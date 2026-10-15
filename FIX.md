# Noulette Patch & Release Plan (`FIX.md`)

Repository: [vibecoder0715/Noulette](https://github.com/vibecoder0715/Noulette)

This document outlines three issues identified in **Noulette**, the proposed code fixes for each issue, and the step-by-step instructions to rebuild/update the Windows `.exe` binaries (`noulette-engine` sidecar and `Noulette-Setup.exe` installer) and push the updated code and release artifacts to GitHub.

## Overview of Issues & Fixes

| \# | Issue Category | Affected Files | Root Cause | Proposed Fix |
| :---- | :---- | :---- | :---- | :---- |
| **1** | **Windows Code Signing & SmartScreen Block** | `apps/desktop/src-tauri/tauri.conf.json`, `scripts/build-dist.ts`, `scripts/build-sidecar.ts`, `README.md` | Downloaded `Noulette-Setup.exe` and the bundled `noulette-engine` sidecar are built without Authenticode SHA-256 signatures or RFC 3161 timestamps, triggering Windows Defender SmartScreen (*"Windows protected your PC"*) when downloaded with Mark-of-the-Web (`Zone.Identifier`). | Configure SHA-256 \+ RFC 3161 timestamping in `tauri.conf.json`, add `signWindowsBinary()` in `scripts/build-dist.ts` to sign both the compiled sidecar `.exe` and outer NSIS setup `.exe`, and provide a GitHub Actions signing/release workflow. |
| **2** | **Missing MCP Tool Annotations (12/12 tools)** | `packages/engine/src/mcp/server.ts`, `packages/engine/src/guard/index.ts`, `packages/engine/src/plans/index.ts`, `packages/engine/src/monitor/index.ts` | None of the 12 registered MCP tools declare `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), causing OpenAI's directory and MCP security scanners to reject or penalize the tools. | Add an explicit `annotations` object with boolean `true`/`false` values for all four hints on all 12 `server.registerTool(...)` calls matching each handler's actual behavior. |
| **3** | **Shell Command Execution in Production Code** | `packages/engine/src/inspect/dast.ts` (line 56\) | `startApp()` invokes `spawn(spec.command, { cwd: root, shell: true, ... })` on line 56, executing the start command through a system shell. | Reject shell control metacharacters (\`/\[;& |

## Issue 1: Windows Code Signing Issues on Download

### Problem

When a user downloads [Noulette-Setup.exe](https://github.com/vibecoder0715/Noulette/releases/latest/download/Noulette-Setup.exe) from GitHub Releases on Windows 10/11, the browser attaches a `Zone.Identifier` Alternate Data Stream (Mark of the Web). Currently:

1. `apps/desktop/src-tauri/tauri.conf.json` has no `digestAlgorithm`, `timestampUrl`, or certificate configuration under `bundle.windows`.  
2. `scripts/build-dist.ts` builds an unsigned NSIS installer and bundles an unsigned Bun sidecar (`apps/desktop/src-tauri/binaries/noulette-engine-x86_64-pc-windows-msvc.exe` compiled by `scripts/build-sidecar.ts`).  
3. Because neither executable carries an Authenticode signature or RFC 3161 countersignature, Windows Defender SmartScreen blocks execution with *"Windows protected your PC"*, and Windows 11 Smart App Control / Defender can block the child sidecar process when spawned.

### Proposed Fix

#### 1\. Update `apps/desktop/src-tauri/tauri.conf.json`

Add SHA-256 digest algorithm, Microsoft ACS RFC 3161 timestamp server, and silent WebView2 bootstrapper config under `bundle.windows`:

{

  "\$schema": "https\://schema.tauri.app/config/2",

  "productName": "Noulette",

  "version": "1.0.3",

  "identifier": "com.noulette.desktop",

  "build": {

    "beforeDevCommand": "bun run dev",

    "devUrl": "http\://localhost:5173",

    "beforeBuildCommand": "bun run build",

    "frontendDist": "../dist"

  },

  "app": {

    "withGlobalTauri": false,

    "windows": \[

      {

        "label": "main",

        "title": "Noulette",

        "width": 1200,

        "height": 820,

        "minWidth": 900,

        "minHeight": 600,

        "resizable": true

      }

    \],

    "security": {

      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'"

    }

  },

  "bundle": {

    "active": true,

    "targets": \["nsis"\],

    "publisher": "Noulette",

    "license": "MIT",

    "shortDescription": "Find problems in your app before it ships, and watch it after launch.",

    "externalBin": \["binaries/noulette-engine"\],

    "resources": {

      "resources/scanners/": "resources/scanners/",

      "resources/rules/": "resources/rules/",

      "resources/ui/": "resources/ui/"

    },

    "icon": \["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"\],

    "windows": {

      "certificateThumbprint": null,

      "digestAlgorithm": "sha256",

      "timestampUrl": "http\://timestamp.acs.microsoft.com",

      "tsp": true,

      "webviewInstallMode": {

        "type": "downloadBootstrapper",

        "silent": true

      },

      "nsis": {

        "installMode": "currentUser",

        "languages": \["English"\],

        "displayLanguageSelector": false

      }

    }

  }

}

#### 2\. Update `scripts/build-dist.ts`

Update `scripts/build-dist.ts` so that:

- It signs `noulette-engine-x86_64-pc-windows-msvc.exe` right after `scripts/build-sidecar.ts` finishes (before Tauri bundles it into the installer).  
- It signs and verifies the outer NSIS installer (`dist/Noulette-Setup-<version>.exe`).  
- It also writes `dist/Noulette-Setup.exe` (matching the direct download URL in `README.md`) and outputs the exact SHA-256 checksum to `dist/Noulette-Setup-<version>.exe.sha256` and the console.  
- It supports **Azure Trusted Signing** (`AZURE_CODESIGN_DLIB` \+ `AZURE_CODESIGN_METADATA`), **Windows Certificate Store / EV Token** (`WINDOWS_CERT_THUMBPRINT`), or **PFX Certificate** (`WINDOWS_PFX_PATH` \+ `WINDOWS_PFX_PASSWORD`), while still allowing unsigned local builds when no signing environment variables are set.

/\*\*

 \* Builds and Authenticode-signs the single Windows installer (NSIS):

 \*  1\. download \+ verify scanners (pinned SHA-256)

 \*  2\. build the UI

 \*  3\. copy rule packs and the UI (for "View in Chrome") into Tauri resources

 \*  4\. compile and sign the engine sidecar

 \*  5\. tauri build \-\> dist/Noulette-Setup-\<version\>.exe (signed \+ SHA-256 verified)

 \*

 \* Supported Windows code-signing environment variables:

 \*  \- Azure Trusted Signing: AZURE\_CODESIGN\_DLIB and AZURE\_CODESIGN\_METADATA

 \*  \- Windows Cert Store / Hardware Token: WINDOWS\_CERT\_THUMBPRINT

 \*  \- PFX File: WINDOWS\_PFX\_PATH and WINDOWS\_PFX\_PASSWORD

 \*/

import fs from 'node:fs';

import path from 'node:path';

import crypto from 'node:crypto';

import { execFileSync } from 'node:child\_process';

import { fetchScanners } from './fetch-scanners.ts';

const root \= path.resolve(import.meta.dir, '..');

const desktop \= path.join(root, 'apps', 'desktop');

const res \= path.join(desktop, 'src-tauri', 'resources');

const bun \= process.execPath;

const run \= (args: string\[\], cwd: string, env?: NodeJS.ProcessEnv) \=\>

  execFileSync(bun, args, { cwd, stdio: 'inherit', env: env ? { ...process.env, ...env } : process.env });

export function signWindowsBinary(filePath: string): boolean {

  if (process.platform \!== 'win32' || \!fs.existsSync(filePath)) return false;

  const signtool \= process.env.SIGNTOOL\_PATH || 'signtool.exe';

  const dlib \= process.env.AZURE\_CODESIGN\_DLIB;

  const dlibMeta \= process.env.AZURE\_CODESIGN\_METADATA;

  const thumbprint \= process.env.WINDOWS\_CERT\_THUMBPRINT || process.env.TAURI\_SIGNING\_WINDOWS\_CERTIFICATE\_THUMBPRINT;

  const pfxPath \= process.env.WINDOWS\_PFX\_PATH;

  const pfxPassword \= process.env.WINDOWS\_PFX\_PASSWORD;

  const timestampUrl \= process.env.WINDOWS\_TIMESTAMP\_URL || 'http\://timestamp.acs.microsoft.com';

  let signArgs: string\[\] | null \= null;

  if (dlib && dlibMeta) {

    signArgs \= \[

      'sign', '/v', '/debug',

      '/fd', 'SHA256',

      '/tr', timestampUrl,

      '/td', 'SHA256',

      '/dlib', dlib,

      '/dmdf', dlibMeta,

      filePath

    \];

  } else if (thumbprint) {

    signArgs \= \[

      'sign', '/v',

      '/sha1', thumbprint,

      '/fd', 'SHA256',

      '/tr', timestampUrl,

      '/td', 'SHA256',

      filePath

    \];

  } else if (pfxPath) {

    signArgs \= \[

      'sign', '/v',

      '/f', pfxPath,

      ...(pfxPassword ? \['/p', pfxPassword\] : \[\]),

      '/fd', 'SHA256',

      '/tr', timestampUrl,

      '/td', 'SHA256',

      filePath

    \];

  }

  if (\!signArgs) {

    console.warn(\`\[sign\] Skipping Authenticode signing for \${path.basename(filePath)} (no signing credentials configured).\`);

    return false;

  }

  console.log(\`\[sign\] Signing \${filePath}...\`);

  execFileSync(signtool, signArgs, { stdio: 'inherit' });

  execFileSync(signtool, \['verify', '/pa', '/v', filePath\], { stdio: 'inherit' });

  return true;

}

await fetchScanners();

run(\['run', 'build'\], desktop);

for (const \[src, dst\] of \[\[path.join(root, 'rules'), path.join(res, 'rules')\], \[path.join(desktop, 'dist'), path.join(res, 'ui')\]\]) {

  fs.rmSync(dst, { recursive: true, force: true });

  fs.cpSync(src, dst, { recursive: true });

}

run(\['run', path.join(root, 'scripts', 'build-sidecar.ts')\], root);

// Sign the compiled sidecar before Tauri bundles it into the NSIS installer

const sidecar \= path.join(desktop, 'src-tauri', 'binaries', 'noulette-engine-x86\_64-pc-windows-msvc.exe');

signWindowsBinary(sidecar);

// Pass certificate thumbprint through to Tauri if provided

const tauriEnv: NodeJS.ProcessEnv \= {};

if (process.env.WINDOWS\_CERT\_THUMBPRINT && \!process.env.TAURI\_SIGNING\_WINDOWS\_CERTIFICATE\_THUMBPRINT) {

  tauriEnv.TAURI\_SIGNING\_WINDOWS\_CERTIFICATE\_THUMBPRINT \= process.env.WINDOWS\_CERT\_THUMBPRINT;

}

run(\['x', 'tauri', 'build'\], desktop, tauriEnv);

const version \= JSON.parse(fs.readFileSync(path.join(desktop, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;

const nsisDir \= path.join(desktop, 'src-tauri', 'target', 'release', 'bundle', 'nsis');

// Older installers stay in this folder, so pick the one for this exact version.

const setup \= fs.readdirSync(nsisDir).find((f) \=\> f.endsWith('-setup.exe') && f.includes(\`\_\${version}\_\`));

if (\!setup) throw new Error('NSIS installer not found');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

const final \= path.join(root, 'dist', \`Noulette-Setup-\${version}.exe\`);

fs.copyFileSync(path.join(nsisDir, setup), final);

// Sign the outer NSIS installer executable

signWindowsBinary(final);

// Also copy to dist/Noulette-Setup.exe for the latest release link and emit SHA-256

const latestAlias \= path.join(root, 'dist', 'Noulette-Setup.exe');

fs.copyFileSync(final, latestAlias);

const sha256 \= crypto.createHash('sha256').update(fs.readFileSync(final)).digest('hex');

fs.writeFileSync(\`\${final}.sha256\`, \`\${sha256}  Noulette-Setup-\${version}.exe\\n\`, 'utf8');

console.log(\`installer: \${final} (\${(fs.statSync(final).size / 1e6).toFixed(1)} MB)\`);

console.log(\`sha256: \${sha256}\`);

## Issue 2: MCP Tool Annotations (`12/12 tools missing one or more hints`)

### Problem

None of the 12 MCP tools registered across `packages/engine/src/mcp/server.ts`, `packages/engine/src/guard/index.ts`, `packages/engine/src/plans/index.ts`, and `packages/engine/src/monitor/index.ts` declare `annotations`. OpenAI's directory and MCP static/runtime validators require all four boolean hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) to be explicitly set on every tool so hosts know whether to prompt the user before invocation.

### Proposed Fix

Set all four boolean hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) explicitly on all 12 tools according to each handler's actual behavior:

| Tool Name | File | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` | Rationale |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| `noulette_inspect` | `packages/engine/src/mcp/server.ts` | `true` | `false` | `true` | `false` | Checks local repository state and returns intake questions (`inspectStart`) without modifying repo files. |
| `noulette_save_plan` | `packages/engine/src/mcp/server.ts` | `false` | `false` | `true` | `false` | Writes `PLAN.md`, runs scanners, and writes `VULN.md`; safe to re-run with the same `projectPath`. |
| `noulette_submit_findings` | `packages/engine/src/mcp/server.ts` | `false` | `false` | `true` | `false` | Validates and records AI stage findings into local state and `VULN.md`. |
| `noulette_labels` | `packages/engine/src/mcp/server.ts` | `true` | `false` | `true` | `false` | Returns the static in-memory `LABELS` array. |
| `noulette_probe` | `packages/engine/src/mcp/server.ts` | `false` | `false` | `false` | `false` | Sends an arbitrary HTTP request (including `POST`/`DELETE`) strictly limited to `127.0.0.1`/`localhost`. |
| `noulette_status` | `packages/engine/src/mcp/server.ts` | `true` | `false` | `true` | `false` | Reads current inspection and build status (`inspectionStatus`, `buildStatus`). |
| `noulette_build` | `packages/engine/src/mcp/server.ts` | `false` | `false` | `true` | `false` | Initializes build state (and safety Git branch when auto-approve is active) and returns items to fix. |
| `noulette_verify` | `packages/engine/src/mcp/server.ts` | `false` | `false` | `true` | `false` | Re-runs scanners and project test suite to update finding statuses. |
| `noulette_safe_clone` | `packages/engine/src/guard/index.ts` | `false` | `false` | `false` | `true` | Clones an external repository URL over the network into quarantine, scans it, and moves it to `destination`. |
| `noulette_future` | `packages/engine/src/plans/index.ts` | `false` | `false` | `true` | `false` | Generates and writes `FUTURE.md` in the local repository. |
| `noulette_log_plans` | `packages/engine/src/monitor/index.ts` | `true` | `false` | `true` | `false` | Reads user-approved production fix plans from `LOGS.md`. |
| `noulette_log_plan_done` | `packages/engine/src/monitor/index.ts` | `false` | `false` | `true` | `false` | Marks an approved production log fix plan as completed. |

#### 1\. `packages/engine/src/mcp/server.ts` (Lines 57–115 replacement)

  server.registerTool('noulette\_inspect', {

    title: 'Start inspection',

    description: 'Step 1 of an inspection. Checks the repository is not empty, then returns intake questions to ask the user. projectPath is optional (the folder open in this workspace is used); if the workspace has several repositories, Noulette lists them so the user can choose.',

    inputSchema: { projectPath },

    annotations: {

      readOnlyHint: true,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async ({ projectPath }) \=\> guarded(() \=\> inspectStart(projectPath)));

  server.registerTool('noulette\_save\_plan', {

    title: 'Save intake answers and scan',

    description: 'Saves the user\\'s answers into PLAN.md, then runs the security scanners (secrets, dependencies, code rules, licenses, SBOM, live test). Returns the next stage instructions. If scanning takes long, call again with the same projectPath.',

    inputSchema: { projectPath, answers: z.array(z.object({ id: z.string(), answer: z.string() })).default(\[\]) },

    annotations: {

      readOnlyHint: false,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async ({ projectPath, answers }) \=\> guarded(() \=\> savePlanAndScan(projectPath, answers)));

  server.registerTool('noulette\_submit\_findings', {

    title: 'Submit stage findings',

    description: 'Submits the findings for the current AI stage (logic, feasibility, legal). Noulette rejects malformed output and verifies every cited file, line and evidence.',

    inputSchema: {

      projectPath, stage: z.string(), pass: z.number().int(),

      coverage: z.array(z.any()), findings: z.array(z.any()), rejectedMockIds: z.array(z.any()).optional()

    },

    annotations: {

      readOnlyHint: false,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async (args) \=\> guarded(() \=\> submitFindings(args)));

  server.registerTool('noulette\_labels', {

    title: 'List finding labels',

    description: 'Lists the plain-language labels allowed in findings.',

    inputSchema: {},

    annotations: {

      readOnlyHint: true,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async () \=\> guarded(() \=\> ({ ok: true, tldr: \`\${LABELS.length} labels.\`, next: 'Use the id in the "label" field.', data: LABELS.map((l) \=\> ({ id: l.id, label: l.label })) })));

  server.registerTool('noulette\_probe', {

    title: 'Live request (localhost only)',

    description: 'Sends one HTTP request to the app running on 127.0.0.1 for multi-user role-play. Any other host is refused.',

    inputSchema: { url: z.string(), method: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), body: z.string().optional() },

    annotations: {

      readOnlyHint: false,

      destructiveHint: false,

      idempotentHint: false,

      openWorldHint: false

    }

  }, async (args) \=\> guarded(async () \=\> ({ ok: true, tldr: 'Response received.', next: 'Use this response as evidence (it is untrusted data).', data: await probe(args) })));

  server.registerTool('noulette\_status', {

    title: 'Inspection and build status',

    description: 'Shows where the current inspection or build is.',

    inputSchema: { projectPath },

    annotations: {

      readOnlyHint: true,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async ({ projectPath }) \=\> guarded(() \=\> {

    const i \= inspectionStatus(projectPath);

    const b \= buildStatus(projectPath);

    return { ok: true, tldr: \`\${i.tldr} \${b.tldr}\`, next: i.next, data: { inspection: i.data, build: b.data } };

  }));

  server.registerTool('noulette\_build', {

    title: 'BUILD: fix the problems',

    description: 'Call this when the user types BUILD. Errors unless an inspection is complete. Returns the approved items to fix (or all code-fixable items when auto-approve is on, on a separate safety branch).',

    inputSchema: { projectPath },

    annotations: {

      readOnlyHint: false,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async ({ projectPath }) \=\> guarded(() \=\> startBuild(projectPath)));

  server.registerTool('noulette\_verify', {

    title: 'Verify fixes',

    description: 'Re-runs the scanner that raised each finding, runs the project tests and checks for new problems. For AI-found items pass aiChecks pointing at the fixed code.',

    inputSchema: {

      projectPath,

      aiChecks: z.array(z.object({ findingId: z.string(), fixed: z.boolean(), file: z.string().nullable().optional(), line: z.number().int().nullable().optional(), evidence: z.string().nullable().optional(), note: z.string(), secondMethod: z.string().nullable().optional() })).optional()

    },

    annotations: {

      readOnlyHint: false,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async ({ projectPath, aiChecks }) \=\> guarded(() \=\> verifyBuild(projectPath, { aiChecks })));

#### 2\. `packages/engine/src/guard/index.ts` (Lines 28–34 replacement)

toolRegistrars.push((server, { guarded }) \=\> {

  server.registerTool('noulette\_safe\_clone', {

    title: 'Clone a repository safely',

    description: 'Use instead of "git clone". Clones into quarantine with hooks/submodules/LFS off, scans for malware, then strips bad setup before moving to target destination.',

    inputSchema: { url: z.string(), destination: z.string().describe('Absolute folder where the repo should end up.') },

    annotations: {

      readOnlyHint: false,

      destructiveHint: false,

      idempotentHint: false,

      openWorldHint: true

    }

  }, async ({ url, destination }) \=\> guarded(() \=\> safeClone(url, destination)));

});

#### 3\. `packages/engine/src/plans/index.ts` (Lines 27–33 replacement)

toolRegistrars.push((server, { guarded }) \=\> {

  server.registerTool('noulette\_future', {

    title: 'Scale plan (FUTURE.md)',

    description: 'Writes FUTURE.md: what the app needs at the planned user count from PLAN.md, then at 10x, 100x and 1000x.',

    inputSchema: { projectPath: projectPathSchema },

    annotations: {

      readOnlyHint: false,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async ({ projectPath }) \=\> guarded(() \=\> generateFuture(projectPath)));

});

#### 4\. `packages/engine/src/monitor/index.ts` (Lines 143–154 replacement)

toolRegistrars.push((server, { guarded }) \=\> {

  server.registerTool('noulette\_log\_plans', {

    title: 'Approved production fixes',

    description: 'Returns production early-warning plans (from LOGS.md) that the user approved in the app. Unapproved ones are never shown here.',

    inputSchema: { projectPath: projectPathSchema },

    annotations: {

      readOnlyHint: true,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async ({ projectPath }) \=\> guarded(() \=\> getApprovedLogPlans(projectPath)));

  server.registerTool('noulette\_log\_plan\_done', {

    title: 'Mark a production fix done',

    description: 'Call after fixing an approved production plan.',

    inputSchema: { projectPath: projectPathSchema, planId: z.string(), summary: z.string() },

    annotations: {

      readOnlyHint: false,

      destructiveHint: false,

      idempotentHint: true,

      openWorldHint: false

    }

  }, async ({ projectPath, planId, summary }) \=\> guarded(() \=\> completeLogPlan(projectPath, planId, summary)));

});

## Issue 3: Shell Command Execution (`packages/engine/src/inspect/dast.ts:56`)

### Problem

In `packages/engine/src/inspect/dast.ts`, `startApp()` spawns the target application's dev server using `shell: true` at line 56:

  const child \= spawn(spec.command, {

    cwd: root,

    shell: true,

    windowsHide: true,

    env: { ...process.env, PORT: String(spec.port), NODE\_ENV: 'development', BROWSER: 'none' },

    stdio: \['ignore', 'pipe', 'pipe'\]

  });

Static security analyzers flag `shell: true` as a shell command execution risk (`1 call in production code run through a shell (src/inspect/dast.ts:56)`).

### Proposed Fix

1. Import `splitCommand` from `../core/proc.js` (which already exists in `packages/engine/src/core/proc.ts` to split command strings into `argv` arrays without invoking a shell).  
2. Reject shell chaining/redirection metacharacters (`/[;&|`\$\>\<\\r\\n\]/`) in both` parseStartAnswer()`and`startApp()\`.  
3. Resolve Windows package-manager shims (`npm`, `npx`, `pnpm`, `yarn`, `corepack` \-\> `.cmd` on `win32`) and call `spawn(bin, args, { cwd: root, windowsHide: true, ... })` with `shell: true` removed.  
4. Attach `child.on('error', ...)` so non-existent executables (`ENOENT`) fail cleanly without throwing an unhandled `'error'` event.

#### `packages/engine/src/inspect/dast.ts` (Lines 1–76 replacement)

import { spawn, type ChildProcess } from 'node:child\_process';

import net from 'node:net';

import { killTree, splitCommand } from '../core/proc.js';

import { labelById } from './taxonomy.js';

import type { Finding, ScannerStatus } from './types.js';

type Raw \= Omit\<Finding, 'id' | 'fingerprint' | 'status'\>;

/\*\*

 \* Live testing. Runs ONLY against 127.0.0.1 with the start command the user typed during intake

 \* (recorded in Noulette's own database, never read from repo files, so a hostile repo cannot

 \* smuggle in a command). If the app cannot start, the result is "not tested".

 \*/

export interface StartSpec {

  command: string;

  port: number;

}

const SHELL\_META\_RE \= /\[;&|\`\$\>\<\\r\\n\]/;

export function parseStartAnswer(answer: string | null): StartSpec | null {

  if (\!answer) return null;

  const portM \= /(?:port|:)\\s\*(\\d{2,5})\\b/i.exec(answer);

  const port \= portM ? parseInt(portM\[1\], 10\) : 3000;

  let command \= answer

    .replace(/\\s\*(on|at|using)?\\s\*port\\s\*\\d{2,5}.\*/i, '')

    .replace(/^\['"\`\]|\['"\`\]\$/g, '')

    .replace(/\['"\`\]/g, '')

    .trim();

  if (\!command || /^(none|no|skip|n\\/a|-)\$/i.test(command)) return null;

  if (SHELL\_META\_RE.test(command)) return null;

  if (port \< 1 || port \> 65535\) return null;

  return { command, port };

}

const running \= new Map\<string, { child: ChildProcess; port: number; startedAt: number; log: string\[\] }\>();

function portOpen(port: number): Promise\<boolean\> {

  return new Promise((resolve) \=\> {

    const s \= net.connect({ host: '127.0.0.1', port }, () \=\> {

      s.destroy();

      resolve(true);

    });

    s.on('error', () \=\> resolve(false));

    setTimeout(1000, () \=\> {

      s.destroy();

      resolve(false);

    });

  });

}

function resolveExecutable(bin: string): string {

  if (process.platform \=== 'win32' && /^(npm|npx|pnpm|yarn|corepack)\$/i.test(bin)) {

    return \`\${bin}.cmd\`;

  }

  return bin;

}

export async function startApp(root: string, spec: StartSpec, waitMs \= 60\_000): Promise\<{ ok: boolean; reason?: string; reused?: boolean }\> {

  if (await portOpen(spec.port)) {

    // Something already listens there (the user's dev server). Use it, but do not own it.

    return { ok: true, reused: true };

  }

  stopApp(root);

  if (SHELL\_META\_RE.test(spec.command)) {

    return { ok: false, reason: 'Start command contains disallowed shell metacharacters.' };

  }

  const argv \= splitCommand(spec.command);

  if (argv.length \=== 0\) {

    return { ok: false, reason: 'No executable found in start command.' };

  }

  const \[rawBin, ...args\] \= argv;

  const bin \= resolveExecutable(rawBin);

  const log: string\[\] \= \[\];

  let spawnErr: Error | null \= null;

  const child \= spawn(bin, args, {

    cwd: root,

    windowsHide: true,

    env: { ...process.env, PORT: String(spec.port), NODE\_ENV: 'development', BROWSER: 'none' },

    stdio: \['ignore', 'pipe', 'pipe'\]

  });

  const keep \= (d: Buffer) \=\> {

    log.push(String(d));

    if (log.length \> 200\) log.shift();

  };

  child.on('error', (err) \=\> {

    spawnErr \= err;

    log.push(err.message);

  });

  child.stdout?.on('data', keep);

  child.stderr?.on('data', keep);

  running.set(root, { child, port: spec.port, startedAt: Date.now(), log });

  const deadline \= Date.now() \+ waitMs;

  while (Date.now() \< deadline) {

    if (spawnErr || child.exitCode \!== null) {

      stopApp(root);

      return { ok: false, reason: \`The app stopped right away. Last output: \${log.join('').slice(-400)}\` };

    }

    if (await portOpen(spec.port)) return { ok: true };

    await new Promise((r) \=\> setTimeout(r, 750));

  }

  stopApp(root);

  return { ok: false, reason: \`Nothing answered on port \${spec.port} within \${Math.round(waitMs / 1000)} seconds.\` };

}

## Rebuild the `.exe` and Push to GitHub

Because the MCP server (`noulette-engine.exe`) is compiled into a standalone Windows binary sidecar and bundled inside the NSIS installer (`Noulette-Setup.exe`), patching the TypeScript source files alone is not enough for end users — **you must rebuild both `.exe` binaries and update the GitHub Release asset**.

### Step 1: Apply the Fixes and Run Tests

\# 1\. Run the test suite to verify the MCP annotations and DAST spawn changes

bun test

### Step 2: Rebuild and Update the Windows `.exe` Binaries

Set your Windows code-signing credentials (if signing with Azure Trusted Signing, a certificate thumbprint, or a `.pfx` certificate) and run the full build pipeline:

\# Optional: Configure Windows Authenticode signing credentials before building

\# Option A (Azure Trusted Signing):

\# \$env:AZURE\_CODESIGN\_DLIB \= "C:\\path\\to\\Azure.CodeSigning.Dlib.dll"

\# \$env:AZURE\_CODESIGN\_METADATA \= "C:\\path\\to\\metadata.json"

\#

\# Option B (Cert Thumbprint in Windows Cert Store):

\# \$env:WINDOWS\_CERT\_THUMBPRINT \= "YOUR\_CERT\_SHA1\_THUMBPRINT"

\#

\# Option C (PFX Certificate):

\# \$env:WINDOWS\_PFX\_PATH \= "C:\\path\\to\\cert.pfx"

\# \$env:WINDOWS\_PFX\_PASSWORD \= "YOUR\_PFX\_PASSWORD"

\# 1\. Recompile the engine sidecar executable:

\#    Outputs packages/engine/dist/noulette-engine.exe

\#    and copies to apps/desktop/src-tauri/binaries/noulette-engine-x86\_64-pc-windows-msvc.exe

bun run build:engine

\# 2\. Rebuild the full desktop NSIS installer executable:

\#    Outputs dist/Noulette-Setup-1.0.3.exe, dist/Noulette-Setup.exe, and prints the new SHA-256 hash

bun run build

### Step 3: Update the SHA-256 Checksum in `README.md`

Copy the new `sha256:` value printed by `bun run build` (or from `dist/Noulette-Setup-1.0.3.exe.sha256`) and update line 10 of `README.md`:

\*(Always the newest release from \[GitHub Releases\](https\://github.com/vibecoder0715/Noulette/releases/latest) | v1.0.3 SHA-256: \`\<NEW\_SHA256\_HASH\>\` )\*

### Step 4: Commit, Push to GitHub, and Update the GitHub Release `.exe`

\# 1\. Stage all patched source files, build scripts, and README.md

git add \\

  packages/engine/src/mcp/server.ts \\

  packages/engine/src/guard/index.ts \\

  packages/engine/src/plans/index.ts \\

  packages/engine/src/monitor/index.ts \\

  packages/engine/src/inspect/dast.ts \\

  apps/desktop/src-tauri/tauri.conf.json \\

  scripts/build-dist.ts \\

  README.md \\

  FIX.md

\# 2\. Commit and push to main

git commit \-m "fix: add 4 MCP tool annotations to all 12 tools, remove shell:true in dast, add Windows Authenticode signing"

git push origin main

\# 3\. Upload and replace the rebuilt Noulette-Setup.exe on GitHub Releases

gh release upload v1.0.3 \\

  dist/Noulette-Setup.exe \\

  dist/Noulette-Setup-1.0.3.exe \\

  dist/Noulette-Setup-1.0.3.exe.sha256 \\

  \--clobber