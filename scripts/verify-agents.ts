/**
 * Real-agent check: reads each connected agent's actual config file, launches the server exactly
 * as that agent would (command + args from its config), and performs an MCP handshake + tool list.
 *   bun run scripts/verify-agents.ts
 */
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { listAgents, stripJsonc } from '../packages/engine/src/integrations/connect.ts';

function entryFrom(id: string, file: string): { command: string; args: string[] } | null {
  const raw = fs.readFileSync(file, 'utf8');
  if (id === 'codex') {
    const t = (Bun.TOML.parse(raw) as any).mcp_servers?.noulette;
    return t ? { command: t.command, args: t.args ?? [] } : null;
  }
  const j = JSON.parse(stripJsonc(raw));
  if (id === 'opencode') {
    const c = j.mcp?.noulette?.command;
    return c ? { command: c[0], args: c.slice(1) } : null;
  }
  const e = j.mcpServers?.noulette;
  return e ? { command: e.command, args: e.args ?? [] } : null;
}

let failed = 0;
for (const a of listAgents()) {
  for (const f of a.files.filter((x) => fs.existsSync(x))) {
    const e = entryFrom(a.id, f);
    if (!e) continue;
    try {
      const c = new Client({ name: `verify-${a.id}`, version: '1' });
      await c.connect(new StdioClientTransport({ command: e.command, args: e.args }));
      const n = (await c.listTools()).tools.length;
      const p = (await c.listPrompts()).prompts.map((x) => x.name).join(',');
      await c.close();
      console.log(`OK   ${a.name.padEnd(12)} ${n} tools, prompts: ${p}  (${f})`);
    } catch (err: any) {
      failed++;
      console.log(`FAIL ${a.name.padEnd(12)} ${err.message}  (${f})`);
    }
  }
}
process.exit(failed ? 1 : 0);
