import { describe, it, expect, afterAll, beforeEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, tempDir, writeFiles, rm } from './helpers.ts';
import '../packages/engine/src/features.ts';
import { writeFuture } from '../packages/engine/src/plans/future.ts';
import { writePlan } from '../packages/engine/src/inspect/plan.ts';
import { connectAgent, listAgents, stripJsonc, agentFiles } from '../packages/engine/src/integrations/connect.ts';

const cleanup: string[] = [];
afterAll(() => {
  cleanup.forEach(rm);
  delete process.env.NOULETTE_AGENT_HOME;
  delete process.env.NOULETTE_AGENT_APPDATA;
});

const CMD = { command: 'C:\\Users\\me\\AppData\\Local\\Noulette\\noulette-engine.exe', args: ['mcp'] };

describe('M6 Plans / FUTURE.md', () => {
  it('TC-M6-01 FUTURE.md is a scale ladder from the PLAN.md user count (x10, x100, x1000)', () => {
    tempHome();
    const p = tempDir();
    cleanup.push(p);
    writeFiles(p, { 'package.json': JSON.stringify({ dependencies: { express: '4', sqlite3: '5' } }) });
    writePlan(p, [{ q: 'How many users do you expect in the next 12 months?', a: '100' }]);
    const r = writeFuture(p);
    expect(r.tiers.map((t) => t.users)).toEqual([100, 1000, 10000, 100000]);
    const md = fs.readFileSync(path.join(p, 'FUTURE.md'), 'utf8');
    expect(md).toContain('## Up to 1,000 users');
    expect(md).toContain('Move from SQLite');
    expect(md).toContain('Detected: Express, SQLite');
    const none = tempDir();
    cleanup.push(none);
    expect(writeFuture(none).missingUsers).toBe(true);
  });
});

describe('M6 one-click Connect (contract tests on a fake home folder)', () => {
  let h = '';
  beforeEach(() => {
    h = tempDir('nl-agenthome-');
    cleanup.push(h);
    process.env.NOULETTE_AGENT_HOME = h;
    process.env.NOULETTE_AGENT_APPDATA = path.join(h, 'AppData', 'Roaming');
  });

  it('TC-M6-02 JSON agents: backup, merge, keep other servers (Kiro, Claude Code, Cline, Antigravity)', () => {
    writeFiles(h, {
      '.kiro/settings/mcp.json': JSON.stringify({ mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } }),
      '.claude.json': JSON.stringify({ numStartups: 5, projects: { x: {} }, mcpServers: { other: { type: 'stdio', command: 'a' } } }),
      'AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json': JSON.stringify({ mcpServers: { git: { command: 'g' } } }),
      '.gemini/config/mcp_config.json': JSON.stringify({ mcpServers: { blender: { command: 'b', args: [] } } })
    });
    for (const id of ['kiro', 'claude-code', 'cline', 'antigravity'] as const) {
      const r = connectAgent(id, CMD);
      expect(r.backup).toBeTruthy();
      expect(fs.existsSync(r.backup!)).toBe(true);
      const j = JSON.parse(fs.readFileSync(r.files[0], 'utf8'));
      expect(j.mcpServers.noulette.command).toBe(CMD.command);
      expect(j.mcpServers.noulette.args).toEqual(['mcp']);
      expect(Object.keys(j.mcpServers).length).toBe(2);
    }
    const claude = JSON.parse(fs.readFileSync(path.join(h, '.claude.json'), 'utf8'));
    expect(claude.numStartups).toBe(5);
    expect(claude.mcpServers.noulette.type).toBe('stdio');
    expect(JSON.parse(fs.readFileSync(path.join(h, '.kiro/settings/mcp.json'), 'utf8')).mcpServers.noulette.disabled).toBe(false);
    expect(listAgents().filter((a) => a.connected).map((a) => a.id).sort()).toEqual(['antigravity', 'claude-code', 'cline', 'kiro']);
    // Reconnecting replaces our entry only.
    connectAgent('kiro', { command: 'D:\\new\\noulette-engine.exe', args: ['mcp'] });
    const k = JSON.parse(fs.readFileSync(path.join(h, '.kiro/settings/mcp.json'), 'utf8'));
    expect(k.mcpServers.noulette.command).toBe('D:\\new\\noulette-engine.exe');
    expect(k.mcpServers.fetch.command).toBe('uvx');
  });

  it('TC-M6-03 Codex TOML: valid Windows path quoting, other tables kept, re-connect replaces only our table', () => {
    writeFiles(h, { '.codex/config.toml': 'model = "gpt-5"\n\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n' });
    connectAgent('codex', CMD);
    connectAgent('codex', CMD);
    const t = fs.readFileSync(path.join(h, '.codex/config.toml'), 'utf8');
    expect(t).toContain(`command = 'C:\\Users\\me\\AppData\\Local\\Noulette\\noulette-engine.exe'`);
    expect(t.match(/\[mcp_servers\.noulette\]/g)!.length).toBe(1);
    expect(t).toContain('[mcp_servers.context7]');
    expect(t).toContain('model = "gpt-5"');
    const parsed = Bun.TOML.parse(t) as any;
    expect(parsed.mcp_servers.noulette.command).toBe(CMD.command);
    expect(parsed.mcp_servers.context7.command).toBe('npx');
  });

  it('TC-M6-04 OpenCode JSONC: comments kept, local command array, schema present', () => {
    writeFiles(h, { '.config/opencode/opencode.jsonc': '{\n  // my settings\n  "$schema": "https://opencode.ai/config.json",\n  "theme": "dark",\n}\n' });
    connectAgent('opencode', CMD);
    const raw = fs.readFileSync(path.join(h, '.config/opencode/opencode.jsonc'), 'utf8');
    expect(raw).toContain('// my settings');
    const j = JSON.parse(stripJsonc(raw));
    expect(j.mcp.noulette).toEqual({ type: 'local', command: [CMD.command, 'mcp'], enabled: true, timeout: 30000 });
    expect(j.theme).toBe('dark');
  });

  it('TC-M6-05 never overwrites a broken config file', () => {
    writeFiles(h, { '.kiro/settings/mcp.json': '{ "mcpServers": { broken' });
    expect(() => connectAgent('kiro', CMD)).toThrow(/not valid JSON/);
    expect(fs.readFileSync(path.join(h, '.kiro/settings/mcp.json'), 'utf8')).toBe('{ "mcpServers": { broken');
    expect(agentFiles('cline')[0]).toContain(path.join('.cline', 'data', 'settings'));
  });
});
