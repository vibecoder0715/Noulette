import path from 'node:path';

/** How a coding agent launches Noulette's stdio MCP server on this machine (absolute, resolved at runtime). */
export function engineCommand(): { command: string; args: string[] } {
  const exe = process.execPath;
  if (/[\\/]bun(\.exe)?$/i.test(exe)) return { command: exe, args: ['run', path.resolve(import.meta.dir, '..', 'cli.ts'), 'mcp'] };
  return { command: exe, args: ['mcp'] };
}
