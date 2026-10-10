import fs from 'node:fs';
import path from 'node:path';
import { kvGet, kvSet } from '../core/db.js';
import { projectKey } from '../core/paths.js';
import { registerProject, setProjectState, measureRepo, listRepoFiles, ensureGitignore, EMPTY_REPO_MESSAGE } from '../core/projects.js';
import { getSettings, effortCaps } from '../core/settings.js';
import { createRun, getRun, latestRun, updateRun, runJob, type RunRow } from '../core/runs.js';
import { notify, createApproval, supersedePending, resolveByKind } from '../core/events.js';
import { INTAKE_QUESTIONS, readPlan, writePlan, answerFor, parseAccounts, savePrivateIntake, readPrivateIntake, type QA } from './plan.js';
import { scanSecrets, scanDependencies, scanSast, scanLicenses, scanMocks, writeSbom, detectAnalytics, analyticsFindings, finalize, sastLanguages, type DepPackage } from './scanners.js';
import { runDast, parseStartAnswer, stopApp, appPort } from './dast.js';
import { checklist, AI_STAGES, type AiStage, type CheckItem } from './checklists.js';
import { validateSubmission } from './agent-schema.js';
import { stagePrompt, FINISH_MESSAGE } from './prompts.js';
import { saveFindings, getFindings, setFindingStatus, tldr } from './store.js';
import { writeVulnMd, type CoverageRecord } from './vulnmd.js';
import { labelById } from './taxonomy.js';
import type { Finding, ScannerStatus } from './types.js';

export interface InspectionData {
  effort: 'standard' | 'extra';
  passes: number;
  stage: 'intake' | 'scanning' | AiStage | 'done';
  pass: number;
  scanners: ScannerStatus[];
  coverage: CoverageRecord[];
  checklists: Partial<Record<AiStage, CheckItem[]>>;
  liveTested: boolean;
  livePort: number | null;
  context: string;
}

export class NouletteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface ToolResult {
  ok: boolean;
  /** Plain-language one-liner for the human. */
  tldr: string;
  /** Exact instruction for the agent's next step. */
  next: string;
  data?: unknown;
}

// ------------------------------------------------------------------ start + intake

export async function inspectStart(projectPath: string): Promise<ToolResult> {
  if (!projectPath || !path.isAbsolute(projectPath)) throw new NouletteError('BAD_PATH', 'projectPath must be the absolute path of the repository.');
  if (!fs.existsSync(projectPath)) throw new NouletteError('NOT_FOUND', `Folder not found: ${projectPath}`);
  const size = await measureRepo(projectPath);
  if (size.empty) {
    return { ok: false, tldr: EMPTY_REPO_MESSAGE, next: `Tell the user exactly: "${EMPTY_REPO_MESSAGE}" and stop.`, data: { sourceFiles: size.sourceFiles, codeLines: size.codeLines } };
  }
  const project = registerProject(projectPath);
  const settings = getSettings();
  const caps = effortCaps(settings);
  const run = createRun<InspectionData>(project.path, 'inspection', 'running', {
    effort: settings.effort, passes: caps.aiPasses, stage: 'intake', pass: 1, scanners: [], coverage: [], checklists: {}, liveTested: false, livePort: null, context: ''
  });
  setProjectState(project.path, { status: 'inspecting', inspectionId: run.id, stage: 'intake' });
  const plan = readPlan(project.path);
  const questions = INTAKE_QUESTIONS.map((q) => ({ id: q.id, question: q.q, hint: q.hint, required: q.required, currentAnswer: answerFor(plan, q.id) }));
  const haveAll = questions.filter((q) => q.required).every((q) => q.currentAnswer);
  return {
    ok: true,
    tldr: 'Inspection started. A few quick questions first.',
    next: haveAll
      ? 'PLAN.md already has answers. Show the user the current answers briefly and ask if anything changed. Then call noulette_save_plan with all answers (changed or not).'
      : 'Ask the user these questions in plain words (a few at a time). Required ones must be answered. Then call noulette_save_plan with {projectPath, answers:[{id, answer}]}.',
    data: { inspectionId: run.id, questions }
  };
}

