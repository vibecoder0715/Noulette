# Noulette Real-PC Execution & Test Plan

> **Objective:** Validate `dist\noulette.exe` live on the host PC across Desktop GUI mode, IPC invocation, CLI execution, quarantine cloning, and OWASP Juice Shop threat detection while the application executable is actively running.

---

## 1. Test Architecture & Environment
- **Host OS:** Windows 10/11 x64
- **Target Executable:** `dist\noulette.exe` (104 MB Tauri 2 + Bun embedded release)
- **Extracted Engine Sidecar:** `%APPDATA%\noulette\bin\noulette-engine.exe` (94 MB)
- **Active Workspace Directory:** `c:\Users\User\Downloads\noulette`

---

## 2. Concise Test Plan Matrix

| Test ID | Test Category | Target Feature / Flow | Expected Outcome | Execution Method |
|---|---|---|---|---|
| **TP-01** | **Process & GUI Launch** | Launch `dist\noulette.exe` on Windows desktop | Process spawns with active PID, creates GUI window handle, extracts engine | PowerShell `Start-Process` + `Get-Process` |
| **TP-02** | **Engine Extraction** | Verify `%APPDATA%\noulette\bin\noulette-engine.exe` | Extracted binary exists, size matches embedded payload, permissions valid | Filesystem assertion |
| **TP-03** | **Tauri IPC: Status & Keys** | Call `get_engine_status` & `get_key_status` | Returns `ready: true`, sidecar path, and Ed25519 key status | IPC invocation harness |
| **TP-04** | **Tauri IPC: Workspace** | Call `get_active_projects` & `set_active_project` | Project path switches and persists in `%APPDATA%\noulette\projects.json` | IPC invocation harness |
| **TP-05** | **Tauri IPC: Decisions** | Call `record_decision` & `sign_decision` | Validates ULID format, enforces justification rules (≥10 chars, ≤90d), signs | IPC invocation harness |
| **TP-06** | **Tauri IPC: Receipts** | Call `sign_receipt` | Issues signed release receipt with Ed25519 signature | IPC invocation harness |
| **TP-07** | **CLI Subprocess Forwarding**| Run `noulette.exe --version` & `noulette.exe --help` | Forwards CLI args from wrapper to engine without GUI error | Live CLI execution |
| **TP-08** | **CLI Gate: Clean Project**  | Run `noulette.exe scan` & `gate` on clean repo | Passes release gate with 0 blocking findings | Live CLI execution |
| **TP-09** | **CLI Gate: Leaked Secret**  | Run `noulette.exe scan` & `gate` on repo with key | Blocks release gate with exit code 1 citing secret leak | Live CLI execution |
| **TP-10** | **Quarantine Clone Tool**    | Run `noulette.exe clone` / `noulette_clone` on safe repo | Bare clones into quarantine, scans with TrapCheck, outputs PASS | CLI & MCP tool call |
| **TP-11** | **Quarantine Attack Rejection**| Intercept clone containing pre-install / AGT backdoor | Traps malicious script, outputs REJECT with explicit rule IDs | CLI & MCP tool call |
| **TP-12** | **OWASP Juice Shop Catch**   | Scan Juice Shop security, logic, and scale flaws | Catches SQLi, XSS, JWT secret, negative cart, SQLite locks | Automated test fixture |
| **TP-13** | **Tests.py Edge Matrix**     | Run `tests/tests.py` test suite against engine rules | All edge cases across path traversal, LIF, AGT, CMD pass | Automated Python runner |

---

## 3. Step-by-Step Execution Protocol
1. **Launch Host Process:** Execute `dist\noulette.exe` in background, verify running PID.
2. **Execute Live Verification Suites:** While `noulette.exe` is running, execute tests TP-01 through TP-13.
3. **Capture Telemetry & Logs:** Verify process memory, log outputs, and receipts.
4. **Graceful Teardown:** Ensure test artifacts are cleaned and child processes terminated properly.
