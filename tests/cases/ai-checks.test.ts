import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanAiChecks, validateAgentCitation } from '../../packages/engine/src/steps/12-ai-checks.js';

describe('Step 12: AI-App Checks (TC-089..094)', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-test-ai-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('TC-089: AI output flowing into eval / innerHTML -> Track A rule fires', () => {
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      dependencies: { 'ai': '^3.0.0', 'openai': '^4.0.0' }
    }));
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'agent.ts'), `
      const completion = await openai.chat.completions.create({...});
      eval(completion.choices[0].message.content);
    `);

    const res = scanAiChecks(projectDir);
    expect(res.status).toBe('applicable');
    expect(res.findings.some(f => f.ruleId === 'AI-OUT-001')).toBe(true);
  });

  it('TC-090: App with no AI SDK -> "Not applicable"', () => {
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      dependencies: { 'express': '^4.18.2' }
    }));
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'server.js'), 'const express = require("express");');

    const res = scanAiChecks(projectDir);
    expect(res.status).toBe('not applicable');
    expect(res.findings.length).toBe(0);
  });

  it('TC-091: AI API key present in client bundle or prompt -> Flagged', () => {
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      dependencies: { 'openai': '^4.0.0' }
    }));
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'client.ts'), 'export const OPENAI_API_KEY = "sk-proj-FAKEKEYFORTESTING123456789";');

    const res = scanAiChecks(projectDir);
    expect(res.findings.some(f => f.ruleId === 'AI-KEY-001')).toBe(true);
  });

  it('TC-092: AI call without max_tokens -> Medium finding', () => {
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      dependencies: { 'ai': '^3.0.0' }
    }));
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'call.ts'), 'const res = await generateText({ model: "gpt-4" });');

    const res = scanAiChecks(projectDir);
    expect(res.findings.some(f => f.ruleId === 'AI-COST-001' && f.severity === 'medium')).toBe(true);
  });

  it('TC-093: Agent citation citing non-existent file:line -> Citation validation discards it', () => {
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'file.ts'), 'line 1\nline 2\nline 3\n');

    // Non-existent file
    const val1 = validateAgentCitation({ file: 'src/missing.ts', line: 1 }, projectDir);
    expect(val1.valid).toBe(false);

    // Line out of bounds (file has 4 lines)
    const val2 = validateAgentCitation({ file: 'src/file.ts', line: 999 }, projectDir);
    expect(val2.valid).toBe(false);

    // Valid citation
    const val3 = validateAgentCitation({ file: 'src/file.ts', line: 2 }, projectDir);
    expect(val3.valid).toBe(true);
  });

  it('TC-094: Full run on AI app -> Every OWASP LLM risk has valid status', () => {
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      dependencies: { 'ai': '^3.0.0' }
    }));

    const res = scanAiChecks(projectDir);
    const coverage = res.inventory.owaspCoverage;

    // Check all LLM01 to LLM10
    const expectedIds = ['LLM01', 'LLM02', 'LLM03', 'LLM04', 'LLM05', 'LLM06', 'LLM07', 'LLM08', 'LLM09', 'LLM10'];
    const validStatuses = ['checked-by-rule', 'reviewed-with-evidence', 'not-covered'];

    for (const id of expectedIds) {
      expect(coverage[id]).toBeDefined();
      expect(validStatuses).toContain(coverage[id]);
    }
  });
});