export async function savePlanAndScan(projectPath: string, answers: { id: string; answer: string }[], waitMs = 50_000): Promise<ToolResult> {
  const run = requireRun(projectPath);
  if (run.data.stage !== 'intake' && run.data.stage !== 'scanning') throw new NouletteError('WRONG_STAGE', `The intake is already done (current stage: ${run.data.stage}).`);
  if (run.data.stage === 'intake') {
    const byId = new Map(answers.map((a) => [a.id, (a.answer ?? '').toString().trim()]));
    const unknown = answers.filter((a) => !INTAKE_QUESTIONS.some((q) => q.id === a.id)).map((a) => a.id);
    if (unknown.length) throw new NouletteError('BAD_INPUT', `Unknown question ids: ${unknown.join(', ')}`);
    const existing = readPlan(projectPath);
    const missing = INTAKE_QUESTIONS.filter((q) => q.required && !byId.get(q.id) && !answerFor(existing, q.id)).map((q) => q.id);
    if (missing.length) throw new NouletteError('MISSING_ANSWERS', `Please ask the user and answer: ${missing.join(', ')}`);
    const qa: QA[] = [];
    for (const q of INTAKE_QUESTIONS) {
      if (!byId.has(q.id)) continue;
      let a = byId.get(q.id)!;
      if (q.id === 'accounts' && a) {
        const accounts = parseAccounts(a);
        savePrivateIntake(projectPath, { accounts });
        a = accounts.length ? `${accounts.length} test account(s) saved privately in .noulette (not in this file).` : '(none)';
      }
      if (q.id === 'start') kvSet(`start:${projectKey(projectPath)}`, a || null);
      if (q.id === 'tests') kvSet(`tests:${projectKey(projectPath)}`, a || null);
      qa.push({ q: q.q, a: a || '(no answer)' });
    }
    writePlan(projectPath, qa);
    ensureGitignore(projectPath, ['VULN.md', 'LOGS.md', '.noulette/']);
    updateRun<InspectionData>(run.id, { data: { stage: 'scanning' } });
    setProjectState(projectPath, { stage: 'scanning' });
  }
  const job = await runJob(`scan:${run.id}`, () => runDeterministic(projectPath, run.id), waitMs);
  if (!job.done) {
    return { ok: true, tldr: 'Scanning the code. This can take a few minutes on big projects.', next: 'Scanners are still running. Call noulette_save_plan again with the same projectPath (answers can be empty) to wait for the results.' };
  }
  return nextStagePrompt(projectPath, getRun<InspectionData>(run.id)!);
}

function requireRun(projectPath: string): RunRow<InspectionData> {
  const run = latestRun<InspectionData>(projectPath, 'inspection');
  if (!run || run.status !== 'running') throw new NouletteError('NO_INSPECTION', 'No inspection in progress. Call noulette_inspect first.');
  return run;
}

// ------------------------------------------------------------------ deterministic stages (parallel)

export async function runDeterministic(projectPath: string, inspectionId: string): Promise<void> {
  const files = await listRepoFiles(projectPath);
  const [secrets, deps, sast, mocks] = await Promise.all([
    scanSecrets(projectPath),
    scanDependencies(projectPath),
    scanSast(projectPath, files),
    scanMocks(projectPath, files)
  ]);
  const lic = await scanLicenses(projectPath, files, deps.packages);
  writeSbom(projectPath, deps.packages);
  const analytics = detectAnalytics(projectPath, files);
  const start = parseStartAnswer(kvGet<string | null>(`start:${projectKey(projectPath)}`, null));
  const dast = await runDast(projectPath, start);
  const all = [...secrets.findings, ...deps.findings, ...sast.findings, ...dast.findings, ...mocks.findings, ...analyticsFindings(analytics), ...lic.findings].map(finalize);
  saveFindings(projectPath, inspectionId, all);
  const scanners = [secrets.status, deps.status, sast.status, lic.status, { name: 'sbom', ok: true, ran: true, findings: deps.packages.length, note: `${deps.packages.length} packages listed in .noulette/sbom.cdx.json`, ms: 0 }, dast.status, mocks.status];
  const context = buildContext(projectPath, files, getFindings(projectPath, inspectionId), deps.packages, lic.projectLicense, sastLanguages(files));
  updateRun<InspectionData>(inspectionId, { data: { stage: 'logic', pass: 1, scanners, liveTested: dast.tested, livePort: dast.port, context } });
  setProjectState(projectPath, { stage: 'logic' });
}

