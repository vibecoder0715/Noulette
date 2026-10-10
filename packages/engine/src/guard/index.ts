import { z } from 'zod';
import { route, stateExtras, approvalHandlers, HttpError } from '../daemon/api.js';
import { ticks, startHooks } from '../daemon/server.js';
import { toolRegistrars } from '../mcp/server.js';
import { guardWatcher } from './watcher.js';
import { decideGuard, recentGuardLog, GuardDecisionError } from './quarantine.js';
import { safeClone } from './clone.js';

let watching: string[] = [];

startHooks.push(() => {
  watching = guardWatcher.sync();
});
ticks.push({ name: 'guard-sync', everyMs: 10_000, fn: () => (watching = guardWatcher.sync()) });

stateExtras.push(() => ({ guard: { watching, recent: recentGuardLog(10) } }));

approvalHandlers.guard = (id, decision, body) => {
  try {
    return decideGuard(id, decision, body?.confirmText);
  } catch (e: any) {
    throw new HttpError(e instanceof GuardDecisionError ? 400 : 500, e.message);
  }
};

route('GET', '/api/guard/log', () => recentGuardLog(200));

toolRegistrars.push((server, { guarded }) => {
  server.registerTool('noulette_safe_clone', {
    title: 'Clone a repository safely',
    description: 'Use instead of "git clone". Clones into quarantine with hooks/submodules/LFS off, scans for malware, hidden AI instructions and leaked secrets, and only moves it to the destination if it is safe. Otherwise the user decides in the Noulette app.',
    inputSchema: { url: z.string(), destination: z.string().describe('Absolute folder where the repo should end up') }
  }, async ({ url, destination }) => guarded(() => safeClone(url, destination)));
});
