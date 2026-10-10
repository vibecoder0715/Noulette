import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * One-click "Connect" for coding agents. Config formats verified against each agent's docs (Oct 2026):
 *  - Kiro          ~/.kiro/settings/mcp.json                     JSON  mcpServers.{command,args,env,disabled}
 *  - Claude Code   ~/.claude.json                                JSON  mcpServers.{type:"stdio",command,args,env}
 *  - Cline         ~/.cline/data/settings/cline_mcp_settings.json (CLI) and
 *                  <VS Code family>/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
 *                                                                JSON  mcpServers.{command,args,disabled}
 *  - OpenCode      ~/.config/opencode/opencode.json[c]           JSONC mcp.{type:"local",command:[...],enabled}
 *  - Codex         ~/.codex/config.toml                          TOML  [mcp_servers.noulette] command, args
 *  - Antigravity   ~/.gemini/config/mcp_config.json (newer) or ~/.gemini/antigravity/mcp_config.json
 *                                                                JSON  mcpServers.{command,args}
 * Every write: back up first, merge (other servers untouched), refuse to touch files that do not parse.
 */
export type AgentId = 'kiro' | 'claude-code' | 'cline' | 'opencode' | 'codex' | 'antigravity';

export interface Cmd {
  command: string;
  args: string[];
}

export interface AgentInfo {
  id: AgentId;
  name: string;
  files: string[];
  installed: boolean;
  connected: boolean;
}

const home = () => process.env.NOULETTE_AGENT_HOME ?? os.homedir();
const appData = () => process.env.NOULETTE_AGENT_APPDATA ?? process.env.APPDATA ?? path.join(home(), 'AppData', 'Roaming');

const VSCODE_FAMILY = ['Code', 'Code - Insiders', 'Cursor', 'Kiro', 'Antigravity', 'Antigravity IDE', 'VSCodium', 'Windsurf'];

function clineFiles(): string[] {
  const out: string[] = [];
  for (const ide of VSCODE_FAMILY) {
    const dir = path.join(appData(), ide, 'User', 'globalStorage', 'saoudrizwan.claude-dev');
    if (fs.existsSync(dir)) out.push(path.join(dir, 'settings', 'cline_mcp_settings.json'));
  }
  const cli = path.join(home(), '.cline', 'data', 'settings', 'cline_mcp_settings.json');
  if (fs.existsSync(path.join(home(), '.cline')) || !out.length) out.push(cli);
  return out;
}

function opencodeFile(): string {
  const dir = path.join(home(), '.config', 'opencode');
  for (const f of ['opencode.jsonc', 'opencode.json']) if (fs.existsSync(path.join(dir, f))) return path.join(dir, f);
  return path.join(dir, 'opencode.json');
}

function antigravityFile(): string {
  const a = path.join(home(), '.gemini', 'config', 'mcp_config.json');
  const b = path.join(home(), '.gemini', 'antigravity', 'mcp_config.json');
  if (fs.existsSync(a)) return a;
  if (fs.existsSync(b)) return b;
  return a;
}

export function agentFiles(id: AgentId): string[] {
  switch (id) {
    case 'kiro': return [path.join(home(), '.kiro', 'settings', 'mcp.json')];
    case 'claude-code': return [path.join(home(), '.claude.json')];
    case 'cline': return clineFiles();
    case 'opencode': return [opencodeFile()];
    case 'codex': return [path.join(home(), '.codex', 'config.toml')];
    case 'antigravity': return [antigravityFile()];
  }
}

const NAMES: Record<AgentId, string> = { kiro: 'Kiro', 'claude-code': 'Claude Code', cline: 'Cline', opencode: 'OpenCode', codex: 'Codex', antigravity: 'Antigravity' };

function installed(id: AgentId): boolean {
  const h = home();
  switch (id) {
    case 'kiro': return fs.existsSync(path.join(h, '.kiro')) || fs.existsSync(path.join(appData(), 'Kiro'));
    case 'claude-code': return fs.existsSync(path.join(h, '.claude.json')) || fs.existsSync(path.join(h, '.claude'));
    case 'cline': return VSCODE_FAMILY.some((i) => fs.existsSync(path.join(appData(), i, 'User', 'globalStorage', 'saoudrizwan.claude-dev'))) || fs.existsSync(path.join(h, '.cline'));
    case 'opencode': return fs.existsSync(path.join(h, '.config', 'opencode'));
    case 'codex': return fs.existsSync(path.join(h, '.codex'));
    case 'antigravity': return fs.existsSync(path.join(h, '.gemini')) || fs.existsSync(path.join(appData(), 'Antigravity'));
  }
}

