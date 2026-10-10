import fs from 'node:fs';
import path from 'node:path';
import { projectWorkDir } from '../core/paths.js';
import { latestRun } from '../core/runs.js';
import { readPlan, answerFor, parseUserCount } from '../inspect/plan.js';
import { getFindings } from '../inspect/store.js';
import type { ToolResult } from '../inspect/pipeline.js';

/** Scale ladder written to FUTURE.md: the planned user count, then 10x, 100x and 1000x. */
export interface Tier {
  users: number;
  title: string;
  tldr: string;
  /** Short labels for the UI. The full steps go to FUTURE.md and the noulette_future tool. */
  short: string[];
  steps: string[];
  cost: string;
}

interface Stack {
  web: string | null;
  db: string | null;
  hosting: string | null;
  inMemoryState: boolean;
}

function detectStack(root: string, hosting: string | null, findings: { labelId: string; title: string }[]): Stack {
  let deps: Record<string, string> = {};
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    deps = { ...pj.dependencies, ...pj.devDependencies };
  } catch {}
  const txt = ['requirements.txt', 'pyproject.toml', 'Gemfile', 'go.mod', 'pom.xml', 'composer.json']
    .map((f) => {
      try {
        return fs.readFileSync(path.join(root, f), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n')
    .toLowerCase();
  const has = (n: string) => n in deps || txt.includes(n);
  const web = has('next') ? 'Next.js' : has('express') ? 'Express' : has('fastify') ? 'Fastify' : has('django') ? 'Django' : has('flask') ? 'Flask' : has('fastapi') ? 'FastAPI' : has('rails') ? 'Rails' : has('spring-boot') ? 'Spring Boot' : has('laravel') ? 'Laravel' : null;
  const db = has('pg') || has('postgres') || has('psycopg') ? 'Postgres' : has('mysql') || has('mysql2') ? 'MySQL' : has('mongodb') || has('mongoose') ? 'MongoDB' : has('sqlite3') || has('better-sqlite3') || has('sqlite') ? 'SQLite' : has('@prisma/client') ? 'Prisma (database not detected)' : null;
  return { web, db, hosting, inMemoryState: findings.some((f) => f.labelId === 'scale' && /memory|Map|in-memory/i.test(f.title)) };
}

const fmt = (n: number) => n.toLocaleString('en-US');

function tierFor(users: number, s: Stack): Tier {
  const steps: string[] = [];
  const short: string[] = [];
  const add = (s: string, l: string) => (short.push(s), steps.push(l));
  const addFirst = (s: string, l: string) => (short.unshift(s), steps.unshift(l));
  let tldr: string;
  let cost: string;
  if (users <= 500) {
    tldr = 'Keep it simple: one small server or a managed platform is enough.';
    cost = 'about $0 to $25';
    add('One small server', 'Run on one small server or a managed platform (for example Render, Railway, Fly.io or a $5-10 VPS).');
    add('Daily backups', s.db ? `Keep ${s.db}, with automatic daily backups you have tested restoring.` : 'Use a managed database with daily backups (Postgres is a safe default).');
    add('HTTPS + env keys', 'Turn on HTTPS and keep all keys in environment variables.');
    add('Error tracking', 'Add error tracking (PostHog) so you hear about bugs before users tell you.');
  } else if (users <= 5_000) {
    tldr = 'Make the basics solid: a real database, limits against abuse, and early alerts.';
    cost = 'about $25 to $150';
    add(s.db === 'SQLite' ? 'Leave SQLite' : 'Managed database', s.db === 'SQLite' ? 'Move from SQLite to a managed Postgres or MySQL before you reach this size.' : 'Use a managed database with connection pooling.');
    add('Rate limits', 'Add rate limits on login, sign-up and expensive API routes.');
    add('CDN', 'Serve images and static files through a CDN.');
    add('Background jobs', 'Move slow work (emails, exports, image processing) to a background job queue.');
    add('Staging + uptime', 'Add a staging copy of the app and an uptime check.');
  } else if (users <= 50_000) {
    tldr = 'Run more than one copy of the app so one failure does not take you down.';
    cost = 'about $150 to $1,500';
    add('2+ servers', 'Run at least two app servers behind a load balancer; keep no user data in server memory (sessions in the database or Redis).');
    add('Cache + indexes', 'Add a cache (Redis) for hot data and add database indexes for the slowest queries.');
    add('Read replica', 'Add a database read replica and test failover.');
    add('Load test', 'Load-test the main user journeys at 2x this number before a launch or campaign.');
    add('Phone alerts', 'Set up alerts that reach a phone, and write a short "what to do when it breaks" note.');
  } else if (users <= 500_000) {
    tldr = 'Plan for growth across machines and data centres, and get an outside security review.';
    cost = 'about $1,500 to $15,000';
    add('Multi-zone', 'Spread servers across availability zones; autoscale on load.');
    add('Database growth', 'Plan how the database grows: bigger managed tier, partitioning, or splitting heavy tables.');
    add('Split heavy work', 'Split out heavy work (search, media, reports) into separate services or managed products.');
    add('Uptime targets', 'Define service levels (for example 99.9% uptime) and track them.');
    add('Security + legal review', 'Get a penetration test and check legal requirements (GDPR or local data laws, data processing agreements).');
  } else {
    tldr = 'This is large scale: multiple regions and a dedicated reliability team.';
    cost = 'above $15,000';
    add('Multi-region', 'Run in more than one region with tested failover.');
    add('Reliability team', 'Have people dedicated to reliability and security, with on-call rotations.');
    add('Failure drills', 'Practise failures on purpose (game days) and review every incident.');
  }
  if (s.inMemoryState && users > 500) addFirst('Move memory state to a database', 'Move state that lives in server memory into a database now: it is lost on every restart and breaks with two servers.');
  if (s.web === 'Next.js' && users > 5_000) add('Edge caching', 'Cache pages at the edge (static or incremental rendering) to cut server load.');
  return { users, title: `Up to ${fmt(users)} users`, tldr, short, steps, cost };
}

export function buildFuture(root: string): { tiers: Tier[]; missingUsers: boolean; stack: Stack; planned: number } {
  const plan = readPlan(root);
  const planned = parseUserCount(answerFor(plan, 'users'));
  const base = planned ?? 100;
  const run = latestRun(root, 'inspection');
  const findings = run ? getFindings(root, run.id) : [];
  const stack = detectStack(root, answerFor(plan, 'hosting'), findings);
  const tiers = [1, 10, 100, 1000].map((m) => tierFor(base * m, stack));
  return { tiers, missingUsers: !planned, stack, planned: base };
}

export function writeFuture(root: string): { file: string; tiers: Tier[]; missingUsers: boolean } {
  const f = buildFuture(root);
  const lines = ['# FUTURE', '', `Scale plan written by Noulette from PLAN.md (${f.missingUsers ? 'no user count yet, starting at 100' : `planned: ${fmt(f.planned)} users`}). Rough costs are monthly hosting estimates, not quotes.`, ''];
  lines.push(`Detected: ${[f.stack.web, f.stack.db, f.stack.hosting].filter(Boolean).join(', ') || 'stack not detected'}.`, '');
  for (const t of f.tiers) {
    lines.push(`## ${t.title}`, '', t.tldr, '');
    for (const s of t.steps) lines.push(`- ${s}`);
    lines.push('', `Rough monthly cost: ${t.cost}.`, '');
  }
  const file = path.join(root, 'FUTURE.md');
  fs.writeFileSync(file, lines.join('\n'));
  fs.writeFileSync(projectWorkDir(root, 'future.json'), JSON.stringify({ tiers: f.tiers, missingUsers: f.missingUsers, file }, null, 2));
  return { file, tiers: f.tiers, missingUsers: f.missingUsers };
}

export function readFuture(root: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(projectWorkDir(root, 'future.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function generateFuture(projectPath: string): ToolResult {
  const r = writeFuture(projectPath);
  return { ok: true, tldr: `FUTURE.md written with ${r.tiers.length} growth steps.`, next: 'Summarise the next growth step for the user in two sentences.', data: r };
}
