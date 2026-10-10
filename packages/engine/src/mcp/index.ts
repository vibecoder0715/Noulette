import fs from 'node:fs';
import path from 'node:path';
import { paginateFindingsForMcp } from '../steps/18-master-list.js';
import { startFix } from '../steps/21-start-fix.js';
import { verifyFix } from '../steps/22-referee.js';
import { applyApprovedFix } from '../steps/24-decision.js';
import { generateScalePlan } from '../steps/plan-lite.js';
import { freezeCandidate } from '../steps/07-freeze.js';
import { classifyFiles } from '../steps/08-classify.js';
import { scanLeakedKeys } from '../steps/09-leaked-keys.js';
import { scanCodeMistakes } from '../steps/10-code-mistakes.js';
import { scanIngredients } from '../steps/11-ingredients.js';
import { scanAiChecks } from '../steps/12-ai-checks.js';
import { checkFreshDanger } from '../steps/13-fresh-danger.js';
import { mapTheApp } from '../steps/14-appmap.js';
import { writeLogicRules } from '../steps/15-write-rules.js';
import { joinEvidence } from '../steps/17-join.js';
import { buildMasterList } from '../steps/18-master-list.js';
import { writeRuleBook } from '../steps/19-rulebook.js';
import { generateDangerNotes } from '../steps/20-dangernotes.js';
import { quarantineGit } from '../steps/03-quarantine.js';
import { runTrapCheck } from '../steps/04-trapcheck.js';
import { getProjectsRegistryPath } from '../util/paths.js';

export interface McpEnvelope<T = any> {
  ok: boolean;
  isError?: boolean;
  data?: T;
  error?: { code: string; message: string };
  next_required_step?: string;
  forbidden?: boolean;
  content?: Array<{ type: 'text'; text: string }>;
}

export interface McpServerConfig {
  autoFix?: boolean;
  planApproved?: boolean;
  activeAttemptId?: string | null;
}

export class McpServer {
  private config: McpServerConfig;
  private projectPath: string;

  constructor(projectPath: string = process.cwd(), config: McpServerConfig = {}) {
    this.projectPath = path.resolve(projectPath);
    this.config = {
      autoFix: config.autoFix ?? true,
      planApproved: config.planApproved ?? false,
      activeAttemptId: config.activeAttemptId ?? null
    };
  }

  public setAutoFix(enabled: boolean) {
    this.config.autoFix = enabled;
  }

  public setPlanApproved(approved: boolean) {
    this.config.planApproved = approved;
  }

