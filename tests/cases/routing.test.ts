import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { handleArrival } from '../../packages/engine/src/steps/01-arrival.js';
import { routeOrigin, getGlobalGitEmail } from '../../packages/engine/src/steps/02-route.js';
import { CaseRecordSchema } from '../../packages/engine/src/schema/case.schema.js';
import { atomicWriteJsonSync } from '../../packages/engine/src/util/atomic-fs.js';

describe('Step 1 & 2: Arrival & Origin Routing (TC-001..006)', () => {
  let tempDir: string;
  let testAppData: string;
  let oldAppData: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-test-routing-'));
    testAppData = path.join(tempDir, 'appdata');
    fs.mkdirSync(testAppData, { recursive: true });

    oldAppData = process.env.NOULETTE_APPDATA_DIR;
    process.env.NOULETTE_APPDATA_DIR = testAppData;

    // Set up default config
    atomicWriteJsonSync(path.join(testAppData, 'config.json'), {
      schemaVersion: 1,
      effortTier: 'Medium',
      autoFix: true,
      audio: { enabled: true, volume: 0.8 },
      scanners: { opengrepPath: null, gitleaksPath: null }
    });
  });

  afterEach(() => {
    if (oldAppData !== undefined) {
      process.env.NOULETTE_APPDATA_DIR = oldAppData;
    } else {
      delete process.env.NOULETTE_APPDATA_DIR;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('TC-001: Folder created by noulette clone containing .noulette-origin.json -> Route = outside (cites marker)', () => {
    const fixtureDir = path.join(tempDir, 'repo-tc001');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, '.noulette-origin.json'), JSON.stringify({ origin: 'https://example.com/repo.git' }));

    const caseRecord = handleArrival({ projectPath: fixtureDir });
    expect(caseRecord.type).toBe('outside');
    expect(caseRecord.routingReason).toContain('.noulette-origin.json');
    expect(CaseRecordSchema.safeParse(caseRecord).success).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(path.join(testAppData, 'cases', caseRecord.caseId, 'case.json'), 'utf8'));
    expect(onDisk.caseId).toBe(caseRecord.caseId);
    expect(onDisk.tier).toBe('Medium');
  });

  it('TC-002: Git folder whose remote owner is not in user identities -> Route = outside', () => {
    const fixtureDir = path.join(tempDir, 'repo-tc002');
    fs.mkdirSync(fixtureDir, { recursive: true });
    execSync('git init -b main', { cwd: fixtureDir, stdio: 'ignore' });
    execSync('git remote add origin https://github.com/unknown-attacker/untrusted-repo.git', { cwd: fixtureDir, stdio: 'ignore' });

    // Register project in projects.json
    atomicWriteJsonSync(path.join(testAppData, 'projects.json'), {
      schemaVersion: 1,
      projects: [{
        path: fixtureDir,
        name: 'untrusted-repo',
        registeredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString()
      }],
      activeProjectPath: fixtureDir
    });

    const caseRecord = handleArrival({ projectPath: fixtureDir });
    expect(caseRecord.type).toBe('outside');
    expect(caseRecord.routingReason).toBe('unconfigured remote owner');
  });

  it('TC-003: User repo with staged change -> Route = change', () => {
    const fixtureDir = path.join(tempDir, 'repo-tc003');
    fs.mkdirSync(fixtureDir, { recursive: true });
    execSync('git init -b main', { cwd: fixtureDir, stdio: 'ignore' });

    const globalEmail = getGlobalGitEmail() || 'user@example.com';
    const username = globalEmail.split('@')[0];

    // Configure remote matching user
    execSync(`git remote add origin https://github.com/${username}/my-app.git`, { cwd: fixtureDir, stdio: 'ignore' });

    // Register project
    atomicWriteJsonSync(path.join(testAppData, 'projects.json'), {
      schemaVersion: 1,
      projects: [{
        path: fixtureDir,
        name: 'my-app',
        registeredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString()
      }],
      activeProjectPath: fixtureDir
    });

    // Create a commit then stage a change
    fs.writeFileSync(path.join(fixtureDir, 'README.md'), 'Initial');
    execSync('git config user.name "Tester"', { cwd: fixtureDir, stdio: 'ignore' });
    execSync(`git config user.email "${globalEmail}"`, { cwd: fixtureDir, stdio: 'ignore' });
    execSync('git add README.md && git commit -m "init"', { cwd: fixtureDir, stdio: 'ignore' });

    // Staged change
    fs.writeFileSync(path.join(fixtureDir, 'README.md'), 'Updated staged content');
    execSync('git add README.md', { cwd: fixtureDir, stdio: 'ignore' });

    const caseRecord = handleArrival({ projectPath: fixtureDir });
    expect(caseRecord.type).toBe('change');
    expect(caseRecord.routingReason).toContain('staged diff');
  });

  it('TC-004: Folder whose files carry a Zone.Identifier stream -> Route = outside (reason "downloaded")', () => {
    const fixtureDir = path.join(tempDir, 'repo-tc004');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'downloaded.zip.Zone.Identifier'), '[ZoneTransfer]\r\nZoneId=3');

    const caseRecord = handleArrival({ projectPath: fixtureDir });
    expect(caseRecord.type).toBe('outside');
    expect(caseRecord.routingReason).toBe('downloaded');
  });

  it('TC-005: Manual advisory event from watcher -> Route = alert (skips quarantine)', () => {
    const fixtureDir = path.join(tempDir, 'repo-tc005');
    fs.mkdirSync(fixtureDir, { recursive: true });

    const caseRecord = handleArrival({ projectPath: fixtureDir, watcherEvent: true });
    expect(caseRecord.type).toBe('alert');
    expect(caseRecord.routingReason).toBe('watcher advisory event');
  });

  it('TC-006: Folder with no git, no marker, no streams -> Route = outside (reason "unknown origin")', () => {
    const fixtureDir = path.join(tempDir, 'repo-tc006');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'plain.txt'), 'Hello');

    const caseRecord = handleArrival({ projectPath: fixtureDir });
    expect(caseRecord.type).toBe('outside');
    expect(caseRecord.routingReason).toBe('unknown origin');
  });

  it('TC-153: Staged change in user repo (route = change) -> No quarantine folder created', () => {
    const fixtureDir = path.join(tempDir, 'repo-tc153');
    fs.mkdirSync(fixtureDir, { recursive: true });
    execSync('git init -b main', { cwd: fixtureDir, stdio: 'ignore' });
    const globalEmail = getGlobalGitEmail() || 'user@example.com';
    const username = globalEmail.split('@')[0];
    execSync(`git remote add origin https://github.com/${username}/app153.git`, { cwd: fixtureDir, stdio: 'ignore' });

    atomicWriteJsonSync(path.join(testAppData, 'projects.json'), {
      schemaVersion: 1,
      projects: [{ path: fixtureDir, name: 'app153', registeredAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }],
      activeProjectPath: fixtureDir
    });

    fs.writeFileSync(path.join(fixtureDir, 'README.md'), 'Init');
    execSync('git config user.name "Tester"', { cwd: fixtureDir, stdio: 'ignore' });
    execSync(`git config user.email "${globalEmail}"`, { cwd: fixtureDir, stdio: 'ignore' });
    execSync('git add README.md && git commit -m "init"', { cwd: fixtureDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(fixtureDir, 'README.md'), 'Staged change');
    execSync('git add README.md', { cwd: fixtureDir, stdio: 'ignore' });

    const caseRecord = handleArrival({ projectPath: fixtureDir });
    expect(caseRecord.type).toBe('change');
    const quarantinePath = path.join(testAppData, 'quarantine', caseRecord.caseId);
    expect(fs.existsSync(quarantinePath)).toBe(false);
  });

  it('TC-154: Watcher advisory alert -> Route = alert; no quarantine folder created', () => {
    const fixtureDir = path.join(tempDir, 'repo-tc154');
    fs.mkdirSync(fixtureDir, { recursive: true });

    const caseRecord = handleArrival({ projectPath: fixtureDir, watcherEvent: true });
    expect(caseRecord.type).toBe('alert');
    const quarantinePath = path.join(testAppData, 'quarantine', caseRecord.caseId);
    expect(fs.existsSync(quarantinePath)).toBe(false);
  });
});
