import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Finding } from '../schema/finding.schema.js';
import { generateFindingId } from '../util/ulid.js';
import { computeFindingFingerprint } from '../util/secret-hmac.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface AiCheckOptions {
  candidateId?: string;
  owaspMapPath?: string;
}

export interface AiInventory {
  schemaVersion: 1;
  hasAiSdk: boolean;
  sdkList: string[];
  citationsValidated: number;
  citationsRejected: number;
  owaspCoverage: Record<string, string>;
  generatedAt: string;
}

export interface AiCheckResult {
  status: 'applicable' | 'not applicable';
  findings: Finding[];
  inventory: AiInventory;
}

const AI_SDK_PACKAGES = [
  'ai',
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
  '@ai-sdk/google',
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  '@google/genai',
  'langchain',
  'ollama'
];

/**
 * Validates agent citations (file:line citation validation).
 */
export function validateAgentCitation(
  citation: { file: string; line: number },
  projectPath: string
): { valid: boolean; reason?: string } {
  const fullPath = path.join(projectPath, citation.file);
  if (!fs.existsSync(fullPath)) {
    return { valid: false, reason: `Cited file does not exist: ${citation.file}` };
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const lineCount = content.split('\n').length;
    if (citation.line <= 0 || citation.line > lineCount) {
      return { valid: false, reason: `Cited line ${citation.line} is out of bounds (file has ${lineCount} lines)` };
    }
  } catch (err: any) {
    return { valid: false, reason: `Could not read file: ${err.message}` };
  }

  return { valid: true };
}

/**
 * Step 12 — AI-App Checks:
 * Analyzes model output sanitization, AI key leakage, consumption caps, and OWASP LLM map.
 */