const ROUTE_RE = /\b(app|router|server|api)\.(get|post|put|patch|delete|all|route)\s*\(\s*['"`]([^'"`]+)|@(app|router|bp|blueprint)\.(route|get|post|put|delete)\(\s*['"]([^'"]+)|@(Get|Post|Put|Delete|Patch|RequestMapping|GetMapping|PostMapping)\(\s*["']?([^"')]*)|\bHandleFunc\(\s*"([^"]+)/;

function buildContext(root: string, files: string[], findings: Finding[], packages: DepPackage[], license: string | null, langs: string[]): string {
  const routes: string[] = [];
  for (const f of files) {
    if (routes.length >= 80) break;
    if (!/\.(js|ts|jsx|tsx|mjs|py|java|kt|go|php|rb|cs)$/i.test(f) || /node_modules|test/i.test(f)) continue;
    try {
      const lines = fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/);
      lines.forEach((l, i) => {
        const m = ROUTE_RE.exec(l);
        if (m && routes.length < 80) routes.push(`${f}:${i + 1}  ${l.trim().slice(0, 120)}`);
      });
    } catch {}
  }
  const mockHits = findings.filter((f) => f.source === 'mock').map((f) => `${f.id}  ${f.file}:${f.line}  ${f.evidence}`);
  const sec = findings.filter((f) => f.stage === 'security').slice(0, 40).map((f) => `${f.severity}  ${f.title}  ${f.file ?? ''}${f.line ? ':' + f.line : ''}`);
  return [
    `Languages with AST rules: ${langs.join(', ') || 'none'}. Files in repo: ${files.length}.`,
    `Project license: ${license ?? 'none found'}.`,
    `Files (first 200):\n${files.slice(0, 200).join('\n')}`,
    `Routes / endpoints found:\n${routes.join('\n') || '(none detected)'}`,
    `Security scanner results (already recorded, do not repeat them):\n${sec.join('\n') || '(none)'}`,
    `Mock-detection hits (confirm or reject in F5; reject with rejectedMockIds):\n${mockHits.join('\n') || '(none)'}`,
    `Dependencies (first 60):\n${packages.slice(0, 60).map((p) => `${p.name}@${p.version} ${p.licenses.join('/')}`).join('\n') || '(no lockfile)'}`
  ].join('\n\n');
}

// ------------------------------------------------------------------ AI stages

function nextStagePrompt(projectPath: string, run: RunRow<InspectionData>): ToolResult {
  const stage = run.data.stage as AiStage;
  const plan = readPlan(projectPath);
  const accounts = readPrivateIntake(projectPath).accounts;
  const items = run.data.checklists[stage] ?? checklist(stage, plan, { liveApp: run.data.liveTested, accounts: accounts.length });
  if (!run.data.checklists[stage]) updateRun<InspectionData>(run.id, { data: { checklists: { ...run.data.checklists, [stage]: items } } });
  const planText = fs.existsSync(path.join(projectPath, 'PLAN.md')) ? fs.readFileSync(path.join(projectPath, 'PLAN.md'), 'utf8') : '';
  const livePort = appPort(projectPath) ?? (run.data.liveTested ? run.data.livePort : null);
  const prompt = stagePrompt({ stage, pass: run.data.pass, passes: run.data.passes, projectPath, items, planText, context: run.data.context, livePort });
  const scannerLine = run.data.scanners.map((s) => `${s.name}: ${s.ran ? s.findings : 'skipped'}`).join(', ');
  return {
    ok: true,
    tldr: stage === 'logic' ? `Scanners finished (${scannerLine}). Now checking business rules.` : stage === 'feasibility' ? 'Business rules checked. Now checking if the app can handle real use.' : 'Almost done. Now checking licenses.',
    next: prompt,
    data: { stage, pass: run.data.pass, passes: run.data.passes, checklist: items, accounts: stage === 'logic' && livePort ? accounts.map((a) => a.user) : undefined }
  };
}

export function submitFindings(raw: any): ToolResult {
  const projectPath = raw?.projectPath;
  if (typeof projectPath !== 'string') throw new NouletteError('BAD_INPUT', 'projectPath is required.');
  const run = requireRun(projectPath);
  const stage = run.data.stage;
  if (stage === 'intake' || stage === 'scanning') throw new NouletteError('WRONG_STAGE', 'Finish the intake first (noulette_save_plan).');
  if (raw?.stage !== stage) throw new NouletteError('WRONG_STAGE', `Stages run in order. Current stage is "${stage}", you sent "${raw?.stage}".`);
  if (raw?.pass !== run.data.pass) throw new NouletteError('WRONG_PASS', `Current pass is ${run.data.pass}.`);
  const items = run.data.checklists[stage as AiStage] ?? [];
  const v = validateSubmission(projectPath, raw, items);
  if (!v.ok) {
    return { ok: false, tldr: 'The findings were rejected because some were incomplete or could not be verified.', next: `Fix these problems and call noulette_submit_findings again (same stage and pass):\n- ${v.errors.join('\n- ')}`, data: { errors: v.errors } };
  }
  const sub = v.value;
  const disclaimer = sub.stage === 'legal' ? 'This is not legal advice. Ask a lawyer before making decisions based on it.' : undefined;
  const list = sub.findings.map((f) =>
    finalize({
      stage: sub.stage, source: 'agent', rule: `${sub.stage}.${f.checkId}`, severity: f.severity, labelId: f.label, title: f.title, tldr: f.tldr,
      file: f.file?.replace(/\\/g, '/') ?? null, line: f.line, evidence: f.evidence, fixability: f.fixability, humanAction: f.humanAction ?? null, fix: f.fix,
      details: { explanation: f.explanation, scenario: f.scenario, confidence: f.confidence, planRef: f.planRef ?? null, checkId: f.checkId, pass: sub.pass, disclaimer }
    })
  );
  saveFindings(projectPath, run.id, list);
  if (sub.rejectedMockIds?.length) {
    const mocks = new Set(getFindings(projectPath, run.id).filter((f) => f.source === 'mock').map((f) => f.id));
    for (const r of sub.rejectedMockIds) if (mocks.has(r.id)) setFindingStatus([r.id], 'dismissed', `Agent: ${r.reason}`);
  }
  const coverage = [...run.data.coverage, { stage: sub.stage, pass: sub.pass, coverage: sub.coverage }];
  if (sub.pass < run.data.passes) {
    const next = updateRun<InspectionData>(run.id, { data: { coverage, pass: sub.pass + 1 } });
    return nextStagePrompt(projectPath, next);
  }
  const idx = AI_STAGES.indexOf(sub.stage);
  if (idx < AI_STAGES.length - 1) {
    const nextStage = AI_STAGES[idx + 1];
    const next = updateRun<InspectionData>(run.id, { data: { coverage, stage: nextStage, pass: 1 } });
    setProjectState(projectPath, { stage: nextStage });
    return nextStagePrompt(projectPath, next);
  }
  updateRun<InspectionData>(run.id, { data: { coverage } });
  return finishInspection(projectPath, run.id);
}

// ------------------------------------------------------------------ finish

/** Super-critical = high-confidence threats worth a sound: live keys, actively exploited packages, confirmed critical code flaws. */
function superCritical(f: Finding): boolean {
  if (f.severity !== 'critical') return false;
  if (f.source === 'gitleaks' || f.source === 'dast') return true;
  if (f.source === 'osv') return !!f.details?.kev;
  if (f.source === 'opengrep') return true;
  return f.source === 'agent' && f.details?.confidence === 'confirmed';
}

export function finishInspection(projectPath: string, inspectionId: string): ToolResult {
  stopApp(projectPath);
  const run = updateRun<InspectionData>(inspectionId, { status: 'done', finished: true, data: { stage: 'done' } });
  const findings = getFindings(projectPath, inspectionId).filter((f) => f.status !== 'dismissed');
  const all = getFindings(projectPath, inspectionId);
  writeVulnMd(projectPath, { inspectionId, findings: all, scanners: run.data.scanners, coverage: run.data.coverage });
  ensureGitignore(projectPath, ['VULN.md', 'LOGS.md', '.noulette/']);
  const t = tldr(findings);
  const settings = getSettings();
  const name = path.basename(projectPath);
  supersedePending(projectPath, 'inspection');
  resolveByKind('inspection-finished', projectKey(projectPath));
  let approvalId: string | null = null;
  if (findings.length) {
    const items = findings.map((f) => ({ id: f.id, title: f.title, tldr: f.tldr, severity: f.severity, label: labelById(f.labelId).label, fixability: f.fixability, humanAction: f.humanAction, where: f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : null, stage: f.stage }));
    if (!settings.autoApprove) {
      approvalId = createApproval({
        project: projectPath, kind: 'inspection', title: `Fix plan for ${name}`,
        summary: `${t.critical} critical, ${t.shouldFix} should fix, ${t.needsYou} need you.`,
        data: { inspectionId, items, counts: t }
      });
    }
  }
  const crit = findings.filter(superCritical);
  if (crit.length) {
    notify({ project: projectPath, severity: 'critical', kind: 'critical-finding', title: `${crit.length} serious problem${crit.length > 1 ? 's' : ''} in ${name}`, body: [...new Set(crit.map((f) => f.title))].slice(0, 4).join(', '), alert: true, data: { inspectionId, approvalId }, dedupeKey: projectKey(projectPath) });
  }
  notify({
    project: projectPath, severity: 'info', kind: 'inspection-finished', title: `Inspection finished: ${name}`,
    body: findings.length ? `${t.critical} critical, ${t.shouldFix} should fix, ${t.needsYou} need you.${settings.autoApprove ? ' Auto-approve is on, fixes start now.' : ' See Approvals.'}` : 'No problems found.',
    alert: true, data: { inspectionId, approvalId }, dedupeKey: projectKey(projectPath)
  });
  setProjectState(projectPath, { status: findings.length && !settings.autoApprove ? 'needs_approval' : 'ready', stage: null, lastInspectedAt: Date.now(), inspectionId });
  return {
    ok: true,
    tldr: findings.length ? `Done. ${t.critical} critical, ${t.shouldFix} should fix, ${t.needsYou} need you.` : 'Done. No problems found.',
    next: settings.autoApprove && findings.length
      ? 'Auto-approve is ON. Call noulette_build now with the same projectPath and follow its instructions.'
      : `Tell the user a 2-line summary in plain words, then say exactly: ${FINISH_MESSAGE}`,
    data: { inspectionId, counts: t, approvalId, vulnFile: path.join(projectPath, 'VULN.md') }
  };
}

export function inspectionStatus(projectPath: string): ToolResult {
  const run = latestRun<InspectionData>(projectPath, 'inspection');
  if (!run) return { ok: true, tldr: 'Not inspected yet.', next: 'Call noulette_inspect to start.' };
  const findings = getFindings(projectPath, run.id);
  return { ok: true, tldr: `Inspection ${run.status} (stage: ${run.data.stage}).`, next: run.status === 'running' ? 'Continue the current stage.' : 'Nothing to do.', data: { inspectionId: run.id, status: run.status, stage: run.data.stage, counts: tldr(findings) } };
}
