import fs from 'node:fs';
import path from 'node:path';
import { kvGet, getDb } from '../core/db.js';
import { projectKey } from '../core/paths.js';
import { getSettings, effortCaps } from '../core/settings.js';
import { createRun, latestRun, updateRun, getRun, runJob, type RunRow } from '../core/runs.js';
import { notify, latestApproval, verifyApprovalSignature, resolveByKind, getNotification, resolveNotification } from '../core/events.js';
import { setProjectState, getProject, listProjects, listRepoFiles } from '../core/projects.js';
import * as git from '../core/git.js';
import { run, splitCommand } from '../core/proc.js';
import { NouletteError, type ToolResult, type InspectionData } from '../inspect/pipeline.js';
import { getFindings, setFindingStatus, tldr } from '../inspect/store.js';
import { scanSecrets, scanDependencies, scanSast, scanMocks, detectAnalytics, finalize, fingerprint } from '../inspect/scanners.js';
import { runDast, parseStartAnswer, stopApp } from '../inspect/dast.js';
import { archiveVulnMd, vulnPath } from '../inspect/vulnmd.js';
import { fixPrompt } from '../inspect/prompts.js';
import { safeJoin } from '../core/paths.js';
import type { Finding } from '../inspect/types.js';

export interface BuildData {
  mode: 'auto' | 'approved';
  inspectionId: string;
  approvalId: string | null;
  items: string[];
  needsYou: string[];
  loops: number;
  cap: number;
  secondMethod: boolean;
  branch: string | null;
  base: string | null;
  rollback: string | null;
  history: { loop: number; fixed: string[]; failing: { id: string; reason: string }[]; tests: string; regressions: string[] }[];
}

const KEEP_UNCOMMITTED = ['PLAN.md', 'FUTURE.md', '.gitignore'];

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Copyable commands shown in the merge notification and on Home. */
export function mergeCommands(base: string, branch: string): { merge: string; discard: string } {
  return { merge: `git checkout ${base} && git merge ${branch}`, discard: `git checkout ${base} && git branch -D ${branch}` };
}

function itemView(f: Finding) {
  return { id: f.id, title: f.title, tldr: f.tldr, severity: f.severity, where: f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : null, evidence: f.evidence, fix: f.fix, explanation: f.details?.explanation ?? null, source: f.source, rule: f.rule, humanStepAfterFix: f.fixability === 'both' ? f.humanAction : null };
}

/** Human-only parts are never auto-fixed and never marked resolved. History-only secrets cannot be fixed in code. */
function isCodeFixable(f: Finding): boolean {
  if (f.fixability === 'human') return false;
  if (f.source === 'gitleaks' && f.details?.historyOnly) return false;
  if (f.source === 'osv' && !f.details?.fixedVersion) return false;
  return f.status === 'open' || f.status === 'failed';
}

