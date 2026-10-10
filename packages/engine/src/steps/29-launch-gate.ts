import path from 'node:path';
import { verifySeal } from './28-seal.js';
import { evaluateMergeGate } from './27-merge-gate.js';

export interface LaunchGateResult {
  allowed: boolean;
  exitCode: number;
  reason?: string;
  sealMatches: boolean;
  receiptValid: boolean;
}

/**
 * Step 29 — Launch Gate:
 * Evaluates artifact directory against seal.json and verifies release receipt (TC-135).
 */
export function evaluateLaunchGate(
  artifactDir: string,
  projectPath: string = artifactDir
): LaunchGateResult {
  const normProject = path.resolve(projectPath);
  const normArtifact = path.resolve(artifactDir);

  // 1. Verify seal integrity
  const sealResult = verifySeal(normArtifact, normProject);
  if (!sealResult.matches) {
    return {
      allowed: false,
      exitCode: 1,
      reason: `Artifact seal check failed: ${sealResult.reason}`,
      sealMatches: false,
      receiptValid: false
    };
  }

  // 2. Verify release receipt
  const gateResult = evaluateMergeGate(normProject);
  if (!gateResult.passed) {
    return {
      allowed: false,
      exitCode: 2,
      reason: `Release receipt verification failed: ${gateResult.reason}`,
      sealMatches: true,
      receiptValid: false
    };
  }

  return {
    allowed: true,
    exitCode: 0,
    sealMatches: true,
    receiptValid: true
  };
}
