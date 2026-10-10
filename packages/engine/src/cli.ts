#!/usr/bin/env bun
/**
 * noulette-engine
 *   mcp      stdio MCP server (what coding agents launch)
 *   daemon   background service: local API + UI for the desktop app / Chrome, scheduler, watchers
 *   cloud    cloud worker (bring-your-own-deploy): log monitoring + signed approval queue
 *   token    prints the local API token (for opening the UI in Chrome)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp/server.js';
import { VERSION } from './version.js';
import './features.js';

async function main() {
  const cmd = process.argv[2] ?? 'help';
  if (cmd === 'mcp') {
    // stdout is the protocol channel: nothing else may print there.
    console.log = console.error;
    const server = createMcpServer();
    await server.connect(new StdioServerTransport());
    return;
  }
  if (cmd === 'daemon') {
    const { startDaemon, AlreadyRunning } = await import('./daemon/server.js');
    let d;
    try {
      d = await startDaemon();
    } catch (e) {
      if (e instanceof AlreadyRunning) return process.exit(0);
      throw e;
    }
    console.error(`noulette daemon ${VERSION} on http://127.0.0.1:${d.port}`);
    const stop = () => {
      d.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  if (cmd === 'cloud') {
    const { startCloudWorker } = await import('./cloud/worker.js');
    await startCloudWorker();
    return;
  }
  if (cmd === 'token') {
    const { apiToken, readDaemonInfo } = await import('./daemon/server.js');
    const info = readDaemonInfo();
    process.stdout.write(JSON.stringify({ token: apiToken(), port: info?.port ?? null }) + '\n');
    return;
  }
  if (cmd === '--version' || cmd === 'version') {
    process.stdout.write(VERSION + '\n');
    return;
  }
  process.stderr.write('Usage: noulette-engine <mcp|daemon|cloud|token|version>\n');
  process.exit(cmd === 'help' ? 0 : 1);
}

main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
