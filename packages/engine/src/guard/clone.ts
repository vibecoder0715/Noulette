import fs from 'node:fs';
import path from 'node:path';
import { run } from '../core/proc.js';
import { newId } from '../core/db.js';
import { NouletteError, type ToolResult } from '../inspect/pipeline.js';
import { scanUnit } from './rules.js';
import { handleScan, quarantineRoot } from './quarantine.js';

function validUrl(u: string): boolean {
  if (/^https:\/\/[\w.-]+\/[\w.\/-]+?(\.git)?\/?$/.test(u)) return true;
  if (/^git@[\w.-]+:[\w.\/-]+?(\.git)?$/.test(u)) return true;
  return path.isAbsolute(u) && fs.existsSync(u);
}

/**
 * Clones into quarantine with every code-running git feature off (hooks, submodules, LFS filters,
 * symlinks, ext:: transport), scans it, and only moves it to the destination when it is safe.
 */
export async function safeClone(url: string, destination: string): Promise<ToolResult> {
  if (!validUrl(url)) throw new NouletteError('BAD_URL', 'Use an https:// or git@ repository address.');
  if (!path.isAbsolute(destination)) throw new NouletteError('BAD_PATH', 'destination must be an absolute folder path.');
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new NouletteError('EXISTS', 'The destination folder already exists and is not empty.');
  const q = path.join(quarantineRoot(), newId('q'), path.basename(destination));
  fs.mkdirSync(path.dirname(q), { recursive: true });
  const hooksOff = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const r = await run('git', [
    '-c', `core.hooksPath=${hooksOff}`, '-c', 'core.symlinks=false', '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=user',
    '-c', 'transfer.fsckObjects=true', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false',
    'clone', '--no-recurse-submodules', '--depth', '50', url, q
  ], { timeoutMs: 600_000, env: { GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' } });
  if (r.code !== 0) {
    fs.rmSync(path.dirname(q), { recursive: true, force: true });
    throw new NouletteError('CLONE_FAILED', `git clone failed: ${r.stderr.trim().slice(0, 300)}`);
  }
  const scan = await scanUnit(q);
  if (scan.verdict === 'safe') {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) fs.rmdirSync(destination);
    fs.renameSync(q, destination);
    fs.rmSync(path.dirname(q), { recursive: true, force: true });
    handleScan(destination, scan, { source: 'clone' });
    return { ok: true, tldr: `Cloned safely to ${destination}. Nothing suspicious found.`, next: 'You can open the project.', data: { destination, files: scan.files } };
  }
  const h = handleScan(q, scan, { source: 'clone', alreadyQuarantined: q, destination });
  return {
    ok: false,
    tldr: scan.verdict === 'critical' ? 'Blocked: this repository looks dangerous. It stays in quarantine.' : 'This repository needs a quick check. It is waiting in quarantine.',
    next: 'Do not open or run anything from this repository. Tell the user to review it in Noulette > Approvals. Only the user can release it.',
    data: { verdict: scan.verdict, reasons: scan.reasons.slice(0, 10).map((x) => x.plain), approvalId: h.approvalId }
  };
}
