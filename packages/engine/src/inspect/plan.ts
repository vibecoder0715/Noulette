import fs from 'node:fs';
import path from 'node:path';
import { projectWorkDir } from '../core/paths.js';

export interface QA {
  q: string;
  a: string;
}

/** Intake questions asked before any deep inspection. `id` lets other stages read answers reliably. */
export const INTAKE_QUESTIONS: { id: string; q: string; required: boolean; hint: string }[] = [
  { id: 'description', q: 'In one or two sentences, what does your app do?', required: true, hint: 'e.g. "An online shop for handmade candles."' },
  { id: 'goal', q: 'What is your main goal for this app?', required: true, hint: 'e.g. launch publicly, internal tool, school project, sell to companies' },
  { id: 'users', q: 'How many users do you expect in the next 12 months?', required: true, hint: 'A number, e.g. 1000' },
  { id: 'audience', q: 'Who are your users and where are they?', required: true, hint: 'e.g. adults in Malaysia, staff at one factory, children under 13' },
  { id: 'data', q: 'What kind of data does the app handle?', required: true, hint: 'e.g. emails, payments, health records, none' },
  { id: 'hosting', q: 'Where will the app run?', required: false, hint: 'e.g. Vercel, AWS, a single VPS, on-premise PC, not decided' },
  { id: 'integrations', q: 'Does it connect to outside systems (APIs, payment providers, hardware)?', required: false, hint: 'List them, or "none"' },
  { id: 'start', q: 'How do I start the app on this computer, and on which port?', required: false, hint: 'e.g. "npm run dev" on port 3000. Leave empty to skip live testing.' },
  { id: 'accounts', q: 'Two throwaway test accounts for multi-user checks (username:password, comma separated)?', required: false, hint: 'Never use real accounts. Stored privately, not in PLAN.md.' },
  { id: 'tests', q: 'How do I run your tests?', required: false, hint: 'e.g. "npm test". Leave empty if there are none.' }
];

const HEADER = '# PLAN\n\nThis file is written by Noulette from your answers. You can edit it at any time.\n\n';

export function planPath(root: string): string {
  return path.join(root, 'PLAN.md');
}

export function parsePlan(text: string): QA[] {
  const out: QA[] = [];
  let cur: QA | null = null;
  let mode: 'q' | 'a' | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const qm = /^Q:\s?(.*)$/.exec(line);
    const am = /^A:\s?(.*)$/.exec(line);
    if (qm) {
      if (cur) out.push(cur);
      cur = { q: qm[1].trim(), a: '' };
      mode = 'q';
    } else if (am && cur) {
      cur.a = am[1];
      mode = 'a';
    } else if (cur && mode === 'a' && line.trim() !== '') {
      cur.a += '\n' + line;
    } else if (cur && mode === 'q' && line.trim() !== '') {
      cur.q += ' ' + line.trim();
    }
  }
  if (cur) out.push(cur);
  return out.map((x) => ({ q: x.q, a: x.a.trim() }));
}

export function readPlan(root: string): QA[] {
  const f = planPath(root);
  return fs.existsSync(f) ? parsePlan(fs.readFileSync(f, 'utf8')) : [];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Merges answers into PLAN.md: matching questions are updated, new ones appended, others kept. */
export function writePlan(root: string, answers: QA[]): QA[] {
  const existing = readPlan(root);
  for (const ans of answers) {
    const i = existing.findIndex((e) => norm(e.q) === norm(ans.q));
    const clean = { q: ans.q.replace(/\r?\n/g, ' ').trim(), a: ans.a.replace(/^(Q|A):/gm, '$1 :').trim() };
    if (i >= 0) existing[i] = clean;
    else existing.push(clean);
  }
  const body = existing.map((x) => `Q: ${x.q}\nA: ${x.a || '(no answer)'}\n`).join('\n');
  fs.writeFileSync(planPath(root), HEADER + body);
  return existing;
}

export function answerFor(plan: QA[], id: string): string | null {
  const q = INTAKE_QUESTIONS.find((x) => x.id === id);
  if (!q) return null;
  const hit = plan.find((p) => norm(p.q) === norm(q.q));
  const a = hit?.a?.trim();
  return a && a !== '(no answer)' ? a : null;
}

/** Parses "about 1,000", "5k", "10 000 users" into a number. */
export function parseUserCount(text: string | null): number | null {
  if (!text) return null;
  const m = /(\d[\d,.\s]*)\s*(k|m|thousand|million)?/i.exec(text);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/[\s,]/g, ''));
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k' || unit === 'thousand') n *= 1_000;
  if (unit === 'm' || unit === 'million') n *= 1_000_000;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Private intake data (test account credentials) never goes into PLAN.md.
export interface PrivateIntake {
  accounts: { user: string; password: string }[];
}

export function savePrivateIntake(root: string, data: PrivateIntake): void {
  fs.writeFileSync(projectWorkDir(root, 'intake.json'), JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function readPrivateIntake(root: string): PrivateIntake {
  try {
    return JSON.parse(fs.readFileSync(projectWorkDir(root, 'intake.json'), 'utf8'));
  } catch {
    return { accounts: [] };
  }
}

export function parseAccounts(text: string): { user: string; password: string }[] {
  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes(':'))
    .map((s) => {
      const i = s.indexOf(':');
      return { user: s.slice(0, i).trim(), password: s.slice(i + 1).trim() };
    })
    .filter((a) => a.user && a.password)
    .slice(0, 4);
}
