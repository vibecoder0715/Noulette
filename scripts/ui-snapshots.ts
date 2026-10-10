/**
 * Visual check: starts a throwaway daemon with demo data, renders every page in headless Edge
 * (light + dark) and writes PNGs to %TEMP%\nl-shots.
 *   bun run scripts/ui-snapshots.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
process.env.NOULETTE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-shot-home-'));
process.env.NOULETTE_UI = path.join(root, 'apps', 'desktop', 'dist');
process.env.NOULETTE_DOWNLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-shot-dl-'));
const { startDaemon, apiToken } = await import('../packages/engine/src/daemon/server.ts');
await import('../packages/engine/src/features.ts');
const { registerProject } = await import('../packages/engine/src/core/projects.ts');
const { notify, createApproval } = await import('../packages/engine/src/core/events.ts');
const { writePlan } = await import('../packages/engine/src/inspect/plan.ts');
const { writeFuture } = await import('../packages/engine/src/plans/future.ts');

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-shot-proj-'));
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ dependencies: { express: '4', sqlite3: '5' } }));
writePlan(proj, [{ q: 'How many users do you expect in the next 12 months?', a: '1000' }]);
registerProject(proj);
writeFuture(proj);
notify({ severity: 'critical', kind: 'critical-finding', title: '3 serious problems in shop-app', body: 'Leaked password or key, Database flaw, Command takeover', alert: false });
notify({ severity: 'info', kind: 'merge-ready', sticky: true, title: 'Fixes ready to merge: shop-app', body: 'Fixes were made on a separate branch and were NOT merged. 4 fixed, 2 need you.', data: { commands: { merge: 'git checkout main && git merge noulette/fix-20261010-120000', discard: 'git checkout main && git branch -D noulette/fix-20261010-120000' } } });
notify({ severity: 'warning', kind: 'monitor-error', title: 'Production check failed', body: 'PostHog answered 401 (check the personal API key).' });
createApproval({ project: proj, kind: 'inspection', title: 'Fix plan for shop-app', summary: '3 critical, 6 should fix, 2 need you.', data: { items: [
  { id: 'a', title: 'Database flaw', tldr: 'Someone could read or change your database by typing special text.', severity: 'critical', label: 'Database flaw', fixability: 'code', where: 'src/server.js:13' },
  { id: 'b', title: 'Leaked password or key', tldr: 'A password or key is written in the code where others can find it.', severity: 'critical', label: 'Leaked password or key', fixability: 'both', humanAction: 'Rotate the key.', where: 'src/server.js:9' },
  { id: 'c', title: 'Carts live in memory', tldr: 'Carts disappear on restart.', severity: 'high', label: 'Will not handle your user count', fixability: 'human', humanAction: 'Choose a database.' }
] } });
createApproval({ kind: 'guard', title: 'Blocked: invoice.pdf.exe', summary: 'This looks like an attack. It was moved to quarantine.', data: { verdict: 'critical', originalPath: 'C:\\Users\\you\\Downloads\\invoice.pdf.exe', reasons: [{ level: 'critical', plain: '"invoice.pdf.exe" pretends to be a document but is a program.' }] } });

const d = await startDaemon({ port: 48931, allowSecond: true });
const tok = apiToken();
const out = path.join(os.tmpdir(), 'nl-shots');
fs.mkdirSync(out, { recursive: true });
const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p))!;
for (const theme of ['bright', 'dark']) {
  for (const page of ['home', 'settings', 'notifications', 'approvals', 'plans', 'manual']) {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-edge-'));
    // Theme is read from localStorage; the inline script sets it before the app loads via a tiny redirect page.
    const url = `http://127.0.0.1:${d.port}/?t=${tok}&theme=${theme}#${page}`;
    // Async: the daemon runs in this process and must keep serving while Edge renders.
    const p = Bun.spawn([edge, '--headless=new', '--disable-gpu', `--user-data-dir=${prof}`, '--window-size=1280,900', '--virtual-time-budget=5000', `--screenshot=${path.join(out, `${theme}-${page}.png`)}`, url], { stdout: 'ignore', stderr: 'ignore' });
    await Promise.race([p.exited, new Promise((r) => setTimeout(r, 30_000))]);
    p.kill();
  }
}
d.stop();
console.log(out);
process.exit(0);
