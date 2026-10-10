import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mapTheApp } from '../../packages/engine/src/steps/14-appmap.js';

describe('Step 14: Map the App (TC-095..098, TC-159)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-appmap-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('TC-095: Next.js app directory -> Routes extracted, written to .noulette/appmap.json', () => {
    const appDir = path.join(tempDir, 'app');
    fs.mkdirSync(path.join(appDir, 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(appDir, 'page.tsx'), 'export default function Page() { return <div>Home</div>; }');
    fs.writeFileSync(path.join(appDir, 'dashboard', 'page.tsx'), 'export default function Dashboard() { return <div>Dash</div>; }');

    const result = mapTheApp(tempDir);
    expect(result.appMap.routes.length).toBeGreaterThanOrEqual(2);
    expect(result.appMap.routes.some(r => r.path === '/')).toBe(true);
    expect(result.appMap.routes.some(r => r.path === '/dashboard')).toBe(true);

    const savedPath = path.join(tempDir, '.noulette', 'appmap.json');
    expect(fs.existsSync(savedPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    expect(parsed.schemaVersion).toBe(1);
  });

  it('TC-096: Route handler lacking auth check -> Listed under unprotected with finding', () => {
    const apiDir = path.join(tempDir, 'app', 'api', 'orders');
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(
      path.join(apiDir, 'route.ts'),
      `export async function GET(req: Request) { return Response.json({ orders: [] }); }`
    );

    const result = mapTheApp(tempDir);
    const route = result.appMap.routes.find(r => r.path === '/api/orders');
    expect(route).toBeDefined();
    expect(route?.status).toBe('unprotected');
    expect(route?.protected).toBe(false);

    const finding = result.findings.find(f => f.ruleId === 'LOGIC-ROUTE-001');
    expect(finding).toBeDefined();
    expect(finding?.where.file).toContain('app/api/orders/route.ts');
  });

  it('TC-097: Supabase migration with user_id but without RLS -> LOGIC-RLS-001 High finding', () => {
    const migDir = path.join(tempDir, 'supabase', 'migrations');
    fs.mkdirSync(migDir, { recursive: true });
    fs.writeFileSync(
      path.join(migDir, '20260101_init.sql'),
      `CREATE TABLE documents (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        title TEXT
      );`
    );

    const result = mapTheApp(tempDir);
    const table = result.appMap.tables.find(t => t.name === 'documents');
    expect(table).toBeDefined();
    expect(table?.rlsEnabled).toBe(false);

    const finding = result.findings.find(f => f.ruleId === 'LOGIC-RLS-001');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
    expect(finding?.blocking).toBe(true);
  });

  it('TC-098: Supabase migration with RLS policy USING (true) on user table -> LOGIC-RLS-002 High finding', () => {
    const migDir = path.join(tempDir, 'supabase', 'migrations');
    fs.mkdirSync(migDir, { recursive: true });
    fs.writeFileSync(
      path.join(migDir, '20260102_policy.sql'),
      `ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Universal access" ON documents FOR SELECT USING (true);`
    );

    const result = mapTheApp(tempDir);
    const finding = result.findings.find(f => f.ruleId === 'LOGIC-RLS-002');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('high');
    expect(finding?.blocking).toBe(true);
  });

  it('TC-159: Middleware matcher skips a route -> App map marks route as unknown, never assumed protected', () => {
    // Middleware that only matches /dashboard/:path*
    fs.writeFileSync(
      path.join(tempDir, 'middleware.ts'),
      `export const config = { matcher: ['/dashboard/:path*'] };
      export function middleware(req: any) { return; }`
    );

    const appDir = path.join(tempDir, 'app');
    fs.mkdirSync(path.join(appDir, 'dashboard'), { recursive: true });
    fs.mkdirSync(path.join(appDir, 'public-page'), { recursive: true });

    fs.writeFileSync(path.join(appDir, 'dashboard', 'route.ts'), 'export function GET() {}');
    fs.writeFileSync(path.join(appDir, 'public-page', 'route.ts'), 'export function GET() {}');

    const result = mapTheApp(tempDir);
    const dashRoute = result.appMap.routes.find(r => r.path === '/dashboard');
    const pubRoute = result.appMap.routes.find(r => r.path === '/public-page');

    expect(dashRoute?.status).toBe('protected');
    // Skipped route must be 'unknown', NOT 'protected'
    expect(pubRoute?.status).toBe('unknown');
    expect(pubRoute?.protected).toBe(false);
  });
});
