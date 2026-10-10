import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { tempHome, tempDir, ENGINE_CLI, rm } from './helpers.ts';
import { getSettings, updateSettings } from '../packages/engine/src/core/settings.ts';
import { setSecret, getSecret, secretsBackend } from '../packages/engine/src/core/secrets.ts';
import { registerProject, listProjects, setActiveProject, activeProject } from '../packages/engine/src/core/projects.ts';
import { notify, listNotifications, markRead, resolveNotification, createApproval, decideApproval, getApproval, verifyApprovalSignature } from '../packages/engine/src/core/events.ts';
import { getDb } from '../packages/engine/src/core/db.ts';
import { startDaemon, apiToken } from '../packages/engine/src/daemon/server.ts';
import '../packages/engine/src/daemon/api.ts';
import '../packages/engine/src/features.ts';

const cleanup: string[] = [];
afterAll(() => cleanup.forEach(rm));

describe('M1 state store', () => {
  beforeEach(() => {
    cleanup.push(tempHome());
  });

  it('TC-M1-01 settings defaults and validation', () => {
    const s = getSettings();
    expect(s.effort).toBe('standard');
    expect(s.autoApprove).toBe(false);
    expect(s.productionAnalysis).toBe(false);
    expect(s.intervalMin).toBe(30);
    expect(() => updateSettings({ intervalMin: 10 })).toThrow();
    expect(() => updateSettings({ volume: 101 })).toThrow();
    expect(updateSettings({ intervalMin: 120 }).intervalMin).toBe(120);
    expect(updateSettings({ inspector: { posthog: { enabled: true } } }).inspector.posthog.host).toBe('https://us.posthog.com');
  });

  it('TC-M1-02 secrets are encrypted at rest and never exposed in state', async () => {
    setSecret('aiApiKey', 'sk-test-SECRET-123');
    expect(getSecret('aiApiKey')).toBe('sk-test-SECRET-123');
    const raw = fs.readFileSync(path.join(process.env.NOULETTE_HOME!, 'secrets.bin'));
    if (process.platform === 'win32') expect(secretsBackend()).toBe('dpapi');
    expect(raw.toString('latin1')).not.toContain('SECRET-123');
    const { stateSnapshot } = await import('../packages/engine/src/daemon/api.ts');
    const snap = JSON.stringify(stateSnapshot());
    expect(snap).not.toContain('SECRET-123');
    expect(snap).toContain('"aiApiKey":"stored"');
  });

  it('TC-M1-03 project registry keyed by path, with active project', () => {
    const a = tempDir();
    const b = tempDir();
    cleanup.push(a, b);
    registerProject(a);
    registerProject(a.toUpperCase());
    registerProject(b);
    expect(listProjects().length).toBe(2);
    setActiveProject(a);
    expect(activeProject()!.path.toLowerCase()).toBe(a.toLowerCase());
    expect(() => registerProject(path.join(a, 'missing'))).toThrow();
  });

  it('TC-M1-04 notifications: read/resolved move to History, sticky stays, dedupe', () => {
    const n1 = notify({ severity: 'info', kind: 'x', title: 'one', body: 'b' });
    const n2 = notify({ severity: 'critical', kind: 'y', title: 'two', body: 'b', sticky: true });
    markRead(n1);
    markRead(n2);
    let l = listNotifications();
    expect(l.main.map((n) => n.id)).toEqual([n2]);
    expect(l.history.map((n) => n.id)).toEqual([n1]);
    resolveNotification(n2);
    l = listNotifications();
    expect(l.main.length).toBe(0);
    expect(l.history.length).toBe(2);
    const d1 = notify({ severity: 'info', kind: 'settings-changed', title: 's', body: '1', dedupeKey: 'settings' });
    const d2 = notify({ severity: 'info', kind: 'settings-changed', title: 's', body: '2', dedupeKey: 'settings' });
    expect(d1).toBe(d2);
  });

  it('TC-M1-05 approvals are signed and tampering is detected', () => {
    const id = createApproval({ kind: 'inspection', title: 't', summary: 's', data: { items: [{ id: 'a' }, { id: 'b' }] } });
    const a = decideApproval(id, 'approved', ['a']);
    expect(a.signature).toBeTruthy();
    expect(verifyApprovalSignature(a)).toBe(true);
    getDb().query('UPDATE approvals SET data=? WHERE id=?').run(JSON.stringify({ items: [{ id: 'a' }, { id: 'b' }], selection: ['a', 'b'] }), id);
    expect(verifyApprovalSignature(getApproval(id)!)).toBe(false);
    expect(() => decideApproval(id, 'rejected')).toThrow();
  });
});

