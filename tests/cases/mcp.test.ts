import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpServer } from '../../packages/engine/src/mcp/index.js';
import { recordDecision } from '../../packages/engine/src/steps/24-decision.js';
import { computeCandidateTreeHash } from '../../packages/engine/src/util/candidate-tree.js';
import { generateScalePlan } from '../../packages/engine/src/steps/plan-lite.js';

describe('MCP Server & Scale Plan (TC-139..143)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-mcp-test-'));
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{\n  "name": "sample",\n  "version": "1.0.0"\n}\n');
    fs.writeFileSync(path.join(tempDir, 'src', 'index.js'), 'export function test(input) { eval(input); }\n');
    fs.writeFileSync(path.join(tempDir, 'tests', 'index.test.js'), 'test("sample", () => {});\n');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('TC-139: Call tools/list; expected tools returned; each response <= 20 KB cap', async () => {
    const server = new McpServer(tempDir);
    const resp = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(resp.jsonrpc).toBe('2.0');
    expect(resp.result).toBeDefined();
    expect(resp.result.tools).toBeDefined();

    const toolNames = resp.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('noulette_scan');
    expect(toolNames).toContain('noulette_get_findings');
    expect(toolNames).toContain('noulette_start_fix');
    expect(toolNames).toContain('noulette_verify_fix');
    expect(toolNames).toContain('noulette_apply_approved');
    expect(toolNames).toContain('noulette_plan');

    // Strict human-in-the-loop: No approve tool in MCP
    expect(toolNames.some((n: string) => n === 'noulette_approve' || n === 'approve')).toBe(false);

    // Response payload size <= 20 KB
    const serialized = JSON.stringify(resp);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');
    expect(sizeBytes).toBeLessThanOrEqual(20 * 1024);
  });

  it('TC-140: Call noulette_verify_fix before noulette_start_fix -> ok:false, error code, and next_required_step', async () => {
    const server = new McpServer(tempDir);
    const envelope = await server.callTool('noulette_verify_fix', {});

    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('NO_ACTIVE_ATTEMPT');
    expect(envelope.next_required_step).toBe('noulette_start_fix');
    expect(envelope.forbidden).toBe(false);
  });

  it('TC-141: Call every tool in valid and invalid states; every response matches envelope schema', async () => {
    const server = new McpServer(tempDir);

    const checkEnvelope = (env: any) => {
      expect(typeof env.ok).toBe('boolean');
      expect(typeof env.forbidden).toBe('boolean');
      if (env.next_required_step !== undefined) {
        expect(typeof env.next_required_step).toBe('string');
      }
      if (!env.ok) {
        expect(env.error).toBeDefined();
        expect(typeof env.error.code).toBe('string');
        expect(typeof env.error.message).toBe('string');
      }
    };

    // 1. Unknown tool
    const envUnknown = await server.callTool('noulette_nonexistent', {});
    checkEnvelope(envUnknown);
    expect(envUnknown.ok).toBe(false);
    expect(envUnknown.forbidden).toBe(true);

    // 2. noulette_start_fix with missing findingIds
    const envStartEmpty = await server.callTool('noulette_start_fix', { findingIds: [] });
    checkEnvelope(envStartEmpty);
    expect(envStartEmpty.ok).toBe(false);

    // 3. noulette_apply_approved with missing decisionId
    const envApplyMissing = await server.callTool('noulette_apply_approved', {});
    checkEnvelope(envApplyMissing);
    expect(envApplyMissing.ok).toBe(false);

    // 4. noulette_plan
    const envPlan = await server.callTool('noulette_plan', { expectedUsers: '500' });
    checkEnvelope(envPlan);
    expect(envPlan.ok).toBe(true);

    // 5. noulette_get_findings
    const envFindings = await server.callTool('noulette_get_findings', { page: 1, pageSize: 20 });
    checkEnvelope(envFindings);
    expect(envFindings.ok).toBe(true);
  });

  it('TC-142: Auto-fix OFF in scripted MCP client; start_fix refused until plan is approved in the app', async () => {
    // Config: autoFix is false, planApproved is false
    const server = new McpServer(tempDir, { autoFix: false, planApproved: false });

    // Calling start_fix must be refused with PLAN_APPROVAL_REQUIRED
    const envRefused = await server.callTool('noulette_start_fix', {
      findingIds: ['fnd_01J00000000000000000000001']
    });

    expect(envRefused.ok).toBe(false);
    expect(envRefused.error?.code).toBe('PLAN_APPROVAL_REQUIRED');
    expect(envRefused.next_required_step).toBe('approve_plan_in_app');
    expect(envRefused.forbidden).toBe(true);

    // Once user approves plan in the desktop app
    server.setPlanApproved(true);

    const envAllowed = await server.callTool('noulette_start_fix', {
      findingIds: ['fnd_01J00000000000000000000001']
    });

    expect(envAllowed.ok).toBe(true);
    expect(envAllowed.data.attemptId).toBeDefined();
    expect(envAllowed.next_required_step).toBe('noulette_verify_fix');
  });

  it('TC-143: Auto-fix ON full flow in scripted MCP client: scan -> fix -> verify -> approval -> apply', async () => {
    const server = new McpServer(tempDir, { autoFix: true });

    // 1. scan
    const scanEnv = await server.callTool('noulette_scan', {});
    expect(scanEnv.ok).toBe(true);
    expect(scanEnv.data.findingsCount).toBeGreaterThan(0);

    // 2. get findings
    const findingsEnv = await server.callTool('noulette_get_findings', { page: 1 });
    expect(findingsEnv.ok).toBe(true);
    expect(findingsEnv.data.findings.length).toBeGreaterThan(0);
    const targetFinding = findingsEnv.data.findings[0];

    // 3. start fix
    const startEnv = await server.callTool('noulette_start_fix', {
      findingIds: [targetFinding.id]
    });
    expect(startEnv.ok).toBe(true);
    const { attemptId, workDir } = startEnv.data;

    // 4. agent fixes the issue in isolated work copy
    fs.writeFileSync(path.join(workDir, 'src', 'index.js'), 'export function test() { /* clean */ }\n');

    // 5. verify fix
    const verifyEnv = await server.callTool('noulette_verify_fix', { attemptId });
    expect(verifyEnv.ok).toBe(true);
    expect(verifyEnv.data.passed).toBe(true);
    expect(verifyEnv.next_required_step).toBe('sign_decision_in_app');

    // Attempting apply without signed decision must fail
    const prematureApply = await server.callTool('noulette_apply_approved', {
      decisionId: 'dec_01J00000000000000000000000'
    });
    expect(prematureApply.ok).toBe(false);
    expect(prematureApply.forbidden).toBe(true);

    // 6. User reviews and signs approval card in desktop app UI
    const treeHash = computeCandidateTreeHash(tempDir);
    const decision = recordDecision(tempDir, {
      findingId: targetFinding.id,
      candidateId: targetFinding.candidateId,
      candidateTreeHash: treeHash,
      action: 'approve',
      attemptId,
      decidedBy: 'lead-engineer'
    });

    // 7. apply approved fix via MCP
    const applyEnv = await server.callTool('noulette_apply_approved', {
      decisionId: decision.decisionId
    });
    expect(applyEnv.ok).toBe(true);
    expect(applyEnv.data.applied).toBe(true);

    // Verify main working tree now has the fix applied!
    const mainContent = fs.readFileSync(path.join(tempDir, 'src', 'index.js'), 'utf8');
    expect(mainContent).toContain('clean');
    expect(mainContent).not.toContain('eval("evil")');
  });

  it('Scale & Risk Plan — Lite: Generates .noulette/plan.md and non-blocking findings (source: "plan")', () => {
    const plan = generateScalePlan(tempDir, 'cand_01J00000000000000000000000', {
      expectedUsers: '10,000',
      monthlyBudget: '$250/mo'
    });

    expect(fs.existsSync(plan.markdownPath)).toBe(true);
    expect(plan.markdownContent).toContain('Scale & Risk Plan — Lite');
    expect(plan.markdownContent).toContain('10,000');
    expect(plan.markdownContent).toContain('$250/mo');

    expect(plan.findings.length).toBeGreaterThan(0);
    for (const f of plan.findings) {
      expect(f.source).toBe('plan');
      expect(f.blocking).toBe(false);
    }
  });
});
