import type { QA } from './plan.js';
import { answerFor, parseUserCount } from './plan.js';

export type AiStage = 'logic' | 'feasibility' | 'legal';
export const AI_STAGES: AiStage[] = ['logic', 'feasibility', 'legal'];

export interface CheckItem {
  id: string;
  check: string;
}

/**
 * Strict per-stage checklists. The agent must report a result for EVERY item id,
 * otherwise the submission is rejected. Items are generated from PLAN.md, so they
 * follow the app's real goals (user count, data, audience, integrations).
 */
export function checklist(stage: AiStage, plan: QA[], ctx: { liveApp: boolean; accounts: number }): CheckItem[] {
  const users = parseUserCount(answerFor(plan, 'users'));
  const data = (answerFor(plan, 'data') ?? '').toLowerCase();
  const audience = (answerFor(plan, 'audience') ?? '').toLowerCase();
  const integrations = answerFor(plan, 'integrations') ?? '';
  const items: CheckItem[] = [];
  const add = (id: string, check: string) => items.push({ id, check });
  if (stage === 'logic') {
    const how = ctx.liveApp && ctx.accounts >= 2
      ? 'Use noulette_probe against the running app, logged in as each test account, and send the real requests.'
      : 'Role-play by tracing the code path for each actor (no live app available).';
    add('L1', `Act as user A, then user B: can B read or change A's records by changing an id in a URL or body? ${how}`);
    add('L2', 'Act as a normal user: can you reach admin-only actions or set your own role/permissions?');
    add('L3', 'Act as a shopper/customer: can amounts, prices, quantities or percentages be negative, zero, huge, or set by the client?');
    add('L4', 'Can a user skip a required step (payment, email verification, approval) or do steps out of order?');
    add('L5', 'Can the same action be repeated or raced to gain twice (double submit, coupon reuse, double spend, replay)?');
    add('L6', 'Act as an anonymous visitor: login, sign-up and password reset. Any account enumeration, reusable or guessable tokens?');
    add('L7', 'Are server-side checks present for every rule that the UI enforces (limits, ownership, validation)?');
    add('L8', 'After logout, delete or role change, do old sessions/tokens/links still work?');
    add('L9', `Act as an attacker against EVERY input (query strings, form/JSON bodies, headers, file names, search, login): SQL injection (' OR '1'='1, UNION SELECT, ; DROP), NoSQL operators ({"$ne":null}), XSS (<script>, onerror=), command injection (; id, $(whoami)), path traversal (../../etc/passwd). ${ctx.liveApp ? 'Send the payloads with noulette_probe and report any SQL/stack error, extra rows, login success or reflected script.' : 'Trace each input to the database, shell, file system and HTML output.'} Every input that reaches a query, command, path or page without parameterization/escaping is a finding, even if no exploit was confirmed. The note must name the payload types you tried and the inputs you covered. "not-applicable" is not allowed.`);
  } else if (stage === 'feasibility') {
    add('F1', `Can the current stack, database and hosting handle ${users ? users.toLocaleString('en-US') + ' users (from PLAN.md)' : 'the expected user count (ask: PLAN.md has no number)'}? Report underbuild.`);
    add('F2', 'Is the setup heavier or more expensive than that user count needs? Report overbuild.');
    add('F3', 'In-memory state (sessions, caches, Maps, files on local disk) that breaks with restarts or more than one server.');
    add('F4', `Every outside connection${integrations ? ` (PLAN.md says: ${integrations.slice(0, 200)})` : ''}: timeouts, retries, auth, webhook signature checks, idempotency, endpoint compliance requirements.`);
    add('F5', 'Mock, fake, placeholder or hard-coded functions where a real system is needed. Confirm or reject each mock-detection hit.');
    add('F6', 'Release pipeline: build, tests, CI, migrations, environment config and secret handling.');
    add('F7', 'Reliability: error handling, health checks, graceful shutdown, backups, what happens when a dependency is down.');
    add('F8', 'Monitoring: will the owner know when users hit errors after launch? (PostHog or similar).');
    if (/pay|card|stripe|money|bank/.test(data + integrations)) add('F9', 'Payments: PCI-DSS scope (card data must never touch your server), refunds, currency rounding.');
    if (/health|medical|patient/.test(data)) add('F10', 'Health data: HIPAA or local equivalent requirements (encryption, access logs, consent).');
    if (/eu|europe|germany|france|uk|gdpr/.test(audience)) add('F11', 'EU/UK users: GDPR basics (consent, data export/delete, data location).');
    if (/child|kid|under 1[38]|student|school/.test(audience)) add('F12', 'Children: COPPA or local child-privacy rules (parental consent, minimal data).');
    if (/hardware|factory|plc|iot|device|sensor|modbus|opc/.test(integrations.toLowerCase())) add('F13', 'Hardware/industrial integration: protocol, safety interlocks, offline behaviour, vendor compliance.');
  } else {
    add('G1', 'Project license: present, matches what README/package metadata claim.');
    add('G2', 'Dependency licenses that conflict with how the app is shared or sold (use the scanner list).');
    add('G3', 'Code copied from elsewhere with a foreign copyright header or "All rights reserved".');
    add('G4', 'Fonts, images, icons, sounds and other assets: is there evidence they may be used?');
    add('G5', 'Third-party brand names or logos used as if they were your own.');
    if (/email|name|phone|address|personal|user|account|payment|health|location/.test(data) || !data) add('G6', 'Privacy policy / terms needed for the data collected, and whether the app has them.');
    add('G7', 'Contradictions between what the docs promise and what the code or licenses allow.');
  }
  return items;
}
