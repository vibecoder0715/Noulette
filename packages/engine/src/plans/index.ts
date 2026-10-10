import fs from 'node:fs';
import { route, stateExtras, HttpError, engineCommand } from '../daemon/api.js';
import { toolRegistrars, projectPath as projectPathSchema } from '../mcp/server.js';
import { activeProject } from '../core/projects.js';
import { writeFuture, readFuture, generateFuture } from './future.js';
import { listAgents, connectAgent, ConnectError, type AgentId } from '../integrations/connect.js';

route('GET', '/api/future', ({ query }) => {
  const p = query.get('project') ?? activeProject()?.path;
  return p ? readFuture(p) ?? {} : {};
});

route('POST', '/api/future', ({ body }) => {
  const p = String(body?.project ?? activeProject()?.path ?? '');
  if (!p || !fs.existsSync(p)) throw new HttpError(400, 'Add a project on Home first.');
  return writeFuture(p);
});

stateExtras.push(() => ({ agents: listAgents().map(({ files, ...a }) => a) }));

route('POST', '/api/agents/connect', ({ body }) => {
  try {
    return connectAgent(String(body?.id) as AgentId, engineCommand());
  } catch (e: any) {
    throw new HttpError(e instanceof ConnectError ? 400 : 500, e.message);
  }
});

toolRegistrars.push((server, { guarded }) => {
  server.registerTool('noulette_future', {
    title: 'Scale plan (FUTURE.md)',
    description: 'Writes FUTURE.md: what the app needs at the planned user count from PLAN.md, then at 10x, 100x and 1000x.',
    inputSchema: { projectPath: projectPathSchema }
  }, async ({ projectPath }) => guarded(() => generateFuture(projectPath)));
});
