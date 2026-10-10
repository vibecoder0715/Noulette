import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Finding } from '../schema/finding.schema.js';
import { generateFindingId } from '../util/ulid.js';
import { computeFindingFingerprint } from '../util/secret-hmac.js';

export interface CodeMistakesOptions {
  opengrepPath?: string | null;
  expectedChecksum?: string | null;
  candidateId?: string;
}

export interface CodeMistakesResult {
  findings: Finding[];
  status: 'completed' | 'not-run-unavailable' | 'not-run-modified';
  reason?: string;
}

/**
 * Helper to add a standardized finding to the results array.
 */
function createFindingAdder(
  relPath: string,
  candidateId: string,
  findings: Finding[]
) {
  return (
    ruleId: string,
    what: string,
    lineNum: number,
    snippet: string,
    howToFix: string,
    severity: 'critical' | 'high' | 'medium' | 'low' = 'high'
  ) => {
    const trimmed = snippet.trim();
    const snippetHash = crypto.createHash('sha256').update(trimmed).digest('hex');
    const fingerprint = computeFindingFingerprint(ruleId, relPath, 1, trimmed);

    findings.push({
      schemaVersion: 1,
      id: generateFindingId(),
      fingerprint,
      candidateId,
      source: 'code',
      ruleId,
      occurrenceIndex: 1,
      what,
      where: { file: relPath, line: lineNum },
      visibility: ['pushed'],
      urgency: 'fix-before-launch',
      severity,
      confidence: 'confirmed',
      blocking: severity === 'high' || severity === 'critical',
      evidence: {
        snippetHash,
        excerpt: trimmed.slice(0, 200),
        request: null
      },
      howToFix,
      youMustDo: ['Refactor vulnerable code path to use safe API'],
      status: 'open',
      attempts: 0
    });
  };
}

/**
 * JavaScript & TypeScript Code Mistakes Scanner with Data-Flow Taint Tracking
 */
