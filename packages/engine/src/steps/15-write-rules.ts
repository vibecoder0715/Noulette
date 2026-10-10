import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export const WIZARD_AREAS = [
  'tenant-isolation',
  'admin-auth',
  'user-ownership',
  'sensitive-exports'
] as const;

export type WizardArea = typeof WIZARD_AREAS[number];

export interface WizardAnswers {
  [area: string]: string | null | undefined;
}

export interface LogicRule {
  id: string;
  area: string;
  description: string;
  assertion: string;
}

export interface LogicRulesConfig {
  schemaVersion: 1;
  answered: Record<string, string>;
  unanswered: string[];
  rules: LogicRule[];
  generatedAt: string;
}

export interface WriteRulesResult {
  config: LogicRulesConfig;
  notCheckedInScorecard: { check: string; explanation: string }[];
}

/**
 * Step 15 — Write the Rules:
 * Generates logic-rules.json from plain-language ownership defaults or wizard answers.
 * Any unanswered area is marked as "not checked" in the scorecard (TC-099).
 */
export function writeLogicRules(
  projectPath: string,
  answers: WizardAnswers = {}
): WriteRulesResult {
  const normProject = path.resolve(projectPath);
  const answered: Record<string, string> = {};
  const unanswered: string[] = [];
  const rules: LogicRule[] = [];
  const notCheckedInScorecard: { check: string; explanation: string }[] = [];

  for (const area of WIZARD_AREAS) {
    const val = answers[area];
    if (val !== undefined && val !== null && val.trim() !== '') {
      answered[area] = val.trim();
      rules.push({
        id: `RULE-${area.toUpperCase().replace(/-/g, '_')}`,
        area,
        description: `Enforce ${area} policy: ${val}`,
        assertion: `require(${area} === '${val}')`
      });
    } else {
      unanswered.push(area);
      notCheckedInScorecard.push({
        check: area,
        explanation: 'not checked'
      });
    }
  }

  const config: LogicRulesConfig = {
    schemaVersion: 1,
    answered,
    unanswered,
    rules,
    generatedAt: new Date().toISOString()
  };

  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }

  atomicWriteJsonSync(path.join(nouletteDir, 'logic-rules.json'), config);

  return { config, notCheckedInScorecard };
}
