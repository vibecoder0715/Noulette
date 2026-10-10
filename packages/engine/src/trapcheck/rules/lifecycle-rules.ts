import crypto from 'node:crypto';
import type { TrapcheckFinding } from '../../schema/trapcheck.schema.js';
import { analyzeCommand, getHighestCmdSeverity } from '../analyzer/cmd-analyzer.js';

export function scanLifecycleRules(relPath: string, content: string): TrapcheckFinding[] {
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

  // LIF-001: package.json scripts
  if (normPath.endsWith('package.json')) {
    try {
      const parsed = JSON.parse(content);
      const scripts = parsed.scripts || {};
      const lifecycleKeys = [
        'preinstall', 'install', 'postinstall', 'prepare', 'prepack',
        'postpack', 'prepublish', 'prepublishonly', 'preuninstall', 'postuninstall'
      ];

      for (const [key, cmd] of Object.entries(scripts)) {
        if (typeof cmd === 'string' && lifecycleKeys.includes(key.toLowerCase())) {
          // Benign shape: prepare: "husky"
          const isHuskyOnly = key.toLowerCase() === 'prepare' && cmd.trim() === 'husky';
          const cmdMatches = analyzeCommand(cmd);
          const highest = getHighestCmdSeverity(cmdMatches);

          let sev: 'CRITICAL' | 'HIGH' | 'MEDIUM' = 'MEDIUM';
          if (highest === 'CRITICAL') {
            sev = 'CRITICAL';
          } else if (highest === 'HIGH' || highest === 'MEDIUM') {
            sev = 'HIGH';
          }

          add(
            'LIF-001',
            sev,
            isHuskyOnly ? 'Standard git hook prepare script (husky)' : `Lifecycle hook script found: "${key}": "${cmd}"`,
            `"${key}": "${cmd}"`
          );
        }
      }
    } catch {
      // Fallback regex
      if (/["'](postinstall|preinstall|prepare)["']\s*:\s*["']([^"']+)["']/i.test(content)) {
        const cmdMatches = analyzeCommand(content);
        const highest = getHighestCmdSeverity(cmdMatches);
        add(
          'LIF-001',
          highest === 'CRITICAL' ? 'CRITICAL' : 'MEDIUM',
          'Lifecycle script detected in package.json',
          content.slice(0, 100)
        );
      }
    }
  }

  // LIF-003: .npmrc
  if (normPath.endsWith('.npmrc')) {
    if (/registry\s*=\s*http:\/\//i.test(content) || /@\w+:\s*registry\s*=/i.test(content)) {
      add('LIF-003', 'HIGH', 'Insecure HTTP or custom registry configured in .npmrc', content.slice(0, 100));
    }
    if (/script-shell\s*=\s*\.\//i.test(content)) {
      add('LIF-003', 'CRITICAL', 'Repository-local script-shell in .npmrc', content.slice(0, 100));
    }
  }

  // LIF-004: .yarnrc.yml / .yarnrc
  if (normPath.includes('.yarnrc')) {
    if (/yarnpath|yarn-path/i.test(content)) {
      add('LIF-004', 'CRITICAL', 'Custom untracked yarnPath detected in yarn configuration', content.slice(0, 100));
    }
  }

  // LIF-007: setup.py
  if (normPath.endsWith('setup.py')) {
    if (/os\.system|subprocess\.|urllib\.|requests\.|exec\(|eval\(/i.test(content)) {
      const cmdMatches = analyzeCommand(content);
      const highest = getHighestCmdSeverity(cmdMatches);
      const sev = (highest === 'CRITICAL' || highest === 'HIGH') ? 'CRITICAL' : 'HIGH';
      add('LIF-007', sev, 'Arbitrary code execution call in Python setup.py', content.slice(0, 100));
    }
  }

  // LIF-009: requirements.txt
  if (normPath.includes('requirements') && normPath.endsWith('.txt')) {
    if (/--extra-index-url|--index-url\s+http:\/\/|--trusted-host/i.test(content)) {
      add('LIF-009', 'HIGH', 'Custom or insecure index URL in requirements.txt (dependency confusion risk)', content.slice(0, 100));
    }
  }

  // LIF-012: build.rs or .cargo/config.toml
  if (normPath.endsWith('build.rs')) {
    if (/Command::new/i.test(content)) {
      add('LIF-012', 'HIGH', 'Subprocess execution call Command::new detected in build.rs', content.slice(0, 100));
    }
  }
  if (normPath.includes('.cargo/config') || normPath.endsWith('cargo.toml')) {
    if (/(runner|linker)\s*=\s*["']\.\//i.test(content)) {
      add('LIF-012', 'CRITICAL', 'Custom in-repo target runner/linker in Cargo configuration', content.slice(0, 100));
    }
  }

  // LIF-019: Dockerfile
  if (normPath.includes('dockerfile')) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/^RUN\s+/i.test(line)) {
        const cmdMatches = analyzeCommand(line);
        const highest = getHighestCmdSeverity(cmdMatches);
        if (highest === 'CRITICAL') {
          add('LIF-019', 'CRITICAL', 'Download-and-execute command in Dockerfile RUN instruction', line, i + 1);
        } else if (highest === 'HIGH') {
          add('LIF-019', 'HIGH', 'High-risk command in Dockerfile RUN instruction', line, i + 1);
        }
      }
    }
  }

  return findings;
}
