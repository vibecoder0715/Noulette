import path from 'node:path';
import crypto from 'node:crypto';
import type { TrapcheckFinding } from '../../schema/trapcheck.schema.js';
import { analyzeCommand, getHighestCmdSeverity } from '../analyzer/cmd-analyzer.js';

export function scanAgentRules(relPath: string, content: string): TrapcheckFinding[] {
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

  // AGT-001 & AGT-002: .claude/settings*.json
  if (normPath.includes('.claude/settings')) {
    try {
      const parsed = JSON.parse(content);
      // Check hooks (AGT-001)
      if (parsed.hooks) {
        let hookSev: 'CRITICAL' | 'HIGH' = 'HIGH';
        const hookStr = JSON.stringify(parsed.hooks);
        const cmdMatches = analyzeCommand(hookStr);
        const highest = getHighestCmdSeverity(cmdMatches);
        if (highest === 'CRITICAL' || highest === 'HIGH') {
          hookSev = 'CRITICAL';
        }
        add('AGT-001', hookSev, 'Auto-executing hooks detected in Claude settings', hookStr);
      }
      // Check env overrides (AGT-002)
      if (parsed.env) {
        for (const [key, val] of Object.entries(parsed.env)) {
          const upperKey = key.toUpperCase();
          if (
            upperKey.endsWith('_BASE_URL') ||
            upperKey.endsWith('_API_URL') ||
            upperKey.includes('PROXY') ||
            upperKey === 'NODE_OPTIONS' ||
            upperKey === 'NODE_TLS_REJECT_UNAUTHORIZED'
          ) {
            add('AGT-002', 'CRITICAL', `Agent environment URL/proxy override detected: ${key}=${val}`, `${key}=${val}`);
          }
        }
      }
    } catch {
      // Non-json or comments in json: fallback string match
      if (/"hooks"\s*:/.test(content)) {
        const cmdMatches = analyzeCommand(content);
        const highest = getHighestCmdSeverity(cmdMatches);
        add('AGT-001', highest === 'CRITICAL' ? 'CRITICAL' : 'HIGH', 'Hooks found in Claude settings', content.slice(0, 100));
      }
      if (/ANTHROPIC_BASE_URL|HTTPS?_PROXY|NODE_OPTIONS/i.test(content)) {
        add('AGT-002', 'CRITICAL', 'Agent environment URL/proxy override detected', content.slice(0, 100));
      }
    }
  }

  // AGT-003: Agent permission bypass
  if (/enableAllProjectMcpServers\s*:\s*true/i.test(content) || /bash\(\*\)/i.test(content)) {
    add('AGT-003', 'HIGH', 'Broad agent permission bypass or auto-approval detected', content.slice(0, 100));
  }

  // AGT-004: MCP server configurations (*mcp*.json)
  if (normPath.endsWith('.mcp.json') || normPath.includes('/mcp.json') || (normPath.includes('mcp') && normPath.endsWith('.json'))) {
    // Check real-shape MCP servers (split command + args, env injection, remote URL) (TC-202)
    try {
      const parsed = JSON.parse(content);
      const servers = parsed.mcpServers || parsed.servers || {};
      for (const [sName, sCfg] of Object.entries<any>(servers)) {
        if (!sCfg || typeof sCfg !== 'object') continue;
        // Split command + args
        if (sCfg.command) {
          const fullCmd = [sCfg.command, ...(Array.isArray(sCfg.args) ? sCfg.args : [])].join(' ');
          const cmdMatches = analyzeCommand(fullCmd);
          for (const cm of cmdMatches) {
            if (cm.ruleId !== 'CMD-012') {
              add(cm.ruleId, cm.severity, `MCP server ${sName}: ${cm.reason}`, fullCmd);
            }
          }
          const highest = getHighestCmdSeverity(cmdMatches);
          if (highest === 'CRITICAL' || highest === 'HIGH') {
            add('AGT-004', highest, `Dangerous command in MCP server ${sName}`, fullCmd);
          }
        }
        // Environment variable injection (NODE_OPTIONS, PROXY, etc.)
        if (sCfg.env && typeof sCfg.env === 'object') {
          for (const [envK, envV] of Object.entries<any>(sCfg.env)) {
            const upK = envK.toUpperCase();
            if (upK === 'NODE_OPTIONS' || upK.includes('PROXY') || upK.endsWith('_URL')) {
              add('AGT-004', 'CRITICAL', `MCP server ${sName} injects dangerous environment: ${envK}=${envV}`, `${envK}=${envV}`);
            }
          }
        }
        // Remote url servers
        if (sCfg.url || sCfg.transport === 'sse') {
          add('AGT-004', 'HIGH', `MCP server ${sName} connects to remote server: ${sCfg.url || 'sse'}`, JSON.stringify(sCfg));
        }
      }
    } catch {
      // Fallback to string analysis
    }

    const cmdMatches = analyzeCommand(content);
    const highest = getHighestCmdSeverity(cmdMatches);
    const isUnpinnedNpx = /npx\s+(?:-y|--yes)\s+([a-z0-9_-]+)(?:["'\s]|$)/i.test(content) && !/npx\s+(?:-y|--yes)\s+[a-z0-9_-]+@[0-9]/i.test(content);

    if (highest === 'CRITICAL') {
      add('AGT-004', 'CRITICAL', 'Dangerous execution command in MCP configuration', content.slice(0, 100));
    } else if (highest === 'HIGH' || isUnpinnedNpx) {
      add('AGT-004', 'HIGH', 'Unpinned package or command found in MCP configuration', content.slice(0, 100));
    }
  }

  // AGT-007: .vscode/tasks.json with folderOpen
  if (normPath.includes('.vscode/tasks.json')) {
    if (/["']?runon["']?\s*:\s*["']folderopen["']/i.test(content)) {
      const cmdMatches = analyzeCommand(content);
      const highest = getHighestCmdSeverity(cmdMatches);
      const sev = (highest === 'CRITICAL' || highest === 'HIGH' || highest === 'MEDIUM') ? 'CRITICAL' : 'HIGH';
      add('AGT-007', sev, 'Auto-run on folder open task detected in .vscode/tasks.json', content.slice(0, 100));
    }
  }

  // AGT-008: .vscode/settings.json pointing to in-repo executables (TC-203)
  if (normPath.includes('.vscode/settings.json')) {
    if (
      /terminal\.integrated\.automationprofile/i.test(content) ||
      /terminal\.integrated\.automationshell/i.test(content) ||
      /python\.defaultinterpreterpath\s*:\s*["']\.\//i.test(content) ||
      /["']\.\/tools\/[^"']+\.exe["']/i.test(content) ||
      /"path"\s*:\s*["'][^"']+\.(?:exe|bat|cmd|sh)["']/i.test(content)
    ) {
      add('AGT-008', 'HIGH', 'VS Code settings pointing to repository-local executable', content.slice(0, 100));
    }
  }

  // AGT-011: .devcontainer
  if (normPath.includes('devcontainer')) {
    if (/initializecommand/i.test(content)) {
      const cmdMatches = analyzeCommand(content);
      const highest = getHighestCmdSeverity(cmdMatches);
      const sev = (highest === 'CRITICAL' || highest === 'HIGH' || highest === 'MEDIUM') ? 'CRITICAL' : 'HIGH';
      add('AGT-011', sev, 'Host-side initializeCommand detected in devcontainer configuration', content.slice(0, 100));
    }
  }

  return findings;
}
