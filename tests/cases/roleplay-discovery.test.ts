import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverCandidateRoutes } from '../../packages/engine/src/steps/16-roleplay.js';

describe('Roleplay Dynamic Route & Spec Discovery (Gap 4)', () => {
  it('discovers routes from openapi.json specifications', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-openapi-'));
    try {
      const openapi = {
        openapi: '3.0.0',
        paths: {
          '/users/{userId}/profile': {},
          '/invoices/{id}/pdf': {},
          '/admin/settings': {}
        }
      };
      fs.writeFileSync(path.join(tmp, 'openapi.json'), JSON.stringify(openapi, null, 2), 'utf8');

      const routes = discoverCandidateRoutes(tmp);
      expect(routes).toContain('/users/order_123/profile');
      expect(routes).toContain('/invoices/order_123/pdf');
      expect(routes).toContain('/admin/settings');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('discovers routes from express/fastify route patterns', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-express-'));
    try {
      const serverCode = `
        app.get('/api/v1/accounts/:accId', (req, res) => res.json({}));
        router.post('/api/billing/cards/:cardId', (req, res) => res.json({}));
      `;
      fs.writeFileSync(path.join(tmp, 'server.js'), serverCode, 'utf8');

      const routes = discoverCandidateRoutes(tmp);
      expect(routes).toContain('/api/v1/accounts/order_123');
      expect(routes).toContain('/api/billing/cards/order_123');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('discovers routes from next.js app/pages router tree', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-next-'));
    try {
      const apiRouteDir = path.join(tmp, 'app', 'api', 'documents', '[docId]');
      fs.mkdirSync(apiRouteDir, { recursive: true });
      fs.writeFileSync(path.join(apiRouteDir, 'route.ts'), 'export async function GET() {}', 'utf8');

      const routes = discoverCandidateRoutes(tmp);
      expect(routes).toContain('/api/documents/order_123');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
