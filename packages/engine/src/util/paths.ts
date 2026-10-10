import path from 'node:path';
import os from 'node:os';

/**
 * Returns the global AppData directory (%APPDATA%\noulette).
 * Can be overridden with NOULETTE_APPDATA_DIR for tests.
 */
export function getAppDataDir(): string {
  if (process.env.NOULETTE_APPDATA_DIR) {
    return path.resolve(process.env.NOULETTE_APPDATA_DIR);
  }
  const appData = process.env.APPDATA || (
    process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Roaming')
      : path.join(os.homedir(), '.config')
  );
  return path.join(appData, 'noulette');
}

/**
 * Returns the quarantine root directory (%LOCALAPPDATA%\noulette\quarantine).
 * Can be overridden with NOULETTE_LOCALAPPDATA_DIR for tests.
 */
export function getLocalAppDataDir(): string {
  if (process.env.NOULETTE_LOCALAPPDATA_DIR) {
    return path.resolve(process.env.NOULETTE_LOCALAPPDATA_DIR);
  }
  const localAppData = process.env.LOCALAPPDATA || (
    process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.local', 'share')
  );
  return path.join(localAppData, 'noulette');
}

export function getQuarantineRoot(): string {
  return path.join(getLocalAppDataDir(), 'quarantine');
}

export function getCasesDir(): string {
  return path.join(getAppDataDir(), 'cases');
}

export function getCaseDir(caseId: string): string {
  return path.join(getCasesDir(), caseId);
}

export function getGlobalConfigPath(): string {
  return path.join(getAppDataDir(), 'config.json');
}

export function getProjectsRegistryPath(): string {
  return path.join(getAppDataDir(), 'projects.json');
}

export function getGlobalSecretKeyPath(): string {
  return path.join(getAppDataDir(), 'secret.key');
}

export function getGlobalPubKeyPath(): string {
  return path.join(getAppDataDir(), 'pubkey');
}

export function getProjectNouletteDir(projectPath: string): string {
  return path.join(projectPath, '.noulette');
}