describe('M1 daemon HTTP API', () => {
  let port = 0;
  let stop: () => void = () => {};
  let token = '';
  beforeEach(async () => {
    stop();
    cleanup.push(tempHome());
    const d = await startDaemon({ port: 48100 + Math.floor(Math.random() * 500), allowSecond: true });
    port = d.port;
    stop = d.stop;
    token = apiToken();
  });
  afterAll(() => stop());
  const base = () => `http://127.0.0.1:${port}`;

  it('TC-M1-06 rejects missing token, foreign Host/Origin and non-JSON writes', async () => {
    expect((await fetch(base() + '/api/state')).status).toBe(401);
    expect((await fetch(base() + '/api/state', { headers: { Authorization: `Bearer ${token}`, Host: 'evil.example' } })).status).toBe(403);
    expect((await fetch(base() + '/api/state', { headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(base() + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    const ok = await fetch(base() + '/api/state', { headers: { Authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    const s = await ok.json();
    expect(s.card.status).toBe('no_project');
    expect(s.intervals).toEqual([5, 15, 30, 45, 60, 75, 90, 120]);
  });

  it('TC-M1-07 settings change raises one deduplicated "Settings changed" alert', async () => {
    const post = (b: unknown) => fetch(base() + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    expect((await post({ effort: 'extra' })).status).toBe(200);
    expect((await post({ volume: 40 })).status).toBe(200);
    expect((await post({ intervalMin: 7 })).status).toBe(400);
    const n = listNotifications().main.filter((x) => x.kind === 'settings-changed');
    expect(n.length).toBe(1);
    expect(n[0].alert).toBe(1);
  });

  it('TC-M1-08 remote MCP is off by default and token-protected when on', async () => {
    expect((await fetch(base() + '/mcp', { method: 'POST' })).status).toBe(404);
    updateSettings({ remoteMcp: { enabled: true } });
    expect((await fetch(base() + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(base() + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('noulette_build');
    await client.close();
  });
});

describe('M1 MCP stdio conformance', () => {
  it('TC-M1-09 initialize, tools, prompts, call, errors over stdio (newline-delimited JSON-RPC)', async () => {
    const home = tempDir('nl-home-');
    cleanup.push(home);
    const client = new Client({ name: 'conformance', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['run', ENGINE_CLI, 'mcp'], env: { ...process.env, NOULETTE_HOME: home } as Record<string, string> });
    await client.connect(transport);
    expect(client.getServerVersion()?.name).toBe('noulette');
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const t of ['noulette_inspect', 'noulette_save_plan', 'noulette_submit_findings', 'noulette_build', 'noulette_verify', 'noulette_probe', 'noulette_labels']) expect(names).toContain(t);
    expect(names.some((n) => /approve/.test(n))).toBe(false);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(['inspect', 'build']));
    const build = await client.getPrompt({ name: 'build' });
    expect(JSON.stringify(build.messages)).toContain('noulette_build');
    const labels = await client.callTool({ name: 'noulette_labels', arguments: {} });
    expect((labels.content as any)[0].text).toContain('database');
    const bad = await client.callTool({ name: 'noulette_probe', arguments: { url: 'https://example.com/' } });
    expect(bad.isError).toBe(true);
    const err = await client.callTool({ name: 'noulette_build', arguments: { projectPath: home } });
    expect((err.content as any)[0].text).toContain('INSPECTION_REQUIRED');
    // Unknown tools are a JSON-RPC error (or an isError result, depending on SDK version): never a silent success.
    const unknown = await client.callTool({ name: 'does_not_exist', arguments: {} }).then((r) => ({ isError: r.isError }), () => ({ isError: true }));
    expect(unknown.isError).toBe(true);
    await client.close();
  }, 30_000);
});
