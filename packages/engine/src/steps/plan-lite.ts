import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../schema/finding.schema.js';
import { generateFindingId } from '../util/ulid.js';
import { computeFindingFingerprint } from '../util/secret-hmac.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface PlanAnswers {
  expectedUsers?: string;
  monthlyBudget?: string;
  targetLaunchDate?: string;
}

export interface PlanResult {
  markdownPath: string;
  markdownContent: string;
  findings: Finding[];
}

export interface DiscoveredStack {
  framework: string;
  database: string;
  queue: string;
  ci: string;
  isMicroservices: boolean;
  hasDocker: boolean;
}

/**
 * Inspects repository files to discover the true underlying tech stack.
 */
export function discoverProjectStack(normProject: string): DiscoveredStack {
  let framework = 'Node.js';
  let database = 'None detected';
  let queue = 'None detected';
  let ci = 'None';
  let isMicroservices = false;
  let hasDocker = false;

  // 1. CI Pipeline check
  if (fs.existsSync(path.join(normProject, '.github', 'workflows'))) {
    ci = 'GitHub Actions';
  } else if (fs.existsSync(path.join(normProject, '.gitlab-ci.yml'))) {
    ci = 'GitLab CI';
  } else if (fs.existsSync(path.join(normProject, 'Jenkinsfile'))) {
    ci = 'Jenkins';
  }

  // 2. Docker / Containers
  if (fs.existsSync(path.join(normProject, 'Dockerfile')) || fs.existsSync(path.join(normProject, 'docker-compose.yml')) || fs.existsSync(path.join(normProject, 'compose.yaml'))) {
    hasDocker = true;
  }

  // 3. Node.js (package.json)
  const pkgPath = path.join(normProject, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['next']) framework = 'Next.js (React)';
      else if (deps['nuxt']) framework = 'Nuxt (Vue)';
      else if (deps['@nestjs/core']) framework = 'NestJS';
      else if (deps['express']) framework = 'Express / Node.js';
      else if (deps['fastify']) framework = 'Fastify / Node.js';
      else if (deps['@sveltejs/kit'] || deps['svelte']) framework = 'SvelteKit';
      else if (deps['react']) framework = 'React SPA';
      else if (deps['vue']) framework = 'Vue.js SPA';

      if (deps['@supabase/supabase-js']) database = 'PostgreSQL / Supabase';
      else if (deps['@prisma/client'] || deps['prisma']) database = 'PostgreSQL / Prisma ORM';
      else if (deps['pg'] || deps['postgres']) database = 'PostgreSQL';
      else if (deps['mysql2'] || deps['mysql']) database = 'MySQL';
      else if (deps['mongoose'] || deps['mongodb']) database = 'MongoDB';
      else if (deps['better-sqlite3'] || deps['sqlite3'] || deps['sqlite']) database = 'SQLite';

      if (deps['bull'] || deps['bullmq']) queue = 'BullMQ / Redis';
      else if (deps['amqplib']) queue = 'RabbitMQ';
      else if (deps['kafkajs']) queue = 'Apache Kafka';
    } catch {}
  }

  // 4. Rust (Cargo.toml)
  const cargoPath = path.join(normProject, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    try {
      const cargoText = fs.readFileSync(cargoPath, 'utf8');
      if (cargoText.includes('axum')) framework = 'Rust (Axum)';
      else if (cargoText.includes('actix-web')) framework = 'Rust (Actix-web)';
      else if (cargoText.includes('rocket')) framework = 'Rust (Rocket)';
      else framework = 'Rust';

      if (cargoText.includes('sqlx')) database = 'SQLx (PostgreSQL/MySQL/SQLite)';
      else if (cargoText.includes('diesel')) database = 'Diesel ORM';
      else if (cargoText.includes('rusqlite')) database = 'SQLite';
    } catch {}
  }

  // 5. Python (requirements.txt / pyproject.toml)
  const reqPath = path.join(normProject, 'requirements.txt');
  const pyprojPath = path.join(normProject, 'pyproject.toml');
  if (fs.existsSync(reqPath) || fs.existsSync(pyprojPath)) {
    const text = (fs.existsSync(reqPath) ? fs.readFileSync(reqPath, 'utf8') : '') +
      (fs.existsSync(pyprojPath) ? fs.readFileSync(pyprojPath, 'utf8') : '');

    if (text.includes('fastapi')) framework = 'Python (FastAPI)';
    else if (text.includes('django')) framework = 'Python (Django)';
    else if (text.includes('flask')) framework = 'Python (Flask)';
    else framework = 'Python';

    if (text.includes('psycopg') || text.includes('asyncpg')) database = 'PostgreSQL';
    else if (text.includes('sqlalchemy')) database = 'SQLAlchemy (Relational DB)';
    else if (text.includes('pymongo')) database = 'MongoDB';

    if (text.includes('celery')) queue = 'Celery / Redis';
  }

  // 6. Go (go.mod)
  const goModPath = path.join(normProject, 'go.mod');
  if (fs.existsSync(goModPath)) {
    try {
      const goText = fs.readFileSync(goModPath, 'utf8');
      if (goText.includes('gin-gonic/gin')) framework = 'Go (Gin)';
      else if (goText.includes('labstack/echo')) framework = 'Go (Echo)';
      else if (goText.includes('gofiber/fiber')) framework = 'Go (Fiber)';
      else framework = 'Go';

      if (goText.includes('gorm.io/gorm')) database = 'GORM';
      else if (goText.includes('jackc/pgx')) database = 'PostgreSQL';
    } catch {}
  }

  return {
    framework,
    database,
    queue,
    ci,
    isMicroservices,
    hasDocker
  };
}