export async function startBuild(projectPath: string): Promise<ToolResult> {
  const inspection = latestRun<InspectionData>(projectPath, 'inspection');
  if (!inspection || inspection.status !== 'done' || !fs.existsSync(vulnPath(projectPath))) {
    throw new NouletteError('INSPECTION_REQUIRED', 'Inspection has not been completed for this repository. Run noulette_inspect first (paste the Inspect prompt from Noulette Settings).');
  }
  const existing = latestRun<BuildData>(projectPath, 'build');
  if (existing && existing.status === 'running' && existing.data.inspectionId === inspection.id) return buildBrief(projectPath, existing, 'A build is already in progress. Continue fixing these items.');
  const settings = getSettings();
  const caps = effortCaps(settings);
  const findings = getFindings(projectPath, inspection.id).filter((f) => f.status !== 'dismissed');
  let selected: Finding[];
  let approvalId: string | null = null;
  const mode: BuildData['mode'] = settings.autoApprove ? 'auto' : 'approved';
  if (mode === 'approved') {
    const ap = latestApproval(projectPath, 'inspection');
    if (!ap || ap.data?.inspectionId !== inspection.id) throw new NouletteError('NO_APPROVAL', 'There is no fix plan for the latest inspection. Run the inspection again.');
    if (ap.status === 'pending') throw new NouletteError('WAITING_APPROVAL', 'The fix plan is waiting for approval. Ask the user to open Noulette > Approvals and approve it, then call noulette_build again.');
    if (ap.status !== 'approved') throw new NouletteError('REJECTED', 'The user rejected this fix plan. Do not change code.');
    if (!verifyApprovalSignature(ap)) throw new NouletteError('BAD_SIGNATURE', 'The approval signature is invalid. Ask the user to approve again in the Noulette app.');
    approvalId = ap.id;
    const chosen = new Set<string>(ap.data.selection ?? ap.data.items.map((i: any) => i.id));
    selected = findings.filter((f) => chosen.has(f.id));
  } else {
    selected = findings;
  }
  const items = selected.filter(isCodeFixable);
  const needsYou = findings.filter((f) => f.fixability !== 'code' || !isCodeFixable(f)).filter((f) => f.status !== 'fixed');
  let branch: string | null = null;
  let base: string | null = null;
  let rollback: string | null = null;
  const isRepo = await git.isGitRepo(projectPath);
  if (mode === 'auto') {
    if (!isRepo) throw new NouletteError('NEEDS_GIT', 'Auto-approve needs a git repository so fixes can go on a separate branch. Run "git init" and commit, or turn auto-approve off.');
    const dirty = await git.dirtyFiles(projectPath);
    if (dirty.length) throw new NouletteError('UNCOMMITTED_CHANGES', `Auto-fix will not start while you have uncommitted changes, so your work cannot be lost. Commit or stash these first: ${dirty.slice(0, 10).join(', ')}${dirty.length > 10 ? ' ...' : ''}`);
    base = await git.currentBranch(projectPath);
    if (!base) throw new NouletteError('DETACHED_HEAD', 'Check out a branch first (the repository is in "detached HEAD" state).');
    rollback = await git.headCommit(projectPath);
    if (!rollback) throw new NouletteError('NO_COMMITS', 'The repository has no commits yet. Make a first commit, then try again.');
    branch = `noulette/fix-${stamp()}`;
    while (await git.branchExists(projectPath, branch)) branch += '-1';
    if (items.length) await git.createBranch(projectPath, branch);
  } else if (isRepo) {
    rollback = await git.headCommit(projectPath);
  }
  const build = createRun<BuildData>(projectPath, 'build', 'running', {
    mode, inspectionId: inspection.id, approvalId, items: items.map((f) => f.id), needsYou: needsYou.map((f) => f.id), loops: 0, cap: caps.fixLoops, secondMethod: caps.secondMethod, branch: items.length ? branch : null, base, rollback, history: []
  });
  setProjectState(projectPath, { status: 'building' });
  if (!items.length) return finishBuild(projectPath, build, { success: true, failing: [] });
  return buildBrief(projectPath, build, mode === 'auto' ? `Auto-approve is on. Working on branch ${branch} (based on ${base}). Nothing will be merged automatically.` : 'The user approved these fixes.');
}

function buildBrief(projectPath: string, build: RunRow<BuildData>, intro: string): ToolResult {
  const all = getFindings(projectPath, build.data.inspectionId);
  const items = all.filter((f) => build.data.items.includes(f.id) && f.status !== 'fixed');
  const needsYou = all.filter((f) => build.data.needsYou.includes(f.id));
  return {
    ok: true,
    tldr: `Fixing ${items.length} problem${items.length === 1 ? '' : 's'}. ${needsYou.length} need you.`,
    next: [
      intro,
      fixPrompt(),
      `Loop limit: ${build.data.cap} verify rounds (used ${build.data.loops}).`,
      build.data.secondMethod ? 'Extra effort: for each fix, also confirm it with a second method (a test you add, or a live request) and describe it in secondMethod when you call noulette_verify.' : '',
      'For items found by the AI review (source "agent", "mock" or "builtin"), pass aiChecks to noulette_verify: [{findingId, fixed:true, file, line, evidence, note}] pointing at the fixed code.',
      `Do NOT work on these "Needs you" items: ${needsYou.map((f) => f.title).slice(0, 12).join('; ') || 'none'}.`
    ].filter(Boolean).join('\n'),
    data: { buildId: build.id, branch: build.data.branch, base: build.data.base, items: items.map(itemView), needsYou: needsYou.map((f) => ({ id: f.id, title: f.title, action: f.humanAction })) }
  };
}

