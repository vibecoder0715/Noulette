# IMPLEMENTATION

What was built for Noulette v1.0.0 (M1 to M6), and how it is tested. Run everything with `bun test`. The installer is built with `bun run build` and written to `dist/Noulette-Setup-1.0.0.exe`.

## v1.0.1: follow the agent's folder, more AI APIs, landing page (done)

Status: implemented. 66 tests pass (new: `tests/routing.test.ts` TC-R-01..09, TC-M5-11..12). Installer: `dist/Noulette-Setup-1.0.1.exe`. Site: `docs/` on GitHub Pages. The build script now copies the installer that matches the version (it used to pick up a stale 1.0.0 file).

**Root cause of "go build one first".** The MCP never looks at the agent's workspace. It inspects only the `projectPath` the agent passes. The copied Inspect prompt pinned the desktop's "active project", which was a leftover test folder (`%TEMP%\nl-kiro-live`, 2 files). So every agent inspected that folder, whichever repo it had open. Two smaller bugs make it worse: `listRepoFiles` treats an empty `git ls-files` result as final, and it applies the 50k-file cap before filtering for source files.

**1. Engine: resolve the repo per call (backend only).**
- `projectPath` becomes optional on every tool.
- Each call resolves the folder in this order:
  1. The agent's workspace folders, read from MCP `roots/list` (when the client supports it).
  2. The MCP process's working directory (agents start servers in the workspace).
  3. An explicit `projectPath`, which is accepted only if it is inside one of those folders. If no workspace is known, it is accepted as-is.
- The repo root is snapped to the nearest `git rev-parse --show-toplevel`.
- Multiple folders or repos:
  - Each git repo found in the workspace roots (one level of nesting) is a separate project. Each keeps its own state, run, `PLAN.md`, `VULN.md` and `LOGS.md`, keyed by path as now.
  - With one candidate, it is used directly.
  - With several candidates and no `projectPath`, the tool returns the list and asks the agent to choose one. It never guesses.
- Quarantine between repos:
  - Scanning a parent folder skips nested repos (any subfolder with its own `.git`).
  - Noulette files (`PLAN.md`, `VULN.md`, `LOGS.md`, `FUTURE.md`, `.noulette/`) are read and written only at the resolved project root, never inside a nested repo.
- Empty check fixes:
  - An empty git listing falls back to walking the folder.
  - Files are filtered for source code before the cap.
  - If the folder is empty but contains repos, the tool lists those repos instead of the "go build one first" message.
- Prompts no longer pin a path. They say that Noulette detects the open folder.

**2. Desktop: simpler frontend.**
- Remove the Project panel (picker and Add folder) from Settings.
- Home "Start inspection" always copies the prompt.
- Projects appear on their own once an agent uses them. The Notifications status follows the most recently used project.
- "Add to my project" (AGENTS.md) becomes "Copy snippet" only.

**3. Tests, rebuild, install.**
- Update TC-M2-01. Add tests for roots, cwd fallback, an outside path being redirected, multi-repo choice, nested-repo isolation and the empty-listing fallback.
- Bump the version to 1.0.1 and run `bun run build`, which writes `dist/Noulette-Setup-1.0.1.exe`.
- Install it silently and launch it on this PC.