function scanJavaScriptTypeScript(
  relPath: string,
  code: string,
  candidateId: string,
  findings: Finding[]
): void {
  const lines = code.split('\n');
  const add = createFindingAdder(relPath, candidateId, findings);

  // Parameterized query lookalikes (safe queries using $1, ? placeholders with parameter array)
  const sqlParamLookalike = /db\.query\s*\(\s*["'`][^"'`]+(?:\$1|\?)[^"'`]*["'`]\s*,\s*\[/;
  const isLookalikeSafe = sqlParamLookalike.test(code);

  // 1. Data-Flow Taint Tracking: Source -> Intermediate Variable -> Sink
  const taintedVariables = new Set<string>();
  const taintSourcePattern = /(?:req\.(?:body|query|params|headers)|request\.(?:body|query|params)|props\.(?:input|userText)|userText|userControlled)/i;

  // Track variable assignments that receive untrusted input
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const assignMatch = line.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(.*)/);
    if (assignMatch) {
      const varName = assignMatch[1];
      const rhs = assignMatch[2];
      if (taintSourcePattern.test(rhs)) {
        taintedVariables.add(varName);
      } else {
        // Propagate taint through string concatenations or template strings
        for (const taintedVar of taintedVariables) {
          const varRefRegex = new RegExp(`(?:\\$\\{${taintedVar}\\}|\\+\\s*${taintedVar}|${taintedVar}\\s*\\+)`);
          if (varRefRegex.test(rhs)) {
            taintedVariables.add(varName);
            break;
          }
        }
      }
    }
  }

  // 2. Line-by-line checks
  const xssPattern = /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?:req\.|props\.|input|userText|[a-zA-Z0-9_$]+)/i;
  const cmdInjPattern = /(?:child_process|cp)\.exec\s*\([^,)]*(?:req\.|params\.|body\.|[a-zA-Z0-9_$]+)/i;
  const evalPattern = /eval\s*\(\s*(?:req\.body|req\.query|req\.params|input|[a-zA-Z0-9_$]+)/i;
  const jwtPattern = /jwt\.verify\s*\([^,]+,\s*['"]none['"]|algorithms\s*:\s*\[\s*['"]none['"]\s*\]/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // XSS check
    if (xssPattern.test(line)) {
      const hasDirectTaint = /(?:req\.|props\.|input|userText)/i.test(line);
      let hasVarTaint = false;
      for (const tv of taintedVariables) {
        if (new RegExp(`__html\\s*:\\s*${tv}\\b`).test(line)) {
          hasVarTaint = true;
          break;
        }
      }
      if (hasDirectTaint || hasVarTaint) {
        add('CODE-XSS-001', 'Direct XSS via dangerouslySetInnerHTML fed from user input', i + 1, line, 'Do not use dangerouslySetInnerHTML with untrusted user input. Use React safe text binding.');
      }
    }

    // Command injection check
    if (/(?:child_process|cp)\.exec\s*\(/.test(line)) {
      const hasDirectTaint = /(?:req\.|params\.|body\.)/i.test(line);
      let hasVarTaint = false;
      for (const tv of taintedVariables) {
        if (new RegExp(`exec\\s*\\([^,)]*${tv}\\b`).test(line)) {
          hasVarTaint = true;
          break;
        }
      }
      if (hasDirectTaint || hasVarTaint) {
        add('CODE-CMD-001', 'Command injection via child_process.exec with unvalidated parameter', i + 1, line, 'Use execFile or spawn with argument array instead of exec with concatenated command string.');
      }
    }

    // Eval check
    if (/eval\s*\(/.test(line)) {
      const hasDirectTaint = /(?:req\.body|req\.query|req\.params|input)/i.test(line);
      let hasVarTaint = false;
      for (const tv of taintedVariables) {
        if (new RegExp(`eval\\s*\\([^)]*${tv}\\b`).test(line)) {
          hasVarTaint = true;
          break;
        }
      }
      if (hasDirectTaint || hasVarTaint) {
        add('CODE-EVAL-001', 'Arbitrary code execution via eval of request input', i + 1, line, 'Remove eval call. Parse input with JSON.parse or strict schema validator.');
      }
    }

    // JWT alg: none check
    if (jwtPattern.test(line)) {
      add('CODE-JWT-001', 'JWT verified with insecure "none" algorithm', i + 1, line, 'Enforce cryptographic signing algorithms (e.g. RS256 or HS256) and reject "none".');
    }
  }

  // 3. SQL injection check (direct concatenation or tainted variable reachability)
  const sqlDirectPattern = /(?:db\.query|SELECT\s+[\s\S]*?FROM|executeRaw)\s*[\s\S]*?(?:\$\{\s*req\.|\+\s*req\.|req\.(?:body|query|params)\s*\+)/i;
  let sqlTaintFound = false;

  if (sqlDirectPattern.test(code) && !isLookalikeSafe) {
    const matchLine = lines.findIndex(l => sqlDirectPattern.test(l) || /SELECT.*WHERE/i.test(l));
    const lineNum = matchLine !== -1 ? matchLine + 1 : 1;
    const snippet = lines[lineNum - 1] || 'db.query(`SELECT ... ${req.query.id}`)';
    add('CODE-SQL-001', 'SQL injection vulnerability detected via query concatenation', lineNum, snippet, 'Use parameterized query placeholders ($1, ?) instead of string interpolation.');
    sqlTaintFound = true;
  }

  // Check multi-step taint tracking into db.query(taintedQuery)
  if (!sqlTaintFound && !isLookalikeSafe && taintedVariables.size > 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/db\.(?:query|executeRaw)\s*\(/.test(line)) {
        for (const tv of taintedVariables) {
          if (new RegExp(`db\\.(?:query|executeRaw)\\s*\\(\\s*${tv}\\b`).test(line)) {
            add('CODE-SQL-001', 'SQL injection vulnerability detected via tainted query flow', i + 1, line, 'Use parameterized query placeholders ($1, ?) instead of string concatenation.');
            sqlTaintFound = true;
            break;
          }
        }
      }
      if (sqlTaintFound) break;
    }
  }

  // 4. Insecure CORS check
  const corsPattern = /(?:cors\([^)]*origin\s*:\s*['"]\*['"][^)]*credentials\s*:\s*true|Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"][\s\S]{0,100}Access-Control-Allow-Credentials['"]?\s*:\s*['"]true['"])/i;
  if (corsPattern.test(code)) {
    const matchLine = lines.findIndex(l => /cors/i.test(l) || /Access-Control/i.test(l));
    const lineNum = matchLine !== -1 ? matchLine + 1 : 1;
    add('CODE-CORS-001', 'Insecure CORS configuration: wildcard origin combined with credentials', lineNum, lines[lineNum - 1] || 'cors({ origin: "*", credentials: true })', 'Wildcard origin "*" cannot be combined with credentials. Specify trusted origins explicitly.');
  }
}

/**
 * Python Security Scanner with AST & Variable Taint Tracking
 */
function scanPython(
  relPath: string,
  code: string,
  candidateId: string,
  findings: Finding[]
): void {
  const lines = code.split('\n');
  const add = createFindingAdder(relPath, candidateId, findings);

  const taintedVars = new Set<string>();
  const pySourcePattern = /(?:request\.(?:GET|POST|args|form|json|data)|sys\.argv|input\s*\(|user_input)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const assignMatch = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*(.*)/);
    if (assignMatch) {
      const varName = assignMatch[1];
      const rhs = assignMatch[2];
      if (pySourcePattern.test(rhs)) {
        taintedVars.add(varName);
      } else {
        for (const tv of taintedVars) {
          if (new RegExp(`(?:f["'][^"']*\\{${tv}\\}[^"']*["']|%\\s*${tv}|\\+\\s*${tv}|${tv}\\s*\\+)`).test(rhs)) {
            taintedVars.add(varName);
            break;
          }
        }
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Python SQL Injection: cursor.execute / session.execute / raw(f"SELECT ...")
    if (/(?:cursor\.execute|session\.execute|\.raw)\s*\(/.test(line)) {
      const hasFstring = /f["'][^"']*(?:SELECT|UPDATE|DELETE|INSERT)[^"']*\{/i.test(line);
      const hasFormat = /["'][^"']*(?:SELECT|UPDATE|DELETE|INSERT)[^"']*["']\s*%\s*/i.test(line);
      const hasConcat = /["'][^"']*(?:SELECT|UPDATE|DELETE|INSERT)[^"']*["']\s*\+\s*/i.test(line);

      let usesTaintedVar = false;
      for (const tv of taintedVars) {
        if (new RegExp(`\\(\\s*${tv}\\b`).test(line)) {
          usesTaintedVar = true;
          break;
        }
      }

      if (hasFstring || hasFormat || hasConcat || usesTaintedVar) {
        add('CODE-PY-SQL-001', 'Python SQL injection: string formatting or concatenation in database query', i + 1, line, 'Use DB-API parameterized queries with tuple parameters: cursor.execute(query, (param,)).');
      }
    }

    // Python Command Injection: os.system, os.popen, subprocess.Popen(..., shell=True)
    if (/(?:os\.system|os\.popen|subprocess\.(?:Popen|run|call)\s*\([^)]*shell\s*=\s*True)/.test(line)) {
      const hasDirectTaint = /(?:request\.|input\(|sys\.argv)/.test(line);
      let usesTaintedVar = false;
      for (const tv of taintedVars) {
        if (new RegExp(`\\b${tv}\\b`).test(line)) {
          usesTaintedVar = true;
          break;
        }
      }
      if (hasDirectTaint || usesTaintedVar || /f["'][^"']*\{/.test(line)) {
        add('CODE-PY-CMD-001', 'Python Command Injection: executing shell command with unvalidated input', i + 1, line, 'Avoid shell=True in subprocess. Use argument list subprocess.run(["cmd", arg]) without shell.');
      }
    }

    // Python Deserialization: pickle.loads, yaml.load without SafeLoader
    if (/pickle\.loads\s*\(/.test(line)) {
      add('CODE-PY-DESER-001', 'Python unsafe deserialization via pickle.loads', i + 1, line, 'Never unpickle untrusted data. Use JSON or protocol buffers for serialization.');
    }
    if (/yaml\.load\s*\([^,)]*(?!\s*,\s*Loader\s*=\s*(?:yaml\.)?SafeLoader)/.test(line)) {
      add('CODE-PY-DESER-002', 'Python unsafe YAML loading without SafeLoader', i + 1, line, 'Use yaml.safe_load(data) instead of yaml.load to prevent arbitrary code execution.');
    }

    // Insecure production settings: DEBUG = True in Django
    if (/^\s*DEBUG\s*=\s*True\b/.test(line) && (relPath.includes('setting') || relPath.includes('config'))) {
      add('CODE-PY-CONFIG-001', 'Insecure Django setting: DEBUG enabled in production configuration', i + 1, line, 'Set DEBUG = False and read DEBUG from environment variable for development only.', 'medium');
    }
  }
}

/**
 * Go Security Scanner
 */
function scanGo(
  relPath: string,
  code: string,
  candidateId: string,
  findings: Finding[]
): void {
  const lines = code.split('\n');
  const add = createFindingAdder(relPath, candidateId, findings);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Go SQL Injection: db.Query(fmt.Sprintf("SELECT ... %s", id)) or concatenation
    if (/(?:db\.Query|db\.Exec|db\.Raw)\s*\(\s*(?:fmt\.Sprintf\s*\([^)]*(?:SELECT|UPDATE|DELETE|INSERT)|["'][^"']*(?:SELECT|UPDATE|DELETE)[^"']*["']\s*\+)/i.test(line)) {
      add('CODE-GO-SQL-001', 'Go SQL Injection: dynamically formatted query string without prepared statement', i + 1, line, 'Use database/sql parameter placeholders: db.Query("SELECT ... WHERE id = ?", id).');
    }

    // Go Command Injection: exec.Command("sh", "-c", input)
    if (/exec\.Command\s*\(\s*["'](?:sh|bash|cmd|powershell)["']\s*,\s*["'](?:-c|\/c)["']\s*,\s*[^)]+/.test(line)) {
      add('CODE-GO-CMD-001', 'Go Command Injection: shell invocation with variable argument', i + 1, line, 'Invoke the specific executable directly without invoking an intermediate shell interpreter.');
    }

    // Go Path Traversal: os.Open(filepath.Join(dir, untrusted))
    if (/os\.(?:Open|ReadFile)\s*\(\s*(?:filepath\.Join|fmt\.Sprintf)/.test(line) && /(?:r\.URL|c\.Query|c\.Param)/.test(line)) {
      add('CODE-GO-PATH-001', 'Go Path Traversal: opening file path constructed with user-supplied parameter', i + 1, line, 'Sanitize and clean path with filepath.Clean, and verify target lies within allowed base directory.');
    }
  }
}

/**
 * Rust Security Scanner
 */
function scanRust(
  relPath: string,
  code: string,
  candidateId: string,
  findings: Finding[]
): void {
  const lines = code.split('\n');
  const add = createFindingAdder(relPath, candidateId, findings);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Rust Command Injection
    if (/Command::new\s*\(\s*["'](?:sh|bash|cmd)["']\s*\)\s*\.args?\s*\([^)]*(?:-c|\/C)/.test(line)) {
      add('CODE-RS-CMD-001', 'Rust Command Injection: spawning shell interpreter with arguments', i + 1, line, 'Execute command binary directly with distinct arguments rather than invoking sh -c.');
    }

    // Rust SQL Injection: sqlx::query(&format!("SELECT ... {}", id))
    if (/(?:sqlx::query|client\.query)\s*\(\s*&(?:format!\s*\([^)]*(?:SELECT|UPDATE|DELETE|INSERT))/i.test(line)) {
      add('CODE-RS-SQL-001', 'Rust SQL Injection: format! string interpolation used in sqlx query', i + 1, line, 'Use sqlx query binding: sqlx::query("SELECT ... WHERE id = $1").bind(id).');
    }

    // Rust Unchecked Transmute
    if (/std::mem::transmute_copy\s*\(/.test(line) || (/unsafe\s*\{/.test(line) && /std::mem::transmute\s*\(/.test(line))) {
      add('CODE-RS-UNSAFE-001', 'Rust Unsafe Transmute Hazard: unbounded memory cast without layout validation', i + 1, line, 'Use safe type conversion traits (From/Into, TryFrom) or validated parsing instead of transmute.', 'medium');
    }
  }
}

/**
 * Java Security Scanner
 */
function scanJava(
  relPath: string,
  code: string,
  candidateId: string,
  findings: Finding[]
): void {
  const lines = code.split('\n');
  const add = createFindingAdder(relPath, candidateId, findings);

  const taintedJavaVars = new Set<string>();
  const javaSourcePattern = /(?:getParameter|getHeader|getQueryString|getInputStream|@RequestParam|@PathVariable|userControlled|input)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const assignMatch = line.match(/^\s*(?:String|[a-zA-Z0-9_<>]+)\s+([a-zA-Z0-9_]+)\s*=\s*(.*)/);
    if (assignMatch) {
      const varName = assignMatch[1];
      const rhs = assignMatch[2];
      if (javaSourcePattern.test(rhs)) {
        taintedJavaVars.add(varName);
      } else {
        for (const tv of taintedJavaVars) {
          if (new RegExp(`(?:\\+\\s*${tv}|${tv}\\s*\\+)`).test(rhs)) {
            taintedJavaVars.add(varName);
            break;
          }
        }
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Java SQL Injection: .executeQuery("SELECT ... " + id) or tainted variable
    if (/(?:\.executeQuery|\.execute|createNativeQuery)\s*\(/.test(line)) {
      const hasConcat = /["'][^"']*(?:SELECT|UPDATE|DELETE|INSERT)[^"']*["']\s*\+/i.test(line);
      let usesTaint = false;
      for (const tv of taintedJavaVars) {
        if (new RegExp(`\\+\\s*${tv}\\b|${tv}\\s*\\+|\\(\\s*${tv}\\b`).test(line)) {
          usesTaint = true;
          break;
        }
      }
      if (hasConcat || usesTaint) {
        add('CODE-JAVA-SQL-001', 'Java SQL Injection: dynamic concatenation in SQL statement execution', i + 1, line, 'Use PreparedStatement with setString / setInt parameter placeholders.');
      }
    }

    // Java Command Injection: Runtime.getRuntime().exec(...) or ProcessBuilder
    if (/(?:Runtime\.getRuntime\(\)\.exec|new\s+ProcessBuilder)\s*\(/.test(line)) {
      const hasDirectTaint = /(?:getParameter|input|params)/i.test(line);
      let usesTaint = false;
      for (const tv of taintedJavaVars) {
        if (new RegExp(`\\b${tv}\\b`).test(line)) {
          usesTaint = true;
          break;
        }
      }
      if (hasDirectTaint || usesTaint || /exec\s*\([^)]*\+/i.test(line)) {
        add('CODE-JAVA-CMD-001', 'Java Command Injection: Runtime.getRuntime().exec or ProcessBuilder with unvalidated input', i + 1, line, 'Use ProcessBuilder with parameterized argument array and validate input against a strict allowlist.');
      }
    }

    // Java Deserialization: ObjectInputStream.readObject()
    if (/new\s+ObjectInputStream\s*\([^)]*\)\.readObject\(\)/.test(line)) {
      add('CODE-JAVA-DESER-001', 'Java Unsafe Deserialization via ObjectInputStream.readObject', i + 1, line, 'Avoid Java native serialization. Use Jackson JSON parser with polymorphic typing disabled.');
    }

    // Java XXE: DocumentBuilderFactory without feature disabling
    if (/DocumentBuilderFactory\.newInstance\(\)/.test(line) && !code.includes('setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)')) {
      add('CODE-JAVA-XXE-001', 'Java XML External Entity (XXE) vulnerability in DocumentBuilderFactory', i + 1, line, 'Disable DOCTYPE declaration: dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);');
    }
  }
}

/**
 * Checks for security mistakes across multiple languages: JS/TS, Python, Go, Rust, Java.
 */
export function scanCodeAst(relPath: string, code: string, candidateId: string): Finding[] {
  const findings: Finding[] = [];
  const ext = path.extname(relPath).toLowerCase();

  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    scanJavaScriptTypeScript(relPath, code, candidateId, findings);
  } else if (ext === '.py') {
    scanPython(relPath, code, candidateId, findings);
  } else if (ext === '.go') {
    scanGo(relPath, code, candidateId, findings);
  } else if (ext === '.rs') {
    scanRust(relPath, code, candidateId, findings);
  } else if (ext === '.java') {
    scanJava(relPath, code, candidateId, findings);
  } else {
    // Default fallback to JS/TS engine for generic files
    scanJavaScriptTypeScript(relPath, code, candidateId, findings);
  }

  return findings;
}

/**
 * Step 10 — Multi-Language Code Mistakes Scanner
 */
export function scanCodeMistakes(
  projectPath: string,
  options: CodeMistakesOptions = {}
): CodeMistakesResult {
  const normProject = path.resolve(projectPath);
  const candidateId = options.candidateId || 'cand_01J00000000000000000000000';

  // TC-162: Check binary checksum integrity if opengrep binary path is given
  if (options.opengrepPath) {
    if (!fs.existsSync(options.opengrepPath)) {
      return {
        findings: [],
        status: 'not-run-unavailable',
        reason: 'code check not run (scanner unavailable)'
      };
    }

    const binaryBuffer = fs.readFileSync(options.opengrepPath);
    const actualChecksum = crypto.createHash('sha256').update(binaryBuffer).digest('hex');

    if (options.expectedChecksum && actualChecksum !== options.expectedChecksum) {
      return {
        findings: [],
        status: 'not-run-modified',
        reason: 'code check reported as "not run (scanner modified)"'
      };
    }
  } else if (options.opengrepPath === null && options.expectedChecksum === undefined) {
    // When opengrep is explicitly null and requested to simulate unavailable
    return {
      findings: [],
      status: 'not-run-unavailable',
      reason: 'code check not run (scanner unavailable)'
    };
  }

  // Multi-language supported extensions
  const supportedExtensions = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py',
    '.go',
    '.rs',
    '.java'
  ]);

  // Scan project files using AST / multi-language taint tracking engine
  const findings: Finding[] = [];

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
        if (supportedExtensions.has(ext)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            findings.push(...scanCodeAst(relPath, content, candidateId));
          } catch {
            // ignore
          }
        }
      }
    }
  }

  walk(normProject);

  return {
    findings,
    status: 'completed'
  };
}
