# Noulette

Finds problems in your app before it ships, and keeps watching it after launch.
Pitch deck: **[Pitch deck](https://canva.link/3hbctynfjxnnnkd)**
[![M8ven Score](https://m8ven.ai/badge/mcp/vibecoder0715-noulette-7aos4x?v=85ce596a492bcf79c466188ebae9d9ac)](https://m8ven.ai/mcp/vibecoder0715-noulette-7aos4x?s=readme)

## 1. Download

**[Download Noulette for Windows (latest .exe)](https://github.com/vibecoder0715/Noulette/releases/latest/download/Noulette-Setup.exe)** · [Website](https://vibecoder0715.github.io/Noulette/)  
*(Always the newest release from [GitHub Releases](https://github.com/vibecoder0715/Noulette/releases/latest) | v1.0.4 SHA-256: `0504efc54f07d6ba57c4163a899b5609152b8fec00669becf91bf5df8c7e3c0e`)*

One installer for everything: the desktop app, the MCP server your coding agent talks to, and the bundled scanners. Windows 10/11 x64, installs for the current user, no admin rights or extra runtimes needed.

The installer is not code-signed yet, so Windows SmartScreen will show "Windows protected your PC". Click **More info**, then **Run anyway**. Only do this for a file you downloaded from the official link.

## 2. Mission and vision

Noulette does not just check, detect problems and propose decisions about your code before pushing to production. When enabled with an API key, it actively checks logs, inspects and detects or predicts log issues, and proposes fixes directly in your notifications for approval. Nothing changes without your permission.

## 3. Core functions

- **Inspect**: Scans your code for security leaks, vulnerable packages, and logic flaws before launch.
- **BUILD**: Fixes approved issues, re-runs tests, and verifies the solution automatically.
- **Auto-Approve**: Optionally inspects and fixes issues on an isolated branch.
- **Download Guard**: Quarantines suspicious files and downloads to keep your project safe.
- **Active Log Monitoring**: Watches errors and traffic, predicts problems, and proposes fixes for approval.
- **Future Plans**: Maps out scaling requirements as your user base grows.

## 4. Environments

- **Coding Agents**: Connects with Antigravity, Claude Code, Cline, Cursor, and any MCP tool.
- **Analytics**: Supports PostHog and Google Analytics 4.
- **AI Models**: Works with OpenAI-compatible APIs and local models like Ollama.
- **Local & Private**: Runs locally on your PC. Your data and keys stay secure.
- **Cloud Worker**: Optional self-hosted worker to monitor logs when your PC is offline.
- **Build from Source**: Runs on Bun and Rust (`bun install`, `bun test`, `bun run build`).

## 5. Sample training script

Sample training script for the agent that **monitor, detect and predict the logs** are as in ([trainings](trainings/) folder), details described in ([trainings/README.md](trainings/README.md)).

**Note**: the data is mock and not actual. For actual fine-tuning, please customize the script and use real data.

## 6. Special thanks and license

Thanks to the projects Noulette builds on: [opengrep](https://github.com/opengrep/opengrep) (LGPL-2.1), [gitleaks](https://github.com/gitleaks/gitleaks) (MIT), [osv-scanner](https://github.com/google/osv-scanner) (Apache-2.0), [askalono](https://github.com/jpeddicord/askalono) (Apache-2.0), [Tauri](https://tauri.app), [Bun](https://bun.sh), the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk), [OSV.dev](https://osv.dev), the [GitHub Advisory Database](https://github.com/advisories), the [CISA KEV catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) and [LogHub](https://github.com/logpai/loghub). The bundled scanners are unmodified upstream binaries under their own licenses.

Noulette is released under the [MIT License](LICENSE.md).
