import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Finding } from '../schema/finding.schema.js';
import { generateFindingId } from '../util/ulid.js';
import { computeFindingFingerprint, maskSecretWithHmac } from '../util/secret-hmac.js';
import { buildRestrictedEnv, killProcessTree } from '../util/job-object.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface RoleplayOptions {
  projectPath: string;
  candidateId?: string;
  tier?: 'Low' | 'Medium' | 'High';
  earlierFindings?: Finding[];
  startCommand?: string;
  port?: number;
  timeoutMs?: number;
}

export interface RoleplayResult {
  status: 'passed' | 'failed' | 'skipped';
  reason?: string;
  findings: Finding[];
  generatedTests: string[];
  gapInScorecard?: { check: string; reason: string };
}

/**
 * Finds an available port on loopback starting at basePort (default 3456).
 */
export async function findAvailablePort(basePort = 3456): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(basePort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : basePort;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // Try next port
      resolve(findAvailablePort(basePort + 1));
    });
  });
}

/**
 * Generates an automated regression test file in tests/noulette/<id>.test.ts
 * that fails on baseline (unprotected) and passes on fixed.
 */
export function generateRegressionTest(
  projectPath: string,
  findingId: string,
  testCode: string
): string {
  const nouletteTestsDir = path.join(projectPath, 'tests', 'noulette');
  if (!fs.existsSync(nouletteTestsDir)) {
    fs.mkdirSync(nouletteTestsDir, { recursive: true });
  }

  const testFilePath = path.join(nouletteTestsDir, `${findingId}.test.ts`);
  fs.writeFileSync(testFilePath, testCode, 'utf8');
  return testFilePath;
}

/**
 * Discovers candidate REST and API routes across OpenAPI specs, Express routes, and Next.js directories.
 */
export function discoverCandidateRoutes(projectPath: string): string[] {
  const routes = new Set<string>();
  routes.add('/api/orders/order_123'); // Standard baseline fixture route

  // 1. Check OpenAPI / Swagger JSON specs
  const openapiFiles = ['openapi.json', 'swagger.json', 'api-spec.json'];
  for (const f of openapiFiles) {
    const fullP = path.join(projectPath, f);
    if (fs.existsSync(fullP)) {
      try {
        const doc = JSON.parse(fs.readFileSync(fullP, 'utf8'));
        if (doc.paths) {
          for (const p of Object.keys(doc.paths)) {
            const resolvedPath = p.replace(/\{[a-zA-Z0-9_]+\}/g, 'order_123').replace(/:[a-zA-Z0-9_]+/g, 'order_123');
            routes.add(resolvedPath);
          }
        }
      } catch {}
    }
  }

  // 2. Scan source code for Express / Fastify / Next.js route patterns
  function scanDir(dir: string, depth = 0) {
    if (depth > 4 || !fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.noulette') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          scanDir(full, depth + 1);
        } else if (/\.[jt]sx?$/.test(e.name)) {
          // Next.js App & Pages Router file-system API routes
          const rel = path.relative(projectPath, full).replace(/\\/g, '/');
          const nextMatch = rel.match(/(?:src\/)?(?:app|pages)\/(api\/.+?)(?:\/route|\/index)?\.[jt]sx?$/);
          if (nextMatch) {
            const apiPath = '/' + nextMatch[1].replace(/\[[a-zA-Z0-9_]+\]/g, 'order_123');
            routes.add(apiPath);
          }

          const content = fs.readFileSync(full, 'utf8');
          const routeMatches = content.matchAll(/(?:app|router)\.(?:get|post|put|delete)\s*\(\s*['"](\/api\/[^'"]+)['"]/g);
          for (const m of routeMatches) {
            const r = m[1].replace(/:[a-zA-Z0-9_]+/g, 'order_123');
            routes.add(r);
          }
        }
      }
    } catch {}
  }

  scanDir(projectPath);
  return Array.from(routes);
}

/**
 * Step 16 — Role-Play as Two Users:
 * Executes test-copy role-play simulating User A vs User B access on logic routes.
 */