/**
 * Step: Scale & Risk Plan — Lite:
 * Evaluates architectural complexity, costs, and underbuild/overbuild risks.
 * Generates .noulette/plan.md and non-blocking findings with source: "plan".
 */
export function generateScalePlan(
  projectPath: string,
  candidateId = 'cand_01J00000000000000000000000',
  answers: PlanAnswers = {}
): PlanResult {
  const normProject = path.resolve(projectPath);
  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }

  // Dynamic stack discovery
  const facts = discoverProjectStack(normProject);

  const users = answers.expectedUsers || '< 1,000';
  const budget = answers.monthlyBudget || '< $100/mo';
  const targetDate = answers.targetLaunchDate || 'Next 30 days';

  const findings: Finding[] = [];

  // API Cost Guardrails finding (source: "plan", non-blocking)
  const costFp = computeFindingFingerprint('PLAN-COST-001', 'package.json', 1, 'api-cost-limits');
  findings.push({
    schemaVersion: 1,
    id: generateFindingId(),
    fingerprint: costFp,
    candidateId,
    source: 'plan',
    ruleId: 'PLAN-COST-001',
    occurrenceIndex: 1,
    what: 'Scale Advisory: Uncapped third-party LLM / API billing endpoints',
    where: { file: 'package.json', line: 1 },
    visibility: ['local'],
    urgency: 'nice-to-fix',
    severity: 'info',
    confidence: 'likely',
    blocking: false,
    evidence: {
      snippetHash: 'plan-cost-budget',
      excerpt: `Target budget: ${budget}. Implement hard billing alarms and per-user monthly usage quotas.`,
      request: null
    },
    howToFix: 'Configure spend limit webhooks and token limits in upstream provider console.',
    youMustDo: ['Set budget alarm thresholds in provider dashboard'],
    status: 'open',
    attempts: 0
  });

  const lines: string[] = [
    '# Scale & Risk Plan — Lite (Beta 10-Step Advisory)',
    '',
    '## 1. Project Facts',
    `- **Framework:** ${facts.framework}`,
    `- **Database:** ${facts.database}`,
    `- **Background Worker / Queue:** ${facts.queue}`,
    `- **CI Pipeline:** ${facts.ci}`,
    `- **Containerization:** ${facts.hasDocker ? 'Docker detected' : 'Direct process'}`,
    '',
    '## 2. Planning Parameters',
    `- **Target Users:** ${users}`,
    `- **Target Monthly Budget:** ${budget}`,
    `- **Target Launch Date:** ${targetDate}`,
    '',
    '## 3. Overbuild Heuristics',
    '- [Rule of Thumb] Avoid distributed microservices and multi-region databases before 10k active users.',
    `- [Rule of Thumb] Keep queue workers in single instance background jobs until background load exceeds 50 req/sec (${facts.queue}).`,
    '',
    '## 4. Underbuild Heuristics',
    `- [Evidence] Ensure automated database point-in-time recovery (PITR) is enabled on ${facts.database.includes('Supabase') ? 'Supabase' : facts.database}.`,
    '- [Evidence] Ensure unique tenant IDs are indexed across user tables.',
    '- [Evidence] Configure database connection pooling to prevent connection exhaustion under traffic spikes.',
    '',
    '## 5. API Cost Guardrails',
    `- Set hard billing alerts at 50%, 80%, and 100% of target budget (${budget}).`,
    '- Apply client rate-limiting on unauthenticated endpoints.',
    '',
    '## 6. Stage Roadmap (0 to 10k Users)',
    '1. Phase 1 (0 - 100 users): Single deployment tier, managed database free tier, basic error tracking.',
    '2. Phase 2 (100 - 1k users): Dedicated database compute, automated daily backups.',
    '3. Phase 3 (1k - 10k users): Redis caching for hot endpoints, read replicas.',
    '',
    '## 7. What Not to Build Yet',
    '- Do NOT build custom authentication (use standard OAuth / verified auth libraries).',
    '- Do NOT implement Kubernetes or complex cluster orchestrators before product-market fit.',
    '',
    '## 8. Badges',
    '- `[Evidence-Backed]` Database backup and tenant indexing.',
    '- `[Rule-of-Thumb]` Scale architecture stages.',
    '',
    '## 9. Fix Feasibility Prompt',
    '```',
    'Review the open security findings and apply minimal targeted fixes without architectural churn.',
    '```',
    '',
    '## 10. Rescan Handoff',
    '- Re-run `noulette-engine scan` after implementing changes.'
  ];

  const markdownContent = lines.join('\n') + '\n';
  const markdownPath = path.join(nouletteDir, 'plan.md');
  fs.writeFileSync(markdownPath, markdownContent, 'utf8');

  return {
    markdownPath,
    markdownContent,
    findings
  };
}
