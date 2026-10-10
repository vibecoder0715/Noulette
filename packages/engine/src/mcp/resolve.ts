import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { NouletteError } from '../inspect/pipeline.js';
import { childRepos } from '../core/projects.js';
import { repoRoot } from '../core/git.js';
import { dataDir, projectKey } from '../core/paths.js';

/**
 * Works out which repository a tool call is about, from the agent's side (not the desktop app):
 *  1. the agent's workspace folders (MCP roots/list), else 2. the folder the agent started the server in,
 *  3. an explicit projectPath, accepted only when it is inside that workspace (or no workspace is known).
 * A workspace folder that holds several repositories yields one project per repository; when that is
 * ambiguous the agent is asked to choose. Each project keeps its own state and files, keyed by path.
 */
export interface Resolved {
  path: string;
  note: string | null;
}

const same = (a: string, b: string) => projectKey(a) === projectKey(b);
const inside = (child: string, parent: string) => {
  const r = path.relative(projectKey(parent), projectKey(child));
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

/** Folders that are never a project: home, drive roots, system folders, Noulette's own install and data. */
function unusableCwd(dir: string): boolean {
  const blocked = [
    os.homedir(), os.tmpdir(), path.dirname(process.execPath), dataDir(),
    process.env.SystemRoot, process.env.windir, process.env.ProgramFiles, process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA, process.env.APPDATA
  ].filter(Boolean) as string[];
  const abs = path.resolve(dir);
  return path.parse(abs).root === abs || blocked.some((b) => same(b, abs));
}

async function workspaceFolders(server: Server, useCwd: boolean): Promise<{ folders: string[]; from: 'roots' | 'cwd' | null }> {
  if (server.getClientCapabilities()?.roots) {
    try {
      const { roots } = await server.listRoots(undefined, { timeout: 3000 });
      const folders = roots
        .filter((r) => r.uri.startsWith('file:'))
        .map((r) => path.resolve(fileURLToPath(r.uri)))
        .filter((d) => fs.existsSync(d) && fs.statSync(d).isDirectory());
      if (folders.length) return { folders, from: 'roots' };
    } catch {
      // Client advertised roots but did not answer: fall back to the working directory.
    }
  }
  if (useCwd) {
    const cwd = process.env.NOULETTE_WORKSPACE || process.cwd();
    if (fs.existsSync(cwd) && !unusableCwd(cwd)) return { folders: [path.resolve(cwd)], from: 'cwd' };
  }
  return { folders: [], from: null };
}

/** Candidate projects inside the workspace folders: the folder itself, or each repository it contains. */
async function candidates(folders: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of folders) {
    if (await repoRoot(f)) out.push(f);
    else {
      const kids = childRepos(f);
      out.push(...(kids.length ? kids : [f]));
    }
  }
  return out.filter((c, i) => out.findIndex((o) => same(o, c)) === i);
}

const list = (c: string[]) => c.map((p) => `- ${p}`).join('\n');

export async function resolveProject(server: Server, given: string | undefined, useCwd: boolean): Promise<Resolved> {
  const g = given?.trim() ? given.trim() : undefined;
  const ws = await workspaceFolders(server, useCwd);
  const cands = ws.folders.length ? await candidates(ws.folders) : [];

  if (g) {
    if (!path.isAbsolute(g)) {
      // A relative path is read against the workspace when there is one.
      if (ws.folders.length === 1) return { path: path.resolve(ws.folders[0], g), note: null };
      throw new NouletteError('BAD_PATH', 'projectPath must be the absolute path of the repository.');
    }
    // The working directory is only a hint, so an explicit path wins over it. Workspace roots are authoritative.
    if (ws.from !== 'roots' || ws.folders.some((f) => inside(g, f))) return { path: path.resolve(g), note: null };
    // The agent passed a folder outside its own workspace (often a stale path from an old prompt).
    if (cands.length === 1) {
      return { path: cands[0], note: `Used the folder open in your workspace (${cands[0]}) instead of ${g}, which is outside it. Pass this path from now on.` };
    }
    throw new NouletteError('CHOOSE_PROJECT', `${g} is outside the folders open in this workspace. Ask the user which repository to use, then pass it as projectPath:\n${list(cands)}`);
  }

  if (cands.length === 1) return { path: cands[0], note: null };
  if (cands.length > 1) {
    throw new NouletteError('CHOOSE_PROJECT', `This workspace has ${cands.length} repositories. Ask the user which one to use (each is inspected separately), then pass it as projectPath:\n${list(cands)}`);
  }
  throw new NouletteError('NO_PROJECT', 'Could not tell which folder is open in this workspace. Pass projectPath = the absolute path of the repository open in this workspace.');
}
