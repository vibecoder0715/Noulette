import fs from 'node:fs';
import path from 'node:path';
import type { TrapcheckFinding, TrapcheckInconclusive } from '../schema/trapcheck.schema.js';

export interface SafeWriterOptions {
  maxFiles?: number;
  maxTotalBytes?: number;
  maxDecompressionRatio?: number;
  maxDepth?: number;
  neutralizeExecutables?: boolean;
}

export interface NeutralizedEntry {
  original: string;
  renamedTo: string;
}

export interface SafeExtractionResult {
  extractedCount: number;
  totalBytesWritten: number;
  findings: TrapcheckFinding[];
  inconclusive: TrapcheckInconclusive[];
  neutralized: NeutralizedEntry[];
  stoppedEarly: boolean;
  stopReason?: string;
}

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.lnk',
  '.msi', '.scr', '.pif', '.com', '.hta', '.cpl', '.wsf'
]);

export function isWindowsReserved(name: string): boolean {
  const baseName = name.split('.')[0].toUpperCase();
  return WINDOWS_RESERVED_NAMES.has(baseName);
}

/**
 * Validates path against Zip-Slip attacks (ARC-001).
 * Rejects '..', absolute paths, UNC paths, drive letters.
 */
export function validateSafePath(entryPath: string): { safe: boolean; reason?: string } {
  // Check NUL bytes (ARC-001 / TC-184)
  if (entryPath.includes('\0') || entryPath.includes('%00')) {
    return { safe: false, reason: 'NUL byte detected in zip entry (ARC-001 / ARC-013)' };
  }

  // Check Right-to-Left Override and Unicode control overrides (ARC-013 / TC-184)
  if (/[\u202A-\u202E\u2066-\u2069]/.test(entryPath)) {
    return { safe: false, reason: 'Right-to-left override character detected (ARC-013)' };
  }

  // Normalize slashes
  const normalized = entryPath.replace(/\\/g, '/');

  // Device paths, pipes, and UNC (TC-183)
  if (
    normalized.startsWith('//') ||
    normalized.startsWith('\\\\') ||
    normalized.startsWith('/') ||
    normalized.startsWith('//?/') ||
    normalized.startsWith('//./') ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    return { safe: false, reason: 'Absolute, drive letter, device or UNC path detected in zip entry (ARC-001)' };
  }

  // URL-decoded traversal check (TC-184: ..%2f, %2e%2e)
  let urlDecoded = entryPath;
  try {
    urlDecoded = decodeURIComponent(entryPath).replace(/\\/g, '/');
  } catch {}

  if (urlDecoded.includes('../') || urlDecoded.includes('/..') || urlDecoded === '..' || /\.\.%2f/i.test(entryPath) || /%2e%2e/i.test(entryPath)) {
    return { safe: false, reason: 'Directory traversal (..) detected in zip entry (ARC-001)' };
  }

  // Traversal '..'
  const parts = normalized.split('/');
  for (const part of parts) {
    if (part === '..') {
      return { safe: false, reason: 'Directory traversal (..) detected in zip entry (ARC-001)' };
    }
  }

  return { safe: true };
}

/**
 * Sanitizes an entry filename for Windows safety.
 * Handles reserved names (CON, AUX, etc.), Alternate Data Streams (:), trailing dots/spaces, 8.3 names, and neutralizing executables.
 */
export function sanitizeEntryPath(
  relPath: string,
  existingPaths: Set<string>,
  options: SafeWriterOptions = {}
): {
  safeRelPath: string;
  isReserved: boolean;
  isStream: boolean;
  isCollision: boolean;
  neutralized: boolean;
} {
  let normalized = relPath.replace(/\\/g, '/');
  let isStream = false;
  let isReserved = false;
  let isCollision = false;
  let neutralized = false;

  const segments = normalized.split('/');
  const sanitizedSegments: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i];

    // Check Alternate Data Streams (colon in filename)
    if (seg.includes(':')) {
      isStream = true;
      seg = seg.split(':')[0]; // Strip stream syntax
      if (!seg) seg = 'unnamed_stream';
    }

    // Strip trailing dots and spaces (TC-184)
    seg = seg.replace(/[\.\s]+$/, '');
    if (!seg) seg = 'safe_entry';

    // Handle 8.3 short names (TC-184: PROGRA~1)
    if (/[a-zA-Z0-9_]{1,6}~\d+/i.test(seg)) {
      seg = `safe_${seg.replace(/~/g, '_')}`;
    }

    // Check Windows reserved names
    if (isWindowsReserved(seg)) {
      isReserved = true;
      seg = `safe_${seg}`;
    }

    sanitizedSegments.push(seg);
  }

  normalized = sanitizedSegments.join('/');

  // Neutralize executables
  const ext = path.extname(normalized).toLowerCase();
  if (options.neutralizeExecutables !== false && EXECUTABLE_EXTENSIONS.has(ext)) {
    normalized = `${normalized}.nlt`;
    neutralized = true;
  }

  // Check case-insensitive collision on Windows (ARC-006)
  const lowerPath = normalized.toLowerCase();
  if (existingPaths.has(lowerPath)) {
    isCollision = true;
    const parsed = path.parse(normalized);
    let counter = 1;
    let candidate = `${parsed.dir ? parsed.dir + '/' : ''}${parsed.name}_collision_${counter}${parsed.ext}`;
    while (existingPaths.has(candidate.toLowerCase())) {
      counter++;
      candidate = `${parsed.dir ? parsed.dir + '/' : ''}${parsed.name}_collision_${counter}${parsed.ext}`;
    }
    normalized = candidate;
  }

  existingPaths.add(normalized.toLowerCase());

  return {
    safeRelPath: normalized,
    isReserved,
    isStream,
    isCollision,
    neutralized
  };
}

/**
 * Safe file writer: writes buffer to destination under targetDir, strictly preventing traversal.
 */
export function safeWriteEntry(
  targetDir: string,
  relPath: string,
  data: Buffer,
  neutralize = false
): string {
  const fullTarget = path.resolve(path.join(targetDir, relPath));
  const resolvedBase = path.resolve(targetDir);

  if (!fullTarget.startsWith(resolvedBase)) {
    throw new Error(`Security Violation: Path traversal outside target directory: ${relPath}`);
  }

  const dir = path.dirname(fullTarget);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullTarget, data, { mode: neutralize ? 0o444 : 0o666 });
  return fullTarget;
}
