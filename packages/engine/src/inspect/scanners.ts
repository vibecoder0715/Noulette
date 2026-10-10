import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { run } from '../core/proc.js';
import { rulesDir, scannersDir, projectWorkDir } from '../core/paths.js';
import { isGitRepo } from '../core/git.js';
import { labelById, labelForCwe } from './taxonomy.js';
import { loadKev } from './feeds.js';
import { redact } from '../core/redact.js';
import type { Finding, FindingSeverity, ScannerStatus, Stage } from './types.js';

type Raw = Omit<Finding, 'id' | 'fingerprint' | 'status'>;

export function fingerprint(f: Pick<Finding, 'source' | 'rule' | 'file' | 'evidence' | 'title'>): string {
  const ev = (f.evidence ?? f.title).replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha256').update(`${f.source}|${f.rule}|${(f.file ?? '').toLowerCase()}|${ev}`).digest('hex').slice(0, 24);
}

export function finalize(raw: Raw): Omit<Finding, 'id'> {
  return { ...raw, fingerprint: fingerprint(raw), status: 'open' };
}

function bin(name: string): string {
  return path.join(scannersDir(), name);
}

function scannerAvailable(rel: string): boolean {
  return fs.existsSync(bin(rel));
}

function lineAt(root: string, file: string | null, line: number | null): string | null {
  if (!file || !line) return null;
  try {
    const l = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)[line - 1];
    return l === undefined ? null : l.trim().slice(0, 300);
  } catch {
    return null;
  }
}

function rel(root: string, p: string): string {
  const abs = path.isAbsolute(p) ? p : path.join(root, p);
  return path.relative(root, abs).replace(/\\/g, '/');
}

function isTestPath(f: string): boolean {
  return /(^|\/)(tests?|__tests__|spec|specs|fixtures?|mocks?|__mocks__|e2e|cypress|examples?|samples?|stories)(\/|$)|\.(test|spec|stories)\.[a-z]+$|_test\.(go|py)$|test_[^/]*\.py$/i.test(f);
}

// --------------------------------------------------------------------------- gitleaks

