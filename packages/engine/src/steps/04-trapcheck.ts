import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { TrapcheckFinding, TrapcheckInconclusive, TrapcheckResult } from '../schema/trapcheck.schema.js';
import { scanAgentRules } from '../trapcheck/rules/agent-rules.js';
import { scanLifecycleRules } from '../trapcheck/rules/lifecycle-rules.js';
import { scanPayloadRules } from '../trapcheck/rules/payload-rules.js';
import { scanInjectionRules } from '../trapcheck/rules/injection-rules.js';
import { scanNetRules } from '../trapcheck/rules/net-rules.js';
import { evaluateVerdict } from '../trapcheck/verdict.js';
import { computeCandidateTreeHash } from '../util/candidate-tree.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';
import { getCaseDir } from '../util/paths.js';

export interface TrapcheckOptions {
  rulesVersion?: string;
  maxFiles?: number;
  maxFileSize?: number;
  neutralized?: { original: string; renamedTo: string }[];
  inconclusive?: TrapcheckInconclusive[];
}

export function runTrapCheck(
  targetDir: string,
  caseId: string,
  options: TrapcheckOptions = {}
): TrapcheckResult {
  const rulesVersion = options.rulesVersion || '2026.10.09';
  const treeHash = computeCandidateTreeHash(targetDir);

  const findings: TrapcheckFinding[] = [];
  const inconclusive: TrapcheckInconclusive[] = options.inconclusive ? [...options.inconclusive] : [];
  const partialFiles: string[] = [];

  let filesScanned = 0;
  let bytesScanned = 0;

  // Check if any package.json references specific script files
  const referencedLifecycleFiles = new Set<string>();
  const pkgJsonPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.scripts) {
        for (const cmd of Object.values(pkg.scripts)) {
          if (typeof cmd === 'string') {
            const matches = cmd.match(/[a-zA-Z0-9_\-\.\/]+\.(?:js|ts|cjs|mjs)/g);
            if (matches) {
              matches.forEach(m => {
                const norm = m.replace(/\\/g, '/').toLowerCase();
                referencedLifecycleFiles.add(norm);
                referencedLifecycleFiles.add(path.basename(norm));
              });
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(targetDir, fullPath).replace(/\\/g, '/');

      // Skip .git
      if (entry.name === '.git') continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        filesScanned++;
        let stats: fs.Stats;
        try {
          stats = fs.statSync(fullPath);
        } catch (err: any) {
          inconclusive.push({ code: 'ARC-008', file: relPath, why: `File unreadable or removed: ${err.message}` });
          continue;
        }

        bytesScanned += stats.size;

        let buffer: Buffer;
        try {
          buffer = fs.readFileSync(fullPath);
        } catch (err: any) {
          inconclusive.push({ code: 'ARC-008', file: relPath, why: `Failed to read file: ${err.message}` });
          continue;
        }

        const isLifecycleRef = referencedLifecycleFiles.has(relPath.toLowerCase()) || referencedLifecycleFiles.has(entry.name.toLowerCase());

        // 1. Payload & type sniffing rules (PAY-*)
        findings.push(...scanPayloadRules(relPath, buffer, undefined, isLifecycleRef));

        // If file is text, run text rules
        const isBinary = buffer.includes(0);
        if (!isBinary) {
          const text = buffer.toString('utf8');

          // 2. Agent rules (AGT-*)
          findings.push(...scanAgentRules(relPath, text));

          // 3. Lifecycle rules (LIF-*)
          findings.push(...scanLifecycleRules(relPath, text));

          // 4. Injection rules (INJ-*)
          findings.push(...scanInjectionRules(relPath, text));

          // 5. Network & exfil rules (NET-*)
          findings.push(...scanNetRules(relPath, text, isLifecycleRef));
        }
      }
    }
  }

  walk(targetDir);

  const result = evaluateVerdict({
    caseId,
    treeHash,
    rulesVersion,
    findings,
    inconclusive,
    filesScanned,
    bytesScanned,
    partialFiles,
    neutralized: options.neutralized
  });

  // Write trapcheck.json into case folder
  const caseDir = getCaseDir(caseId);
  if (!fs.existsSync(caseDir)) {
    fs.mkdirSync(caseDir, { recursive: true });
  }
  atomicWriteJsonSync(path.join(caseDir, 'trapcheck.json'), result);

  return result;
}
