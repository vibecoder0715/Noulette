import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Finding } from '../schema/finding.schema.js';
import { generateFindingId } from '../util/ulid.js';
import { computeFindingFingerprint } from '../util/secret-hmac.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface RouteInfo {
  path: string;
  file: string;
  protected: boolean;
  authMethod?: string;
  status: 'protected' | 'unprotected' | 'unknown';
}

export interface TableInfo {
  name: string;
  rlsEnabled: boolean;
  policies: { name: string; definition: string }[];
}

export interface AppMap {
  schemaVersion: 1;
  routes: RouteInfo[];
  tables: TableInfo[];
  middleware: { file: string; matchers: string[] } | null;
  generatedAt: string;
}

export interface AppMapResult {
  appMap: AppMap;
  findings: Finding[];
}

/**
 * Step 14 — Map the App:
 * Extracts routes, middleware, auth checks, and Supabase RLS policies.
 */
export function mapTheApp(projectPath: string, candidateId = 'cand_01J00000000000000000000000'): AppMapResult {
  const normProject = path.resolve(projectPath);
  const routes: RouteInfo[] = [];
  const tables: TableInfo[] = [];
  const findings: Finding[] = [];

  // 1. Inspect middleware (e.g. middleware.ts)
  let middlewareInfo: { file: string; matchers: string[] } | null = null;
  const middlewareFile = ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js'].find(f =>
    fs.existsSync(path.join(normProject, f))
  );

  if (middlewareFile) {
    const mwContent = fs.readFileSync(path.join(normProject, middlewareFile), 'utf8');
    const matchers: string[] = [];
    const matcherMatch = mwContent.match(/matcher\s*:\s*(\[[^\]]+\]|['"][^'"]+['"])/);
    if (matcherMatch) {
      const raw = matcherMatch[1];
      if (raw.startsWith('[')) {
        const items = raw.slice(1, -1).split(',').map(s => s.trim().replace(/['"]/g, ''));
        matchers.push(...items.filter(Boolean));
      } else {
        matchers.push(raw.replace(/['"]/g, ''));
      }
    }
    middlewareInfo = { file: middlewareFile, matchers };
  }

  // 2. Discover routes (Next.js app and pages)
  const routeDirs = ['app', 'src/app', 'pages/api', 'src/pages/api'];
  for (const rd of routeDirs) {
    const fullRd = path.join(normProject, rd);
    if (!fs.existsSync(fullRd)) continue;

    function walkRoutes(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullEntry = path.join(dir, entry.name);
        const relEntry = path.relative(normProject, fullEntry).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          walkRoutes(fullEntry);
        } else if (entry.isFile() && /\.(js|ts|tsx)$/.test(entry.name)) {
          // Compute route path
          const relRoute = path.relative(fullRd, fullEntry).replace(/\\/g, '/');
          let cleanRoute = '/' + relRoute.replace(/\/route\.[jt]sx?$/, '').replace(/\.[jt]sx?$/, '');
          cleanRoute = cleanRoute.replace(/\/page$/, '') || '/';
          cleanRoute = cleanRoute.replace(/\/route$/, '') || '/';

          let fileText = '';
          try {
            fileText = fs.readFileSync(fullEntry, 'utf8');
          } catch {
            continue;
          }

          // Check if middleware matcher covers this route
          let isCoveredByMiddleware = false;
          let isSkippedByMatcher = false;
          if (middlewareInfo && middlewareInfo.matchers.length > 0) {
            isCoveredByMiddleware = middlewareInfo.matchers.some(m => {
              const pattern = m.replace(/\/:path\*/g, '(/.*)?').replace(/:path\*/g, '.*').replace(/\*/g, '.*');
              const regex = new RegExp(`^${pattern}$`);
              return regex.test(cleanRoute);
            });
            isSkippedByMatcher = !isCoveredByMiddleware;
          }

          // Check intra-file auth checks
          const hasInFileAuth = /getServerSession|auth\(\)|getUser\(|supabase\.auth\.getUser|requireAuth|verifySession/i.test(fileText);

          let status: 'protected' | 'unprotected' | 'unknown' = 'unprotected';
          if (isSkippedByMatcher) {
            // TC-159: Route skipped by middleware matcher is flagged as "unknown", not protected!
            status = 'unknown';
          } else if (isCoveredByMiddleware || hasInFileAuth) {
            status = 'protected';
          }

          routes.push({
            path: cleanRoute,
            file: relEntry,
            protected: status === 'protected',
            authMethod: hasInFileAuth ? 'inline' : (isCoveredByMiddleware ? 'middleware' : undefined),
            status
          });

          // TC-096: Route handler lacking auth check -> Listed under unprotected
          if (status === 'unprotected' && (cleanRoute.startsWith('/api') || cleanRoute.includes('/admin'))) {
            const snippetHash = crypto.createHash('sha256').update(cleanRoute).digest('hex');
            const fingerprint = computeFindingFingerprint('LOGIC-ROUTE-001', relEntry, 1, cleanRoute);

            findings.push({
              schemaVersion: 1,
              id: generateFindingId(),
              fingerprint,
              candidateId,
              source: 'logic',
              ruleId: 'LOGIC-ROUTE-001',
              occurrenceIndex: 1,
              what: `API route handler lacking authentication check: ${cleanRoute}`,
              where: { file: relEntry, line: 1 },
              visibility: ['shipped'],
              urgency: 'fix-soon',
              severity: 'medium',
              confidence: 'likely',
              blocking: false,
              evidence: { snippetHash, excerpt: `Unprotected route handler: ${cleanRoute}`, request: null },
              howToFix: 'Add authentication or session check inside the route handler or protect with middleware.',
              youMustDo: ['Add session validation before handling request data'],
              status: 'open',
              attempts: 0
            });
          }
        }
      }
    }

    walkRoutes(fullRd);
  }

  // 3. Inspect SQL migrations / Supabase RLS tables (TC-097, TC-098)
  const migrationsDir = path.join(normProject, 'supabase', 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const entries = fs.readdirSync(migrationsDir);
    for (const entry of entries) {
      if (!entry.endsWith('.sql')) continue;
      const relSql = `supabase/migrations/${entry}`;
      const sqlContent = fs.readFileSync(path.join(migrationsDir, entry), 'utf8');

      // TC-097: Table with user_id, RLS disabled
      if (/create\s+table\s+(\w+)/i.test(sqlContent) && /user_id\s+/i.test(sqlContent)) {
        const tableMatch = sqlContent.match(/create\s+table\s+(\w+)/i);
        const tableName = tableMatch ? tableMatch[1] : 'users_data';
        const hasRlsEnable = new RegExp(`alter\\s+table\\s+${tableName}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sqlContent);

        if (!hasRlsEnable) {
          tables.push({ name: tableName, rlsEnabled: false, policies: [] });

          const snippetHash = crypto.createHash('sha256').update(`${tableName}:rls-disabled`).digest('hex');
          const fingerprint = computeFindingFingerprint('LOGIC-RLS-001', relSql, 1, tableName);

          findings.push({
            schemaVersion: 1,
            id: generateFindingId(),
            fingerprint,
            candidateId,
            source: 'logic',
            ruleId: 'LOGIC-RLS-001',
            occurrenceIndex: 1,
            what: `Supabase table with user_id but Row Level Security (RLS) is disabled: ${tableName}`,
            where: { file: relSql, line: 1 },
            visibility: ['shipped'],
            urgency: 'fix-before-launch',
            severity: 'high',
            confidence: 'likely',
            blocking: true,
            evidence: { snippetHash, excerpt: `Table ${tableName} has user_id but RLS is not enabled`, request: null },
            howToFix: `Enable Row Level Security on table: ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`,
            youMustDo: ['Enable RLS and define tenant isolation policies'],
            status: 'open',
            attempts: 0
          });
        }
      }

      // TC-098: RLS policy with using (true) on user-owned table
      if (/create\s+policy\s+.*using\s*\(\s*true\s*\)/i.test(sqlContent)) {
        const snippetHash = crypto.createHash('sha256').update('policy-using-true').digest('hex');
        const fingerprint = computeFindingFingerprint('LOGIC-RLS-002', relSql, 1, 'using (true)');

        findings.push({
          schemaVersion: 1,
          id: generateFindingId(),
          fingerprint,
          candidateId,
          source: 'logic',
          ruleId: 'LOGIC-RLS-002',
          occurrenceIndex: 1,
          what: 'Supabase RLS policy allows universal access with "using (true)"',
          where: { file: relSql, line: 1 },
          visibility: ['shipped'],
          urgency: 'fix-before-launch',
          severity: 'high',
          confidence: 'likely',
          blocking: true,
          evidence: { snippetHash, excerpt: 'Policy with USING (true) grants access to all authenticated users', request: null },
          howToFix: 'Restrict policy USING clause to check auth.uid() = user_id.',
          youMustDo: ['Restrict USING expression to tenant or owner identity'],
          status: 'open',
          attempts: 0
        });
      }
    }
  }

  const appMap: AppMap = {
    schemaVersion: 1,
    routes,
    tables,
    middleware: middlewareInfo,
    generatedAt: new Date().toISOString()
  };

  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }
  atomicWriteJsonSync(path.join(nouletteDir, 'appmap.json'), appMap);

  return { appMap, findings };
}
