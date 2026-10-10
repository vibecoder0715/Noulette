import fs from 'node:fs';
import path from 'node:path';
import { generateCaseId } from '../util/ulid.js';
import { getGlobalConfigPath, getCaseDir } from '../util/paths.js';
import { readJsonSync, atomicWriteJsonSync } from '../util/atomic-fs.js';
import { CaseRecordSchema, type CaseRecord, type CaseType } from '../schema/case.schema.js';
import { GlobalConfigSchema, type GlobalConfig } from '../schema/config.schema.js';
import { routeOrigin, type RouteOptions } from './02-route.js';

export interface ArrivalInput {
  projectPath: string;
  typeHint?: CaseType;
  watcherEvent?: boolean;
}

/**
 * Loads global config from %APPDATA%\noulette\config.json or returns default snapshot.
 */
export function loadGlobalConfig(): GlobalConfig {
  const configPath = getGlobalConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const parsed = readJsonSync<unknown>(configPath);
      return GlobalConfigSchema.parse(parsed);
    } catch {
      // Fallback if invalid
    }
  }

  // Default config
  const defConfig: GlobalConfig = {
    schemaVersion: 1,
    effortTier: 'Medium',
    autoFix: true,
    audio: { enabled: true, volume: 0.8 },
    scanners: { opengrepPath: null, gitleaksPath: null }
  };
  atomicWriteJsonSync(configPath, defConfig);
  return defConfig;
}

/**
 * Step 1 — Something Arrives:
 * Generates case-<ulid> under %APPDATA%\noulette\cases\<id>\case.json.
 * Snapshots tier from %APPDATA%\noulette\config.json.
 */
export function handleArrival(input: ArrivalInput): CaseRecord {
  const config = loadGlobalConfig();
  const route = routeOrigin(input.projectPath, {
    watcherEvent: input.watcherEvent,
    typeHint: input.typeHint
  });

  const caseId = generateCaseId();
  const now = new Date().toISOString();

  const caseRecord: CaseRecord = {
    schemaVersion: 1,
    caseId,
    type: route.type,
    projectPath: path.resolve(input.projectPath),
    tier: config.effortTier,
    status: 'pending',
    routingReason: route.reason,
    createdAt: now,
    updatedAt: now
  };

  // Validate strictly against schema
  CaseRecordSchema.parse(caseRecord);

  // Write to disk
  const caseDir = getCaseDir(caseId);
  if (!fs.existsSync(caseDir)) {
    fs.mkdirSync(caseDir, { recursive: true });
  }

  const caseJsonPath = path.join(caseDir, 'case.json');
  atomicWriteJsonSync(caseJsonPath, caseRecord);

  return caseRecord;
}
