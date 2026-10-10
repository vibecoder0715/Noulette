import crypto from 'node:crypto';
import type { TrapcheckFinding } from '../../schema/trapcheck.schema.js';
import { decodeTagBlock, hasTagBlock, hasZeroWidth } from '../../util/sanitize-text.js';

export function scanInjectionRules(relPath: string, text: string): TrapcheckFinding[] {
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

  // INJ-004: Unicode tag block characters U+E0000 to U+E007F
  if (hasTagBlock(text)) {
    const decoded = decodeTagBlock(text);
    if (decoded) {
      const lowerDecoded = decoded.toLowerCase();
      const hasDirective = /ignore\s+(all\s+|any\s+|previous\s+|prior\s+)?instructions|disregard|system\s+prompt|new\s+instructions/i.test(lowerDecoded);
      if (hasDirective) {
        add('INJ-004', 'CRITICAL', 'Steganographic Unicode tag block decoding to instruction injection', decoded);
      } else {
        add('INJ-004', 'HIGH', 'Steganographic Unicode tag block characters detected', decoded);
      }
    }
  }

  // INJ-003: Hidden text in markdown/HTML comments
  const htmlComments = text.match(/<!--([\s\S]*?)-->/g);
  if (htmlComments) {
    for (const comment of htmlComments) {
      const inner = comment.replace(/^<!--/, '').replace(/-->$/, '').trim();
      const hasInstruction = /ignore\s+|run\s+|curl\s+|download\s+|system\s+prompt|instruction/i.test(inner);
      if (hasInstruction && inner.length > 20) {
        add('INJ-003', 'HIGH', 'Hidden HTML comment containing prompt injection or agent instruction', comment);
      }
    }
  }

  // INJ-001 & INJ-002: Directives and Prompt Injections
  const isAgentFacing =
    normPath.includes('agent') ||
    normPath.includes('claude') ||
    normPath.includes('gemini') ||
    normPath.includes('cursor') ||
    normPath.includes('windsurf') ||
    normPath.includes('copilot') ||
    normPath.endsWith('readme.md') ||
    normPath.endsWith('.md') ||
    normPath.endsWith('.mdc');

  const directiveRegex = /ignore\s+(all\s+|any\s+|previous\s+|prior\s+)?instructions|disregard\s+(all\s+|any\s+)?prior\s+guidance|you\s+are\s+now|developer\s+message|system\s+prompt|do\s+not\s+(tell|reveal|inform)\s+(to\s+)?the\s+user/i;

  const actionRegex = /run\s+|execute\s+|curl\s+|download\s+|install\s+|powershell\s+|bash\s+|sh\s+/i;

  // Split visible text (excluding HTML comments) by paragraphs (two or more newlines)
  const visibleText = text.replace(/<!--[\s\S]*?-->/g, '');
  const paragraphs = visibleText.split(/\n\s*\n/);
  for (const para of paragraphs) {
    if (directiveRegex.test(para)) {
      if (actionRegex.test(para)) {
        // Directive + Action in same paragraph -> both INJ-001 and INJ-002 CRITICAL!
        add('INJ-001', 'CRITICAL', 'Directive override phrase detected (INJ-001)', para.trim());
        add('INJ-002', 'CRITICAL', 'Prompt injection with direct action request detected (INJ-002)', para.trim());
      } else {
        add('INJ-001', isAgentFacing ? 'HIGH' : 'MEDIUM', 'Directive override phrase detected in text', para.trim());
      }
    }
  }

  // INJ-007: Telling agent to disable tools/scanners
  if (/disable\s+(the\s+)?(linter|scanner|tests)|turn\s+off\s+scanners|auto-approve\s+all\s+changes/i.test(text)) {
    add('INJ-007', 'HIGH', 'Instructions requesting disabling linters, scanners, or checks', text.slice(0, 100));
  }

  // INJ-011: Mass suppression comments (> 20 nosec / nosemgrep)
  const suppressions = text.match(/#\s*nosec|\/\/\s*nosemgrep|\/\*\s*eslint-disable/g);
  if (suppressions && suppressions.length > 20) {
    add('INJ-011', 'HIGH', `Mass suppression comments detected in file (${suppressions.length} occurrences)`, text.slice(0, 100));
  }

  return findings;
}
