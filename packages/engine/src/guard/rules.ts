import fs from 'node:fs';
import path from 'node:path';
import { run } from '../core/proc.js';

/**
 * Download guard rules. Tuned to stay quiet:
 *  - critical  = high-confidence attack patterns (raise an alert);
 *  - uncertain = worth a human look (quietly added to Approvals);
 *  - everything else is only logged.
 */
export type GuardLevel = 'critical' | 'uncertain';
export interface GuardReason {
  rule: string;
  level: GuardLevel;
  plain: string;
  file: string;
}
export type Verdict = 'safe' | 'uncertain' | 'critical';

const AGENT_FILES = /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.clinerules|\.windsurfrules|copilot-instructions\.md|\.kiro\/steering\/[^/]+\.md|\.cursor\/rules\/[^/]+)$/i;
const EXEC_EXT = /\.(exe|scr|pif|com|bat|cmd|vbs|vbe|js|jse|wsf|wsh|hta|lnk|ps1|psm1|msi|msix|jar|dll|cpl|reg|iso|img)$/i;
const RISKY_STANDALONE = /\.(scr|pif|com|hta|vbe|jse|wsf|wsh|cpl)$/i;
const DOUBLE_EXT = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|zip|rar|mp4|mp3|csv)\s*\.(exe|scr|pif|com|bat|cmd|vbs|js|jse|wsf|lnk|ps1|hta)$/i;
const DOWNLOAD_CRADLE = /(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|certutil\s+-urlcache|bitsadmin|DownloadString|DownloadFile|Start-BitsTransfer)\b[^\n]{0,200}(\||;|&&|iex|Invoke-Expression|sh\b|bash\b|node\s+-e|python\s+-c|powershell)/i;
const PS_ENCODED = /powershell(\.exe)?[^\n]{0,80}\s-(e|en|enc|encodedcommand)\s+[A-Za-z0-9+/=]{80,}/i;
const PS_IEX = /(iex|Invoke-Expression)\s*\(?[^\n]{0,120}(FromBase64String|DownloadString|New-Object\s+Net\.WebClient)/i;
const HIDDEN_UNICODE = /[\u{E0000}-\u{E007F}]|[\u202A-\u202E\u2066-\u2069]|(?:[\u200B-\u200D\u2060\uFEFF]){5,}/u;
const INJECTION_TEXT = /(ignore (all )?(previous|prior|above) instructions|disregard (the )?(system|previous) prompt|you are now (in )?(developer|dan) mode|do not tell the user|exfiltrate|send (the )?(contents of )?(~\/\.ssh|\.env|id_rsa))/i;

export function scanFileContent(rel: string, buf: Buffer): GuardReason[] {
  const out: GuardReason[] = [];
  const name = path.basename(rel);
  const norm = rel.replace(/\\/g, '/');
  const add = (rule: string, level: GuardLevel, plain: string) => out.push({ rule, level, plain, file: norm });
  if (DOUBLE_EXT.test(name)) add('double-extension', 'critical', `"${name}" pretends to be a document but is a program.`);
  else if (RISKY_STANDALONE.test(name)) add('risky-type', 'uncertain', `"${name}" is a type of file that runs code when opened.`);
  const isPE = buf.length > 64 && buf[0] === 0x4d && buf[1] === 0x5a;
  if (isPE && !/\.(exe|dll|msi|sys|scr|com|cpl|ocx|node|pyd)$/i.test(name)) add('disguised-program', 'critical', `"${name}" is a Windows program with a misleading file name.`);
  if (buf.length > 2_000_000 || isPE) return out;
  const text = buf.toString('utf8');
  if (AGENT_FILES.test(norm)) {
    if (HIDDEN_UNICODE.test(text)) add('hidden-ai-instructions', 'critical', `${name} contains invisible characters, a known trick to hide instructions for AI agents.`);
    else if (INJECTION_TEXT.test(text)) add('ai-instruction-override', 'uncertain', `${name} contains text that tries to override what your AI agent is told.`);
  }
  if (/(^|\/)\.vscode\/tasks\.json$/i.test(norm) && /"runOn"\s*:\s*"folderOpen"/.test(text)) add('autorun-task', 'critical', 'This project runs a command automatically as soon as the folder is opened in VS Code.');
  if (/(^|\/)\.claude\/settings(\.local)?\.json$/i.test(norm)) {
    if (/"hooks"\s*:/.test(text) && DOWNLOAD_CRADLE.test(text)) add('agent-hook-download', 'critical', 'An AI agent hook downloads and runs code from the internet.');
    else if (/"(ANTHROPIC|OPENAI)_BASE_URL"|"NODE_OPTIONS"|"HTTPS?_PROXY"/i.test(text)) add('agent-env-override', 'uncertain', 'AI agent settings send your traffic to a different server.');
  }
  if (/(^|\/)package\.json$/i.test(norm)) {
    try {
      const scripts = JSON.parse(text).scripts ?? {};
      for (const k of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) {
        const s = String(scripts[k] ?? '');
        if (s && (DOWNLOAD_CRADLE.test(s) || PS_ENCODED.test(s) || /base64\s+(-d|--decode)|eval\s*\(|node\s+-e\s+["'].*(http|child_process)/i.test(s))) add('install-script', 'critical', `Installing this package runs a hidden download or encoded command ("${k}").`);
      }
    } catch {}
  }
  if (/(^|\/)\.(npmrc|yarnrc(\.yml)?)$/i.test(norm) && /registry\s*[=:]\s*["']?https?:\/\/(?!registry\.npmjs\.org|registry\.yarnpkg\.com)/i.test(text)) add('registry-override', 'uncertain', 'Packages would be downloaded from an unofficial server.');
  if (/\.(ps1|psm1|bat|cmd|vbs|sh|js|mjs|py)$/i.test(name)) {
    if (PS_ENCODED.test(text) || PS_IEX.test(text)) add('obfuscated-script', 'critical', `${name} hides what it does (encoded commands that download or run code).`);
    else if (DOWNLOAD_CRADLE.test(text) && /\.(ps1|bat|cmd|vbs)$/i.test(name)) add('download-and-run', 'uncertain', `${name} downloads something from the internet and runs it.`);
  }
  if (/\.svg$/i.test(name) && /<script\b|\son[a-z]+\s*=|javascript:/i.test(text)) add('svg-script', /document\.cookie|fetch\(|eval\(|atob\(/.test(text) ? 'critical' : 'uncertain', `The image ${name} contains code.`);
  if (/\.(html?|js)$/i.test(name) && /(keylogger|navigator\.clipboard\.readText\(\)[\s\S]{0,200}fetch|document\.cookie[\s\S]{0,120}(fetch|XMLHttpRequest|sendBeacon)\(\s*['"]https?:)/i.test(text)) add('data-stealer', 'critical', `${name} reads private data (cookies or clipboard) and sends it to the internet.`);
  return out;
}

/** Mark-of-the-Web: true when Windows recorded that the file came from the internet. */
function fromInternet(abs: string): boolean {
  if (process.platform !== 'win32') return false;
  try {
    return /ZoneId=3|ZoneId=4/.test(fs.readFileSync(abs + ':Zone.Identifier', 'utf8'));
  } catch {
    return false;
  }
}

/** Authenticode check for downloaded programs. Signed by a valid publisher = normal installer. */
export async function signatureStatus(abs: string): Promise<'valid' | 'invalid' | 'unknown'> {
  if (process.platform !== 'win32') return 'unknown';
  const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-AuthenticodeSignature -LiteralPath $args[0]).Status', abs], { timeoutMs: 20_000 });
  const s = r.stdout.trim();
  return s === 'Valid' ? 'valid' : s ? 'invalid' : 'unknown';
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.noulette', '__pycache__', '.venv', 'venv', 'target', 'dist', 'build', '.next']);

export interface UnitScan {
  verdict: Verdict;
  reasons: GuardReason[];
  files: number;
}

/** Scans one new file or folder (a download, a clone, an added file). */
export async function scanUnit(abs: string, opts: { maxFiles?: number } = {}): Promise<UnitScan> {
  const reasons: GuardReason[] = [];
  let files = 0;
  const max = opts.maxFiles ?? 20_000;
  const isDir = fs.statSync(abs).isDirectory();
  const base = isDir ? abs : path.dirname(abs);
  const visit = async (p: string) => {
    if (files >= max) return;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(p);
      if (path.isAbsolute(target) || target.split(/[\\/]/).includes('..')) reasons.push({ rule: 'symlink-escape', level: 'uncertain', plain: 'A link points outside the folder.', file: path.relative(base, p).replace(/\\/g, '/') });
      return;
    }
    if (st.isDirectory()) {
      if (p !== abs && SKIP_DIRS.has(path.basename(p))) return;
      for (const e of fs.readdirSync(p)) await visit(path.join(p, e));
      return;
    }
    files++;
    const rel = path.relative(base, p).replace(/\\/g, '/') || path.basename(p);
    let buf: Buffer;
    try {
      const fd = fs.openSync(p, 'r');
      const len = Math.min(st.size, 2_000_001);
      buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      fs.closeSync(fd);
    } catch {
      return;
    }
    reasons.push(...scanFileContent(rel, buf));
    // Programs downloaded on their own: unsigned ones from the internet need a look; signed installers are normal.
    if (!isDir && EXEC_EXT.test(p) && /\.(exe|msi|msix|dll|scr|com)$/i.test(p) && fromInternet(p)) {
      const sig = await signatureStatus(p);
      if (sig !== 'valid') reasons.push({ rule: 'unsigned-download', level: 'uncertain', plain: `"${path.basename(p)}" came from the internet and is not signed by a known publisher.`, file: rel });
    }
  };
  await visit(abs);
  if (isDir) {
    const { scanSecrets } = await import('../inspect/scanners.js');
    const s = await scanSecrets(abs);
    const strong = s.findings.filter((f) => !f.details?.historyOnly && /private-key|aws|gcp|azure|github|stripe|slack|openai|anthropic/i.test(f.rule));
    if (strong.length) reasons.push({ rule: 'leaked-secrets', level: 'uncertain', plain: `Contains ${strong.length} real-looking password(s) or key(s). Someone may have leaked them, or they may be bait.`, file: strong[0].file ?? '' });
  }
  const verdict: Verdict = reasons.some((r) => r.level === 'critical') ? 'critical' : reasons.length ? 'uncertain' : 'safe';
  return { verdict, reasons, files };
}
