import { spawn } from 'node:child_process';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  input?: string;
  maxBytes?: number;
  shell?: boolean;
}

/**
 * Runs a process with arguments as an array (no shell interpolation), hidden on Windows,
 * with a timeout and output cap. The whole process tree is killed on timeout.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as Record<string, string>,
      windowsHide: true,
      shell: opts.shell ?? false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const done = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs ?? 120_000);
    child.stdout.on('data', (d) => {
      if (stdout.length < maxBytes) stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < maxBytes) stderr += d.toString();
    });
    child.on('error', (e) => done({ code: null, stdout, stderr, timedOut, error: e.message }));
    child.on('close', (code) => done({ code, stdout, stderr, timedOut }));
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export function killTree(pid?: number): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid);
    } catch {}
  }
}

/** Splits a user-provided command line ("npm run start -- --port 3000") into argv without invoking a shell. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (/\s/.test(ch)) {
      if (cur) out.push(cur), (cur = '');
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