function isConnected(file: string): boolean {
  try {
    const t = fs.readFileSync(file, 'utf8');
    return /\[mcp_servers\.noulette\]/.test(t) || /"noulette"\s*:/.test(t);
  } catch {
    return false;
  }
}

export function listAgents(): AgentInfo[] {
  return (Object.keys(NAMES) as AgentId[]).map((id) => {
    const files = agentFiles(id);
    return { id, name: NAMES[id], files, installed: installed(id), connected: files.some(isConnected) };
  });
}

/** Strips // and /* *\/ comments and trailing commas (JSONC), leaving strings intact. */
export function stripJsonc(t: string): string {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < t.length) {
    const c = t[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += t[++i] ?? '';
      else if (c === '"') inStr = false;
      i++;
    } else if (c === '"') (inStr = true), (out += c), i++;
    else if (c === '/' && t[i + 1] === '/') while (i < t.length && t[i] !== '\n') i++;
    else if (c === '/' && t[i + 1] === '*') {
      i += 2;
      while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++;
      i += 2;
    } else (out += c), i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export class ConnectError extends Error {}

function backup(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const b = `${file}.noulette-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, b);
  return b;
}

function readJson(file: string, jsonc = false): any {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(jsonc ? stripJsonc(raw) : raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new ConnectError(`${file} is not valid JSON, so Noulette did not change it. Fix or remove it, then try again.`);
  }
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
}

function tomlLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  return JSON.stringify(s);
}

function connectFile(id: AgentId, file: string, cmd: Cmd): void {
  if (id === 'codex') {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const block = `[mcp_servers.noulette]\ncommand = ${tomlLiteral(cmd.command)}\nargs = [${cmd.args.map(tomlLiteral).join(', ')}]\nstartup_timeout_sec = 30\ntool_timeout_sec = 600\n`;
    const re = /^\[mcp_servers\.noulette\][\s\S]*?(?=^\[|(?![\s\S]))/m;
    const next = re.test(existing) ? existing.replace(re, block + '\n') : (existing ? existing.replace(/\s*$/, '\n\n') : '') + block;
    writeAtomic(file, next);
    return;
  }
  if (id === 'opencode') {
    const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const j = readJson(file, true);
    const entry = { type: 'local', command: [cmd.command, ...cmd.args], enabled: true, timeout: 30000 };
    const hasComments = raw !== '' && stripJsonc(raw).replace(/\s/g, '') !== raw.replace(/,(\s*[}\]])/g, '$1').replace(/\s/g, '');
    if (hasComments && !j.mcp?.noulette) {
      // Keep the user's comments: insert textually.
      const entryText = `"noulette": ${JSON.stringify(entry)}`;
      let next: string;
      if (/"mcp"\s*:\s*\{\s*\}/.test(raw)) next = raw.replace(/"mcp"\s*:\s*\{\s*\}/, `"mcp": { ${entryText} }`);
      else if (/"mcp"\s*:\s*\{/.test(raw)) next = raw.replace(/"mcp"\s*:\s*\{(\s*)/, (_m, ws) => `"mcp": {${ws}${entryText},${ws}`);
      else next = raw.replace(/\{/, `{\n  "mcp": { ${entryText} },`);
      JSON.parse(stripJsonc(next));
      writeAtomic(file, next);
      return;
    }
    j.$schema ??= 'https://opencode.ai/config.json';
    j.mcp = { ...(j.mcp ?? {}), noulette: entry };
    writeAtomic(file, JSON.stringify(j, null, 2) + '\n');
    return;
  }
  const j = readJson(file);
  const entry: Record<string, unknown> =
    id === 'claude-code' ? { type: 'stdio', command: cmd.command, args: cmd.args, env: {} }
      : id === 'kiro' ? { command: cmd.command, args: cmd.args, env: {}, disabled: false, autoApprove: [] }
        : id === 'cline' ? { command: cmd.command, args: cmd.args, disabled: false, autoApprove: [], timeout: 600 }
          : { command: cmd.command, args: cmd.args };
  j.mcpServers = { ...(j.mcpServers ?? {}), noulette: entry };
  writeAtomic(file, JSON.stringify(j, null, 2) + '\n');
}

export function connectAgent(id: AgentId, cmd: Cmd): { name: string; files: string[]; backup: string | null } {
  if (!(id in NAMES)) throw new ConnectError('Unknown agent');
  const files = agentFiles(id);
  let firstBackup: string | null = null;
  for (const f of files) {
    if (id !== 'codex') readJson(f, id === 'opencode'); // validate before any change
    const b = backup(f);
    firstBackup ??= b;
    connectFile(id, f, cmd);
  }
  return { name: NAMES[id], files, backup: firstBackup };
}
