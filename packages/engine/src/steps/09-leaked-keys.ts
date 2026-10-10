import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import type { Finding } from '../schema/finding.schema.js';
import { maskSecretWithHmac, computeFindingFingerprint } from '../util/secret-hmac.js';
import { generateFindingId } from '../util/ulid.js';
import { classifyFiles, type FileMap, type FileVisibility } from './08-classify.js';

export interface SecretScanOptions {
  candidateId?: string;
}

// Recognized high-confidence secret patterns
const SECRET_PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g, ruleId: 'KEY-001' },
  { name: 'Stripe Secret Key', regex: /sk_(?:live|test)_[0-9a-zA-Z]{24,}/g, ruleId: 'KEY-002' },
  { name: 'GitHub Personal Token', regex: /ghp_[0-9a-zA-Z]{36}/g, ruleId: 'KEY-003' },
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z-_]{35}/g, ruleId: 'KEY-004' }
];

// Exposure rules for public environment prefixes
const PUBLIC_PREFIX_PATTERNS = [
  { name: 'Public Next.js Secret Leak', regex: /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|KEY|TOKEN|AUTH|PASS)\s*=\s*['"]?([^'"\s\n]+)['"]?/gi, ruleId: 'EXP-001' },
  { name: 'Public Vite Secret Leak', regex: /VITE_[A-Z0-9_]*(?:SECRET|KEY|TOKEN|AUTH|PASS)\s*=\s*['"]?([^'"\s\n]+)['"]?/gi, ruleId: 'EXP-002' }
];

