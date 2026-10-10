import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { getLocalAppDataDir } from '../util/paths.js';
import { parseZipBuffer, type ZipEntry } from '../trapcheck/zip-extractor.js';
import {
  validateSafePath,
  sanitizeEntryPath,
  safeWriteEntry,
  type SafeWriterOptions,
  type NeutralizedEntry
} from '../trapcheck/safe-writer.js';
import type { TrapcheckFinding, TrapcheckInconclusive } from '../schema/trapcheck.schema.js';

export interface QuarantineResult {
  caseId: string;
  quarantineDir: string;
  filesCount: number;
  totalBytesWritten: number;
  findings: TrapcheckFinding[];
  inconclusive: TrapcheckInconclusive[];
  neutralized: NeutralizedEntry[];
  verdict: 'reject' | 'unsure' | 'pass';
  reasons: string[];
}

export function getQuarantineCaseDir(caseId: string): string {
  return path.join(getLocalAppDataDir(), 'quarantine', caseId);
}

function getHardenedGitArgs(repoTarget: string): string {
  const isLocal = fs.existsSync(repoTarget);
  const args = [
    '--template=""',
    '-c', 'init.templateDir=""',
    '-c', 'protocol.ext.allow=never',
    isLocal ? '-c protocol.file.allow=always' : '-c protocol.file.allow=never',
    '-c', 'core.hooksPath=NUL',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.symlinks=false',
    '-c', 'transfer.fsckObjects=true',
    '-c', 'fetch.fsckObjects=true',
    '-c', 'receive.fsckObjects=true'
  ];
  return args.filter(Boolean).join(' ');
}

/**
 * Extracts and quarantines an archive buffer or file safely.
 */
