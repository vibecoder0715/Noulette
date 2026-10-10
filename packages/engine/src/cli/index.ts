#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { handleArrival } from '../steps/01-arrival.js';
import { routeOrigin } from '../steps/02-route.js';
import { quarantineArchive, quarantineGit } from '../steps/03-quarantine.js';
import { runTrapCheck } from '../steps/04-trapcheck.js';
import { generateVerdictReport } from '../steps/05-verdict.js';
import { quickChangeCheck } from '../steps/06-quick-change.js';
import { freezeCandidate } from '../steps/07-freeze.js';
import { classifyFiles } from '../steps/08-classify.js';
import { scanLeakedKeys } from '../steps/09-leaked-keys.js';
import { scanCodeMistakes } from '../steps/10-code-mistakes.js';
import { scanIngredients } from '../steps/11-ingredients.js';
import { scanAiChecks } from '../steps/12-ai-checks.js';
import { checkFreshDanger } from '../steps/13-fresh-danger.js';
import { mapTheApp } from '../steps/14-appmap.js';
import { writeLogicRules } from '../steps/15-write-rules.js';
import { runRoleplay } from '../steps/16-roleplay.js';
import { joinEvidence } from '../steps/17-join.js';
import { buildMasterList, paginateFindingsForMcp } from '../steps/18-master-list.js';
import { writeRuleBook } from '../steps/19-rulebook.js';
import { generateDangerNotes } from '../steps/20-dangernotes.js';
import { McpServer } from '../mcp/index.js';

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const subcommand = args[0] || '--help';

  if (subcommand === '--version' || subcommand === '-v') {
    console.log('noulette-engine 0.1.0');
    return 0;
  }

  if (subcommand === '--help' || subcommand === '-h') {
    console.log(`
noulette-engine CLI — High-assurance security and intake engine

Usage:
  noulette-engine <command> [options]

Commands:
  scan [dir]            Run complete static verification pipeline on target directory
  mcp                   Start MCP stdio protocol server
  gate [dir]            Evaluate release gates (exits 0 if allowed, 1 if blocked)
  check-incoming <src>  Quarantine extract and trapcheck incoming file/archive
  clone <url> [dest]    Quarantine-hardened git clone
  verify [dir]          Verify candidate tree and integrity
  --version, -v         Display engine version
  --help, -h            Show this help message
`);
    return 0;
  }

  if (subcommand === 'mcp') {
    const server = new McpServer(process.cwd());
    server.listenStdio();
    return new Promise(() => {}); // Keep alive for stdio
  }

  const targetDir = path.resolve(args[1] || '.');

  if (subcommand === 'scan' || subcommand === 'verify') {
    console.log(`[Noulette] Running verification on: ${targetDir}`);
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

    const checksRan = [
      'classify',
      'keys',
      'code-mistakes',
      'ingredients',
      'fresh-danger',
      'ai-checks',
      'appmap',
      'write-rules'
    ];

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

    console.log(`[Noulette] Done. Total findings: ${master.sortedFindings.length}`);
    console.log(`[Noulette] Scorecard written to: ${master.scorecardPath}`);
    console.log(`[Noulette] Findings written to: ${master.markdownPath}`);
    return 0;
  }

  if (subcommand === 'gate') {
    const findingsPath = path.join(targetDir, '.noulette', 'findings.json');
    if (!fs.existsSync(findingsPath)) {
      console.error('[Noulette] No findings.json found. Run scan first.');
      return 1;
    }
    const findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
    const blocking = findings.filter((f: any) => f.blocking);
    if (blocking.length > 0) {
      console.error(`[Noulette] Gate BLOCKED: ${blocking.length} blocking findings found.`);
      return 1;
    }
    console.log('[Noulette] Gate PASSED: 0 blocking findings.');
    return 0;
  }

  if (subcommand === 'clone') {
    const repoUrl = args[1];
    if (!repoUrl) {
      console.error('[Noulette] Missing repository URL or path. Usage: noulette clone <url> [dest]');
      return 1;
    }
    const destDir = args[2] ? path.resolve(args[2]) : null;
    const server = new McpServer(process.cwd());
    console.log(`[Noulette Intake] Intercepting clone request for: ${repoUrl}`);
    console.log('[Noulette Intake] Isolating in safe quarantine sandbox without checkout...');
    const result = await server.callTool('noulette_clone', { url: repoUrl, destination: destDir });
    if (!result.ok) {
      console.error(`[Noulette Intake] Clone failed: ${result.error?.message}`);
      return 1;
    }
    const data = result.data;
    if (data.allowed) {
      console.log(`[Noulette Intake] PASSED: Repository verified safe (${data.filesInspected} files inspected).`);
      if (destDir) {
        console.log(`[Noulette Intake] Extracted to target directory: ${destDir}`);
      }
      return 0;
    } else {
      console.error(`[Noulette Intake] BLOCKED (${data.verdict.toUpperCase()}): Repository contains security hazards!`);
      for (const reason of data.reasons) {
        console.error(`  - ${reason}`);
      }
      return 1;
    }
  }

  if (subcommand === 'check-incoming') {
    const src = args[1];
    if (!src) {
      console.error('[Noulette] Missing file path. Usage: noulette check-incoming <src>');
      return 1;
    }
    const caseId = `incoming_${Date.now()}`;
    const qRes = quarantineArchive(src, caseId);
    const tcRes = runTrapCheck(qRes.quarantineDir, caseId);
    console.log(`[Noulette Intake] Verdict: ${tcRes.verdict.toUpperCase()}`);
    for (const r of tcRes.reasons) {
      console.log(`  - ${r}`);
    }
    return tcRes.verdict === 'reject' ? 1 : 0;
  }

  console.error(`[Noulette] Unknown command: ${subcommand}`);
  return 1;
}

if ((import.meta as any).main) {
  main().then((code) => {
    process.exit(typeof code === 'number' ? code : 0);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