export function scanLeakedKeys(
  projectPath: string,
  options: SecretScanOptions = {}
): Finding[] {
  const normProject = path.resolve(projectPath);
  const candidateId = options.candidateId || 'cand_01J00000000000000000000000';
  const findings: Finding[] = [];

  const fileMap: FileMap = classifyFiles(normProject);

  function checkContent(relPath: string, content: string, isHistory = false): void {
    const fileClass = fileMap.files[relPath] || {
      file: relPath,
      visibility: [isHistory ? 'pushed' : 'local'] as FileVisibility[]
    };

    const isLocalOnly = fileClass.visibility.length === 1 && fileClass.visibility[0] === 'local';
    const isBlocking = !isLocalOnly;
    const severity = isLocalOnly ? 'info' : 'critical';
    const urgency = isLocalOnly ? 'nice-to-fix' : 'fix-before-launch';

    const lines = content.split('\n');

    // 1. Specific secret tokens
    for (const pat of SECRET_PATTERNS) {
      pat.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      let occurrenceIndex = 1;

      while ((match = pat.regex.exec(content)) !== null) {
        const matchedSecret = match[0];
        // Calculate line number
        const charIdx = match.index;
        const lineNum = content.slice(0, charIdx).split('\n').length;
        const masked = maskSecretWithHmac(matchedSecret);
        const snippetHash = crypto.createHash('sha256').update(matchedSecret).digest('hex');
        const fingerprint = computeFindingFingerprint(pat.ruleId, relPath, occurrenceIndex++, masked);

        findings.push({
          schemaVersion: 1,
          id: generateFindingId(),
          fingerprint,
          candidateId,
          source: 'keys',
          ruleId: pat.ruleId,
          occurrenceIndex,
          what: `${pat.name} detected in ${relPath}${isHistory ? ' (found in git history)' : ''}`,
          where: { file: relPath, line: lineNum },
          visibility: fileClass.visibility as ('pushed' | 'shipped' | 'local')[],
          urgency,
          severity,
          confidence: 'confirmed',
          blocking: isBlocking,
          evidence: {
            snippetHash,
            excerpt: masked,
            request: null
          },
          howToFix: isHistory
            ? 'Rotate and replace the key immediately. Removing the commit is not enough because leaked keys may already be indexed or compromised.'
            : 'Move secret key to a secure server-side environment variable and do not commit to version control.',
          youMustDo: ['Rotate the active secret token at provider', 'Remove key from codebase'],
          status: 'open',
          attempts: 0
        });
      }
    }

    // 2. Public Prefix Exposure Rules
    for (const pat of PUBLIC_PREFIX_PATTERNS) {
      pat.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      let occurrenceIndex = 1;

      while ((match = pat.regex.exec(content)) !== null) {
        const fullMatchedLine = match[0];
        const secretVal = match[1] || '';
        // Skip dummy values or empty
        if (!secretVal || secretVal === 'null' || secretVal === 'undefined') continue;

        const charIdx = match.index;
        const lineNum = content.slice(0, charIdx).split('\n').length;
        const masked = maskSecretWithHmac(secretVal);
        const snippetHash = crypto.createHash('sha256').update(secretVal).digest('hex');
        const fingerprint = computeFindingFingerprint(pat.ruleId, relPath, occurrenceIndex++, masked);

        findings.push({
          schemaVersion: 1,
          id: generateFindingId(),
          fingerprint,
          candidateId,
          source: 'keys',
          ruleId: pat.ruleId,
          occurrenceIndex,
          what: `${pat.name} detected in ${relPath}`,
          where: { file: relPath, line: lineNum },
          visibility: fileClass.visibility as ('pushed' | 'shipped' | 'local')[],
          urgency: 'fix-before-launch',
          severity: 'critical',
          confidence: 'confirmed',
          blocking: true,
          evidence: {
            snippetHash,
            excerpt: masked,
            request: null
          },
          howToFix: 'Remove secret from client-facing environment prefix. Variables prefixed with NEXT_PUBLIC_ or VITE_ are embedded into public client bundles.',
          youMustDo: ['Remove secret from client env prefix', 'Rotate secret at provider'],
          status: 'open',
          attempts: 0
        });
      }
    }

    // 3. Dockerfile ENV secrets
    if (relPath.toLowerCase() === 'dockerfile') {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^ENV\s+[A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD|APIKEY)\s*=\s*(.+)/i.test(line)) {
          const matchedSecret = line.split('=')[1]?.trim() || '';
          if (matchedSecret && !matchedSecret.startsWith('$')) {
            const masked = maskSecretWithHmac(matchedSecret);
            const snippetHash = crypto.createHash('sha256').update(matchedSecret).digest('hex');
            const fingerprint = computeFindingFingerprint('KEY-005', relPath, 1, masked);

            findings.push({
              schemaVersion: 1,
              id: generateFindingId(),
              fingerprint,
              candidateId,
              source: 'keys',
              ruleId: 'KEY-005',
              occurrenceIndex: 1,
              what: `Secret hardcoded in Dockerfile ENV: ${masked}`,
              where: { file: relPath, line: i + 1 },
              visibility: ['shipped'],
              urgency: 'fix-before-launch',
              severity: 'critical',
              confidence: 'confirmed',
              blocking: true,
              evidence: { snippetHash, excerpt: masked, request: null },
              howToFix: 'Do not bake secrets into Docker image layers with ENV. Use runtime environment variables or Docker build secrets.',
              youMustDo: ['Remove ENV secret from Dockerfile'],
              status: 'open',
              attempts: 0
            });
          }
        }
      }
    }
  }

  // Scan working directory files
  for (const [relPath] of Object.entries(fileMap.files)) {
    const fullPath = path.join(normProject, relPath);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const buffer = fs.readFileSync(fullPath);
      if (!buffer.includes(0)) {
        checkContent(relPath, buffer.toString('utf8'), false);
      }
    } catch {
      // ignore
    }
  }

  // Scan Git History (TC-061)
  try {
    const gitDiffHistory = execSync('git log -p -n 10', {
      cwd: normProject,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 20 * 1024 * 1024
    });

    if (gitDiffHistory) {
      for (const pat of SECRET_PATTERNS) {
        pat.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pat.regex.exec(gitDiffHistory)) !== null) {
          const matchedSecret = match[0];
          // Check if already found in current working tree
          const alreadyFound = findings.some(f => f.evidence.excerpt.startsWith(matchedSecret.slice(0, 4)));
          if (!alreadyFound) {
            const masked = maskSecretWithHmac(matchedSecret);
            const snippetHash = crypto.createHash('sha256').update(matchedSecret).digest('hex');
            const fingerprint = computeFindingFingerprint(pat.ruleId, 'git-history', 1, masked);

            findings.push({
              schemaVersion: 1,
              id: generateFindingId(),
              fingerprint,
              candidateId,
              source: 'keys',
              ruleId: pat.ruleId,
              occurrenceIndex: 1,
              what: `${pat.name} found in Git commit history`,
              where: { file: 'git-history', line: null },
              visibility: ['pushed'],
              urgency: 'fix-before-launch',
              severity: 'critical',
              confidence: 'confirmed',
              blocking: true,
              evidence: { snippetHash, excerpt: masked, request: null },
              howToFix: 'Key was committed to Git history. Rotate and replace the key immediately; removing it is not enough.',
              youMustDo: ['Rotate the active secret token at provider'],
              status: 'open',
              attempts: 0
            });
          }
        }
      }
    }
  } catch {
    // Non-git or no history
  }

  return findings;
}