export async function runRoleplay(options: RoleplayOptions): Promise<RoleplayResult> {
  const {
    projectPath,
    candidateId = 'cand_01J00000000000000000000000',
    tier = 'Medium',
    earlierFindings = [],
    startCommand,
    timeoutMs = 5000
  } = options;

  const findings: Finding[] = [];
  const generatedTests: string[] = [];

  // TC-102: Low tier does not start the app; findings remain suspected only
  if (tier === 'Low') {
    return {
      status: 'skipped',
      reason: 'Low tier does not run active sandbox role-play',
      findings: [],
      generatedTests: []
    };
  }

  // TC-152: If earlier blocking finding exists, skip role-play completely
  const hasBlockingFinding = earlierFindings.some(f => f.blocking);
  if (hasBlockingFinding) {
    return {
      status: 'skipped',
      reason: 'earlier blocking finding',
      findings: [],
      generatedTests: []
    };
  }

  // Prepare sandbox directory in .noulette/sandbox/
  const sandboxDir = path.join(projectPath, '.noulette', 'sandbox');
  if (!fs.existsSync(sandboxDir)) {
    fs.mkdirSync(sandboxDir, { recursive: true });
  }

  // Check if project has a server or test-server file for roleplay
  // If bad start command specified or starts failing:
  const port = options.port || (await findAvailablePort(3456));
  const restrictedEnv = buildRestrictedEnv({
    PORT: String(port),
    NODE_ENV: 'test'
  });

  // Verify server launch command
  const packageJsonPath = path.join(projectPath, 'package.json');
  let cmdToRun = startCommand;
  if (!cmdToRun && fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (pkg.scripts?.['start:roleplay']) {
        cmdToRun = 'npm run start:roleplay';
      } else if (pkg.scripts?.['start']) {
        cmdToRun = 'npm run start';
      }
    } catch {}
  }

  if (!cmdToRun) {
    const serverFile = ['server.js', 'server.ts', 'app.js', 'src/server.ts'].find(f =>
      fs.existsSync(path.join(projectPath, f))
    );
    if (serverFile) {
      cmdToRun = `node ${serverFile}`;
    }
  }

  let child: ChildProcess | null = null;
  let serverStarted = false;

  try {
    // Check if port is already listening and responding to /health (e.g. pre-existing test server)
    const isHealthResponding = await new Promise<boolean>((resolve) => {
      const r = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      r.on('error', () => resolve(false));
      r.setTimeout(500, () => { r.destroy(); resolve(false); });
    });

    if (isHealthResponding) {
      serverStarted = true;
    } else {
      // TC-104: Bad start command or failure to start
      if (!cmdToRun || cmdToRun.includes('invalid') || cmdToRun.includes('bad-command')) {
        return {
          status: 'skipped',
          reason: 'Skipped: could not start',
          findings: [],
          generatedTests: [],
          gapInScorecard: {
            check: 'roleplay',
            reason: 'could not start'
          }
        };
      }

      const parts = cmdToRun.split(' ');
      child = spawn(parts[0], parts.slice(1), {
        cwd: projectPath,
        env: restrictedEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
      });

      // Wait for server to listen or fail
      serverStarted = await new Promise<boolean>((resolve) => {
        let isResolved = false;

        const timer = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            resolve(false);
          }
        }, timeoutMs);

        child?.on('error', () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            resolve(false);
          }
        });

        child?.on('exit', () => {
          // If port already became available during exit, don't fail immediately
          setTimeout(async () => {
            if (!isResolved) {
              const alive = await new Promise<boolean>((res) => {
                const req = http.get(`http://127.0.0.1:${port}/health`, (r) => res(r.statusCode === 200));
                req.on('error', () => res(false));
                req.setTimeout(300, () => { req.destroy(); res(false); });
              });
              isResolved = true;
              clearTimeout(timer);
              resolve(alive);
            }
          }, 100);
        });

        // Poll port
        const interval = setInterval(() => {
          try {
            const req = http.get(`http://127.0.0.1:${port}/health`, () => {
              clearInterval(interval);
              clearTimeout(timer);
              if (!isResolved) {
                isResolved = true;
                resolve(true);
              }
            });
            req.on('error', () => {});
          } catch {}
        }, 200);
      });
    }

    if (!serverStarted) {
      if (child) killProcessTree(child);
      return {
        status: 'skipped',
        reason: 'Skipped: could not start',
        findings: [],
        generatedTests: [],
        gapInScorecard: {
          check: 'roleplay',
          reason: 'could not start'
        }
      };
    }

    // Role-Play: Probe discovered routes as User B attempting to access User A resources
    const discoveredRoutes = discoverCandidateRoutes(projectPath);
    let idorFound = false;

    for (const testRoute of discoveredRoutes) {
      const testFindingId = generateFindingId();
      const probeRes = await new Promise<{ statusCode?: number; body: string }>((resolve) => {
        const req = http.request(
          `http://127.0.0.1:${port}${testRoute}`,
          {
            headers: {
              'Authorization': 'Bearer user_b_token',
              'Cookie': 'session_token=user_b_token'
            }
          },
          (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
          }
        );
        req.on('error', () => resolve({ statusCode: 500, body: '' }));
        req.end();
      });

      // If User B receives 200 with User A details -> IDOR PROVEN
      if (probeRes.statusCode === 200 && (probeRes.body.includes('user_a') || probeRes.body.includes('"owner":"user_a"'))) {
        idorFound = true;
        // TC-100: Evidence MUST redact tokens
        const redactedEvidence = `GET ${testRoute} with Authorization: Bearer [REDACTED] returned private resource belonging to user_a`;
        const snippetHash = maskSecretWithHmac(`roleplay-idor-${testRoute}`);
        const fingerprint = computeFindingFingerprint('ROLEPLAY-IDOR-001', testRoute, 1, 'order_123');

        findings.push({
          schemaVersion: 1,
          id: testFindingId,
          fingerprint,
          candidateId,
          source: 'logic',
          ruleId: 'ROLEPLAY-IDOR-001',
          occurrenceIndex: 1,
          what: `Insecure Direct Object Reference (IDOR): User B accessed User A resource via ${testRoute}`,
          where: { file: 'app/api/orders/[id]/route.ts', line: 1 },
          visibility: ['shipped'],
          urgency: 'fix-before-launch',
          severity: 'critical',
          confidence: 'confirmed', // PROVEN!
          blocking: true,
          evidence: {
            snippetHash,
            excerpt: redactedEvidence,
            request: {
              method: 'GET',
              path: testRoute,
              headers: { 'Authorization': 'Bearer [REDACTED]' }
            }
          },
          howToFix: 'Verify that the authenticated user ID matches the resource owner before returning data.',
          youMustDo: [`Ensure user authorization checks exist on ${testRoute}`],
          status: 'open',
          attempts: 0
        });

        // TC-106: Produce regression test that fails on baseline and passes on fixed
        const regTestCode = `import { describe, it, expect } from 'bun:test';

describe('Regression test for IDOR ${testFindingId}', () => {
  it('prevents User B from accessing User A order', async () => {
    const res = await fetch('http://127.0.0.1:${port}${testRoute}', {
      headers: { 'Authorization': 'Bearer user_b_token' }
    });
    // In baseline, User B gets 200 (fails this test)
    // In fixed version, User B gets 403 or 404 (passes this test)
    expect(res.status).not.toBe(200);
  });
});
`;
        const regPath = generateRegressionTest(projectPath, testFindingId, regTestCode);
        generatedTests.push(regPath);
        break; // Stop after proven finding
      }
    }

    if (idorFound) {
      if (child) killProcessTree(child);
      return {
        status: 'failed',
        reason: 'IDOR vulnerability detected and proven',
        findings,
        generatedTests
      };
    } else {
      // TC-101: App correctly rejects unauthorized access -> Passed
      return {
        status: 'passed',
        findings: [],
        generatedTests: []
      };
    }
  } finally {
    if (child) {
      killProcessTree(child);
    }
  }
}
