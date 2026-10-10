import { spawn, type ChildProcess, execSync } from 'node:child_process';

export interface RestrictedRunOptions {
  cwd: string;
  timeoutMs?: number;
  extraEnv?: Record<string, string>;
  allowNetwork?: boolean;
}

export interface RestrictedRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const ALLOWED_ENV_VARS = new Set([
  'PATH',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'COMSPEC',
  'PATHEXT',
  'SYSTEMDRIVE',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES',
  'WINDIR',
  'NODE_ENV'
]);

/**
 * Filters environment variables to strictly allowed ones, explicitly stripping secrets and tokens.
 */
export function buildRestrictedEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const safeEnv: Record<string, string> = {};

  for (const [key, val] of Object.entries(process.env)) {
    if (!val) continue;
    const upperKey = key.toUpperCase();

    // Explicitly reject any variable looking like secrets, tokens, keys
    if (
      upperKey.includes('SECRET') ||
      upperKey.includes('TOKEN') ||
      upperKey.includes('KEY') ||
      upperKey.includes('AUTH') ||
      upperKey.startsWith('AWS_') ||
      upperKey.startsWith('GITHUB_') ||
      upperKey.startsWith('SSH_')
    ) {
      continue;
    }

    if (ALLOWED_ENV_VARS.has(upperKey)) {
      safeEnv[key] = val;
    }
  }

  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) {
      safeEnv[k] = v;
    }
  }

  return safeEnv;
}

/**
 * Kills process and all its children.
 * On Windows, uses taskkill /F /T /PID <pid>.
 */
export function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;

  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
    } catch {
      // Process may already have exited
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }
  }
}

/**
 * Runs a command in restricted environment with process tree termination on timeout.
 */
export async function runRestrictedCommand(
  cmd: string,
  args: string[],
  options: RestrictedRunOptions
): Promise<RestrictedRunResult> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const env = buildRestrictedEnv(options.extraEnv);

  return new Promise((resolve) => {
    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += `\nProcess error: ${err.message}`;
      resolve({
        exitCode: 1,
        stdout,
        stderr,
        timedOut
      });
    });
  });
}