  public getToolsList() {
    return [
      {
        name: 'noulette_scan',
        description: 'Runs complete intake & static security scan',
        inputSchema: { type: 'object', properties: { dir: { type: 'string' } } }
      },
      {
        name: 'noulette_get_findings',
        description: 'Fetches paginated verification findings (max 20 per page, <=20KB)',
        inputSchema: {
          type: 'object',
          properties: { page: { type: 'number' }, pageSize: { type: 'number' } }
        }
      },
      {
        name: 'noulette_start_fix',
        description: 'Snapshots candidate into isolated work copy to begin fix attempt',
        inputSchema: {
          type: 'object',
          required: ['findingIds'],
          properties: { findingIds: { type: 'array', items: { type: 'string' } } }
        }
      },
      {
        name: 'noulette_verify_fix',
        description: 'Runs deterministic referee on current fix attempt',
        inputSchema: {
          type: 'object',
          properties: { attemptId: { type: 'string' } }
        }
      },
      {
        name: 'noulette_apply_approved',
        description: 'Applies human-approved and cryptographically signed fix to main tree',
        inputSchema: {
          type: 'object',
          required: ['decisionId'],
          properties: { decisionId: { type: 'string' } }
        }
      },
      {
        name: 'noulette_plan',
        description: 'Executes 10-step Scale & Risk planning advisory',
        inputSchema: { type: 'object', properties: { expectedUsers: { type: 'string' } } }
      },
      {
        name: 'noulette_clone',
        description: 'Safely intercepts git clone, isolates untrusted repo in a quarantine sandbox, scans with specialized security analyzers, and allows or blocks it with reasons.',
        inputSchema: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'Git repository URL or local path to clone' },
            destination: { type: 'string', description: 'Target destination directory if allowed (optional)' }
          }
        }
      }
    ];
  }

  public async callTool(name: string, args: Record<string, any> = {}): Promise<McpEnvelope> {
    try {
      switch (name) {
        case 'noulette_scan': {
          const targetDir = args.dir ? path.resolve(this.projectPath, args.dir) : this.projectPath;
          const freeze = freezeCandidate(targetDir);
          const fileMap = classifyFiles(targetDir);
          const keyFindings = scanLeakedKeys(targetDir, { candidateId: freeze.candidateId });
          const mistakeResult = scanCodeMistakes(targetDir, { candidateId: freeze.candidateId });
          const ingredientResult = scanIngredients(targetDir, { candidateId: freeze.candidateId });
          const freshDanger = checkFreshDanger(targetDir, { incomingAdvisories: [] });
          const aiResult = scanAiChecks(targetDir, { candidateId: freeze.candidateId });
          const appMapResult = mapTheApp(targetDir, freeze.candidateId);
          const rulesResult = writeLogicRules(targetDir);

          const allFindings = [
            ...keyFindings,
            ...mistakeResult.findings,
            ...ingredientResult.findings,
            ...freshDanger.newFindings,
            ...aiResult.findings,
            ...appMapResult.findings
          ];

          const checksRan = ['classify', 'keys', 'code-mistakes', 'ingredients', 'fresh-danger', 'ai-checks', 'appmap', 'write-rules'];
          const join = joinEvidence({
            projectPath: targetDir,
            candidateId: freeze.candidateId,
            expectedTreeHash: freeze.candidateTreeHash,
            tier: 'Medium',
            findings: allFindings,
            checksRan,
            checksSkipped: [],
            checksNotCovered: rulesResult.notCheckedInScorecard,
            toolVersions: freeze.toolVersions
          });

          const master = buildMasterList(targetDir, join.mergedFindings, join.scorecard);
          writeRuleBook({ projectPath: targetDir });
          generateDangerNotes(targetDir);

          return {
            ok: true,
            data: {
              findingsCount: master.sortedFindings.length,
              scorecard: join.scorecard,
              next_required_step: master.sortedFindings.length > 0 ? 'noulette_start_fix' : 'noulette_receipt'
            },
            next_required_step: master.sortedFindings.length > 0 ? 'noulette_start_fix' : 'noulette_receipt',
            forbidden: false
          };
        }

        case 'noulette_get_findings': {
          const findingsPath = path.join(this.projectPath, '.noulette', 'findings.json');
          let findings = [];
          if (fs.existsSync(findingsPath)) {
            try {
              findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
            } catch {}
          }
          const page = args.page || 1;
          const pageSize = Math.min(20, args.pageSize || 20);
          const paginated = paginateFindingsForMcp(findings, page, pageSize);

          return {
            ok: true,
            data: paginated,
            next_required_step: paginated.total > 0 ? 'noulette_start_fix' : undefined,
            forbidden: false
          };
        }

        case 'noulette_start_fix': {
          // TC-142: Auto-fix OFF refuses start_fix until plan is approved
          if (!this.config.autoFix && !this.config.planApproved) {
            return {
              ok: false,
              error: {
                code: 'PLAN_APPROVAL_REQUIRED',
                message: 'Auto-fix is disabled. Human must approve fix plan in app before starting fix.'
              },
              next_required_step: 'approve_plan_in_app',
              forbidden: true
            };
          }

          const findingIds = args.findingIds || [];
          if (!Array.isArray(findingIds) || findingIds.length === 0) {
            return {
              ok: false,
              error: { code: 'INVALID_ARGUMENTS', message: 'findingIds array is required' },
              next_required_step: 'noulette_get_findings',
              forbidden: false
            };
          }

          const attempt = startFix(this.projectPath, findingIds);
          this.config.activeAttemptId = attempt.attemptId;

          return {
            ok: true,
            data: attempt,
            next_required_step: 'noulette_verify_fix',
            forbidden: false
          };
        }

        case 'noulette_verify_fix': {
          // TC-140: Calling verify_fix before start_fix returns error and next_required_step: "noulette_start_fix"
          const attemptId = args.attemptId || this.config.activeAttemptId;
          if (!attemptId) {
            return {
              ok: false,
              error: {
                code: 'NO_ACTIVE_ATTEMPT',
                message: 'No active fix attempt found. Must call noulette_start_fix first.'
              },
              next_required_step: 'noulette_start_fix',
              forbidden: false
            };
          }

          const verdict = verifyFix(this.projectPath, attemptId);
          return {
            ok: verdict.passed,
            data: verdict,
            next_required_step: verdict.passed ? 'sign_decision_in_app' : 'noulette_start_fix',
            forbidden: false
          };
        }

        case 'noulette_apply_approved': {
          const decisionId = args.decisionId;
          if (!decisionId) {
            return {
              ok: false,
              error: { code: 'MISSING_DECISION_ID', message: 'decisionId is required' },
              next_required_step: 'sign_decision_in_app',
              forbidden: false
            };
          }

          const result = applyApprovedFix(this.projectPath, decisionId);
          if (!result.applied) {
            return {
              ok: false,
              error: { code: 'APPLY_FAILED', message: result.error || 'Apply failed' },
              next_required_step: 'sign_decision_in_app',
              forbidden: true
            };
          }

          return {
            ok: true,
            data: result,
            next_required_step: 'noulette_scan',
            forbidden: false
          };
        }

        case 'noulette_plan': {
          const plan = generateScalePlan(this.projectPath, undefined, args);
          return {
            ok: true,
            data: plan,
            next_required_step: 'noulette_scan',
            forbidden: false
          };
        }

        case 'noulette_clone': {
          const repoUrl = args.url;
          if (!repoUrl) {
            return {
              ok: false,
              error: { code: 'INVALID_ARGUMENTS', message: 'url is required for noulette_clone' },
              forbidden: false
            };
          }

          const caseId = `intake_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const destParam = args.destination || args.dest;
          const destination = destParam ? path.resolve(this.projectPath, destParam) : null;

          // 1. Intercept into quarantine sandbox without checkout
          let qRes;
          try {
            qRes = quarantineGit(repoUrl, caseId);
          } catch (err: any) {
            return {
              ok: false,
              error: { code: 'CLONE_FAILED', message: `Quarantine clone failed: ${err.message}` },
              forbidden: true,
              content: [{ type: 'text', text: `Quarantine clone failed: ${err.message}` }]
            };
          }

          // 2. Run specialized TrapCheck scanner on the quarantined sandbox
          const tcRes = runTrapCheck(qRes.quarantineDir, caseId);
          const keyFindings = scanLeakedKeys(qRes.quarantineDir, { candidateId: caseId });
          const codeFindings = scanCodeMistakes(qRes.quarantineDir, { candidateId: caseId });

          const allFindings = [
            ...qRes.findings,
            ...tcRes.findings,
            ...keyFindings,
            ...codeFindings.findings
          ];

          const reasons: string[] = [...qRes.reasons, ...tcRes.reasons];
          let verdict: 'reject' | 'unsure' | 'pass' = 'pass';

          const criticalFindings = allFindings.filter(f => f.severity === 'CRITICAL' || (f as any).severity === 'critical');
          const highFindings = allFindings.filter(f => f.severity === 'HIGH' || (f as any).severity === 'high');

          if (criticalFindings.length > 0) {
            verdict = 'reject';
            for (const cf of criticalFindings) {
              const fileDesc = typeof cf.where === 'object' && cf.where ? (cf.where as any).file : (cf as any).file || 'repo';
              reasons.push(`[${cf.ruleId}] ${cf.what || (cf as any).plain} at ${fileDesc}`);
            }
          } else if (highFindings.length > 0 || qRes.inconclusive.length > 0) {
            verdict = 'unsure';
            for (const hf of highFindings) {
              const fileDesc = typeof hf.where === 'object' && hf.where ? (hf.where as any).file : (hf as any).file || 'repo';
              reasons.push(`[${hf.ruleId}] ${hf.what || (hf as any).plain} at ${fileDesc}`);
            }
          }

          const allowed = verdict === 'pass';

          // 3. If allowed and destination specified, safely copy verified files and attach origin marker
          if (allowed && destination) {
            fs.mkdirSync(destination, { recursive: true });
            fs.cpSync(qRes.quarantineDir, destination, { recursive: true });
            const markerPath = path.join(destination, '.noulette-origin.json');
            fs.writeFileSync(markerPath, JSON.stringify({
              url: repoUrl,
              caseId,
              intakeVerdict: verdict,
              scannedAt: new Date().toISOString(),
              certifiedSafe: true
            }, null, 2));

            // Record in app data clones registry (TC-171)
            try {
              const clonesPath = path.join(path.dirname(getProjectsRegistryPath()), 'clones.json');
              const existingClones = fs.existsSync(clonesPath) ? JSON.parse(fs.readFileSync(clonesPath, 'utf8')) : [];
              existingClones.push({
                url: repoUrl,
                destination: path.resolve(destination),
                caseId,
                createdAt: new Date().toISOString()
              });
              fs.writeFileSync(clonesPath, JSON.stringify(existingClones, null, 2), 'utf8');
            } catch {}
          }

          const summaryText = [
            `--- Quarantine Intake Analysis ---`,
            `Verdict: ${verdict.toUpperCase()}`,
            `Allowed: ${allowed}`,
            `Files Inspected: ${qRes.filesCount}`,
            `Findings: ${allFindings.length} (${criticalFindings.length} critical)`,
            reasons.length > 0 ? `Reasons:\n- ${reasons.join('\n- ')}` : 'No security traps detected.'
          ].join('\n');

          return {
            ok: true,
            data: {
              url: repoUrl,
              caseId,
              allowed,
              verdict,
              quarantineDir: qRes.quarantineDir,
              destination: destination || null,
              filesInspected: qRes.filesCount,
              findingsCount: allFindings.length,
              criticalCount: criticalFindings.length,
              findings: allFindings,
              reasons
            },
            next_required_step: allowed ? 'open_project' : 'review_quarantine_reasons',
            forbidden: !allowed,
            isError: !allowed,
            content: [{ type: 'text', text: summaryText }]
          };
        }

        default:
          return {
            ok: false,
            error: { code: 'UNKNOWN_TOOL', message: `Tool ${name} not found` },
            forbidden: true
          };
      }
    } catch (err: any) {
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
        forbidden: false
      };
    }
  }

  /**
   * Handles an individual JSON-RPC message.
   */
  public async handleMessage(msg: any): Promise<any> {
    if (msg.method === 'tools/list') {
      return { jsonrpc: '2.0', id: msg.id, result: { tools: this.getToolsList() } };
    } else if (msg.method === 'tools/call') {
      const res = await this.callTool(msg.params?.name, msg.params?.arguments || {});
      return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(res) }] } };
    } else if (msg.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'noulette-engine', version: '0.1.0' }
        }
      };
    } else {
      return { jsonrpc: '2.0', id: msg.id, result: { ok: true } };
    }
  }

  /**
   * Runs the stdio JSON-RPC loop.
   */
  public listenStdio(): void {
    process.stdin.setEncoding('utf8');
    let buffer = '';

    const sendResponse = (id: any, result: any, error?: any) => {
      const resp = JSON.stringify({ jsonrpc: '2.0', id, result, error });
      process.stdout.write(`Content-Length: ${Buffer.byteLength(resp, 'utf8')}\r\n\r\n${resp}`);
    };

    process.stdin.on('data', async (chunk) => {
      buffer += chunk;
      while (true) {
        const match = buffer.match(/Content-Length:\s*(\d+)\r\n\r\n/i);
        if (!match) break;
        const contentLength = parseInt(match[1], 10);
        const headerEnd = buffer.indexOf('\r\n\r\n') + 4;
        if (buffer.length < headerEnd + contentLength) break;

        const body = buffer.slice(headerEnd, headerEnd + contentLength);
        buffer = buffer.slice(headerEnd + contentLength);

        try {
          const msg = JSON.parse(body);
          const response = await this.handleMessage(msg);
          sendResponse(response.id, response.result, response.error);
        } catch (err: any) {
          sendResponse(null, null, { code: -32700, message: 'Parse error' });
        }
      }
    });
  }
}