export function scanAiChecks(
  projectPath: string,
  options: AiCheckOptions = {}
): AiCheckResult {
  const normProject = path.resolve(projectPath);
  const candidateId = options.candidateId || 'cand_01J00000000000000000000000';
  const findings: Finding[] = [];

  // Check package.json for AI SDKs
  const detectedSdks: string[] = [];
  const pkgJsonPath = path.join(normProject, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const sdk of AI_SDK_PACKAGES) {
        if (allDeps[sdk]) detectedSdks.push(sdk);
      }
    } catch {
      // ignore
    }
  }

  // If no AI SDKs detected in dependencies or files, return "not applicable" (TC-090)
  if (detectedSdks.length === 0) {
    return {
      status: 'not applicable',
      findings: [],
      inventory: {
        schemaVersion: 1,
        hasAiSdk: false,
        sdkList: [],
        citationsValidated: 0,
        citationsRejected: 0,
        owaspCoverage: {},
        generatedAt: new Date().toISOString()
      }
    };
  }

  // Scan files for Track A checks
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(normProject, fullPath).replace(/\\/g, '/');

      if (entry.name === '.git' || entry.name === '.noulette' || entry.name === 'node_modules') continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
          let text = '';
          try {
            text = fs.readFileSync(fullPath, 'utf8');
          } catch {
            continue;
          }

          const lines = text.split('\n');

          // 1. Model output to sinks (eval / innerHTML) (TC-089)
          if (
            /eval\s*\(\s*(?:completion|response|aiOutput|text|output)/i.test(text) ||
            /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?:completion|response|aiOutput|result\.text)/i.test(text)
          ) {
            const lineNum = lines.findIndex(l => /eval|dangerouslySetInnerHTML/.test(l)) + 1;
            const snippet = lines[lineNum - 1] || 'eval(aiOutput)';
            const snippetHash = crypto.createHash('sha256').update(snippet).digest('hex');
            const fingerprint = computeFindingFingerprint('AI-OUT-001', relPath, 1, snippet);

            findings.push({
              schemaVersion: 1,
              id: generateFindingId(),
              fingerprint,
              candidateId,
              source: 'ai',
              ruleId: 'AI-OUT-001',
              occurrenceIndex: 1,
              what: `Unsanitized AI model output fed directly to code execution sink in ${relPath}`,
              where: { file: relPath, line: lineNum || 1 },
              visibility: ['shipped'],
              urgency: 'fix-before-launch',
              severity: 'critical',
              confidence: 'confirmed',
              blocking: true,
              evidence: { snippetHash, excerpt: snippet.slice(0, 200), request: null },
              howToFix: 'Never feed unvalidated LLM output directly into eval() or innerHTML. Sanitize or parse strictly with typed schemas.',
              youMustDo: ['Sanitize AI output before rendering or executing'],
              status: 'open',
              attempts: 0
            });
          }

          // 2. AI API keys in client bundles or prompts (TC-091)
          if (
            /(?:openai|anthropic|gemini)_?(?:api)?_?key\s*=\s*['"]sk-[a-zA-Z0-9_-]{20,}['"]/i.test(text) ||
            /sk-proj-[a-zA-Z0-9_-]{20,}/i.test(text)
          ) {
            const lineNum = lines.findIndex(l => /sk-/.test(l)) + 1;
            const snippet = lines[lineNum - 1] || 'OPENAI_API_KEY=sk-...';
            const snippetHash = crypto.createHash('sha256').update(snippet).digest('hex');
            const fingerprint = computeFindingFingerprint('AI-KEY-001', relPath, 1, snippet);

            findings.push({
              schemaVersion: 1,
              id: generateFindingId(),
              fingerprint,
              candidateId,
              source: 'ai',
              ruleId: 'AI-KEY-001',
              what: `AI Provider Secret API Key hardcoded in client code or prompt template in ${relPath}`,
              occurrenceIndex: 1,
              where: { file: relPath, line: lineNum || 1 },
              visibility: ['shipped'],
              urgency: 'fix-before-launch',
              severity: 'critical',
              confidence: 'confirmed',
              blocking: true,
              evidence: { snippetHash, excerpt: snippet.slice(0, 100), request: null },
              howToFix: 'Do not embed AI provider API keys in client code or templates. Route AI requests through a secure server proxy.',
              youMustDo: ['Rotate AI provider secret key immediately'],
              status: 'open',
              attempts: 0
            });
          }

          // 3. AI call without max_tokens or rate limits (TC-092)
          if (
            /(?:generateText|streamText|createChatCompletion|messages\.create)\s*\(\{/i.test(text) &&
            !/max_tokens|maxTokens|maxOutputTokens/i.test(text)
          ) {
            const lineNum = lines.findIndex(l => /generateText|streamText|createChatCompletion|messages\.create/.test(l)) + 1;
            const snippet = lines[lineNum - 1] || 'generateText({...})';
            const snippetHash = crypto.createHash('sha256').update(snippet).digest('hex');
            const fingerprint = computeFindingFingerprint('AI-COST-001', relPath, 1, snippet);

            findings.push({
              schemaVersion: 1,
              id: generateFindingId(),
              fingerprint,
              candidateId,
              source: 'ai',
              ruleId: 'AI-COST-001',
              occurrenceIndex: 1,
              what: `AI API invocation missing max_tokens / spend guardrails in ${relPath}`,
              where: { file: relPath, line: lineNum || 1 },
              visibility: ['pushed'],
              urgency: 'nice-to-fix',
              severity: 'medium',
              confidence: 'confirmed',
              blocking: false,
              evidence: { snippetHash, excerpt: snippet.slice(0, 100), request: null },
              howToFix: 'Specify maxTokens or max_tokens on every model call to prevent runaway API spend or unbounded generation loops.',
              youMustDo: ['Add max_tokens limit to model parameters'],
              status: 'open',
              attempts: 0
            });
          }
        }
      }
    }
  }

  walk(normProject);

  // Track C: Read OWASP map
  const owaspMapFile = options.owaspMapPath || path.resolve(process.cwd(), 'rules', 'ai', 'owasp-map.json');
  const owaspCoverage: Record<string, string> = {};

  if (fs.existsSync(owaspMapFile)) {
    try {
      const doc = JSON.parse(fs.readFileSync(owaspMapFile, 'utf8'));
      if (Array.isArray(doc.risks)) {
        for (const risk of doc.risks) {
          owaspCoverage[risk.id] = risk.status;
        }
      }
    } catch {
      // ignore
    }
  }

  const inventory: AiInventory = {
    schemaVersion: 1,
    hasAiSdk: true,
    sdkList: detectedSdks,
    citationsValidated: 0,
    citationsRejected: 0,
    owaspCoverage,
    generatedAt: new Date().toISOString()
  };

  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }
  atomicWriteJsonSync(path.join(nouletteDir, 'ai-inventory.json'), inventory);

  return {
    status: 'applicable',
    findings,
    inventory
  };
}