export async function scanSecrets(root: string): Promise<{ findings: Raw[]; status: ScannerStatus }> {
  const t0 = Date.now();
  if (!scannerAvailable('gitleaks.exe')) return { findings: [], status: { name: 'secrets', ok: false, ran: false, findings: 0, note: 'gitleaks not installed', ms: 0 } };
  const findings: Raw[] = [];
  const seen = new Set<string>();
  const modes: string[][] = [['dir', root]];
  if (await isGitRepo(root)) modes.push(['git', root, '--log-opts=--all -n 500']);
  let ok = true;
  for (const args of modes) {
    const report = path.join(os.tmpdir(), `nl-gl-${process.pid}-${Date.now()}.json`);
    const r = await run(bin('gitleaks.exe'), [...args, '--report-format', 'json', '--report-path', report, '--no-banner', '--redact', '--exit-code', '0', '--max-target-megabytes', '5'], { timeoutMs: 180_000 });
    if (r.code !== 0 && !fs.existsSync(report)) ok = false;
    let items: any[] = [];
    try {
      items = JSON.parse(fs.readFileSync(report, 'utf8'));
    } catch {}
    fs.rmSync(report, { force: true });
    for (const it of items) {
      const file = rel(root, it.File);
      if (/(^|\/)\.noulette\//.test(file)) continue;
      // Anything found in git history stays readable in old commits even after the code is fixed,
      // so it is its own "needs you" item (rotate the key), separate from the current-file finding.
      const historyOnly = args[0] === 'git';
      const key = historyOnly ? `hist:${file}:${it.RuleID}` : `${file}:${it.RuleID}:${it.StartLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = labelById('secret');
      findings.push({
        stage: 'security',
        source: 'gitleaks',
        rule: it.RuleID,
        severity: /live|prod|private-key|aws|stripe|github|gcp|azure/i.test(it.RuleID + it.Description) ? 'critical' : 'high',
        labelId: label.id,
        title: historyOnly ? `${label.label} (in old commits)` : label.label,
        tldr: historyOnly ? 'A password or key was committed in the past. It is still visible in the history.' : label.tldr,
        file: historyOnly ? null : file,
        line: historyOnly ? null : it.StartLine,
        // Never store the secret itself: evidence is the line with the value masked.
        evidence: historyOnly ? null : redact(lineAt(root, file, it.StartLine) ?? ''),
        fixability: historyOnly ? 'human' : 'both',
        humanAction: historyOnly
          ? `Rotate (replace) this key with the provider. It is still in old commits of ${file}; removing it from history needs a history rewrite.`
          : 'Rotate (replace) this key with the provider, because anyone who saw the code may have it.',
        fix: historyOnly ? null : 'Move the value to an environment variable or secret store and remove it from the code.',
        details: { scanner: 'gitleaks', rule: it.RuleID, description: it.Description, commit: it.Commit ? String(it.Commit).slice(0, 12) : null, cwe: 798, historyOnly, historyFile: historyOnly ? file : undefined }
      });
    }
  }
  return { findings, status: { name: 'secrets', ok, ran: true, findings: findings.length, ms: Date.now() - t0 } };
}

// --------------------------------------------------------------------------- osv-scanner

export interface DepPackage {
  name: string;
  version: string;
  ecosystem: string;
  licenses: string[];
  source: string;
}

function osvSeverity(v: any, kev: Set<string>, aliases: string[]): FindingSeverity {
  if (aliases.some((a) => kev.has(a))) return 'critical';
  const ds = String(v?.database_specific?.severity ?? '').toUpperCase();
  if (ds === 'CRITICAL') return 'critical';
  if (ds === 'HIGH') return 'high';
  if (ds === 'MODERATE' || ds === 'MEDIUM') return 'medium';
  return 'low';
}

function fixedVersion(v: any, pkgName: string): string | null {
  for (const a of v?.affected ?? []) {
    if (a?.package?.name && a.package.name !== pkgName) continue;
    for (const r of a?.ranges ?? []) for (const e of r?.events ?? []) if (e.fixed) return e.fixed;
  }
  return null;
}

export async function scanDependencies(root: string, opts: { offline?: boolean } = {}): Promise<{ findings: Raw[]; packages: DepPackage[]; status: ScannerStatus }> {
  const t0 = Date.now();
  if (!scannerAvailable('osv-scanner.exe')) return { findings: [], packages: [], status: { name: 'dependencies', ok: false, ran: false, findings: 0, note: 'osv-scanner not installed', ms: 0 } };
  const offline = opts.offline || process.env.NOULETTE_OFFLINE === '1';
  const args = ['scan', 'source', '-r', root, '--format', 'json', '--allow-no-lockfiles'];
  if (offline) args.push('--offline-vulnerabilities', '--download-offline-databases');
  else args.push('--licenses');
  const r = await run(bin('osv-scanner.exe'), args, { timeoutMs: 300_000 });
  let j: any = null;
  try {
    j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  } catch {}
  if (!j) {
    const noLock = /no package sources found|no lockfiles/i.test(r.stderr + r.stdout);
    return { findings: [], packages: [], status: { name: 'dependencies', ok: noLock, ran: true, findings: 0, note: noLock ? 'No lockfiles found' : (r.stderr || r.error || 'osv-scanner failed').slice(0, 300), ms: Date.now() - t0 } };
  }
  const kev = await loadKev({ offline });
  const findings: Raw[] = [];
  const packages: DepPackage[] = [];
  for (const res of j.results ?? []) {
    const source = rel(root, res?.source?.path ?? '');
    for (const p of res.packages ?? []) {
      const pk = p.package ?? {};
      packages.push({ name: pk.name, version: pk.version, ecosystem: pk.ecosystem, licenses: p.licenses ?? [], source });
      for (const g of p.groups ?? []) {
        const v = (p.vulnerabilities ?? []).find((x: any) => g.ids?.includes(x.id)) ?? {};
        const aliases: string[] = g.aliases ?? g.ids ?? [];
        const exploited = aliases.some((a) => kev.cves.has(a));
        const cwe = v?.database_specific?.cwe_ids?.[0] ?? null;
        const label = labelById(exploited ? 'dependency-exploited' : 'dependency');
        const fixed = fixedVersion(v, pk.name);
        const sev = osvSeverity(v, kev.cves, aliases);
        findings.push({
          stage: 'security',
          source: 'osv',
          rule: g.ids?.[0] ?? v.id ?? 'OSV',
          severity: sev,
          labelId: label.id,
          title: `${label.label}: ${pk.name}`,
          tldr: label.tldr,
          file: source || null,
          line: null,
          evidence: `${pk.name}@${pk.version}`,
          fixability: fixed ? 'code' : 'human',
          humanAction: fixed ? null : 'No fixed version exists yet. Decide whether to replace this package.',
          fix: fixed ? `Upgrade ${pk.name} to ${fixed} or later.` : null,
          details: { scanner: 'osv-scanner', ids: g.ids, aliases, summary: v.summary ?? null, package: pk, fixedVersion: fixed, cwe, cvss: g.max_severity ?? null, kev: exploited, inner: labelForCwe(cwe)?.label ?? null }
        });
      }
    }
  }
  return { findings, packages, status: { name: 'dependencies', ok: true, ran: true, findings: findings.length, note: kev.fetchedAt ? undefined : 'CISA KEV list not downloaded yet', ms: Date.now() - t0 } };
}

// --------------------------------------------------------------------------- opengrep (SAST)

const ANALYZER: Record<string, string> = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.py': 'python', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.go': 'go', '.php': 'php', '.rb': 'ruby', '.cs': 'csharp', '.rs': 'rust'
};

export function sastLanguages(files: string[]): string[] {
  return [...new Set(files.map((f) => ANALYZER[path.extname(f).toLowerCase()]).filter(Boolean))];
}

export async function scanSast(root: string, files: string[], only?: { rules?: string[]; files?: string[] }): Promise<{ findings: Raw[]; status: ScannerStatus }> {
  const t0 = Date.now();
  const exe = bin(path.join('opengrep', 'opengrep-core.exe'));
  if (!fs.existsSync(exe)) return { findings: [], status: { name: 'sast', ok: false, ran: false, findings: 0, note: 'opengrep not installed', ms: 0 } };
  const targetFiles = (only?.files ?? files).filter((f) => ANALYZER[path.extname(f).toLowerCase()] && !isTestPath(f));
  if (!targetFiles.length) return { findings: [], status: { name: 'sast', ok: true, ran: false, findings: 0, note: 'No files in a supported language (AST rules cover JS/TS, Python, Java, Kotlin, Go, PHP, Ruby, C#, Rust)', ms: 0 } };
  const ruleDir = path.join(rulesDir(), 'sast');
  const ruleFiles = fs.existsSync(ruleDir) ? fs.readdirSync(ruleDir).filter((f) => f.endsWith('.yaml')) : [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-sast-'));
  const findings: Raw[] = [];
  let ok = true;
  const notes: string[] = [];
  try {
    const targets = targetFiles.map((f) => ['CodeTarget', { path: path.join(root, f).replace(/\\/g, '/'), analyzer: ANALYZER[path.extname(f).toLowerCase()], products: ['sast'] }]);
    const targetsFile = path.join(tmp, 'targets.json');
    fs.writeFileSync(targetsFile, JSON.stringify(targets));
    for (const rf of ruleFiles) {
      let rulesPath = path.join(ruleDir, rf);
      const r = await run(exe, ['-rules', rulesPath, '-json', '-targets', targetsFile, '-j', String(Math.max(1, Math.min(8, os.cpus().length))), '-timeout', '10', '-max_target_bytes', '2000000'], { timeoutMs: 600_000 });
      let j: any = null;
      try {
        j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{"version"')));
      } catch {}
      if (!j) {
        ok = false;
        notes.push(`${rf}: ${(r.stderr || r.error || '').split('\n').find((l) => /error|exception/i.test(l))?.slice(0, 200) ?? 'failed'}`);
        continue;
      }
      for (const e of j.errors ?? []) if (/fatal|rule/i.test(e.error_type ?? '')) notes.push(`${rf}: ${String(e.message).slice(0, 200)}`);
      for (const m of j.results ?? []) {
        if (only?.rules && !only.rules.includes(m.check_id)) continue;
        const md = m.extra?.metadata ?? {};
        const file = rel(root, m.path);
        const label = labelById(md.label ?? labelForCwe(md.cwe)?.id ?? 'other');
        findings.push({
          stage: 'security',
          source: 'opengrep',
          rule: m.check_id,
          severity: (['critical', 'high', 'medium', 'low'].includes(md.severity) ? md.severity : 'medium') as FindingSeverity,
          labelId: label.id,
          title: label.label,
          tldr: label.tldr,
          file,
          line: m.start?.line ?? null,
          evidence: lineAt(root, file, m.start?.line ?? null),
          fixability: 'code',
          humanAction: null,
          fix: md.fix ?? null,
          details: { scanner: 'opengrep', rule: m.check_id, message: m.extra?.message, cwe: md.cwe ?? null, endLine: m.end?.line ?? null }
        });
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { findings, status: { name: 'sast', ok, ran: true, findings: findings.length, note: notes.length ? notes.join('; ') : undefined, ms: Date.now() - t0 } };
}

// --------------------------------------------------------------------------- licenses (legal, deterministic part)

const COPYLEFT = /\b(AGPL|GPL|SSPL|EUPL|OSL|CC-BY-SA|CC-BY-NC)/i;
const WEAK_COPYLEFT = /\b(LGPL|MPL|EPL|CDDL)/i;
const DISCLAIMER = 'This is not legal advice. Ask a lawyer before making decisions based on it.';

export async function scanLicenses(root: string, files: string[], packages: DepPackage[]): Promise<{ findings: Raw[]; projectLicense: string | null; status: ScannerStatus }> {
  const t0 = Date.now();
  const findings: Raw[] = [];
  let projectLicense: string | null = null;
  const licenseFiles = files.filter((f) => /^(license|licence|copying)(\.(md|txt|rst))?$/i.test(path.basename(f)) && !f.includes('/'));
  if (licenseFiles.length && scannerAvailable('askalono.exe')) {
    const r = await run(bin('askalono.exe'), ['id', path.join(root, licenseFiles[0])], { timeoutMs: 30_000 });
    const m = /License:\s*([^\s(]+)/.exec(r.stdout);
    projectLicense = m ? m[1] : 'Unknown';
  } else if (licenseFiles.length) projectLicense = 'Unknown';
  if (!projectLicense) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      if (typeof pj.license === 'string' && pj.license !== 'UNLICENSED') projectLicense = pj.license;
    } catch {}
  }
  const base = { stage: 'legal' as Stage, source: 'license' as const, fixability: 'human' as const, fix: null };
  if (!projectLicense) {
    const l = labelById('license-missing');
    findings.push({ ...base, rule: 'license.missing', severity: 'low', labelId: l.id, title: l.label, tldr: l.tldr, file: null, line: null, evidence: null, humanAction: 'Choose a license (for example MIT for open source, or a private license if the code is not shared).', details: { disclaimer: DISCLAIMER } });
  }
  const permissive = !projectLicense || /MIT|BSD|Apache|ISC|Unlicense|0BSD|Zlib|Unknown|UNLICENSED|proprietary/i.test(projectLicense);
  for (const p of packages) {
    const lic = p.licenses.join(' OR ');
    if (!lic || /UNKNOWN|NOASSERTION/i.test(lic)) continue;
    if (permissive && COPYLEFT.test(lic) && !WEAK_COPYLEFT.test(lic) && !/OR\s+(MIT|BSD|Apache)/i.test(lic)) {
      const l = labelById('license');
      findings.push({ ...base, rule: 'license.copyleft-dependency', severity: /AGPL|SSPL/i.test(lic) ? 'high' : 'medium', labelId: l.id, title: `${l.label}: ${p.name}`, tldr: `The package ${p.name} uses ${lic}, which may require you to publish your own code.`, file: p.source || null, line: null, evidence: `${p.name}@${p.version}`, humanAction: 'Decide whether to replace the package or accept its license terms.', details: { package: p, projectLicense, disclaimer: DISCLAIMER } });
    }
  }
  // Risky assets: fonts and stock media that usually need a separate license.
  const assetRe = /\.(ttf|otf|woff2?|eot)$/i;
  const stockRe = /(getty|shutterstock|istock|adobestock|depositphotos|dreamstime|123rf)/i;
  const brandFontRe = /(helvetica|sf-?pro|segoe|futura|gotham|proxima|avenir|anthropic|circular|graphik|san-?francisco)/i;
  for (const f of files) {
    const name = path.basename(f);
    if ((assetRe.test(name) && brandFontRe.test(name)) || stockRe.test(name)) {
      const l = labelById('asset');
      findings.push({ ...base, rule: 'license.risky-asset', severity: 'medium', labelId: l.id, title: `${l.label}: ${name}`, tldr: l.tldr, file: f, line: null, evidence: name, humanAction: 'Confirm you have a license for this file, or replace it with a free alternative.', details: { disclaimer: DISCLAIMER } });
    }
  }
  return { findings, projectLicense, status: { name: 'licenses', ok: true, ran: true, findings: findings.length, ms: Date.now() - t0 } };
}

// --------------------------------------------------------------------------- SBOM

export function writeSbom(root: string, packages: DepPackage[]): string {
  const file = projectWorkDir(root, 'sbom.cdx.json');
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: { timestamp: new Date().toISOString(), tools: [{ name: 'noulette' }], component: { type: 'application', name: path.basename(root) } },
    components: packages.map((p) => ({
      type: 'library',
      name: p.name,
      version: p.version,
      purl: purl(p),
      licenses: p.licenses.map((l) => ({ expression: l }))
    }))
  };
  fs.writeFileSync(file, JSON.stringify(bom, null, 2));
  return file;
}

function purl(p: DepPackage): string {
  const eco = ({ npm: 'npm', PyPI: 'pypi', Go: 'golang', Maven: 'maven', 'crates.io': 'cargo', RubyGems: 'gem', Packagist: 'composer', NuGet: 'nuget' } as Record<string, string>)[p.ecosystem] ?? p.ecosystem?.toLowerCase();
  return `pkg:${eco}/${encodeURIComponent(p.name).replace(/%2F/g, '/')}@${p.version}`;
}

// --------------------------------------------------------------------------- mock / placeholder detection

const MOCK_LINE = [
  { re: /\b(mock|fake|dummy|stub)(ed)?[_ -]?(payment|charge|user|data|db|database|api|response|server|email|sms|auth|login|order)s?\b/i, why: 'fake implementation' },
  { re: /\/\/\s*(mock|fake|stub|placeholder|hard-?coded)\b|#\s*(mock|fake|stub|placeholder|hard-?coded)\b/i, why: 'comment says this is fake' },
  { re: /TODO:?\s*(connect|hook up|replace|wire|implement|integrate).{0,40}(real|actual|production|database|api|backend|payment)/i, why: 'TODO says the real system is not connected' },
  { re: /throw new Error\(['"`](not implemented|todo|unimplemented)/i, why: 'not implemented' },
  { re: /raise NotImplementedError/, why: 'not implemented' },
  { re: /\bunimplemented!\(|\btodo!\(/, why: 'not implemented' },
  { re: /['"`](mock|fake|dummy)_[a-z0-9_]+['"`]/i, why: 'fake identifier returned' },
  { re: /lorem ipsum/i, why: 'placeholder text' }
];

export async function scanMocks(root: string, files: string[]): Promise<{ findings: Raw[]; status: ScannerStatus }> {
  const t0 = Date.now();
  const findings: Raw[] = [];
  const label = labelById('mock');
  for (const f of files) {
    if (isTestPath(f) || !ANALYZER[path.extname(f).toLowerCase()] && !/\.(py|swift|dart|scala|ex|exs)$/i.test(f)) continue;
    let text: string;
    try {
      const st = fs.statSync(path.join(root, f));
      if (st.size > 1_000_000) continue;
      text = fs.readFileSync(path.join(root, f), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    let perFile = 0;
    for (let i = 0; i < lines.length && perFile < 5; i++) {
      for (const m of MOCK_LINE) {
        if (m.re.test(lines[i])) {
          findings.push({
            stage: 'feasibility',
            source: 'mock',
            rule: `mock.${m.why.replace(/\s+/g, '-')}`,
            severity: 'high',
            labelId: label.id,
            title: label.label,
            tldr: label.tldr,
            file: f,
            line: i + 1,
            evidence: lines[i].trim().slice(0, 300),
            fixability: 'human',
            humanAction: 'Connect this part to the real system (you may need accounts or keys), or confirm it is intentionally fake.',
            fix: null,
            details: { why: m.why }
          });
          perFile++;
          break;
        }
      }
    }
    if (findings.length >= 40) break;
  }
  return { findings, status: { name: 'mock-detection', ok: true, ran: true, findings: findings.length, ms: Date.now() - t0 } };
}

// --------------------------------------------------------------------------- analytics SDK detection

export interface AnalyticsDetection {
  posthog: boolean;
  ga: boolean;
  evidence: string[];
  appKind: 'web-js' | 'node' | 'python' | 'other';
}

export function detectAnalytics(root: string, files: string[]): AnalyticsDetection {
  const evidence: string[] = [];
  let posthog = false;
  let ga = false;
  let appKind: AnalyticsDetection['appKind'] = 'other';
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = { ...pj.dependencies, ...pj.devDependencies };
    appKind = deps.react || deps.vue || deps.next || deps.svelte || deps.vite ? 'web-js' : 'node';
    for (const d of Object.keys(deps)) {
      if (/^posthog-(js|node|react-native)$|^@posthog\//.test(d)) (posthog = true), evidence.push(`package.json: ${d}`);
      if (/^(react-ga4|@next\/third-parties|vue-gtag|ga-4-react)$/.test(d)) (ga = true), evidence.push(`package.json: ${d}`);
    }
  } catch {}
  for (const f of ['requirements.txt', 'pyproject.toml', 'Pipfile']) {
    try {
      const t = fs.readFileSync(path.join(root, f), 'utf8');
      appKind = appKind === 'other' ? 'python' : appKind;
      if (/^\s*posthog\b/im.test(t)) (posthog = true), evidence.push(`${f}: posthog`);
    } catch {}
  }
  if (!posthog || !ga) {
    for (const f of files.slice(0, 5000)) {
      if (!/\.(html|js|jsx|ts|tsx|vue|svelte|py|php|rb|go)$/i.test(f) || isTestPath(f)) continue;
      try {
        const t = fs.readFileSync(path.join(root, f), 'utf8');
        if (!posthog && /posthog\.init\(|new PostHog\(|from posthog import|us\.i\.posthog\.com|eu\.i\.posthog\.com/.test(t)) (posthog = true), evidence.push(f);
        if (!ga && /googletagmanager\.com\/gtag|gtag\(['"]config['"]/.test(t)) (ga = true), evidence.push(f);
      } catch {}
      if (posthog && ga) break;
    }
  }
  return { posthog, ga, evidence, appKind };
}

export function analyticsFindings(det: AnalyticsDetection): Raw[] {
  if (det.posthog) return [];
  const l = labelById('monitoring');
  const how = det.appKind === 'web-js' ? 'Add posthog-js and call posthog.init with your project key read from an environment variable.' : det.appKind === 'node' ? 'Add posthog-node and capture errors and key events with your project key read from an environment variable.' : det.appKind === 'python' ? 'Add the posthog Python package and capture errors with your key read from an environment variable.' : 'Add the PostHog SDK for your language.';
  return [{
    stage: 'feasibility', source: 'builtin', rule: 'monitoring.posthog-missing', severity: 'medium', labelId: l.id,
    title: 'PostHog is not installed',
    tldr: 'Noulette cannot watch your app after launch until PostHog tracking is added. The fix can add it for you.',
    file: null, line: null, evidence: null, fixability: 'both',
    humanAction: 'Create a PostHog project and put its project key in an environment variable (never in code).',
    fix: how, details: { detected: det, planRef: 'hosting' }
  }];
}
