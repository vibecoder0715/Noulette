import { describe, it, expect, afterAll } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, copyFixture, FIXTURE_SHOP, initRepo, git, rm } from './helpers.ts';
import { inspectStart, savePlanAndScan, submitFindings } from '../packages/engine/src/inspect/pipeline.ts';
import { startBuild, verifyBuild, checkFixBranches } from '../packages/engine/src/build/build.ts';
import { listApprovals, decideApproval, listNotifications, getApproval } from '../packages/engine/src/core/events.ts';
import { updateSettings } from '../packages/engine/src/core/settings.ts';
import { getProject } from '../packages/engine/src/core/projects.ts';
import { latestRun } from '../packages/engine/src/core/runs.ts';
import { getFindings } from '../packages/engine/src/inspect/store.ts';
import { getDb } from '../packages/engine/src/core/db.ts';
import { stateSnapshot } from '../packages/engine/src/daemon/api.ts';

const cleanup: string[] = [];
afterAll(() => cleanup.forEach(rm));

const ANSWERS = [
  { id: 'description', answer: 'Candle shop' },
  { id: 'goal', answer: 'Launch' },
  { id: 'users', answer: '1000' },
  { id: 'audience', answer: 'Adults in Malaysia' },
  { id: 'data', answer: 'Emails and payments' }
];

const DISCOUNT = { checkId: 'L3', label: 'business', severity: 'high', title: 'Discount can be any percent', tldr: 'A shopper can set a 100% discount and pay nothing.', file: 'src/server.js', line: 21, evidence: 'cart.total = cart.total - (cart.total * percent) / 100;', planRef: null, explanation: 'percent comes from the request without limits.', fix: 'Cap and validate the discount.', fixability: 'code', humanAction: null, confidence: 'confirmed' };
const SCALE = { checkId: 'F3', label: 'scale', severity: 'high', title: 'Carts live in memory', tldr: 'Carts disappear on restart.', file: 'src/db.js', line: 2, evidence: 'const carts = new Map();', planRef: 'users', explanation: 'Needs a real database for 1000 users.', fix: 'Use Postgres.', fixability: 'human', humanAction: 'Choose a database.', confidence: 'confirmed' };

async function inspect(repo: string) {
  await inspectStart(repo);
  let r = await savePlanAndScan(repo, ANSWERS, 600_000);
  for (const stage of ['logic', 'feasibility', 'legal'] as const) {
    const items = (r.data as any).checklist as { id: string }[];
    const findings = stage === 'logic' ? [DISCOUNT] : stage === 'feasibility' ? [SCALE] : [];
    const ids = findings.map((f) => f.checkId);
    r = submitFindings({ projectPath: repo, stage, pass: 1, coverage: items.map((i) => ({ id: i.id, result: ids.includes(i.id) ? 'finding' : 'ok', note: i.id === 'L9' ? 'Tried SQL (OR 1=1, UNION), NoSQL $ne, XSS <script>, command ; id and path traversal ../ on every input.' : 'checked the code' })), findings });
    expect(r.ok).toBe(true);
  }
  return r;
}

function edit(repo: string, file: string, from: string, to: string) {
  const p = path.join(repo, file);
  const t = fs.readFileSync(p, 'utf8');
  if (!t.includes(from)) throw new Error(`fixture text not found: ${from}`);
  fs.writeFileSync(p, t.replace(from, to));
}

/** The fixes a good agent would make for the shop fixture. */
function applyGoodFixes(repo: string) {
  edit(repo, 'src/server.js', "const STRIPE_SECRET = 'sk_live_51HxQ2bLkdj39sjdKSJDk39sdkJSD93kdjsKDJ39sdk';", 'const STRIPE_SECRET = process.env.STRIPE_SECRET;');
  edit(repo, 'src/server.js', `const rows = await db.query("SELECT * FROM orders WHERE user_id = '" + req.params.userId + "'");`, "const rows = await db.query('SELECT * FROM orders WHERE user_id = ?', [req.params.userId]);");
  edit(repo, 'src/server.js', 'cart.total = cart.total - (cart.total * percent) / 100;', 'const pct = Math.min(30, Math.max(0, Number(percent) || 0));\n  cart.total = Math.round(cart.total * (100 - pct)) / 100;');
  edit(repo, 'src/server.js', "exec('generate-report ' + req.query.name, (err, out) => res.send(out));", "execFile('generate-report', [String(req.query.name).replace(/[^a-z0-9-]/gi, '')], (err, out) => res.send(out));");
  edit(repo, 'src/server.js', "const { exec } = require('child_process');", "const { execFile } = require('child_process');");
  const pj = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  pj.dependencies['posthog-node'] = '4.0.0';
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify(pj, null, 2));
}

function discountCheck(repo: string, id: string) {
  const lines = fs.readFileSync(path.join(repo, 'src/server.js'), 'utf8').split(/\r?\n/);
  const line = lines.findIndex((l) => l.includes('Math.min(30')) + 1;
  return { findingId: id, fixed: true, file: 'src/server.js', line, evidence: 'Math.min(30, Math.max(0, Number(percent) || 0))', note: 'Clamped on the server' };
}

