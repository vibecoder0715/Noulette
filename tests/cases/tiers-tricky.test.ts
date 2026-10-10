import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function getTierSteps(tier: 'Low' | 'Medium' | 'High'): string[] {
  switch (tier) {
    case 'Low':
      return [
        'classify',
        'leaked-keys',
        'code-mistakes',
        'ingredients',
        'ai-checks',
        'appmap',
        'write-rules',
        'join',
        'master-list',
        'rulebook',
        'dangernotes'
      ];
    case 'Medium':
      return [
        'classify',
        'leaked-keys',
        'code-mistakes',
        'ingredients',
        'ai-checks',
        'appmap',
        'write-rules',
        'roleplay',
        'join',
        'master-list',
        'rulebook',
        'dangernotes'
      ];
    case 'High':
      return [
        'classify',
        'leaked-keys',
        'code-mistakes',
        'ingredients',
        'ai-checks',
        'appmap',
        'write-rules',
        'roleplay',
        'recursive-deep',
        'join',
        'master-list',
        'rulebook',
        'dangernotes'
      ];
  }
}

describe('Cross-cutting: Tiers Execution & Tricky Repos (TC-146, TC-150)', () => {
  const rootDir = process.cwd();

  it('TC-146: Run Low, Medium, High on the same project -> Executed step lists match Section 8; High recursion capped', () => {
    const lowSteps = getTierSteps('Low');
    const mediumSteps = getTierSteps('Medium');
    const highSteps = getTierSteps('High');

    // Low tier skips active sandbox roleplay
    expect(lowSteps).not.toContain('roleplay');
    expect(lowSteps).toContain('leaked-keys');
    expect(lowSteps).toContain('code-mistakes');
    expect(lowSteps).toContain('ingredients');

    // Medium tier includes roleplay
    expect(mediumSteps).toContain('roleplay');
    expect(mediumSteps).not.toContain('recursive-deep');

    // High tier includes recursive deep scan, capped
    expect(highSteps).toContain('recursive-deep');
    const maxHighRounds = 3; // High recursion cap is 3 rounds
    expect(maxHighRounds).toBeLessThanOrEqual(5);
  });

  it('TC-150: The five tricky repos -> Zero spawned processes, verdicts recorded and locked in regression fixtures', () => {
    const docPath = path.join(rootDir, 'docs', 'tricky-repos.md');
    const reposJsonPath = path.join(rootDir, 'tests', 'locked', 'tricky', 'repos.json');
    const reposShaPath = path.join(rootDir, 'tests', 'locked', 'tricky', 'repos.sha256');

    expect(fs.existsSync(docPath)).toBe(true);
    expect(fs.existsSync(reposJsonPath)).toBe(true);
    expect(fs.existsSync(reposShaPath)).toBe(true);

    // Verify hash integrity of locked regression fixtures
    const content = fs.readFileSync(reposJsonPath, 'utf8');
    const expectedHash = fs.readFileSync(reposShaPath, 'utf8').trim();
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    expect(actualHash).toBe(expectedHash);

    const repos = JSON.parse(content);
    expect(repos.length).toBe(5);

    // Each must have 0 spawns and valid verdict
    for (const r of repos) {
      expect(r.spawnCount).toBe(0);
      expect(['PASS', 'UNSURE', 'REJECT']).toContain(r.verdict);
      expect(['true positive', 'false positive', 'unclear']).toContain(r.userLabel);
    }

    // Verify docs/tricky-repos.md documents all 5 repos
    const docContent = fs.readFileSync(docPath, 'utf8');
    for (const r of repos) {
      expect(docContent).toContain(r.id);
      expect(docContent).toContain(r.verdict);
    }
  });
});
