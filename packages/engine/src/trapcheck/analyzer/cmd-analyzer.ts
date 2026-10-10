import type { TrapcheckSeverity } from '../../schema/trapcheck.schema.js';

export interface CmdMatch {
  ruleId: string;
  severity: TrapcheckSeverity;
  reason: string;
  matchedPattern: string;
}

/**
 * Normalizes command strings:
 * - lower-cases
 * - strips caret (^) escapes: p^o^w^e^r -> power
 * - strips backticks (`)
 * - expands simple %COMSPEC:~...% or concat if possible
 */
export function normalizeCommand(raw: string): string {
  let norm = raw.trim();

  // Remove caret escapes: e.g. c^u^r^l -> curl, p^o^w^e^r -> power
  norm = norm.replace(/\^/g, '');

  // Remove backtick split in PowerShell: e.g. p`o`w`e`r -> power
  norm = norm.replace(/`/g, '');

  // Lowercase
  return norm.toLowerCase();
}

/**
 * Analyzes a command string against CMD-001 to CMD-018 patterns.
 */
export function analyzeCommand(rawCommand: string): CmdMatch[] {
  const norm = normalizeCommand(rawCommand);
  const matches: CmdMatch[] = [];

  // Helper to add match
  const add = (ruleId: string, severity: TrapcheckSeverity, reason: string, matchedPattern: string) => {
    matches.push({ ruleId, severity, reason, matchedPattern });
  };

  // CMD-001: Download-and-execute
  // curl/wget/iwr/Invoke-WebRequest/DownloadString/certutil -urlcache pipe or executed into sh/bash/cmd/powershell/iex
  const downloadKeywords = /(curl|wget|iwr|invoke-webrequest|downloadstring|downloadfile|certutil\s+-urlcache|bitsadmin\s+\/transfer)/;
  const execKeywords = /(\|\s*(sh|bash|cmd|powershell|iex)|iex\s*\(|start\s+|cmd\s+\/c|powershell\s+-c)/;
  if (downloadKeywords.test(norm) && execKeywords.test(norm)) {
    add('CMD-001', 'CRITICAL', 'Download-and-execute command pattern detected', rawCommand.slice(0, 100));
  } else if (/powershell\s+.*iex\s*\(.*iwr\s+/.test(norm) || /curl\s+.*\|\s*(sh|bash|cmd)/.test(norm)) {
    add('CMD-001', 'CRITICAL', 'Download-and-execute pipeline detected', rawCommand.slice(0, 100));
  }

  // CMD-002: Encoded command
  // powershell -enc / -encodedcommand / -e <b64>
  const b64PsMatch = norm.match(/(?:powershell(?:\.exe)?\s+)?-(?:enc|encodedcommand|e)\s+([a-za-z0-9+/=]{10,})/i);
  if (b64PsMatch || /frombase64string/i.test(norm) || /atob\s*\(.*eval/i.test(norm) || /\[convert\]::.*iex/i.test(norm)) {
    // Check if decodes to execution or network
    let decodesToDanger = false;
    if (b64PsMatch && b64PsMatch[1]) {
      try {
        const decoded = Buffer.from(b64PsMatch[1], 'base64').toString('utf8').toLowerCase();
        if (/write-output|echo|canary|curl|http|iex|exec|cmd|powershell|net/.test(decoded)) {
          decodesToDanger = true;
        }
      } catch {
        // ignore
      }
    }
    add('CMD-002', decodesToDanger ? 'CRITICAL' : 'HIGH', 'Encoded shell command detected', rawCommand.slice(0, 100));
  }

  // CMD-003: LOLBin proxy execution
  const lolbins = /(mshta|rundll32|regsvr32\s+\/i:http|wscript|cscript|msiexec\s+\/i\s+http|installutil|msbuild|cmstp|pcalua|certreq\s+-post)/;
  if (lolbins.test(norm)) {
    const hasUrl = /https?:\/\//.test(norm);
    add('CMD-003', hasUrl ? 'CRITICAL' : 'HIGH', 'LOLBin proxy execution detected', rawCommand.slice(0, 100));
  }

  // CMD-004: Persistence
  if (
    /schtasks(?:\.exe)?\s+\/create/.test(norm) ||
    /reg\s+add\s+.*\\run(?:once)?/.test(norm) ||
    /\\startup\\/i.test(norm) ||
    /sc(?:\.exe)?\s+create/.test(norm) ||
    /new-service/.test(norm) ||
    /\$profile|\.bashrc|\.profile/.test(norm)
  ) {
    add('CMD-004', 'CRITICAL', 'System persistence command detected', rawCommand.slice(0, 100));
  }

  // CMD-005: Credential/data harvesting paths
  if (
    /\.ssh[\\/]|\.aws[\\/]|\.azure[\\/]|\.npmrc|\.pypirc|\.git-credentials|\.docker[\\/]config\.json|wallet\.dat|mimikatz|sam\s+|system\s+hive|cmdkey\s+\/list/i.test(norm)
  ) {
    add('CMD-005', 'CRITICAL', 'Credential or sensitive identity file access detected', rawCommand.slice(0, 100));
  }

  // CMD-006: Exfil endpoints
  if (
    /pastebin\.com|transfer\.sh|file\.io|webhook\.site|pipedream|ngrok|trycloudflare|serveo|discord\.com\/api\/webhooks|api\.telegram\.org\/bot|interact\.sh/i.test(norm) ||
    /203\.0\.113\.\d+/.test(norm) // TEST-NET raw IP canary
  ) {
    add('CMD-006', 'HIGH', 'Exfiltration endpoint detected', rawCommand.slice(0, 100));
  }

  // CMD-007: Environment dump + send
  if (/(process\.env|os\.environ|printenv|get-childitem\s+env:)\s*.*(?:curl|fetch|http|post)/i.test(norm)) {
    add('CMD-007', 'CRITICAL', 'Environment dump and exfiltration detected', rawCommand.slice(0, 100));
  }

  // CMD-008: Destructive commands
  if (
    /rm\s+-rf\s+[~/]|del\s+\/[fsq]\s+|rd\s+\/s\s+\/q\s+%userprofile%|format\s+[a-z]:|cipher\s+\/w|vssadmin\s+delete\s+shadows|wevtutil\s+cl/i.test(norm)
  ) {
    add('CMD-008', 'CRITICAL', 'Destructive command pattern detected', rawCommand.slice(0, 100));
  }

  // CMD-009: Defense evasion / privilege bypass
  if (
    /set-mppreference\s+-disable/i.test(norm) ||
    /netsh\s+advfirewall.*off/i.test(norm) ||
    /-executionpolicy\s+bypass/i.test(norm) ||
    /\brunas\b/i.test(norm)
  ) {
    const isRemote = /http|curl|iwr/i.test(norm);
    add('CMD-009', isRemote ? 'CRITICAL' : 'HIGH', 'Antivirus/firewall evasion or policy bypass detected', rawCommand.slice(0, 100));
  }

  // CMD-010: Reverse shell / listener
  if (/nc\s+-e|ncat\s+--exec|bash\s+-i\s+>&|\/dev\/tcp|tcpclient/i.test(norm)) {
    add('CMD-010', 'CRITICAL', 'Reverse shell or network listener pattern detected', rawCommand.slice(0, 100));
  }

  // CMD-011: Cryptominer
  if (/xmrig|minerd|cpuminer|stratum\+tcp/i.test(norm)) {
    add('CMD-011', 'CRITICAL', 'Cryptocurrency miner indicator detected', rawCommand.slice(0, 100));
  }

  // CMD-012: Unpinned / remote installs
  if (
    /npx\s+(?:-y|--yes)\s+[a-z0-9_-]+(?:\s+|$)(?!@[0-9])/i.test(norm) || // unpinned npx
    /npm\s+i(?:nstall)?\s+https?:\/\//i.test(norm) ||
    /pip\s+install\s+git\+/i.test(norm) ||
    /--extra-index-url/i.test(norm)
  ) {
    add('CMD-012', 'HIGH', 'Unpinned or external remote package installation detected', rawCommand.slice(0, 100));
  }

  // CMD-013: Obfuscated shell
  if (
    rawCommand.includes('^') ||
    rawCommand.includes('`') ||
    /%comspec:~.*%/i.test(rawCommand) ||
    /-join/i.test(norm)
  ) {
    add('CMD-013', 'HIGH', 'Obfuscated shell escape assembly detected', rawCommand.slice(0, 100));
  }

  // CMD-014: Shell-out wrappers
  if (/cmd(?:\.exe)?\s+\/c/i.test(norm) || /powershell(?:\.exe)?\s+-c/i.test(norm) || /sh\s+-c/i.test(norm)) {
    add('CMD-014', 'MEDIUM', 'Shell wrapper invocation detected', rawCommand.slice(0, 100));
  }

  // CMD-015: Writes outside the project
  if (
    /%appdata%|%userprofile%|%temp%|c:\\windows|\.\.[\\/]\.\.[\\/]/i.test(norm)
  ) {
    add('CMD-015', 'HIGH', 'Filesystem access or write outside project tree detected', rawCommand.slice(0, 100));
  }

  // CMD-016: Sandbox evasion (long sleep/timeout)
  if (/sleep\s+(?:[3-9]\d{2,}|\d{4,})|timeout\s+\/t\s+(?:[3-9]\d{2,}|\d{4,})|ping\s+-n\s+\d{3,}/i.test(norm)) {
    add('CMD-016', 'MEDIUM', 'Sandbox delay / artificial execution sleep detected', rawCommand.slice(0, 100));
  }

  // CMD-017: System modification
  if (
    /drivers\\etc\\hosts|netsh\s+winhttp\s+set\s+proxy|certutil\s+-addstore|import-certificate/i.test(norm)
  ) {
    add('CMD-017', 'CRITICAL', 'System networking, proxy, or certificate authority modification detected', rawCommand.slice(0, 100));
  }

  // CMD-018: Hidden execution
  if (/-windowstyle\s+hidden|create_no_window|windowshide|start\s+\/b/i.test(norm)) {
    add('CMD-018', 'HIGH', 'Hidden or headless execution flags detected', rawCommand.slice(0, 100));
  }

  return matches;
}

/**
 * Returns the highest severity among matches or null if no matches.
 */
export function getHighestCmdSeverity(matches: CmdMatch[]): TrapcheckSeverity | null {
  if (matches.length === 0) return null;
  const order: TrapcheckSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  for (const s of order) {
    if (matches.some(m => m.severity === s)) return s;
  }
  return 'INFO';
}