describe('M3 BUILD with human approval', () => {
  it('TC-M3-01 BUILD waits for approval, refuses rejected or tampered approvals', async () => {
    tempHome();
    const repo = copyFixture(FIXTURE_SHOP);
    cleanup.push(repo);
    await inspect(repo);
    await expect(startBuild(repo)).rejects.toThrow(/waiting for approval/);
    const ap = listApprovals('pending').find((a) => a.kind === 'inspection')!;
    decideApproval(ap.id, 'approved', ap.data.items.slice(0, 1).map((i: any) => i.id));
    getDb().query('UPDATE approvals SET data=? WHERE id=?').run(JSON.stringify({ ...getApproval(ap.id)!.data, selection: ap.data.items.map((i: any) => i.id) }), ap.id);
    await expect(startBuild(repo)).rejects.toThrow(/signature is invalid/);
  }, 600_000);

  it('TC-M3-02 approved fixes are verified by the original scanners, tests and regression diff; VULN.md archived with All clear', async () => {
    tempHome();
    const repo = copyFixture(FIXTURE_SHOP);
    cleanup.push(repo);
    await inspect(repo);
    const ap = listApprovals('pending').find((a) => a.kind === 'inspection')!;
    const pick = ap.data.items.filter((i: any) => /Leaked password|Database flaw|Command takeover|Discount/.test(i.title)).map((i: any) => i.id);
    expect(pick.length).toBe(4);
    decideApproval(ap.id, 'approved', pick);
    const b = await startBuild(repo);
    const items = (b.data as any).items as any[];
    expect(items.map((i) => i.title).sort()).toEqual(['Command takeover', 'Database flaw', 'Discount can be any percent', 'Leaked password or key']);
    const needsYou = (b.data as any).needsYou as any[];
    expect(needsYou.some((n) => n.title === 'Carts live in memory')).toBe(true);
    // Round 1: nothing fixed yet.
    let v = await verifyBuild(repo, {}, 600_000);
    expect(v.ok).toBe(false);
    expect((v.data as any).failing.length).toBe(4);
    applyGoodFixes(repo);
    const discount = items.find((i) => i.title.startsWith('Discount'));
    v = await verifyBuild(repo, { aiChecks: [discountCheck(repo, discount.id)] }, 600_000);
    expect(v.tldr).toContain('All clear');
    expect(v.ok).toBe(true);
    const vuln = fs.readFileSync(path.join(repo, 'VULN.md'), 'utf8');
    expect(vuln).toContain('## All clear');
    const hist = fs.readdirSync(path.join(repo, '.noulette', 'history'));
    expect(hist.length).toBe(1);
    const run = latestRun(repo, 'inspection')!;
    const fs2 = getFindings(repo, run.id);
    const secret = fs2.find((f) => f.source === 'gitleaks')!;
    expect(secret.status).toBe('needs_you');
    expect(fs2.find((f) => f.title === 'Carts live in memory')!.status).toBe('needs_you');
    expect(fs2.find((f) => f.rule === 'nl.js.sql-concat')!.status).toBe('fixed');
    expect(listNotifications().main.some((n) => n.kind === 'build-finished')).toBe(true);
  }, 600_000);

  it('TC-M3-03 regressions and failing project tests block "all clear"; loop stops at the Standard cap (2)', async () => {
    tempHome();
    const repo = copyFixture(FIXTURE_SHOP);
    cleanup.push(repo);
    await inspect(repo);
    const ap = listApprovals('pending').find((a) => a.kind === 'inspection')!;
    decideApproval(ap.id, 'approved', ap.data.items.filter((i: any) => i.title === 'Database flaw').map((i: any) => i.id));
    await startBuild(repo);
    edit(repo, 'src/server.js', `const rows = await db.query("SELECT * FROM orders WHERE user_id = '" + req.params.userId + "'");`, "const rows = await db.query('SELECT * FROM orders WHERE user_id = ?', [req.params.userId]);\n  eval(req.query.debug);");
    const pj = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
    pj.scripts.test = 'node -e "process.exit(3)"';
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify(pj, null, 2));
    let v = await verifyBuild(repo, {}, 600_000);
    expect(v.ok).toBe(false);
    expect((v.data as any).regressions.join()).toMatch(/Code takeover/);
    expect((v.data as any).tests).toMatch(/tests failed/);
    v = await verifyBuild(repo, {}, 600_000);
    expect(v.tldr).toMatch(/Stopped after 2 rounds/);
    expect(latestRun(repo, 'build')!.status).toBe('stopped');
  }, 600_000);
});