**4. Landing page (GitHub Pages, single page).**
- Static `docs/index.html` (HTML, CSS, a little JS), served by Pages from `master` `/docs`.
- The cover is the desktop Home page: the photo slideshow, "Problems in your app? Let's find out." and pill buttons. The primary button becomes **Install .exe**.
- Below the cover: what it does, how it works (3 steps), supported agents (logos), and a footer with GitHub and license links.
- Light and dark themes, responsive.
- The .exe is served from GitHub Releases, not from the Pages repo. The installer is about 96 MB and Pages/git limit files to 100 MB. The button links to `releases/latest/download/Noulette-Setup.exe`, so it always gets the newest version.
- The README Download link points to the same URL and to the page.
- Fonts: Anthropic Sans and Anthropic Serif (owner's choice).

**5. Log AI: more API dialects.**
- Today only OpenAI-compatible `/chat/completions` is supported. That covers Grafilab's OpenAI surface (`https://llm.grafilab.ai/v1`), Ollama, LM Studio, vLLM, OpenRouter, Groq and Gemini's `/openai` endpoint.
- Add dialects, detected from the pasted config or chosen in the basic fields:
  - Anthropic Messages (`/v1/messages`, `x-api-key`, `max_tokens`). This covers Claude and Grafilab's Anthropic surface (`https://llm.grafilab.ai`).
  - Google Gemini native (`generateContent`).
  - Azure OpenAI (`api-key` header, deployment, `api-version`).
- Custom headers are picked up from `default_headers` or curl `-H`.
- Clearer error messages. For Grafilab, 429 `insufficient_quota` is reported as low credits and 403 `billing_currency_unset` as a missing billing country.
- Not covered: AWS Bedrock SigV4 signing. Bedrock's OpenAI-compatible endpoint works instead.

## Architecture

| Part | Where | Notes |
|---|---|---|
| Engine (one exe) | `packages/engine/src/cli.ts` | Commands: `mcp` (stdio), `daemon`, `cloud`, `token`, `version`. Compiled with `bun build --compile`. |
| MCP server | `src/mcp/server.ts` | Built on the official SDK. It exposes 12 tools and 2 prompts (`inspect`, `build`). No tool can approve anything; approvals happen only in the app. |
| Daemon | `src/daemon/` | Listens on `127.0.0.1` only. Bearer token, Host and Origin checks. JSON API plus the UI (for viewing in Chrome). Scheduler ticks. Remote MCP over HTTP (`/mcp`) is off by default. |
| State | `src/core/` | SQLite in `%APPDATA%\noulette` (WAL mode). Secrets are encrypted with DPAPI. Ed25519 signing for approvals. A project registry keyed by path. |
| Desktop | `apps/desktop` | Tauri 2 shell: starts the hidden daemon, tray icon (Open/Quit), single instance, opt-in start at sign-in. Closing the window keeps it in the tray. |
| Packaging | `scripts/build-dist.ts` | A single unsigned NSIS installer for the current user. Contains the engine sidecar, scanners, rule packs and UI. |

## Features by milestone

- **M1: core.**
  - Settings with validation; the interval accepts only 5/15/30/45/60/75/90/120.
  - Notifications use Critical, Warning and Info. Resolved is a state, not a level. Read and resolved items move to History; sticky items stay. The "Suppress" toggle is supported.
  - Six pages wired to real data.
- **M2: Inspect.**
  - Intake questions are saved to `PLAN.md` in Q/A form. Test passwords stay in `.noulette/intake.json` and never go into `PLAN.md`.
  - An empty repo (fewer than 3 source files or under 100 lines of code) is rejected with the exact required message.
  - These run in parallel: gitleaks (working tree and git history), osv-scanner (OSV/GHSA) with CISA KEV, opengrep-core with Noulette's MIT rule packs (`rules/sast`, 9 languages), mock detection and PostHog detection. Licenses (askalono) and SBOM (CycloneDX) follow.
  - DAST runs on localhost only, using the start command from the intake. If it can't run, the result is marked "not tested".
  - The AI stages run in a fixed order: logic, then feasibility, then legal. Each stage has a strict checklist. Submissions are checked against a Zod schema, every item must be covered, and every file, line and evidence string must exist. Extra effort runs 3 passes.
  - Output: `VULN.md` (TL;DR table, collapsed Details, check results, JSON). Plain-language labels come from a 53-label taxonomy. Approvals and Notifications are created. `VULN.md`, `LOGS.md` and `.noulette/` are added to `.gitignore`.
  - Untrusted-data delimiters wrap all repo text, `PLAN.md` content and logs.
- **M3: BUILD.**
  - `noulette_build` errors unless an inspection is complete. It requires a signed, untampered approval, unless auto-approve is on.
  - Verify re-runs the same scanner per finding, then the project tests, then a regression diff. On success, `VULN.md` is archived to `.noulette/history` and an "All clear" header is written.
  - "Needs you" items are never marked Resolved.
  - Loop caps: Standard allows 2 rounds, Extra 3. Auto-approve always caps at 3.
  - Auto-approve works on a `noulette/fix-<timestamp>` branch. It refuses to start with uncommitted changes, never merges, and shows copyable merge and discard commands in a sticky notification and on the Home card. Merging or discarding is detected and the notification is resolved.
  - Plans from `LOGS.md` and download-guard items are never auto-approved.
- **M4: Download guard.**
  - The watcher covers Downloads, the active project and folders you add.
  - Safe items are logged only. Uncertain items are quarantined and added to Approvals quietly. Critical items are quarantined and raise an alert that deep-links to the approval.
  - Releasing a critical item requires typing `allow`.
  - `noulette_safe_clone` clones into quarantine with hooks, submodules, LFS and symlinks off.
- **M5: Monitoring.**
  - Sources: PostHog (events and `$exception` via HogQL) and GA4 aggregates.
  - Data is redacted, then deterministic detectors run: error-rate z-score, new error type, traffic drop or spike, and saturation against the user count in `PLAN.md`. The AI runs only when a detector fires or for the daily digest.
  - After sleep, one coalesced catch-up pass runs. Results appear as "Early warnings" with evidence and a confidence level, are written to `LOGS.md`, and go to Approvals.
  - AI config: you can paste a config (Python, JS, JSON, `.env` or curl) and it is tried first, falling back to the basic fields. Pasted keys move to encrypted storage. Errors show in Notifications and on the page.
  - Cloud worker and Dockerfile (bring your own deploy): every item it produces is Ed25519-signed and verified before use. Unsigned or tampered items are rejected and logged.
  - Eval set: `bun run eval:logs` runs synthetic scenarios plus a LogHub replay.
- **M6: Plans, Connect, packaging and UI.**
  - `FUTURE.md` covers the planned user count, then x10, x100 and x1000.
  - One-click Connect backs up and merges the config for Kiro, Claude Code, Cline, OpenCode (JSONC, comments kept), Codex (TOML) and Antigravity.
  - README rewritten in 5 parts.

## UI layout (latest)

- **Home:** hero and slideshow only. Start inspection copies the prompt.
- **Notifications:** status card (Ready / Inspecting / Needs approval / branch waiting with merge and discard commands), then the TL;DR and alerts.
- **Settings:** a Project panel at the top.
- **Prompts:** the Inspect and Build prompts include the MCP server configuration with the absolute engine path for this machine. They also include the project's absolute path and the full tool-calling path, so an agent can connect from the prompt alone.
- **Plans:** shows short chips per stage. The full steps stay in FUTURE.md and `noulette_future` for agents.
- **Walkthrough:** one-paragraph "what it does", then every Settings component in simple words.
- **App icon:** the brown emblem only (no wordmark), on a transparent background.
- **Typography:** the original Anthropic Sans and Anthropic Serif are restored, from the first commit. Body text has a 0.2px stroke, about 20% thicker.

## UI style

The UI is rebuilt on the original design system: the original `index.css` tokens and classes are kept, and new rules are written in the same style.

- **Colours and type:** black and white, 1px card borders, serif 800 headings with a text stroke, 13px body text.
- **Sidebar:** brown `#66371F` wordmark (the emblem when collapsed), collapse button, 27px icons, square red badges with the brown glow, the "Exploring how to use Noulette?" bubble and the three-way theme switch.
- **Home and Manual head pages:** the original photo slideshows (5 images and 4 images), the 56px serif hero headline and pill buttons. The guide content itself is words only.
- **Fonts:** system fonts only, because the bundled Anthropic fonts were removed. Headings use Georgia and the body uses Segoe UI.
- **App icon:** the Noulette emblem on cream, from `src-tauri/icons-src/noulette-icon.svg`, applied to every icon size and the favicon.

## Test cases

All 55 automated tests pass. `tests/e2e-installed.test.ts` also runs against the installed app.

| ID | Checks |
|---|---|
| TC-M1-01..05 | Settings validation, DPAPI secrets kept out of API state, project registry, notification History/sticky/dedupe, signed approvals with tamper detection |
| TC-M1-06..08 | API rejects a missing token, a foreign Host or Origin, and non-JSON writes; settings-changed alert; remote MCP off by default and token-protected |
| TC-M1-09 | MCP stdio conformance: initialize, tools, prompts, errors, no approve tool |
| TC-M2-01..03 | Exact empty-repo message, `PLAN.md` Q/A format and updates, taxonomy has 40 to 60 labels |
| TC-M2-04..08 | gitleaks (value redacted), osv-scanner with fixed versions, opengrep SQL and command injection, rule packs load, mock and PostHog detection |
| TC-M2-09..12 | Valid submission accepted; 11 malformed or unverifiable cases rejected; feasibility and legal need a human; untrusted delimiters |
| TC-M2-13..14 | DAST on localhost: headers, stack trace and X-Powered-By found; "not tested" when it can't run; non-local hosts refused |
| TC-M2-15..16 | Full inspection over MCP (stage order, `VULN.md`, `.gitignore`, SBOM, approvals, alerts); Extra effort runs 3 passes |
| TC-M3-01..03 | BUILD waits for approval and rejects tampered ones; scanner, tests and regression all pass with archive and All clear; regressions or failing tests stop at the cap of 2 |
| TC-M3-04..07 | Auto-approve needs git and a clean tree; branch only, never merged, copy commands, sticky card, merge detected; discard detected; hard cap of 3 |
| TC-M4-01..06 | Guard rules (critical, uncertain, clean); folder scanned as one unit; watcher behaves quietly; `allow` gate and no auto-release; delete; safe clone blocks a bad repo |
| TC-M5-01..04 | Pasted Grafilab example plus JSON, `.env`, JS and curl configs; pasted config then basic-field fallback with errors shown; `temperature`/`top_p` and the no-JSON-mode retry; key moved to encrypted storage |
| TC-M5-05..10 | Redaction; detectors at 90% or better precision and recall; early warning with evidence and plan; interval and coalesced catch-up; PostHog errors surfaced; signed cloud items |
| TC-M6-01..05 | `FUTURE.md` ladder; JSON agent merge with backup; Codex TOML; OpenCode JSONC; broken configs never overwritten |
| TC-E2E-01..02 | Installed engine serves MCP and finds the bundled scanners; installed daemon serves the UI and API on 127.0.0.1 |

**Manual and real checks:**

- `scripts/verify-agents.ts` completed a handshake using the real config files for Kiro, Cline, OpenCode and Antigravity on this machine.
- Kiro called `noulette_inspect` live.
- `scripts/ui-snapshots.ts` renders every page in light and dark for visual review.

**Pending:**

- Real PostHog end-to-end check. It needs your PostHog project ID and a personal API key, entered in Settings or `NOULETTE_POSTHOG_KEY`.
- GA4 has only been tested against fakes.
- Codex and Claude Code are covered by contract tests only.
