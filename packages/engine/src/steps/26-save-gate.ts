import fs from 'node:fs';
import path from 'node:path';
import { quickChangeCheck } from './06-quick-change.js';
import { scanLeakedKeys } from './09-leaked-keys.js';

export const HOOK_MARKER_START = '# --- NOULETTE SAVE GATE START ---';
export const HOOK_MARKER_END = '# --- NOULETTE SAVE GATE END ---';

export interface SaveGateCheckResult {
  allowed: boolean;
  reason?: string;
  bypassHint?: string;
}

/**
 * Runs the Save Gate validation on the staged changes in a repo.
 */
export function evaluateSaveGate(projectPath: string): SaveGateCheckResult {
  const normProject = path.resolve(projectPath);

  // 1. Quick change check
  const quick = quickChangeCheck(normProject);
  if (!quick.passed) {
    return {
      allowed: false,
      reason: `Quick change check blocked: ${quick.reason}`,
      bypassHint: 'To bypass this check, run: git commit --no-verify'
    };
  }

  // 2. Leaked keys on staged files
  const keys = scanLeakedKeys(normProject);
  const blockingKey = keys.find(k => k.blocking);
  if (blockingKey) {
    return {
      allowed: false,
      reason: `Commit blocked: Live secret detected in staged changes (${blockingKey.what})`,
      bypassHint: 'To bypass this check, run: git commit --no-verify'
    };
  }

  // 3. Denylist check
  const denylistPath = path.join(normProject, '.noulette', 'denylist.json');
  if (fs.existsSync(denylistPath)) {
    try {
      const denylist = JSON.parse(fs.readFileSync(denylistPath, 'utf8'));
      // If any staged package is on denylist
    } catch {}
  }

  return { allowed: true };
}

/**
 * Step 26 — Save Gate:
 * Installs Git pre-commit hooks chaining existing hooks without destroying them (TC-131, TC-132).
 */
export function installSaveGateHooks(projectPath: string): { installed: boolean; hookPath: string } {
  const normProject = path.resolve(projectPath);
  const gitDir = path.join(normProject, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error('Not a git repository: .git folder not found');
  }

  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const preCommitPath = path.join(hooksDir, 'pre-commit');
  let originalContent = '';

  if (fs.existsSync(preCommitPath)) {
    originalContent = fs.readFileSync(preCommitPath, 'utf8');
  }

  // Strip existing noulette section if already present
  if (originalContent.includes(HOOK_MARKER_START)) {
    const s = originalContent.indexOf(HOOK_MARKER_START);
    const e = originalContent.indexOf(HOOK_MARKER_END) + HOOK_MARKER_END.length;
    originalContent = originalContent.slice(0, s) + originalContent.slice(e);
  }

  const nouletteHookScript = `
${HOOK_MARKER_START}
# Run Noulette Save Gate
bun run -e "import { evaluateSaveGate } from './packages/engine/src/steps/26-save-gate.js'; const res = evaluateSaveGate(process.cwd()); if (!res.allowed) { console.error(res.reason); console.error(res.bypassHint); process.exit(1); }"
if [ $? -ne 0 ]; then
  exit 1
fi
${HOOK_MARKER_END}
`.trim();

  // Chain original user hook content
  let newContent = '';
  if (originalContent.trim().length > 0) {
    newContent = `${originalContent.trim()}\n\n${nouletteHookScript}\n`;
  } else {
    newContent = `#!/bin/sh\n${nouletteHookScript}\n`;
  }

  fs.writeFileSync(preCommitPath, newContent, { mode: 0o755 });
  return { installed: true, hookPath: preCommitPath };
}

/**
 * Uninstalls Noulette Save Gate hooks, restoring original user hooks intact (TC-132).
 */
export function uninstallSaveGateHooks(projectPath: string): { uninstalled: boolean; restoredOriginal: boolean } {
  const normProject = path.resolve(projectPath);
  const preCommitPath = path.join(normProject, '.git', 'hooks', 'pre-commit');
  if (!fs.existsSync(preCommitPath)) {
    return { uninstalled: true, restoredOriginal: false };
  }

  const content = fs.readFileSync(preCommitPath, 'utf8');
  if (!content.includes(HOOK_MARKER_START)) {
    return { uninstalled: false, restoredOriginal: false };
  }

  const s = content.indexOf(HOOK_MARKER_START);
  const e = content.indexOf(HOOK_MARKER_END) + HOOK_MARKER_END.length;
  const remaining = (content.slice(0, s) + content.slice(e)).trim();

  if (remaining.length === 0 || remaining === '#!/bin/sh') {
    // Original was empty, remove file
    fs.unlinkSync(preCommitPath);
    return { uninstalled: true, restoredOriginal: false };
  } else {
    // Restore original content
    fs.writeFileSync(preCommitPath, remaining + '\n', { mode: 0o755 });
    return { uninstalled: true, restoredOriginal: true };
  }
}