describe('M3 auto-approve', () => {
  async function autoRepo() {
    tempHome();
    updateSettings({ autoApprove: true });
    const repo = copyFixture(FIXTURE_SHOP);
    cleanup.push(repo);
    fs.rmSync(path.join(repo, 'package-lock.json'));
    initRepo(repo);
    return repo;
  }

  it('TC-M3-04 refuses without git or with uncommitted changes', async () => {
    tempHome();
    updateSettings({ autoApprove: true });
    const nogit = copyFixture(FIXTURE_SHOP);
    cleanup.push(nogit);
    const fin = await inspect(nogit);
    expect(fin.next).toContain('Auto-approve is ON');
    await expect(startBuild(nogit)).rejects.toThrow(/needs a git repository/);
    const repo = await autoRepo();
    await inspect(repo);
    fs.appendFileSync(path.join(repo, 'src/catalog.js'), '\n// my unsaved work\n');
    await expect(startBuild(repo)).rejects.toThrow(/uncommitted changes/);
    expect(fs.readFileSync(path.join(repo, 'src/catalog.js'), 'utf8')).toContain('my unsaved work');
  }, 600_000);

  it('TC-M3-05 one-shot fixes on a safety branch, never merged, with copyable merge/discard commands and a Needs-you list', async () => {
    const repo = await autoRepo();
    await inspect(repo);
    expect(listApprovals('pending').length).toBe(0);
    const baseHead = git(repo, 'rev-parse', 'HEAD').trim();
    const b = await startBuild(repo);
    const branch = (b.data as any).branch as string;
    expect(branch).toMatch(/^noulette\/fix-\d{8}-\d{6}/);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(branch);
    applyGoodFixes(repo);
    const items = (b.data as any).items as any[];
    const discount = items.find((i) => i.title.startsWith('Discount'));
    const v = await verifyBuild(repo, { aiChecks: [discountCheck(repo, discount.id)] }, 600_000);
    expect(v.ok, v.next).toBe(true);
    // Back on main, untouched; fixes only on the branch.
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(baseHead);
    expect(fs.readFileSync(path.join(repo, 'src/server.js'), 'utf8')).toContain('sk_live_');
    expect(git(repo, 'show', `${branch}:src/server.js`)).toContain('process.env.STRIPE_SECRET');
    const cmds = (v.data as any).commands;
    expect(cmds.merge).toBe(`git checkout main && git merge ${branch}`);
    expect(cmds.discard).toBe(`git checkout main && git branch -D ${branch}`);
    const n = listNotifications().main.find((x) => x.kind === 'merge-ready')!;
    expect(n.severity).toBe('info');
    expect(n.sticky).toBe(1);
    expect(n.body).toContain('NOT merged');
    expect(n.data.commands.merge).toBe(cmds.merge);
    const card = (stateSnapshot() as any).card;
    expect(card.status).toBe('branch_waiting');
    expect(card.branch.commands.discard).toBe(cmds.discard);
    expect(v.next).toMatch(/need them: .*Carts live in memory/);
    // Reading it does not remove it while the branch waits.
    getDb().query('UPDATE notifications SET read=1').run();
    expect(listNotifications().main.some((x) => x.kind === 'merge-ready')).toBe(true);
    // The user merges with the copied command; the next check resolves it into History.
    for (const part of cmds.merge.split(' && ')) git(repo, ...part.split(' ').slice(1));
    expect(await checkFixBranches()).toBe(1);
    expect(listNotifications().main.some((x) => x.kind === 'merge-ready')).toBe(false);
    expect(listNotifications().history.find((x) => x.kind === 'merge-ready')!.resolved).toBe(1);
    expect(getProject(repo)!.state.branch).toBeNull();
  }, 600_000);

  it('TC-M3-06 discarding the branch is detected too', async () => {
    const repo = await autoRepo();
    await inspect(repo);
    const b = await startBuild(repo);
    applyGoodFixes(repo);
    const discount = ((b.data as any).items as any[]).find((i) => i.title.startsWith('Discount'));
    const v = await verifyBuild(repo, { aiChecks: [discountCheck(repo, discount.id)] }, 600_000);
    expect(v.ok, v.next).toBe(true);
    const cmds = (v.data as any).commands;
    for (const part of cmds.discard.split(' && ')) git(repo, ...part.split(' ').slice(1));
    expect(await checkFixBranches()).toBe(1);
    expect(listNotifications().history.find((x) => x.kind === 'merge-ready')!.data.outcome).toBe('discarded');
  }, 600_000);

  it('TC-M3-07 hard loop cap of 3 even on Standard effort; branch kept with partial work and what is left', async () => {
    const repo = await autoRepo();
    await inspect(repo);
    const b = await startBuild(repo);
    const branch = (b.data as any).branch;
    edit(repo, 'src/server.js', "const STRIPE_SECRET = 'sk_live_51HxQ2bLkdj39sjdKSJDk39sdkJSD93kdjsKDJ39sdk';", 'const STRIPE_SECRET = process.env.STRIPE_SECRET;');
    let v;
    for (let i = 0; i < 3; i++) v = await verifyBuild(repo, {}, 600_000);
    expect(v!.tldr).toMatch(/Stopped after 3 rounds/);
    expect(latestRun(repo, 'build')!.data.cap).toBe(3);
    expect(git(repo, 'branch', '--list', branch).trim()).not.toBe('');
    expect(git(repo, 'log', '-1', '--format=%s', branch)).toMatch(/partial fixes/);
    expect(v!.next).toMatch(/Could not fix/);
    await expect(verifyBuild(repo, {}, 1000)).rejects.toThrow(/No build in progress/);
  }, 600_000);
});
