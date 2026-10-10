import { describe, it, expect, afterAll } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tempDir, copyFixture, FIXTURE_SHOP, rm } from './helpers.ts';

/** Runs only when the installer has been installed on this machine (bun run build, then run dist/Noulette-Setup-*.exe). */
const INSTALL = path.join(process.env.LOCALAPPDATA ?? '', 'Noulette');
const ENGINE = path.join(INSTALL, 'noulette-engine.exe');
const run = fs.existsSync(ENGINE) ? describe : describe.skip;
const cleanup: string[] = [];
afterAll(() => cleanup.forEach(rm));

run('E2E installed app', () => {
  it('TC-E2E-01 installed engine serves MCP over stdio and finds bundled scanners', async () => {
    const home = tempDir('nl-e2e-');
    const repo = copyFixture(FIXTURE_SHOP);
    cleanup.push(home, repo);
    const client = new Client({ name: 'e2e', version: '1' });
    await client.connect(new StdioClientTransport({ command: ENGINE, args: ['mcp'], env: { ...process.env, NOULETTE_HOME: home } as Record<string, string> }));
    const t = (r: any) => r.content[0].text as string;
    await client.callTool({ name: 'noulette_inspect', arguments: { projectPath: repo } });
    let r = await client.callTool({ name: 'noulette_save_plan', arguments: { projectPath: repo, answers: [{ id: 'description', answer: 'shop' }, { id: 'goal', answer: 'launch' }, { id: 'users', answer: '1000' }, { id: 'audience', answer: 'adults' }, { id: 'data', answer: 'emails' }] } }, undefined, { timeout: 300_000 });
    while (t(r).includes('still running')) r = await client.callTool({ name: 'noulette_save_plan', arguments: { projectPath: repo, answers: [] } }, undefined, { timeout: 300_000 });
    expect(t(r)).toMatch(/secrets: [1-9]/);
    expect(t(r)).toMatch(/sast: [1-9]/);
    expect(t(r)).toMatch(/dependencies: [1-9]/);
    await client.close();
  }, 400_000);

  it('TC-E2E-02 installed daemon starts hidden, serves the UI and API on 127.0.0.1 only', async () => {
    const home = tempDir('nl-e2e-');
    cleanup.push(home);
    const env = { ...process.env, NOULETTE_HOME: home, NOULETTE_PORT: '48777', NOULETTE_UI: path.join(INSTALL, 'resources', 'ui') };
    const d = spawn(ENGINE, ['daemon'], { env, windowsHide: true, stdio: 'ignore' });
    try {
      let ok = false;
      for (let i = 0; i < 40 && !ok; i++) {
        await new Promise((r) => setTimeout(r, 250));
        ok = await fetch('http://127.0.0.1:48777/health').then((x) => x.ok, () => false);
      }
      expect(ok).toBe(true);
      const html = await (await fetch('http://127.0.0.1:48777/')).text();
      expect(html).toContain('<div id="root">');
      expect((await fetch('http://127.0.0.1:48777/api/state')).status).toBe(401);
      const tok = await new Promise<string>((res) => {
        const p = spawn(ENGINE, ['token'], { env, windowsHide: true });
        let o = '';
        p.stdout.on('data', (b) => (o += b));
        p.on('close', () => res(JSON.parse(o).token));
      });
      const s = await (await fetch('http://127.0.0.1:48777/api/state', { headers: { Authorization: `Bearer ${tok}` } })).json();
      expect(s.agents.map((a: any) => a.id)).toEqual(['kiro', 'claude-code', 'cline', 'opencode', 'codex', 'antigravity']);
      expect(s.guard.watching.length).toBeGreaterThan(0);
    } finally {
      d.kill();
    }
  }, 60_000);
});
