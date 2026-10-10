import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { tempHome, tempDir, writeFiles, copyFixture, FIXTURE_SHOP, initRepo, git, rm } from './helpers.ts';
import { createMcpServer } from '../packages/engine/src/mcp/server.ts';
import { measureRepo, listRepoFiles } from '../packages/engine/src/core/projects.ts';
import { inspectPrompt } from '../packages/engine/src/inspect/prompts.ts';

const cleanup: string[] = [];
afterAll(() => cleanup.forEach(rm));

const text = (r: any) => r.content[0].text as string;
const code = 'export function f(a: number) {\n  return a + 1;\n}\n'.repeat(15);

/** An agent client that reports `roots` as its workspace folders (null = no roots support). */
async function agent(roots: string[] | null, opts: { useCwd?: boolean } = {}) {
  const server = createMcpServer(opts);
  const client = new Client({ name: 'agent', version: '1' }, { capabilities: roots ? { roots: { listChanged: false } } : {} });
  if (roots) client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: roots.map((r) => ({ uri: pathToFileURL(r).href, name: path.basename(r) })) }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

function repoWithCode(): string {
  const d = tempDir('nl-route-');
  cleanup.push(d);
  writeFiles(d, { 'src/a.ts': code, 'src/b.ts': code, 'src/c.ts': code });
  initRepo(d);
  return d;
}

describe('Project routing follows the agent workspace', () => {
  beforeAll(() => cleanup.push(tempHome()));

  it('TC-R-01 uses the workspace root when projectPath is left out', async () => {
    const repo = repoWithCode();
    const c = await agent([repo]);
    const r = await c.callTool({ name: 'noulette_inspect', arguments: {} });
    expect(text(r)).toContain('Inspection started');
    expect(text(r)).not.toContain('go build one first');
  });

  it('TC-R-02 a stale path outside the workspace is redirected to the open repo', async () => {
    const repo = repoWithCode();
    const stale = tempDir('nl-stale-');
    cleanup.push(stale);
    writeFiles(stale, { 'README.md': 'old test folder' });
    const c = await agent([repo]);
    const r = await c.callTool({ name: 'noulette_inspect', arguments: { projectPath: stale } });
    expect(text(r)).toContain('NOTE: Used the folder open in your workspace');
    expect(text(r)).toContain('Inspection started');
  });

  it('TC-R-03 several repositories: the agent is asked to choose, and each one is separate', async () => {
    const parent = tempDir('nl-multi-');
    cleanup.push(parent);
    for (const n of ['web', 'api']) {
      fs.mkdirSync(path.join(parent, n));
      writeFiles(path.join(parent, n), { 'a.ts': code, 'b.ts': code, 'c.ts': code });
      initRepo(path.join(parent, n));
    }
    const c = await agent([parent]);
    const r = await c.callTool({ name: 'noulette_inspect', arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('CHOOSE_PROJECT');
    expect(text(r)).toContain(path.join(parent, 'web'));
    expect(text(r)).toContain(path.join(parent, 'api'));
    const web = await c.callTool({ name: 'noulette_inspect', arguments: { projectPath: path.join(parent, 'web') } });
    expect(text(web)).toContain('Inspection started');
    const st = await c.callTool({ name: 'noulette_status', arguments: { projectPath: path.join(parent, 'api') } });
    expect(text(st)).not.toContain('intake');
  });

  it('TC-R-04 two workspace roots both count; without a choice the agent must pick', async () => {
    const a = repoWithCode();
    const b = repoWithCode();
    const c = await agent([a, b]);
    expect(text(await c.callTool({ name: 'noulette_inspect', arguments: {} }))).toContain('CHOOSE_PROJECT');
    expect(text(await c.callTool({ name: 'noulette_inspect', arguments: { projectPath: b } }))).toContain('Inspection started');
  });

  it('TC-R-05 without roots, the working directory is used; an explicit path still wins', async () => {
    const repo = repoWithCode();
    const old = process.env.NOULETTE_WORKSPACE;
    process.env.NOULETTE_WORKSPACE = repo;
    try {
      const c = await agent(null, { useCwd: true });
      expect(text(await c.callTool({ name: 'noulette_inspect', arguments: {} }))).toContain('Inspection started');
      const other = repoWithCode();
      expect(text(await c.callTool({ name: 'noulette_inspect', arguments: { projectPath: other } }))).not.toContain('NOTE:');
      const none = await agent(null, { useCwd: false });
      expect(text(await none.callTool({ name: 'noulette_inspect', arguments: {} }))).toContain('NO_PROJECT');
    } finally {
      if (old === undefined) delete process.env.NOULETTE_WORKSPACE;
      else process.env.NOULETTE_WORKSPACE = old;
    }
  });

  it('TC-R-06 nested repositories are kept out of the parent scan', async () => {
    const parent = repoWithCode();
    const child = path.join(parent, 'vendor-app');
    fs.mkdirSync(child);
    writeFiles(child, { 'secret.ts': code, 'PLAN.md': 'Q: x\nA: child plan' });
    git(child, 'init', '-q');
    const files = await listRepoFiles(parent);
    expect(files.some((f) => f.startsWith('vendor-app'))).toBe(false);
  });

  it('TC-R-07 an empty git listing falls back to the folder walk', async () => {
    const outer = tempDir('nl-outer-');
    cleanup.push(outer);
    writeFiles(outer, { '.gitignore': 'inner/\n', 'x.txt': 'x' });
    initRepo(outer);
    const inner = path.join(outer, 'inner');
    fs.mkdirSync(inner);
    writeFiles(inner, { 'a.ts': code, 'b.ts': code, 'c.ts': code });
    expect((await measureRepo(inner)).empty).toBe(false);
  });

  it('TC-R-08 big non-code folders cannot hide the source code', async () => {
    const repo = copyFixture(FIXTURE_SHOP);
    cleanup.push(repo);
    const assets = path.join(repo, 'aaa-assets');
    fs.mkdirSync(assets);
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(assets, `${i}.png`), '');
    const r = await measureRepo(repo);
    expect(r.empty).toBe(false);
  });

  it('TC-R-09 the prompt never pins a folder', () => {
    expect(inspectPrompt({ command: 'x', args: ['mcp'], projectPath: 'C:\\old\\folder' })).not.toContain('C:\\\\old\\\\folder');
  });
});
