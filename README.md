# Noulette

Finds problems in your app before it ships, and keeps watching it after launch.

## 1. Download

**[Download Noulette for Windows (Noulette-Setup-1.0.0.exe)](https://example.com/noulette/releases/latest/Noulette-Setup-1.0.0.exe)** (placeholder link until the release host is chosen)

One installer for everything: the desktop app, the MCP server your coding agent talks to, and the bundled scanners. Windows 10/11 x64, installs for the current user, no admin rights or extra runtimes needed.

The installer is not code-signed yet, so Windows SmartScreen will show "Windows protected your PC". Click **More info**, then **Run anyway**. Only do this for a file you downloaded from the official link.

## 2. Mission and vision

AI coding agents write code quickly, but they rarely check whether it is safe, follows the app's own rules, or can handle its real users. Noulette adds that check. It runs next to the agent you already use and holds it to strict rules: every problem must point at real code, every fix is verified again, and nothing changes without your approval.

The goal is to make AI-powered discovery of software problems dependable and simple. Results come as a short TL;DR in plain words, with the technical detail available when you want it.

## 3. Core functions

- **Inspect.** Asks a few questions about your app (goals, expected users, data) and saves the answers to `PLAN.md`. It then runs, in order:
  - Security: leaked keys (gitleaks), known-vulnerable packages (osv-scanner with OSV/GHSA, plus the CISA list of actively exploited flaws), code rules (opengrep), an SBOM, and an optional live test against your app on localhost.
  - Business logic: your agent role-plays several users against a strict checklist.
  - Feasibility: user count against your stack, fake or placeholder code, outside connections, pipeline, reliability and monitoring.
  - Licenses: missing license, conflicting packages, risky assets. This is not legal advice.

  The report goes to `VULN.md`, which is kept out of git. A plain summary appears in Notifications and Approvals.
- **BUILD.** Type `BUILD` in your agent after approving. It fixes the approved items. Noulette then re-runs the scanner that found each one, runs your tests and checks for new problems. When all three pass, the report is archived and marked all clear. Problems that need a person, such as rotating a key, a stack decision or a license choice, are listed as "Needs you" and are never marked resolved.
- **Auto-approve (optional).** Inspect and fix in one go, on a separate `noulette/fix-...` branch that is never merged for you. You get copyable merge and discard commands. It will not start while you have uncommitted changes, and it stops at a hard limit of fix rounds.
- **Download guard.** Watches Downloads, the active project and folders you add. Suspicious files go to quarantine and you decide in Approvals. Releasing something marked dangerous requires typing `allow`. Agents can also call `noulette_safe_clone` instead of `git clone`.
- **After launch.** Reads PostHog events and errors and Google Analytics 4 numbers every 5 to 120 minutes. Deterministic detectors look for error spikes, new errors, traffic drops or spikes, and growth past your planned user count. Your AI model explains what it finds and drafts a plan, written to `LOGS.md` as early warnings with evidence and a confidence level. Data is redacted first, and these plans are never fixed without your approval.
- **Plans.** `FUTURE.md` lists what your app needs at your planned user count, then at 10x, 100x and 1000x.

Code rules use real syntax trees (AST) for JavaScript/TypeScript, Python, Java, Kotlin, C#, Go, PHP, Ruby and Rust. For other languages, Noulette checks secrets, dependencies and licenses, and your agent does the logic and feasibility review. The curated rule pack is Noulette's own (MIT). It does not include Semgrep registry rules, because their license does not allow redistribution.

## 4. Environments

- **Coding agents (MCP).** Kiro, Claude Code, Cline, OpenCode, Codex and Antigravity get one-click Connect in Settings. It backs up the agent's config and merges into it, so your other servers are kept. Any other MCP client can run `noulette-engine.exe mcp` over stdio.
- **Analytics.** PostHog (a personal API key with Query read access) and Google Analytics 4 (a service account).
- **AI for log analysis.** Any OpenAI-compatible endpoint, including cloud APIs and local models such as Ollama or LM Studio. Paste a config snippet (Python, JS, JSON, `.env` or curl), fill in the base URL, model and key, or both. The pasted config is tried first, then the basic fields.
- **Local first.** Everything runs on your PC in a hidden background service with a tray icon. You can optionally start it at sign-in. Keys are encrypted for your Windows account with DPAPI. You can open the UI in Chrome at `http://127.0.0.1` with your access code. A token-protected HTTP MCP endpoint exists but is off by default.
- **Cloud worker (bring your own).** `packages/engine/Dockerfile` runs the same monitoring core on your own server while your PC is off. Every item it creates is signed with Ed25519, and the desktop app rejects anything unsigned or tampered. It never sees your repository.
- **Build from source.** Requires Bun 1.3, Rust and git. Run `bun install`, then `bun test`, then `bun run build`. The installer is written to `dist/`.

## 5. Special thanks and license

Thanks to the projects Noulette builds on: [opengrep](https://github.com/opengrep/opengrep) (LGPL-2.1), [gitleaks](https://github.com/gitleaks/gitleaks) (MIT), [osv-scanner](https://github.com/google/osv-scanner) (Apache-2.0), [askalono](https://github.com/jpeddicord/askalono) (Apache-2.0), [Tauri](https://tauri.app), [Bun](https://bun.sh), the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk), [OSV.dev](https://osv.dev), the [GitHub Advisory Database](https://github.com/advisories), the [CISA KEV catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) and [LogHub](https://github.com/logpai/loghub). The bundled scanners are unmodified upstream binaries under their own licenses.

Noulette is released under the [MIT License](LICENSE.md).
