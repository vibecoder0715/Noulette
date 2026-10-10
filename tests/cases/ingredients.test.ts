import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanIngredients, computeFixSize } from '../../packages/engine/src/steps/11-ingredients.js';
import { checkFreshDanger } from '../../packages/engine/src/steps/13-fresh-danger.js';

describe('Steps 11 & 13: Ingredients & Fresh Danger (TC-079..088)', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-test-ingredients-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('TC-079: package-lock.json v3 with CVE -> Finding with fixed version and fix size', () => {
    const pkgLock = {
      name: 'test-app',
      version: '1.0.0',
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { lodash: '4.17.20' } },
        'node_modules/lodash': { version: '4.17.20' }
      }
    };
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), JSON.stringify(pkgLock));

    const res = scanIngredients(projectDir, {
      mockOsvAdvisories: [{
        id: 'GHSA-35jh-r3h4-6jhm',
        packageName: 'lodash',
        affectedVersion: '4.17.20',
        fixedVersion: '4.17.21',
        summary: 'Prototype pollution in lodash'
      }]
    });

    expect(res.findings.length).toBe(1);
    const f = res.findings[0];
    expect(f.ruleId).toBe('GHSA-35jh-r3h4-6jhm');
    expect(f.evidence.request?.fixedVersion).toBe('4.17.21');
    expect(f.evidence.request?.fixSize).toBe('patch');
  });

  it('TC-080: pnpm-lock.yaml and yarn.lock -> Parse to correct package lists', () => {
    const pnpmContent = `
lockfileVersion: '6.0'
dependencies:
  express:
    specifier: ^4.18.2
    version: 4.18.2
packages:
  /express@4.18.2:
    resolution: {integrity: sha512-...}
`;
    fs.writeFileSync(path.join(projectDir, 'pnpm-lock.yaml'), pnpmContent);

    const resPnpm = scanIngredients(projectDir);
    expect(resPnpm.inventory.packages.some(p => p.name === 'express' && p.version === '4.18.2')).toBe(true);

    const yarnContent = `
# ` + `yarn lockfile v1
express@^4.18.2:
  version "4.18.2"
  resolved "https://registry.npmjs.org/express/-/express-4.18.2.tgz"
`;
    fs.writeFileSync(path.join(projectDir, 'yarn.lock'), yarnContent);

    const resYarn = scanIngredients(projectDir);
    expect(resYarn.inventory.packages.some(p => p.name === 'express' && p.version === '4.18.2')).toBe(true);
  });

  it('TC-081: Package present in cached CISA KEV dataset -> Flagged known-exploited, blocking: true', () => {
    fs.writeFileSync(path.join(projectDir, 'requirements.txt'), 'log4j==2.14.0\n');

    const res = scanIngredients(projectDir, {
      mockOsvAdvisories: [{
        id: 'CVE-2021-44228',
        packageName: 'log4j',
        affectedVersion: '2.14.0',
        fixedVersion: '2.15.0',
        summary: 'Log4Shell remote code execution'
      }],
      mockKevList: ['CVE-2021-44228']
    });

    expect(res.findings.length).toBe(1);
    const f = res.findings[0];
    expect(f.what).toContain('CISA KEV Known Exploited');
    expect(f.blocking).toBe(true);
    expect(f.severity).toBe('high');
  });

  it('TC-082: OSV response with MAL-* ID -> Critical, blocking: true', () => {
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), JSON.stringify({
      name: 'app',
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'evil-stealer': '1.0.0' } },
        'node_modules/evil-stealer': { version: '1.0.0' }
      }
    }));

    const res = scanIngredients(projectDir, {
      mockOsvAdvisories: [{
        id: 'MAL-2024-1234',
        packageName: 'evil-stealer',
        affectedVersion: '1.0.0',
        summary: 'Malicious npm package stealing tokens'
      }]
    });

    expect(res.findings.length).toBe(1);
    const f = res.findings[0];
    expect(f.severity).toBe('critical');
    expect(f.blocking).toBe(true);
  });

  it('TC-083: Direct vs transitive, dev vs prod labels correct', () => {
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), JSON.stringify({
      name: 'app',
      lockfileVersion: 3,
      packages: {
        '': {
          dependencies: { prodPkg: '1.0.0' },
          devDependencies: { devPkg: '1.0.0' }
        },
        'node_modules/prodPkg': { version: '1.0.0', dev: false },
        'node_modules/devPkg': { version: '1.0.0', dev: true },
        'node_modules/transPkg': { version: '1.0.0', dev: false }
      }
    }));

    const res = scanIngredients(projectDir);
    const prod = res.inventory.packages.find(p => p.name === 'prodPkg');
    const dev = res.inventory.packages.find(p => p.name === 'devPkg');
    const trans = res.inventory.packages.find(p => p.name === 'transPkg');

    expect(prod?.isDirect).toBe(true);
    expect(prod?.isDev).toBe(false);

    expect(dev?.isDirect).toBe(true);
    expect(dev?.isDev).toBe(true);

    expect(trans?.isDirect).toBe(false);
  });

  it('TC-084: Package unknown to OSV -> Listed as unchecked, not clean', () => {
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), JSON.stringify({
      name: 'app',
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { myPrivatePkg: '1.0.0' } },
        'node_modules/myPrivatePkg': { version: '1.0.0' }
      }
    }));

    const res = scanIngredients(projectDir, { mockOsvAdvisories: [] });
    expect(res.inventory.uncheckedCount).toBeGreaterThan(0);
  });

  it('TC-085: OSV unreachable (simulated) -> Uses cache with stale label, never clean', () => {
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), JSON.stringify({
      name: 'app',
      lockfileVersion: 3,
      packages: { '': { dependencies: { x: '1.0.0' } }, 'node_modules/x': { version: '1.0.0' } }
    }));

    const res = scanIngredients(projectDir, { simulateOsvOffline: true });
    expect(res.inventory.isStaleCache).toBe(true);
  });

  it('TC-086: Fixed version across patch/minor/major boundaries -> Fix size computed correctly', () => {
    expect(computeFixSize('1.2.3', '1.2.4')).toBe('patch');
    expect(computeFixSize('1.2.3', '1.3.0')).toBe('minor');
    expect(computeFixSize('1.2.3', '2.0.0')).toBe('major');
  });

  it('TC-087: Watcher detects new matching advisory -> source: advisory, receipt recheck needed', () => {
    // Generate inventory first
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), JSON.stringify({
      name: 'app',
      lockfileVersion: 3,
      packages: { '': { dependencies: { axios: '0.21.1' } }, 'node_modules/axios': { version: '0.21.1' } }
    }));
    scanIngredients(projectDir);

    // Mock existing receipt
    const receiptsDir = path.join(projectDir, '.noulette', 'receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });
    fs.writeFileSync(path.join(receiptsDir, 'latest.json'), JSON.stringify({
      receiptId: 'rcpt_01J00000000000000000000000',
      recheckNeeded: false
    }));

    const res = checkFreshDanger(projectDir, {
      incomingAdvisories: [{
        id: 'GHSA-42xw-2xvc-rh8d',
        packageName: 'axios',
        affectedVersion: '0.21.1',
        fixedVersion: '0.21.2',
        summary: 'SSRF vulnerability in axios'
      }]
    });

    expect(res.newFindings.length).toBe(1);
    expect(res.newFindings[0].source).toBe('advisory');
    expect(res.recheckNeeded).toBe(true);

    const onDiskReceipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, 'latest.json'), 'utf8'));
    expect(onDiskReceipt.recheckNeeded).toBe(true);
  });

  it('TC-088: Upstream returns HTTP 429 -> Exponential backoff applied', () => {
    const res = checkFreshDanger(projectDir, {
      incomingAdvisories: [],
      simulateHttp429: true
    });
    expect(res.backoffApplied).toBe(true);
  });
});
