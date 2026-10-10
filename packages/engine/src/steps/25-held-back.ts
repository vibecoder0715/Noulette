import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface HeldBackState {
  schemaVersion: 1;
  held: boolean;
  reason: string;
  findingIds: string[];
  heldAt: string;
}

/**
 * Step 25 — Held Back:
 * Manages locked state when attempt limit is exhausted or critical blockers remain.
 */
export function setHeldBackState(
  projectPath: string,
  reason: string,
  findingIds: string[]
): HeldBackState {
  const normProject = path.resolve(projectPath);
  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }

  const state: HeldBackState = {
    schemaVersion: 1,
    held: true,
    reason,
    findingIds,
    heldAt: new Date().toISOString()
  };

  atomicWriteJsonSync(path.join(nouletteDir, 'held-back.json'), state);
  return state;
}

export function getHeldBackState(projectPath: string): HeldBackState | null {
  const normProject = path.resolve(projectPath);
  const filePath = path.join(normProject, '.noulette', 'held-back.json');
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function clearHeldBackState(projectPath: string): boolean {
  const normProject = path.resolve(projectPath);
  const filePath = path.join(normProject, '.noulette', 'held-back.json');
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}