interface AiCheck {
  findingId: string;
  fixed: boolean;
  file?: string | null;
  line?: number | null;
  evidence?: string | null;
  note: string;
  secondMethod?: string | null;
}

async function detectTestCommand(root: string): Promise<string[] | null> {
  const fromIntake = kvGet<string | null>(`tests:${projectKey(root)}`, null);
  if (fromIntake && !/^(none|no|n\/a|-|\(no answer\))$/i.test(fromIntake.trim())) return splitCommand(fromIntake);
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const t = pj.scripts?.test;
    if (t && !/no test specified/.test(t)) return ['npm', 'test', '--silent'];
  } catch {}
  if (fs.existsSync(path.join(root, 'go.mod'))) return ['go', 'test', './...'];
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) return ['cargo', 'test', '--quiet'];
  if ((fs.existsSync(path.join(root, 'pytest.ini')) || fs.existsSync(path.join(root, 'tests'))) && (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'requirements.txt')))) return ['python', '-m', 'pytest', '-q'];
  return null;
}

async function runTests(root: string): Promise<{ pass: boolean; summary: string }> {
  const cmd = await detectTestCommand(root);
  if (!cmd) return { pass: true, summary: 'no tests found' };
  const r = await run(cmd[0], cmd.slice(1), { cwd: root, timeoutMs: 600_000, shell: process.platform === 'win32' });
  if (r.timedOut) return { pass: false, summary: `tests timed out (${cmd.join(' ')})` };
  const tail = (r.stdout + r.stderr).split(/\r?\n/).filter(Boolean).slice(-15).join('\n');
  return { pass: r.code === 0, summary: r.code === 0 ? `tests passed (${cmd.join(' ')})` : `tests failed (${cmd.join(' ')}):\n${tail}` };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function checkCitation(root: string, c: AiCheck): string | null {
  if (!c.file || !c.line || !c.evidence) return 'aiChecks entry must include file, line and evidence of the fixed code';
  const abs = safeJoin(root, c.file);
  if (!abs || !fs.existsSync(abs)) return `file ${c.file} not found`;
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  if (c.line > lines.length) return `${c.file} has only ${lines.length} lines`;
  const win = norm(lines.slice(Math.max(0, c.line - 4), c.line + 3).join(' '));
  return win.includes(norm(c.evidence)) ? null : `evidence not found near ${c.file}:${c.line}`;
}

function evidenceStillPresent(root: string, f: Finding): boolean {
  if (!f.file || !f.evidence) return false;
  try {
    return norm(fs.readFileSync(path.join(root, f.file), 'utf8')).includes(norm(f.evidence));
  } catch {
    return false;
  }
}

export async function verifyBuild(projectPath: string, input: { aiChecks?: AiCheck[] } = {}, waitMs = 50_000): Promise<ToolResult> {
  const build = latestRun<BuildData>(projectPath, 'build');
  if (!build || build.status !== 'running') throw new NouletteError('NO_BUILD', 'No build in progress. Call noulette_build first.');
  const job = await runJob(`verify:${build.id}:${build.data.loops}`, () => doVerify(projectPath, build, input), waitMs);
  if (!job.done) return { ok: true, tldr: 'Checking the fixes.', next: 'Verification is still running. Call noulette_verify again with the same arguments to get the result.' };
  return job.value;
}

async function doVerify(projectPath: string, build: RunRow<BuildData>, input: { aiChecks?: AiCheck[] }): Promise<ToolResult> {
  const loop = build.data.loops + 1;
  const all = getFindings(projectPath, build.data.inspectionId);
  const items = all.filter((f) => build.data.items.includes(f.id) && f.status !== 'fixed');
  const files = await listRepoFiles(projectPath);
  // 1) Re-run the scanners that raised the findings (plus a full deterministic rescan for the regression diff).
  const [secrets, deps, sast, mocks] = await Promise.all([scanSecrets(projectPath), scanDependencies(projectPath), scanSast(projectPath, files), scanMocks(projectPath, files)]);
  const needDast = items.some((f) => f.source === 'dast');
  const dast = needDast ? await runDast(projectPath, parseStartAnswer(kvGet<string | null>(`start:${projectKey(projectPath)}`, null))) : null;
  if (dast) stopApp(projectPath);
  const analytics = detectAnalytics(projectPath, files);
  const now = [...secrets.findings, ...deps.findings, ...sast.findings, ...mocks.findings, ...(dast?.findings ?? [])].map(finalize);
  const nowFp = new Set(now.map((f) => f.fingerprint));
  const checks = new Map((input.aiChecks ?? []).map((c) => [c.findingId, c]));
  const fixed: string[] = [];
  const failing: { id: string; reason: string }[] = [];
  for (const f of items) {
    let reason: string | null = null;
    switch (f.source) {
      case 'gitleaks':
        if (now.some((n) => n.source === 'gitleaks' && !(n.details as any)?.historyOnly && n.rule === f.rule && n.file === f.file)) reason = 'the secret scanner still finds the key in this file';
        break;
      case 'osv':
        if (now.some((n) => n.source === 'osv' && n.rule === f.rule && (n.details as any)?.package?.name === (f.details as any)?.package?.name)) reason = `the package is still on a vulnerable version (needs ${(f.details as any)?.fixedVersion ?? 'a fixed version'})`;
        break;
      case 'opengrep':
        if (nowFp.has(f.fingerprint) || evidenceStillPresent(projectPath, f) && now.some((n) => n.source === 'opengrep' && n.rule === f.rule && n.file === f.file)) reason = 'the code scanner still flags this code';
        break;
      case 'dast':
        if (!dast?.tested) reason = 'the app could not be started to re-test it';
        else if (now.some((n) => n.source === 'dast' && n.rule === f.rule)) reason = 'the live test still shows the problem';
        break;
      case 'mock':
        if (nowFp.has(f.fingerprint)) reason = 'the placeholder code is still there';
        break;
      case 'builtin':
        if (f.rule === 'monitoring.posthog-missing' && !analytics.posthog) reason = 'PostHog is still not installed';
        break;
      case 'agent': {
        const c = checks.get(f.id);
        if (!c) reason = 'missing aiChecks entry for this AI-found item';
        else if (!c.fixed) reason = `agent reports not fixed: ${c.note}`;
        else {
          const bad = checkCitation(projectPath, c);
          if (bad) reason = bad;
          else if (evidenceStillPresent(projectPath, f)) reason = 'the original problem code is unchanged';
          else if (build.data.secondMethod && !(c.secondMethod && c.secondMethod.trim().length >= 15)) reason = 'Extra effort needs a second-method check (secondMethod)';
        }
        break;
      }
    }
    if (reason) failing.push({ id: f.id, reason });
    else fixed.push(f.id);
  }
  // 2) Project tests.
  const tests = await runTests(projectPath);
  // 3) Regression diff: anything new that was not there at inspection time.
  const baseline = new Set(all.map((f) => f.fingerprint));
  const regressions = now.filter((n) => !baseline.has(n.fingerprint)).map((n) => `${n.title} at ${n.file ?? '?'}${n.line ? ':' + n.line : ''} (${n.rule})`);
  const history = [...build.data.history, { loop, fixed, failing, tests: tests.summary, regressions }];
  const updated = updateRun<BuildData>(build.id, { data: { loops: loop, history } });
  if (fixed.length) setFindingStatus(fixed, 'fixed');
  const success = failing.length === 0 && tests.pass && regressions.length === 0;
  if (success || loop >= build.data.cap) return finishBuild(projectPath, updated, { success, failing, tests: tests.summary, regressions });
  return {
    ok: false,
    tldr: `Round ${loop} of ${build.data.cap}: ${fixed.length} fixed, ${failing.length} not yet${tests.pass ? '' : ', tests failing'}${regressions.length ? `, ${regressions.length} new problem(s)` : ''}.`,
    next: [
      `Verification round ${loop} of ${build.data.cap} did not pass. Fix the following, then call noulette_verify again.`,
      failing.length ? `Not fixed yet:\n${failing.map((x) => `- ${x.id}: ${x.reason}`).join('\n')}` : '',
      tests.pass ? '' : `Project tests: ${tests.summary}`,
      regressions.length ? `New problems introduced by the changes (must be removed):\n- ${regressions.join('\n- ')}` : ''
    ].filter(Boolean).join('\n\n'),
    data: { loop, cap: build.data.cap, fixed, failing, tests: tests.summary, regressions }
  };
}

async function finishBuild(projectPath: string, build: RunRow<BuildData>, r: { success: boolean; failing: { id: string; reason: string }[]; tests?: string; regressions?: string[] }): Promise<ToolResult> {
  const name = path.basename(projectPath);
  const inspection = getRun<InspectionData>(build.data.inspectionId)!;
  if (r.failing.length) setFindingStatus(r.failing.map((x) => x.id), 'failed');
  const needsYouFindings = getFindings(projectPath, build.data.inspectionId).filter((f) => build.data.needsYou.includes(f.id) || (f.fixability === 'both' && f.status === 'fixed'));
  // "Both" items keep their human step: they become "needs you" after the code part is fixed. Never Resolved.
  const stillHuman = needsYouFindings.filter((f) => f.status !== 'dismissed');
  setFindingStatus(stillHuman.filter((f) => f.fixability !== 'code').map((f) => f.id), 'needs_you');
  const all = getFindings(projectPath, build.data.inspectionId);
  const fixedCount = all.filter((f) => f.status === 'fixed').length;
  const needsYou = all.filter((f) => f.status === 'needs_you');
  if (r.success) archiveVulnMd(projectPath, needsYou, { inspectionId: build.data.inspectionId, scanners: inspection.data.scanners, coverage: inspection.data.coverage, all });
  let branchInfo: any = null;
  if (build.data.mode === 'auto' && build.data.branch && build.data.base) {
    const head = await git.commitAll(projectPath, r.success ? `noulette: verified fixes (${fixedCount})` : `noulette: partial fixes (${fixedCount} verified, ${r.failing.length} failing)`, KEEP_UNCOMMITTED);
    await git.checkout(projectPath, build.data.base);
    if (!head) {
      await git.rawGit(projectPath, ['branch', '-D', build.data.branch]);
    } else {
      const cmds = mergeCommands(build.data.base, build.data.branch);
      const nid = notify({
        project: projectPath, severity: 'info', kind: 'merge-ready', sticky: true, alert: true,
        title: r.success ? `Fixes ready to merge: ${name}` : `Some fixes ready, some failed: ${name}`,
        body: `Fixes were made on a separate branch and were NOT merged. Branch ${build.data.branch} (from ${build.data.base}). ${fixedCount} fixed, ${needsYou.length} need you${r.failing.length ? `, ${r.failing.length} could not be fixed` : ''}.`,
        data: { branch: build.data.branch, base: build.data.base, head, commands: cmds, fixed: fixedCount, needsYou: needsYou.length, failed: r.failing.length },
        dedupeKey: `${projectKey(projectPath)}:${build.data.branch}`
      });
      branchInfo = { name: build.data.branch, base: build.data.base, head, rollback: build.data.rollback!, fixed: fixedCount, needsYou: needsYou.length, notificationId: nid };
    }
  } else {
    notify({
      project: projectPath, severity: r.success ? 'info' : 'warning', kind: 'build-finished', alert: true,
      title: r.success ? `Fixes verified: ${name}` : `Some fixes could not be verified: ${name}`,
      body: `${fixedCount} fixed, ${needsYou.length} need you${r.failing.length ? `, ${r.failing.length} failed after ${build.data.loops} rounds` : ''}.`,
      data: { buildId: build.id }, dedupeKey: projectKey(projectPath)
    });
  }
  resolveByKind('critical-finding', projectKey(projectPath));
  updateRun<BuildData>(build.id, { status: r.success ? 'done' : 'stopped', finished: true });
  setProjectState(projectPath, { status: branchInfo ? 'branch_waiting' : 'ready', branch: branchInfo });
  const t = tldr(all);
  const cmds = branchInfo ? mergeCommands(branchInfo.base, branchInfo.name) : null;
  return {
    ok: r.success,
    tldr: r.success ? `All clear. ${fixedCount} fixed, ${needsYou.length} need you.` : `Stopped after ${build.data.loops} rounds. ${fixedCount} fixed, ${r.failing.length} could not be fixed, ${needsYou.length} need you.`,
    next: [
      r.success ? 'Verification passed (scanners, tests and regression check). Stop changing code.' : 'The loop limit was reached. Stop changing code and report what is left.',
      cmds ? `The fixes are on branch ${branchInfo.name} and were NOT merged. Tell the user they can merge with: ${cmds.merge}  or discard with: ${cmds.discard}` : '',
      needsYou.length ? `Tell the user these need them: ${needsYou.map((f) => `${f.title} (${f.humanAction ?? 'decision'})`).slice(0, 8).join('; ')}` : '',
      r.failing.length ? `Could not fix: ${r.failing.map((x) => x.reason).slice(0, 6).join('; ')}` : ''
    ].filter(Boolean).join('\n'),
    data: { counts: t, branch: branchInfo, commands: cmds, failing: r.failing, tests: r.tests ?? null, regressions: r.regressions ?? [] }
  };
}

/**
 * Detects whether a waiting fix branch was merged or deleted, then resolves its notification
 * (moving it to History) and clears the Home card.
 */
export async function checkFixBranches(): Promise<number> {
  let changed = 0;
  for (const p of listProjects()) {
    const b = p.state.branch;
    if (!b || !fs.existsSync(p.path)) continue;
    let outcome: 'merged' | 'discarded' | null = null;
    if (!(await git.branchExists(p.path, b.name))) {
      outcome = (await git.isAncestor(p.path, b.head, b.base)) ? 'merged' : 'discarded';
    } else if (await git.isAncestor(p.path, b.head, b.base)) outcome = 'merged';
    if (!outcome) continue;
    const n = getNotification(b.notificationId);
    if (n) {
      resolveNotification(n.id);
      // Record the outcome on the (now resolved, in History) notification itself; no new alert.
      getDbUpdateOutcome(n.id, outcome);
    }
    setProjectState(p.path, { branch: null, status: p.state.status === 'branch_waiting' ? 'ready' : p.state.status });
    changed++;
  }
  return changed;
}

function getDbUpdateOutcome(id: string, outcome: 'merged' | 'discarded'): void {
  const n = getNotification(id);
  if (!n) return;
  getDb().query('UPDATE notifications SET data=?, body=? WHERE id=?').run(JSON.stringify({ ...n.data, outcome }), `${n.body} Outcome: ${outcome === 'merged' ? 'merged' : 'discarded'}.`, id);
}

export function buildStatus(projectPath: string): ToolResult {
  const b = latestRun<BuildData>(projectPath, 'build');
  if (!b) return { ok: true, tldr: 'No build yet.', next: 'Call noulette_build after inspection.' };
  return { ok: true, tldr: `Build ${b.status}, round ${b.data.loops} of ${b.data.cap}.`, next: b.status === 'running' ? 'Continue fixing and call noulette_verify.' : 'Nothing to do.', data: { ...b.data, status: b.status } };
}

export { getProject };
