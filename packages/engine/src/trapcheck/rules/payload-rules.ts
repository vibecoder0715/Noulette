import crypto from 'node:crypto';
import type { TrapcheckFinding } from '../../schema/trapcheck.schema.js';

export function scanPayloadRules(
  relPath: string,
  buffer: Buffer,
  contentStr?: string,
  isLifecycleReferenced = false
): TrapcheckFinding[] {
  const normPath = relPath.replace(/\\/g, '/').toLowerCase();
  const findings: TrapcheckFinding[] = [];

  const add = (
    ruleId: string,
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO',
    plain: string,
    excerpt: string,
    line: number | null = null
  ) => {
    const snippetHash = crypto.createHash('sha256').update(excerpt).digest('hex');
    findings.push({
      ruleId,
      severity,
      file: relPath,
      line,
      snippetHash,
      excerpt: excerpt.slice(0, 200),
      plain,
      confidence: 'confirmed'
    });
  };

  // PAY-011: Extension vs magic mismatch (e.g. .png starting with MZ)
  const isPE = buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a; // 'MZ'
  const isImageOrDoc = normPath.endsWith('.png') || normPath.endsWith('.jpg') || normPath.endsWith('.jpeg') || normPath.endsWith('.gif') || normPath.endsWith('.pdf');
  if (isImageOrDoc && isPE) {
    add('PAY-011', 'CRITICAL', 'Image/document file contains executable PE (MZ) binary header (PAY-011)', `${relPath}: starts with MZ`);
    return findings;
  }

  // PAY-008: Macro-enabled office docs (.docm, .xlsm) or vbaProject.bin
  if (normPath.endsWith('.docm') || normPath.endsWith('.xlsm') || normPath.includes('vbaproject.bin')) {
    add('PAY-008', 'HIGH', 'Office document with VBA macro code detected (PAY-008)', relPath);
  }

  // PAY-009: LNK file presence / shortcut
  if (normPath.endsWith('.lnk')) {
    add('PAY-009', 'HIGH', 'Windows shortcut (.lnk) file detected in repository (PAY-009)', relPath);
  }

  // Text-based checks
  const text = contentStr !== undefined ? contentStr : (buffer.includes(0) ? '' : buffer.toString('utf8'));
  if (!text) return findings;

  // PAY-001 & PAY-002: Base64 decode + eval
  if (/eval\s*\(\s*atob\s*\(/i.test(text) || /eval\s*\(\s*buffer\.from\([^,]+,\s*['"]base64['"]\)/i.test(text)) {
    add('PAY-002', 'HIGH', 'Dynamic evaluation of base64-decoded string detected (eval + atob)', 'eval(atob(...))');
  }

  // PAY-003: Obfuscated JS / _0x variable density
  const hexDensityMatch = text.match(/_0x[a-f0-9]{3,}/g);
  const isPacker = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)/i.test(text);

  if (isPacker || (hexDensityMatch && hexDensityMatch.length >= 10)) {
    if (isLifecycleReferenced || normPath.includes('setup') || normPath.includes('install')) {
      add('PAY-003', 'HIGH', 'Obfuscated JavaScript referenced by lifecycle install scripts', text.slice(0, 100));
    } else {
      // In src/ without lifecycle execution: MEDIUM (benign shape per TC-040)
      add('PAY-003', 'MEDIUM', 'Obfuscated JavaScript patterns detected in source code', text.slice(0, 100));
    }
  }

  return findings;
}
