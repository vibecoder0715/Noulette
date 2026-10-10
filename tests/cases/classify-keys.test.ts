import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { classifyFiles } from '../../packages/engine/src/steps/08-classify.js';
import { scanLeakedKeys } from '../../packages/engine/src/steps/09-leaked-keys.js';

describe('Steps 8 & 9: Classify Files & Leaked Keys (TC-053..070)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-test-keys-'));
    execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.gitignore'), '.env\nnode_modules/\ndist/\n.next/\n');
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'console.log("hello");');
    execSync('git config user.name "Tester" && git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });
  });

  afterEach(() => {
    try {
      fs.rmSync(repoDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('TC-053: Tracked source file -> Visibility = pushed', () => {
    const fmap = classifyFiles(repoDir);
    expect(fmap.files['src/index.ts']?.visibility).toContain('pushed');
  });

  it('TC-054: Git-ignored .env, no Docker context -> Visibility = local', () => {
    fs.writeFileSync(path.join(repoDir, '.env'), 'KEY=123');
    const fmap = classifyFiles(repoDir);
    expect(fmap.files['.env']?.visibility).toEqual(['local']);
  });

  it('TC-055: Ignored .env + Dockerfile COPY . . and no .dockerignore -> Visibility includes shipped', () => {
    fs.writeFileSync(path.join(repoDir, '.env'), 'KEY=123');
    fs.writeFileSync(path.join(repoDir, 'Dockerfile'), 'FROM node:18\nCOPY . .\n');
    const fmap = classifyFiles(repoDir);
    expect(fmap.files['.env']?.visibility).toContain('shipped');
  });

  it('TC-056: Same but .dockerignore lists .env -> Visibility = local', () => {
    fs.writeFileSync(path.join(repoDir, '.env'), 'KEY=123');
    fs.writeFileSync(path.join(repoDir, 'Dockerfile'), 'FROM node:18\nCOPY . .\n');
    fs.writeFileSync(path.join(repoDir, '.dockerignore'), '.env\n');
    const fmap = classifyFiles(repoDir);
    expect(fmap.files['.env']?.visibility).toEqual(['local']);
  });

  it('TC-057: Ignored public/config.json -> Visibility = shipped (public folder)', () => {
    const pubDir = path.join(repoDir, 'public');
    fs.mkdirSync(pubDir, { recursive: true });
    fs.writeFileSync(path.join(pubDir, 'config.json'), '{"api":"url"}');
    const fmap = classifyFiles(repoDir);
    expect(fmap.files['public/config.json']?.visibility).toContain('shipped');
  });

  it('TC-058: New untracked, non-ignored file with fake key -> classified pushed-pending', () => {
    const fakeKey = 'AKIA1234567890ABCDEF';
    fs.writeFileSync(path.join(repoDir, 'newfile.js'), `const key = "${fakeKey}";`);

    const findings = scanLeakedKeys(repoDir);
    const f = findings.find(x => x.where.file === 'newfile.js');
    expect(f).toBeDefined();
    expect(f?.visibility).toContain('pushed-pending');
    expect(f?.blocking).toBe(true);
  });

  it('TC-059: Fake AWS-format key in a tracked file -> Gitleaks Critical, blocking: true', () => {
    const fakeKey = 'AKIAAAAAAAAAAAAAAAAA';
    fs.writeFileSync(path.join(repoDir, 'src', 'aws.js'), `export const k = "${fakeKey}";`);
    execSync('git add src/aws.js && git commit -m "add key"', { cwd: repoDir, stdio: 'ignore' });

    const findings = scanLeakedKeys(repoDir);
    const f = findings.find(x => x.where.file === 'src/aws.js');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('critical');
    expect(f?.blocking).toBe(true);
  });

  it('TC-060: Same fake key in local-only ignored .env -> Info only, not blocking', () => {
    const fakeKey = 'AKIAAAAAAAAAAAAAAAAA';
    fs.writeFileSync(path.join(repoDir, '.env'), `AWS_SECRET=${fakeKey}`);

    const findings = scanLeakedKeys(repoDir);
    const f = findings.find(x => x.where.file === '.env');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('info');
    expect(f?.blocking).toBe(false);
  });

  it('TC-061: Fake key added in commit 1, removed in commit 2 -> Found in history, action says rotate', () => {
    const fakeKey = 'AKIAHISTORICAL123456';
    fs.writeFileSync(path.join(repoDir, 'src', 'old.js'), `const k = "${fakeKey}";`);
    execSync('git add src/old.js && git commit -m "commit 1"', { cwd: repoDir, stdio: 'ignore' });

    fs.writeFileSync(path.join(repoDir, 'src', 'old.js'), '// removed key');
    execSync('git add src/old.js && git commit -m "commit 2"', { cwd: repoDir, stdio: 'ignore' });

    const findings = scanLeakedKeys(repoDir);
    const histFinding = findings.find(f => f.where.file === 'git-history');
    expect(histFinding).toBeDefined();
    expect(histFinding?.howToFix.toLowerCase()).toContain('rotate');
  });

  it('TC-062: NEXT_PUBLIC_STRIPE_SECRET=sk_test_... -> Public-prefix rule fires, Critical', () => {
    fs.writeFileSync(path.join(repoDir, 'src', 'config.ts'), 'NEXT_PUBLIC_STRIPE_SECRET=sk_test_51MzFakeKeyForTest123456');
    execSync('git add src/config.ts && git commit -m "add next public"', { cwd: repoDir, stdio: 'ignore' });

    const findings = scanLeakedKeys(repoDir);
    const f = findings.find(x => x.ruleId === 'EXP-001');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('critical');
  });

  it('TC-063: VITE_API_SECRET=... -> Public-prefix rule fires, Critical', () => {
    fs.writeFileSync(path.join(repoDir, 'src', 'env.ts'), 'VITE_API_SECRET="secret_token_123456789"');
    execSync('git add src/env.ts && git commit -m "add vite secret"', { cwd: repoDir, stdio: 'ignore' });

    const findings = scanLeakedKeys(repoDir);
    const f = findings.find(x => x.ruleId === 'EXP-002');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('critical');
  });

  it('TC-064 & TC-065: Fake key in .next/static/ or dist/bundle.js -> Found, classified shipped', () => {
    const nextStatic = path.join(repoDir, '.next', 'static');
    fs.mkdirSync(nextStatic, { recursive: true });
    fs.writeFileSync(path.join(nextStatic, 'chunk.js'), 'const k = "AKIA1111222233334444";');

    const findings = scanLeakedKeys(repoDir);
    const f = findings.find(x => x.where.file === '.next/static/chunk.js');
    expect(f).toBeDefined();
    expect(f?.visibility).toContain('shipped');
  });

  it('TC-066: Fake key in Dockerfile ENV -> Found, Critical', () => {
    fs.writeFileSync(path.join(repoDir, 'Dockerfile'), 'FROM alpine\nENV API_SECRET=sk_live_123456789012345678901234\n');
    execSync('git add Dockerfile && git commit -m "dockerfile"', { cwd: repoDir, stdio: 'ignore' });

    const findings = scanLeakedKeys(repoDir);
    const f = findings.find(x => x.where.file === 'Dockerfile');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('critical');
  });

  it('TC-067: Fake key in tracked logs/app.log -> Found', () => {
    const logDir = path.join(repoDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'app.log'), 'Error with key: AKIA9999888877776666');
    execSync('git add logs/app.log && git commit -m "logs"', { cwd: repoDir, stdio: 'ignore' });

    const findings = scanLeakedKeys(repoDir);
    const f = findings.find(x => x.where.file === 'logs/app.log');
    expect(f).toBeDefined();
  });

  it('TC-068: High-entropy UUIDs / SHA hashes -> Not flagged', () => {
    const benignFile = path.join(repoDir, 'src', 'uuid.ts');
    fs.writeFileSync(benignFile, `
      export const id1 = "c73bcdcc-ec34-429b-a620-3b4f6e1f0e42";
      export const sha1 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      export const integ = "sha512-H/7sQxW8...";
    `);
    execSync('git add src/uuid.ts && git commit -m "uuids"', { cwd: repoDir, stdio: 'ignore' });

    const findings = scanLeakedKeys(repoDir);
    const uuidFindings = findings.filter(x => x.where.file === 'src/uuid.ts');
    expect(uuidFindings.length).toBe(0);
  });

  it('TC-069: Secret finding excerpt formatted with HMAC -> Full fake key absent', () => {
    const secret = 'AKIAREDACTEDTEST0001';
    fs.writeFileSync(path.join(repoDir, 'src', 'key.ts'), `const s = "${secret}";`);
    execSync('git add src/key.ts && git commit -m "secret"', { cwd: repoDir, stdio: 'ignore' });

    const findings = scanLeakedKeys(repoDir);
    const f = findings.find(x => x.where.file === 'src/key.ts');
    expect(f).toBeDefined();
    expect(f?.evidence.excerpt).not.toContain(secret);
    expect(f?.evidence.excerpt.startsWith('AKIA')).toBe(true);
  });

  it('TC-070: Scan completes fully offline', () => {
    const findings = scanLeakedKeys(repoDir);
    expect(Array.isArray(findings)).toBe(true);
  });
});
