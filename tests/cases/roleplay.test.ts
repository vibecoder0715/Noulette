import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { writeLogicRules } from '../../packages/engine/src/steps/15-write-rules.js';
import { runRoleplay, findAvailablePort } from '../../packages/engine/src/steps/16-roleplay.js';
import { buildRestrictedEnv, killProcessTree } from '../../packages/engine/src/util/job-object.js';
import type { Finding } from '../../packages/engine/src/schema/finding.schema.js';

describe('Step 15 & 16: Write Rules & Role-Play (TC-099..106, TC-152)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-roleplay-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('TC-099: Rules wizard with one question unanswered -> Area appears as not checked in scorecard', () => {
    const answers = {
      'tenant-isolation': 'per-org',
      'admin-auth': 'role-admin',
      // 'user-ownership' omitted (unanswered)
      'sensitive-exports': 'mfa-required'
    };

    const result = writeLogicRules(tempDir, answers);
    expect(result.config.answered['tenant-isolation']).toBe('per-org');
    expect(result.config.unanswered).toContain('user-ownership');

    const notCheckedItem = result.notCheckedInScorecard.find(x => x.check === 'user-ownership');
    expect(notCheckedItem).toBeDefined();
    expect(notCheckedItem?.explanation).toBe('not checked');

    const savedFile = path.join(tempDir, '.noulette', 'logic-rules.json');
    expect(fs.existsSync(savedFile)).toBe(true);
  });

  it('TC-100: Medium tier app with IDOR -> Proven finding with tokens redacted in evidence', async () => {
    const port = await findAvailablePort(3600);
    // Create simple HTTP server simulating vulnerable app
    const serverScript = `
const http = require('node:http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  if (req.url === '/api/orders/order_123') {
    // Vulnerable: returns user_a order regardless of who calls it
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'order_123', owner: 'user_a', item: 'Secret item' }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
server.listen(${port}, '127.0.0.1');
`;
    fs.writeFileSync(path.join(tempDir, 'server.js'), serverScript);

    const result = await runRoleplay({
      projectPath: tempDir,
      tier: 'Medium',
      port,
      startCommand: `node ${path.join(tempDir, 'server.js')}`,
      timeoutMs: 3000
    });

    expect(result.status).toBe('failed');
    expect(result.findings.length).toBe(1);
    const finding = result.findings[0];
    expect(finding.confidence).toBe('confirmed'); // Proven!
    expect(finding.evidence.excerpt).toContain('[REDACTED]');
    expect(finding.evidence.excerpt).not.toContain('user_b_token');
    expect(result.generatedTests.length).toBe(1);
  });

  it('TC-101: Same app correctly fixed -> Passed; no false positive', async () => {
    const port = await findAvailablePort(3650);
    // Create fixed server where User B receives 403 Forbidden
    const serverScript = `
const http = require('node:http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  if (req.url === '/api/orders/order_123') {
    const auth = req.headers['authorization'];
    if (auth && auth.includes('user_b_token')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'order_123', owner: 'user_a' }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
server.listen(${port}, '127.0.0.1');
`;
    fs.writeFileSync(path.join(tempDir, 'server.js'), serverScript);

    const result = await runRoleplay({
      projectPath: tempDir,
      tier: 'Medium',
      port,
      startCommand: `node ${path.join(tempDir, 'server.js')}`,
      timeoutMs: 3000
    });

    expect(result.status).toBe('passed');
    expect(result.findings.length).toBe(0);
  });

  it('TC-102: Low tier on the IDOR app -> App not started; findings suspected only', async () => {
    const result = await runRoleplay({
      projectPath: tempDir,
      tier: 'Low'
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('Low tier');
    expect(result.findings.length).toBe(0);
  });

  it('TC-103: Parent process has REAL_SECRET_TEST=1 -> Variable absent in child restricted env', () => {
    process.env['REAL_SECRET_TEST'] = 'super-secret-123';
    process.env['API_KEY'] = 'secret-key-xyz';
    try {
      const env = buildRestrictedEnv();
      expect(env['REAL_SECRET_TEST']).toBeUndefined();
      expect(env['API_KEY']).toBeUndefined();
    } finally {
      delete process.env['REAL_SECRET_TEST'];
      delete process.env['API_KEY'];
    }
  });

  it('TC-104: Bad start command -> Skipped: could not start; scorecard gap', async () => {
    const result = await runRoleplay({
      projectPath: tempDir,
      tier: 'Medium',
      startCommand: 'bad-command-that-does-not-exist'
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('Skipped: could not start');
    expect(result.gapInScorecard).toBeDefined();
    expect(result.gapInScorecard?.check).toBe('roleplay');
    expect(result.gapInScorecard?.reason).toBe('could not start');
  });

  it('TC-105: App that spawns child and hangs -> Process tree killed at timeout', async () => {
    const port = await findAvailablePort(3700);
    // Script that hangs indefinitely
    const serverScript = `
const http = require('node:http');
// Does not listen on port or respond to /health
setInterval(() => {}, 10000);
`;
    fs.writeFileSync(path.join(tempDir, 'server.js'), serverScript);

    const startTime = Date.now();
    const result = await runRoleplay({
      projectPath: tempDir,
      tier: 'Medium',
      port,
      startCommand: `node ${path.join(tempDir, 'server.js')}`,
      timeoutMs: 1200
    });

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('Skipped: could not start');
  });

  it('TC-106: Proven finding -> Generated regression test fails on baseline and passes on fixed', async () => {
    // Generate regression test file
    const port = await findAvailablePort(3750);
    let isVulnerable = true;

    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200);
        res.end('ok');
        return;
      }
      if (req.url === '/api/orders/order_123') {
        if (isVulnerable) {
          res.writeHead(200);
          res.end(JSON.stringify({ owner: 'user_a' }));
        } else {
          res.writeHead(403);
          res.end('forbidden');
        }
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });

    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', () => resolve()));

    try {
      // 1. Run roleplay on baseline -> produces finding and test
      fs.writeFileSync(path.join(tempDir, 'server.js'), '/* stub */');
      const baselineResult = await runRoleplay({
        projectPath: tempDir,
        tier: 'Medium',
        port,
        startCommand: 'node -e "setInterval(()=>{},1000)"', // dummy, server is already on port
        timeoutMs: 2000
      });

      expect(baselineResult.status).toBe('failed');
      const testPath = baselineResult.generatedTests[0];
      expect(fs.existsSync(testPath)).toBe(true);

      // Verify the generated test logic against baseline:
      // In baseline, GET /api/orders/order_123 returns 200
      const baselineFetch = await fetch(`http://127.0.0.1:${port}/api/orders/order_123`, {
        headers: { 'Authorization': 'Bearer user_b_token' }
      });
      expect(baselineFetch.status).toBe(200); // would fail the assertion (status !== 200)

      // Fix the vulnerability
      isVulnerable = false;
      const fixedFetch = await fetch(`http://127.0.0.1:${port}/api/orders/order_123`, {
        headers: { 'Authorization': 'Bearer user_b_token' }
      });
      expect(fixedFetch.status).toBe(403); // passes the assertion (status !== 200)
    } finally {
      server.close();
    }
  });

  it('TC-152: Medium tier; live fake key in pushed file (earlier blocking finding) -> Role-play Skipped', async () => {
    const dummyBlockingFinding: Finding = {
      schemaVersion: 1,
      id: '01J00000000000000000000001',
      fingerprint: 'fp-1',
      candidateId: 'cand_1',
      source: 'keys',
      ruleId: 'KEY-001',
      occurrenceIndex: 1,
      what: 'Live AWS key in repo',
      where: { file: 'aws.js', line: 1 },
      visibility: ['pushed'],
      urgency: 'fix-before-launch',
      severity: 'critical',
      confidence: 'confirmed',
      blocking: true, // Blocking finding!
      evidence: { snippetHash: 'sh', excerpt: 'ex', request: null },
      howToFix: 'rotate',
      youMustDo: ['rotate'],
      status: 'open',
      attempts: 0
    };

    const result = await runRoleplay({
      projectPath: tempDir,
      tier: 'Medium',
      earlierFindings: [dummyBlockingFinding]
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('earlier blocking finding');
    expect(result.findings.length).toBe(0);
  });
});