export function quarantineArchive(
  archiveInput: Buffer | string,
  caseId: string,
  options: SafeWriterOptions = {},
  currentDepth = 1
): QuarantineResult {
  const quarantineDir = getQuarantineCaseDir(caseId);
  if (!fs.existsSync(quarantineDir)) {
    fs.mkdirSync(quarantineDir, { recursive: true });
  }

  const maxFiles = options.maxFiles ?? 50000;
  const maxTotalBytes = options.maxTotalBytes ?? (1024 * 1024 * 1024); // 1 GB default
  const maxDepth = options.maxDepth ?? 3;

  const findings: TrapcheckFinding[] = [];
  const inconclusive: TrapcheckInconclusive[] = [];
  const neutralized: NeutralizedEntry[] = [];
  const reasons: string[] = [];

  const buffer = typeof archiveInput === 'string' ? fs.readFileSync(archiveInput) : archiveInput;

  // Check nesting depth cap (ARC-003)
  if (currentDepth > maxDepth) {
    inconclusive.push({
      code: 'ARC-003',
      file: `archive_depth_${currentDepth}`,
      why: `Archive nesting depth ${currentDepth} exceeds maximum limit of ${maxDepth}`
    });
    return {
      caseId,
      quarantineDir,
      filesCount: 0,
      totalBytesWritten: 0,
      findings,
      inconclusive,
      neutralized,
      verdict: 'unsure',
      reasons: [`Archive nesting depth exceeded (${currentDepth} > ${maxDepth})`]
    };
  }

  let entries: ZipEntry[] = [];
  try {
    entries = parseZipBuffer(buffer);
  } catch (err: any) {
    if (err.message && err.message.includes('ARC-004')) {
      inconclusive.push({
        code: 'ARC-004',
        file: 'archive.zip',
        why: 'Password-protected or unsupported archive format'
      });
      return {
        caseId,
        quarantineDir,
        filesCount: 0,
        totalBytesWritten: 0,
        findings,
        inconclusive,
        neutralized,
        verdict: 'unsure',
        reasons: ['Encrypted or password-protected archive (ARC-004)']
      };
    }
    inconclusive.push({
      code: 'ARC-009',
      file: 'archive.zip',
      why: `Failed to parse archive: ${err.message}`
    });
    return {
      caseId,
      quarantineDir,
      filesCount: 0,
      totalBytesWritten: 0,
      findings,
      inconclusive,
      neutralized,
      verdict: 'unsure',
      reasons: ['Archive parser error (ARC-009)']
    };
  }

  // Pre-validate all entries for Zip-Slip (ARC-001)
  for (const entry of entries) {
    const val = validateSafePath(entry.fileName);
    if (!val.safe) {
      // Immediate CRITICAL REJECT: do not extract anything!
      const snippetHash = crypto.createHash('sha256').update(entry.fileName).digest('hex');
      findings.push({
        ruleId: 'ARC-001',
        severity: 'CRITICAL',
        file: entry.fileName,
        line: null,
        snippetHash,
        excerpt: entry.fileName.slice(0, 200),
        plain: val.reason || 'Zip-slip directory traversal attempt detected',
        confidence: 'confirmed'
      });
      return {
        caseId,
        quarantineDir,
        filesCount: 0,
        totalBytesWritten: 0,
        findings,
        inconclusive,
        neutralized,
        verdict: 'reject',
        reasons: [`Zip-slip entry detected: ${entry.fileName}`]
      };
    }
  }

  let totalBytes = 0;
  let fileCount = 0;
  const existingPaths = new Set<string>();

  for (const entry of entries) {
    if (entry.fileName.endsWith('/') || entry.fileName.endsWith('\\')) {
      continue; // directory entry
    }

    if (fileCount >= maxFiles) {
      inconclusive.push({
        code: 'ARC-007',
        file: entry.fileName,
        why: `Total file count reached limit of ${maxFiles}`
      });
      break;
    }

    const uncompressed = entry.uncompressedSize;
    if (totalBytes + uncompressed > maxTotalBytes) {
      inconclusive.push({
        code: 'ARC-007',
        file: entry.fileName,
        why: `Decompression reached size limit of ${maxTotalBytes} bytes`
      });
      break;
    }

    let data: Buffer;
    try {
      data = entry.getData();
    } catch (err: any) {
      inconclusive.push({
        code: 'ARC-009',
        file: entry.fileName,
        why: `Error extracting entry: ${err.message}`
      });
      continue;
    }

    totalBytes += data.length;
    fileCount++;

    const sanitized = sanitizeEntryPath(entry.fileName, existingPaths, options);

    if (sanitized.isReserved) {
      findings.push({
        ruleId: 'ARC-005',
        severity: 'HIGH',
        file: entry.fileName,
        line: null,
        snippetHash: crypto.createHash('sha256').update(entry.fileName).digest('hex'),
        excerpt: `Windows reserved name renamed to ${sanitized.safeRelPath}`,
        plain: 'Windows reserved device name detected and renamed',
        confidence: 'confirmed'
      });
    }

    if (sanitized.isStream) {
      findings.push({
        ruleId: 'ARC-005',
        severity: 'HIGH',
        file: entry.fileName,
        line: null,
        snippetHash: crypto.createHash('sha256').update(entry.fileName).digest('hex'),
        excerpt: `Alternate data stream stripped: ${entry.fileName}`,
        plain: 'Alternate Data Stream syntax stripped',
        confidence: 'confirmed'
      });
    }

    if (sanitized.isCollision) {
      findings.push({
        ruleId: 'ARC-006',
        severity: 'HIGH',
        file: entry.fileName,
        line: null,
        snippetHash: crypto.createHash('sha256').update(entry.fileName).digest('hex'),
        excerpt: `Case-collision resolved: ${sanitized.safeRelPath}`,
        plain: 'Case collision resolved to unique name',
        confidence: 'confirmed'
      });
    }

    // Check PAY-010: Executable/binary content by magic or extension
    const isPE = data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a; // 'MZ'
    if (isPE || sanitized.neutralized) {
      findings.push({
        ruleId: 'PAY-010',
        severity: 'HIGH',
        file: entry.fileName,
        line: null,
        snippetHash: crypto.createHash('sha256').update(data.subarray(0, 64)).digest('hex'),
        excerpt: `Binary payload neutralized to ${sanitized.safeRelPath}`,
        plain: 'Executable binary file neutralized with .nlt extension',
        confidence: 'confirmed'
      });
    }

    if (sanitized.neutralized) {
      neutralized.push({
        original: entry.fileName,
        renamedTo: sanitized.safeRelPath
      });
    }

    // Write file safely
    safeWriteEntry(quarantineDir, sanitized.safeRelPath, data, sanitized.neutralized);

    // If entry is a nested zip, extract recursively if under depth limit
    if (sanitized.safeRelPath.toLowerCase().endsWith('.zip')) {
      const nestedResult = quarantineArchive(data, caseId, options, currentDepth + 1);
      findings.push(...nestedResult.findings);
      inconclusive.push(...nestedResult.inconclusive);
      neutralized.push(...nestedResult.neutralized);
    }
  }

  // Determine verdict
  let verdict: 'reject' | 'unsure' | 'pass' = 'pass';
  if (findings.some(f => f.severity === 'CRITICAL')) {
    verdict = 'reject';
  } else if (findings.some(f => f.severity === 'HIGH') || inconclusive.length > 0) {
    verdict = 'unsure';
  }

  return {
    caseId,
    quarantineDir,
    filesCount: fileCount,
    totalBytesWritten: totalBytes,
    findings,
    inconclusive,
    neutralized,
    verdict,
    reasons
  };
}

