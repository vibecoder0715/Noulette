import crypto from 'node:crypto';
import type { TrapcheckFinding } from '../../schema/trapcheck.schema.js';

export function scanNetRules(relPath: string, text: string, isLifecycle = false): TrapcheckFinding[] {
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

  // NET-003: Exfiltrating hostname, user info, environment
  if (
    /(hostname|userinfo|os\.environ|process\.env)\s*.*(?:fetch|axios|http\.request|post|curl)/i.test(text)
  ) {
    add('NET-003', 'CRITICAL', 'Exfiltrating system environment, username, or hostname via network call', text.slice(0, 100));
  }

  // NET-004: Reading credentials / SSH paths in source
  if (
    /\.ssh[\\/]|\.aws[\\/]credentials|\.docker[\\/]config\.json|wallet\.dat/i.test(text)
  ) {
    add('NET-004', 'CRITICAL', 'Sensitive credential or wallet path referenced in code', text.slice(0, 100));
  }

  // NET-005: Writing to Startup / Run registry keys
  if (/currentversion\\run|\\startup\\/i.test(text) && /(reg\s+add|fs\.write|createkey)/i.test(text)) {
    add('NET-005', 'CRITICAL', 'Persistence key modification detected in source', text.slice(0, 100));
  }

  // NET-001 & NET-002: Outbound network calls in lifecycle code
  if (isLifecycle || normPath.includes('setup.py') || normPath.includes('build.rs') || normPath.includes('postinstall')) {
    if (/https?:\/\//i.test(text) || /fetch\s*\(|http\.get|urllib\.request/i.test(text)) {
      add('NET-002', 'HIGH', 'Outbound network communication in install or build lifecycle code', text.slice(0, 100));
    }
  }

  return findings;
}
