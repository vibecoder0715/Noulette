import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { scanCodeMistakes, scanCodeAst } from '../../packages/engine/src/steps/10-code-mistakes.js';

describe('Step 10: Code Mistakes Scanner (TC-071..078, TC-162)', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-test-code-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('TC-071: SQL injection in route -> Rule fires; fingerprint stable across blank line insertion', () => {
    const code1 = 'export async function GET(req) {\n  const res = await db.query(`SELECT * FROM users WHERE id = ${req.query.id}`);\n}';
    const findings1 = scanCodeAst('src/route.ts', code1, 'cand_1');
    expect(findings1.some(f => f.ruleId === 'CODE-SQL-001')).toBe(true);
    const fp1 = findings1.find(f => f.ruleId === 'CODE-SQL-001')?.fingerprint;

    // Insert blank line above
    const code2 = '\n\nexport async function GET(req) {\n  const res = await db.query(`SELECT * FROM users WHERE id = ${req.query.id}`);\n}';
    const findings2 = scanCodeAst('src/route.ts', code2, 'cand_1');
    const fp2 = findings2.find(f => f.ruleId === 'CODE-SQL-001')?.fingerprint;

    expect(fp1).toBe(fp2); // Stable fingerprint across line changes
  });

  it('TC-072: dangerouslySetInnerHTML from user input -> XSS rule fires', () => {
    const code = 'export function Card({ req }) {\n  return <div dangerouslySetInnerHTML={{ __html: req.body.html }} />;\n}';
    const findings = scanCodeAst('src/Card.tsx', code, 'cand_1');
    expect(findings.some(f => f.ruleId === 'CODE-XSS-001')).toBe(true);
  });

  it('TC-073: child_process.exec with request parameter -> Command injection fires', () => {
    const code = 'const cp = require("child_process");\ncp.exec("ping " + req.query.host);';
    const findings = scanCodeAst('src/ping.js', code, 'cand_1');
    expect(findings.some(f => f.ruleId === 'CODE-CMD-001')).toBe(true);
  });

  it('TC-074: eval(req.body) -> Eval rule fires', () => {
    const code = 'app.post("/calc", (req) => {\n  const res = eval(req.body.code);\n});';
    const findings = scanCodeAst('src/calc.js', code, 'cand_1');
    expect(findings.some(f => f.ruleId === 'CODE-EVAL-001')).toBe(true);
  });

  it('TC-075: CORS * with credentials -> Rule fires', () => {
    const code = 'app.use(cors({ origin: "*", credentials: true }));';
    const findings = scanCodeAst('src/server.js', code, 'cand_1');
    expect(findings.some(f => f.ruleId === 'CODE-CORS-001')).toBe(true);
  });

  it('TC-076: JWT verified with alg: none -> Rule fires', () => {
    const code = 'jwt.verify(token, key, { algorithms: ["none"] });';
    const findings = scanCodeAst('src/auth.js', code, 'cand_1');
    expect(findings.some(f => f.ruleId === 'CODE-JWT-001')).toBe(true);
  });

  it('TC-077: Safe parameterized query lookalike -> No finding', () => {
    const code = 'export async function GET(req) {\n  const res = await db.query("SELECT * FROM users WHERE id = $1", [req.query.id]);\n}';
    const findings = scanCodeAst('src/safe.ts', code, 'cand_1');
    expect(findings.length).toBe(0);
  });

  it('TC-078: Opengrep binary missing -> Scorecard: code check not run (scanner unavailable)', () => {
    const res = scanCodeMistakes(projectDir, { opengrepPath: null });
    expect(res.status).toBe('not-run-unavailable');
    expect(res.reason).toContain('code check not run (scanner unavailable)');
  });

  it('TC-162: Modified byte in opengrep.exe -> Checksum mismatch reported as "not run (scanner modified)"', () => {
    const fakeBin = path.join(projectDir, 'opengrep.exe');
    fs.writeFileSync(fakeBin, 'MOCK_OPENGREP_BINARY_CONTENT');
    const validHash = crypto.createHash('sha256').update('MOCK_OPENGREP_BINARY_CONTENT').digest('hex');

    // Alter 1 byte
    fs.writeFileSync(fakeBin, 'MOCK_OPENGREP_BINARY_CONTENX');

    const res = scanCodeMistakes(projectDir, { opengrepPath: fakeBin, expectedChecksum: validHash });
    expect(res.status).toBe('not-run-modified');
    expect(res.reason).toContain('not run (scanner modified)');
  });
});