/**
 * Git acquisition without checkout through safe writer.
 */
export function quarantineGit(
  repoUrlOrPath: string,
  caseId: string,
  options: SafeWriterOptions = {}
): QuarantineResult {
  const quarantineDir = getQuarantineCaseDir(caseId);
  const tempBare = path.join(quarantineDir, '.bare');
  if (!fs.existsSync(quarantineDir)) {
    fs.mkdirSync(quarantineDir, { recursive: true });
  }

  const findings: TrapcheckFinding[] = [];
  const inconclusive: TrapcheckInconclusive[] = [];
  const neutralized: NeutralizedEntry[] = [];
  const reasons: string[] = [];

  try {
    const trimmed = repoUrlOrPath.trim();
    if (
      trimmed.startsWith('-') ||
      trimmed.includes('--upload-pack') ||
      trimmed.includes('--receive-pack') ||
      trimmed.toLowerCase().startsWith('ext::') ||
      trimmed.toLowerCase().startsWith('file://')
    ) {
      findings.push({
        ruleId: 'GIT-001',
        severity: 'CRITICAL',
        file: repoUrlOrPath,
        line: null,
        snippetHash: crypto.createHash('sha256').update(repoUrlOrPath).digest('hex'),
        excerpt: repoUrlOrPath.slice(0, 200),
        plain: 'Disallowed git URL scheme or parameter injection attempt (TC-196)',
        confidence: 'confirmed'
      });
      return {
        caseId,
        quarantineDir,
        filesCount: 0,
        totalBytesWritten: 0,
        findings,
        inconclusive,
        neutralized,
        verdict: 'reject',
        reasons: ['Disallowed git URL scheme or parameter injection attempt (TC-196)']
      };
    }

    const isLocalDir = fs.existsSync(repoUrlOrPath) && fs.statSync(repoUrlOrPath).isDirectory();
    const hasGit = isLocalDir && fs.existsSync(path.join(repoUrlOrPath, '.git'));

    if (isLocalDir && !hasGit) {
      // Local uninitialized folder acquisition: safely quarantine entries
      const existingPaths = new Set<string>();
      let totalBytes = 0;
      const fileList: string[] = [];

      function walk(dir: string, base: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const rel = (base ? `${base}/${entry.name}` : entry.name).replace(/\\/g, '/');
          const full = path.join(dir, entry.name);

          // Disallow copying .git/hooks or executing scripts within
          if (rel.startsWith('.git/hooks') || rel.includes('/.git/hooks')) {
            continue;
          }

          // Check symlink boundary escape
          try {
            const lstat = fs.lstatSync(full);
            if (lstat.isSymbolicLink()) {
              const target = fs.realpathSync(full);
              const resolvedRoot = path.resolve(repoUrlOrPath);
              if (!target.startsWith(resolvedRoot)) {
                findings.push({
                  ruleId: 'ARC-001',
                  severity: 'CRITICAL',
                  file: rel,
                  line: null,
                  snippetHash: crypto.createHash('sha256').update(rel).digest('hex'),
                  excerpt: `Symlink points outside intake root: ${target}`,
                  plain: 'Symbolic link traversal out of intake boundary blocked',
                  confidence: 'confirmed'
                });
                continue;
              }
            }
          } catch {}

          if (entry.isDirectory()) {
            walk(full, rel);
          } else {
            fileList.push(rel);
            const data = fs.readFileSync(full);
            totalBytes += data.length;
            const sanitized = sanitizeEntryPath(rel, existingPaths, options);
            safeWriteEntry(quarantineDir, sanitized.safeRelPath, data, sanitized.neutralized);
            if (sanitized.neutralized) {
              neutralized.push({ original: rel, renamedTo: sanitized.safeRelPath });
            }
          }
        }
      }

      walk(repoUrlOrPath, '');

      return {
        caseId,
        quarantineDir,
        filesCount: fileList.length,
        totalBytesWritten: totalBytes,
        findings,
        inconclusive,
        neutralized,
        verdict: 'pass',
        reasons
      };
    }

    const cloneArgs = getHardenedGitArgs(repoUrlOrPath);
    const bareArgs = getHardenedGitArgs(tempBare);

    // Clone bare with --no-checkout and hardened flags
    execSync(`git clone --bare --no-checkout --no-recurse-submodules ${cloneArgs} "${repoUrlOrPath}" "${tempBare}"`, {
      stdio: 'ignore'
    });

    // List all files from HEAD
    const lsTreeOut = execSync(`git -C "${tempBare}" ${bareArgs} ls-tree -r --name-only HEAD`, {
      encoding: 'utf8'
    });

    const fileList = lsTreeOut.split('\n').map(l => l.trim()).filter(Boolean);
    const existingPaths = new Set<string>();
    let totalBytes = 0;

    for (const relPath of fileList) {
      const val = validateSafePath(relPath);
      if (!val.safe) {
        findings.push({
          ruleId: 'ARC-001',
          severity: 'CRITICAL',
          file: relPath,
          line: null,
          snippetHash: crypto.createHash('sha256').update(relPath).digest('hex'),
          excerpt: relPath,
          plain: val.reason || 'Directory traversal detected in git tree',
          confidence: 'confirmed'
        });
        continue;
      }

      // Read content from git object
      const fileData = execSync(`git -C "${tempBare}" ${bareArgs} show "HEAD:${relPath}"`, {
        maxBuffer: 50 * 1024 * 1024
      });

      totalBytes += fileData.length;

      // TC-197: Hostile submodule or gitattributes filter command execution check (GIT-003)
      const lowerRel = relPath.toLowerCase();
      if (lowerRel === '.gitmodules' || lowerRel === '.gitattributes') {
        const text = fileData.toString('utf8');
        if (/update\s*=\s*!/i.test(text) || /filter\s*=.*(?:cmd|sh|bash|powershell|curl)/i.test(text)) {
          findings.push({
            ruleId: 'GIT-003',
            severity: 'CRITICAL',
            file: relPath,
            line: null,
            snippetHash: crypto.createHash('sha256').update(text).digest('hex'),
            excerpt: text.slice(0, 200),
            plain: 'Hostile submodule update command or gitattributes filter detected (GIT-003 / TC-197)',
            confidence: 'confirmed'
          });
        }
      }

      const sanitized = sanitizeEntryPath(relPath, existingPaths, options);

      safeWriteEntry(quarantineDir, sanitized.safeRelPath, fileData, sanitized.neutralized);

      if (sanitized.neutralized) {
        neutralized.push({ original: relPath, renamedTo: sanitized.safeRelPath });
      }
    }

    // Clean up temporary bare repo so only the safe working copy remains
    try {
      fs.rmSync(tempBare, { recursive: true, force: true });
    } catch {
      // ignore
    }

    let verdict: 'reject' | 'unsure' | 'pass' = 'pass';
    if (findings.some(f => f.severity === 'CRITICAL')) {
      verdict = 'reject';
    } else if (findings.some(f => f.severity === 'HIGH') || inconclusive.length > 0) {
      verdict = 'unsure';
    }

    return {
      caseId,
      quarantineDir,
      filesCount: fileList.length,
      totalBytesWritten: totalBytes,
      findings,
      inconclusive,
      neutralized,
      verdict,
      reasons
    };
  } catch (err: any) {
    inconclusive.push({
      code: 'ARC-009',
      file: repoUrlOrPath,
      why: `Git acquisition error: ${err.message}`
    });
    return {
      caseId,
      quarantineDir,
      filesCount: 0,
      totalBytesWritten: 0,
      findings,
      inconclusive,
      neutralized,
      verdict: 'unsure',
      reasons: [err.message]
    };
  }
}

/**
 * Removes quarantined case directory cleanly with no leftover file handles.
 */
export function deleteQuarantinedCase(caseId: string): void {
  const qDir = getQuarantineCaseDir(caseId);
  if (fs.existsSync(qDir)) {
    // Retry up to 3 times in case of Windows file lock latency
    for (let i = 0; i < 3; i++) {
      try {
        fs.rmSync(qDir, { recursive: true, force: true });
        break;
      } catch {
        // Sleep a tiny bit
        const end = Date.now() + 50;
        while (Date.now() < end) {}
      }
    }
  }
}

/**
 * Promotes quarantined files to destination, restoring neutralized extensions.
 */
export function promoteQuarantinedCase(caseId: string, destinationDir: string): void {
  const qDir = getQuarantineCaseDir(caseId);
  if (!fs.existsSync(qDir)) {
    throw new Error(`Quarantine case not found: ${caseId}`);
  }

  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  function copyDir(src: string, dest: string) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      let destName = entry.name;
      // Restore .nlt extension
      if (destName.endsWith('.nlt')) {
        destName = destName.slice(0, -4);
      }
      const destPath = path.join(dest, destName);

      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDir(qDir, destinationDir);
}
