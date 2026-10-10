# noulette — Additional Test Cases (TC-164 to TC-315) and Strengthening List

**Status:** PROPOSED v1.2. Not locked. Lock only after the user reviews it.
**Adds to:** the 163 cases in `TEST_CASES.md` / `cases.json`.
**Why this exists:** the first 163 cases check that each feature works. They mostly do not check that the product resists a hostile project, a hostile agent, a broken Windows machine, or its own mistakes. This file closes those gaps. It comes from reading the uploaded test files, the three implementation plans, and the review comments on both.

---

## 0. How to read this file

- **Pri**: `P0` must pass before the first release (a trust boundary, a false "all good", or data loss). `P1` must pass before a public beta. `P2` is hardening.
- **Fixtures** follow the existing rules: inert only, the word `CANARY`, loopback or TEST-NET addresses, fake names, no real malware, no real keys.
- **Positive-control rule (new).** Any test that asserts "nothing happened" (no file written, no process spawned, no hook run) must first show, in the same test, that a naive implementation would have caused it. A test that cannot fail proves nothing.
- **Real-shape rule (new).** Config fixtures must use the real documented shape of the tool they imitate (Claude Code settings, `.mcp.json`, VS Code settings, GitHub Actions). Verify each shape against the current tool documentation when writing the fixture.
- **No test may define the function it tests.** Tests import product code. A test that only compares a local constant with itself fails review.
- **Run the suite against the built `noulette-engine.exe`**, not only the TypeScript source (see TC-309).

Counts: 152 new cases, TC-164 to TC-315. P0: 68. P1: 83. P2: 1.

---

## 1. Defects found in the current registry and tests

These are facts found by checking the uploaded files. Fix them before relying on the lock.

| ID | Finding | Required action |
|---|---|---|
| R-1 | `cases.sha256` does not equal the SHA-256 of `cases.json`. I tried raw bytes, CRLF and LF, with and without a trailing newline, compact JSON, sorted keys, and indented JSON with and without ASCII escaping. None match. `matrix.sha256` and `repos.sha256` do match. | Decide one canonical form for the lock, write it down, regenerate once, and make `lock-tests --check` use exactly that form. Until then the lock proves nothing for `cases.json`. |
| R-2 | Five rows in `cases.json` have corrupted `expected` values: TC-021 (`cmd` plus a backtick), TC-023, TC-027, TC-031, TC-038 (`sh` plus a backtick). The cause is an unescaped pipe character inside the fixture text, which split the Markdown table cell. The same unescaped pipes are in `TEST_CASES.md`, so those rows also render wrongly. | Escape each pipe character with a backslash in the source table, or rewrite the fixture wording to avoid it. Make the generator escape-aware. Add TC-164. Regenerate `cases.json` and re-lock. |
| R-3 | The lock hash files sit beside the tests they protect, so the builder agent can edit a test and regenerate the hash in the same change. | Pin the expected hash somewhere the builder is told not to touch and CI reads from the base branch or from a value the user committed. See TC-165. |
| R-4 | Four Part 1 cases have no test in the uploaded files: TC-151, TC-153, TC-154, TC-163. They may exist elsewhere. | Confirm they exist. TC-166 enforces this automatically. |
| R-5 | `cases.json` has no priority, owner, or status field. | Add `priority`, `part`, and `status` so progress is measurable. |

---

## 2. Existing tests that are too weak (strengthen, no new ID)

Each of these passes today for reasons unrelated to the behavior named in its title.

| Existing | Why it is weak | Required change |
|---|---|---|
| TC-007 | The sentinel is checked at `tempDir/escape.txt`. Extraction happens deeper (inside `localapp`), so a one-level `../` lands elsewhere and a vulnerable extractor would still pass. | Search the whole temp tree for the escaped file name outside the extraction root. See TC-182. |
| TC-008 | `C:\sentinel` is checked, but only the plain drive-letter form is tried. | Add UNC, drive-relative, and device-path forms. See TC-183. |
| TC-015 | A hook placed in the source repo is never copied by `git clone`. I confirmed a naive clone does not write the sentinel either, so the test cannot fail. | Add a positive control using a template-directory hook. See TC-195. |
| TC-017 to TC-024 | Fixtures use invented shapes: a hook event called `postToolExecution`, a bare `command` string with arguments inside it, and a made-up VS Code key. Real tools use nested hook arrays, a split `command` and `args`, and a platform-suffixed key. A parser tuned to these fixtures can miss real files. | Use real shapes. See TC-201 to TC-203. |
| TC-029 | The fixture is built with the engine's own `encodeTagBlock`, so a symmetric bug in encode and decode passes. | Build the characters in the test with `String.fromCodePoint`. See TC-213. |
| TC-050, TC-051 | The tests read `candidateTreeHash`, not the `gitTreeHash` and `workingTreeHash` pair in the plan. Nothing tests CRLF, untracked files, or non-git folders. | Cover the pair. See TC-174 to TC-181. |
| TC-058 | Expects visibility `pushed-pending`, which is not in the finding schema's visibility values. | Add the value to the schema or change the test. One of them is wrong. |
| TC-059 to TC-069 | Five of the six fake AWS-style keys do not match the AWS pattern as I recall it from the gitleaks rule (16 characters from A–Z and 2–7, entropy of about 3 or more). The sixth matches but has entropy 0.57. The real gitleaks may not flag them. If the code uses its own fallback regex, the tests pass without exercising gitleaks. | Generate valid fake keys and add a positive control through the bundled binary. See TC-218. |
| TC-061 | Expects `where.file` to be the string `git-history`. The real file path and commit are lost. | Report the real path and commit hash in the finding. |
| TC-064, TC-065 | The title covers `.next/static` and `dist/`; only `.next/static` is tested. | Add the `dist/` case. |
| TC-068 | Three benign samples are not a false-positive test. | See TC-216 and TC-223. |
| TC-069 | Only the `excerpt` field is checked for the secret. | Check every output. See TC-220. |
| TC-070 | Asserts only that a result is an array. It never blocks the network. | Block network access and assert zero attempts. See TC-225. |
| TC-087 | The engine edits `recheckNeeded` inside the receipt file. Part 2 signs receipts, so editing the body would break the signature. | Store the recheck state outside the signed body. See TC-237. |
| TC-088 | Asserts only a boolean `backoffApplied`. | Assert real delays and limits. See TC-232. |
| TC-109 | Title says blocking gap; the test checks that a skipped entry contains the word "gap". | Assert the release is blocked. |
| TC-111 | Sorts the same input twice and compares. Any deterministic function passes. Urgency and confidence order are never asserted. | Shuffle the input, assert the full comparator order. |
| TC-112 | `truncated` is true on any page that has more pages, which conflates paging with the 20 KB cap. Findings are too small to hit the cap. | Use large findings to force truncation. See TC-287. |
| TC-113 | Checks `toContain` for user text. A rewrite that changes whitespace around it would pass. | Assert the bytes outside the markers are identical. See TC-301. |
| TC-114 | Varies only the free-text field, which a template-only writer never copies. | Put hostile text in the fields that are copied (id, package, versions). See TC-220 and TC-284. |
| TC-146 | `getTierSteps` is defined inside the test file, and `maxHighRounds = 3` is a local constant. The test compares them with themselves. | Call the real orchestrator and measure executed steps. Simulate failures to prove the 3-round cap. |
| TC-150 | Reads `spawnCount` from the locked JSON, so it checks the file, not the scanner. The five repos are agent-authored, with agent-assigned labels, not yours. | Run the scanner on the user's five repos and measure spawns. See TC-216. |
| TC-155 | Passes a finding that is already `blocking: true` into the join and checks it is still blocking. It never touches `AGENTS.md`, the save gate, or the merge gate. | Exercise the real gates. See TC-279 and TC-274. |
| TC-157 | Checks that fixture strings are non-empty and the lock matches. It never runs a fixture against a rule. | Execute the matrix. See TC-217. |
| TC-158 | Tests a helper function defined inside the test. It cannot fail because of the product. | Read the rule IDs from the engine's rule registry. |
| TC-160, TC-161 | One trivial zip test stands for both. Neither Docker-absent nor Windows Home vs Pro is simulated. | Mock `docker` missing and `docker info` failing, and a Pro machine with the Sandbox feature present. Assert the same provider, the "Basic protection" label, and no elevation prompt. |

---

## 3. New test cases

### A. Registry and lock integrity

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-164 | P0 | A registry table containing a fixture with an unescaped pipe in a cell. | Parser rejects the file or handles escapes. Row count equals the header. No truncated `expected` value. |
| TC-165 | P0 | A test edited and its `.sha256` regenerated in the same change. | CI fails because the expected hash comes from a pinned location, not from the edited file. |
| TC-166 | P0 | Every ID in `cases.json`, and every ID in every test title. | Each case has at least one executable test. Each test ID exists in `cases.json`. Orphans fail (covers TC-151, 153, 154, 163). |
| TC-167 | P1 | Static scan of all test files. | Fails any test that defines the function it asserts on, or that imports nothing from product code. |
| TC-168 | P1 | Mutation run: switch off 20 chosen engine behaviors one at a time (zip-slip check, hook disabling, redaction, signature check, and so on). | Each mutation is killed by at least one test. Survivors are listed and reviewed. |

### B. Routing and identity

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-169 | P0 | A hostile folder whose own `.git/config` sets `user.email` and a remote owner equal to the user's, with a staged diff. | Route stays `outside`. Identity comes only from global git config and from projects the user registered in the app. |
| TC-170 | P0 | `projects.json` edited by another process, with no app confirmation. | The folder is not trusted as the user's own. |
| TC-171 | P0 | A folder created by `noulette clone` with `.noulette-origin.json` deleted. | Still `outside`, using the clone record in app data. |
| TC-172 | P1 | Own repo with only unstaged changes, then a pull that brings in another author's commits. | Unstaged changes are checked, not ignored. Pulled commits get a full diff scan, not only the quick check. |
| TC-173 | P1 | Same project reached through a junction or symlink, with different drive-letter case. | One project identity. No double registration. |

### C. Candidate, hashes, and projects without git

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-174 | P0 | A project folder with no git. | A candidate is created with `commit` null. Gates state the limit. No crash. |
| TC-175 | P0 | A dirty tree: uncommitted edits and untracked files. | The spare copy contains the uncommitted work. A patch made on it applies to the dirty tree. |
| TC-176 | P0 | Commit the receipt, public key, and managed `AGENTS.md` block. | The content hash used by the gates does not change, so the receipt still verifies at the PR head. |
| TC-177 | P0 | The same repo checked out with `autocrlf` true and false. | The git tree hash is identical. The working-tree hash behaves as documented. |
| TC-178 | P1 | A file renamed by case only; the same content at two paths; NFC and NFD names. | Hashes differ as expected. No collision on a case-insensitive disk. |
| TC-179 | P1 | Empty repo, one commit, detached HEAD, shallow clone, a worktree, a repo with a submodule. | A candidate is defined for each. No crash. |
| TC-180 | P1 | A file edited between freeze and join (editor autosave). | Candidate marked stale and checks rerun. No mixed results. |
| TC-181 | P1 | The engine writes `.noulette/` files and the app writes `.next/` during a run. | Neither invalidates the candidate. |

### D. Quarantine and archives

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-182 | P0 | Zip entries with one to six levels of `../` and `..\`, mixed. | Whole temp tree searched. No file exists outside the extraction root. ARC-001, REJECT. |
| TC-183 | P0 | Entries named `/x`, `C:x.txt`, `\\server\share\x`, `\\?\C:\x`, `//?/C:/x`, `\\.\pipe\x`. | ARC-001, REJECT, nothing written. |
| TC-184 | P0 | Entries with `..%2f`, a NUL byte, trailing dot or space, 8.3 names (`PROGRA~1`), right-to-left override, Unicode-collision names. | Renamed or rejected and recorded. None escape. |
| TC-185 | P0 | A symlink entry pointing outside, followed by a file written through it. | No write outside. ARC-002. |
| TC-186 | P0 | tar, tar.gz, gz, 7z, rar inputs. | Supported ones extract safely. Unsupported ones give UNSURE, not a silent skip. |
| TC-187 | P0 | Nested exactly 3 levels, then exactly 4. | 3 passes. 4 is INCONCLUSIVE. No off-by-one. |
| TC-188 | P0 | A synthetic inert zip with a very high compression ratio. | Ratio cap fires before disk fills. Bytes written within the cap. Time within budget. |
| TC-189 | P1 | Overlapping entries, duplicate names, local header and central directory mismatch, truncated file, bad CRC, zip64. | UNSURE. No crash. No partial promote. |
| TC-190 | P1 | 50,001 entries; a file one byte over the cap; an inner path over 260 characters. | Limits and long paths handled cleanly. |
| TC-191 | P1 | `dir\CON.txt`, `NUL.tar.gz`, `COM1`, `LPT9`, `CLOCK$`, streams on directories, `Src/` and `src/`. | Renamed or flagged. No collision. |
| TC-192 | P1 | A fixture locked or removed mid-scan (simulated antivirus or EBUSY). | INCONCLUSIVE, then UNSURE. No hang. |
| TC-193 | P1 | Promote a passed case with renamed `.nlt` files. | Restored names are byte-identical. Hash matches. Promote refuses to overwrite different content. |
| TC-194 | P1 | Disk full during extraction, and a process killed mid-extraction. | Clean failure. No partial files. Orphans cleaned on next start. |

### E. Git intake

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-195 | P0 | A canary `post-checkout` hook in a git template directory. | Control: a naive `git clone` writes the sentinel. `quarantineGit` does not. |
| TC-196 | P0 | URLs using `ext::`, a local `file://` path, a leading `-`, and `--upload-pack=`. | Rejected before git is started. Only approved schemes pass. |
| TC-197 | P0 | A hostile submodule with `update = !cmd`, a committed `.gitattributes` filter, config-like files. | Not recursed or applied. No process started except git. GIT-003 recorded. |
| TC-198 | P1 | A case-insensitive and symlink collision repo (inert), cloned with no checkout. | Nothing written outside. Blobs read through `cat-file` only. |
| TC-199 | P1 | Git older than the configured minimum, and at the minimum. | Older refuses with a clear message. At or above proceeds. Choose the minimum against git's current security releases. |
| TC-200 | P1 | A repo with 100,000 commits, huge packs, long ref names, and credentials in the URL. | Limits give INCONCLUSIVE, not a hang. Credentials never logged or stored. |

### F. Trap check realism and evasion

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-201 | P0 | `.claude/settings.json` in the real nested hook shape, with several event types, and `settings.local.json`. | AGT-001 for each. |
| TC-202 | P0 | `.mcp.json` with `command` plus `args` split, an `env` that injects `NODE_OPTIONS=--require`, and remote `url` servers. | AGT-004 and CMD rules fire. Remote servers are listed. |
| TC-203 | P0 | `.vscode/settings.json` with `terminal.integrated.automationProfile.windows` as an object, and an older `automationShell.windows`. | AGT-008. |
| TC-204 | P0 | JSON with comments, trailing commas, a byte-order mark, UTF-16 files, and duplicate keys (benign first, hostile second). | Parsed, or INCONCLUSIVE. Never silently skipped. The hostile key is seen. |
| TC-205 | P0 | Commands assembled from parts: `args` joins, `%COMSPEC%`, `${env:X}`, `${input:}`. | Flagged or INCONCLUSIVE. |
| TC-206 | P0 | `.CLAUDE/Settings.JSON`, `.claude\settings.json` in an archive, look-alike key names. | Still detected (Windows is case-insensitive). |
| TC-207 | P1 | Workflows with `pull_request_target` plus head checkout, expression injection in `run:`, `workflow_run`, action by tag not SHA, missing `permissions`, `@main` reusable workflow. | CIW rules fire. Benign look-alikes stay quiet. |
| TC-208 | P1 | Dockerfile with a `RUN` continued over lines, heredocs, `ADD` from a URL, and a benign secret mount. | Handled. |
| TC-209 | P1 | `postinstall` that calls `npm run setup`, workspace packages with install scripts, `overrides` or `resolutions` pointing to URLs. | The indirection is followed and the target flagged. |
| TC-210 | P1 | `setup.py` using `__import__("subprocess")`, an in-tree build backend, `conftest.py` side effects, `.pth` imports. | Flagged. |
| TC-211 | P1 | PowerShell `iex` variants, `-EncodedCommand` in UTF-16LE base64, tick-split names, and batch tricks (caret, `%var:~0,1%`, delayed expansion). | CMD rules fire. |
| TC-212 | P1 | Injection phrases in other languages, leetspeak, base64 plus rot13, markdown link mismatch, code comments, `docs/`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, `GEMINI.md`, `.windsurfrules`, and other agent rule files. | INJ rules fire. The agent-file list is complete and documented. |
| TC-213 | P1 | Tag-block, variation-selector, zero-width, and bidi controls built in the test with `String.fromCodePoint`, in source and file names. | INJ-004 or ARC-013. |
| TC-214 | P1 | A PNG that is really a ZIP, PE, or script; an SVG with script; a PDF with a launch marker; real OOXML with `vbaProject.bin`; `.hta`, `.chm`, `.iso`, `.msi`, `.jar`, `.appx`. | Flagged or UNSURE by type. |
| TC-215 | P1 | One 50 MB line, pathological regex inputs for every regex rule, 10,000-level JSON and YAML, YAML alias bombs (inert). | Per-file time and memory caps give INCONCLUSIVE. Total scan time bounded. No crash. |
| TC-216 | P1 | 30 popular benign repos at pinned commits, plus the user's five tricky repos, scanned for real. | Zero REJECT on benign repos. UNSURE rate reported against a set budget. User labels recorded. Spawn count measured, not read from a file. |
| TC-217 | P0 | Execute all 142 rows of the §12 matrix against the engine. | Bad and evasion fixtures fire the named rule. The look-alike does not. A missing row or rule fails. |

### G. Secrets

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-218 | P0 | Fake keys generated to the real pattern (AWS prefix plus 16 characters from A–Z and 2–7, entropy of about 3.5 or more), run through the bundled gitleaks binary and through the engine. | Both flag them. The same keys are used in all key tests. Verify the pattern against the bundled gitleaks version. |
| TC-219 | P0 | Placeholder and example values (`your_api_key_here`, `xxxx`, values ending `EXAMPLE`). | Not flagged, as documented. |
| TC-220 | P0 | A fake secret, with hostile text in the fields that get copied. Then scan every output. | The full secret appears nowhere: findings, reports, case files, logs, stderr, MCP replies, decisions, receipts. Only a prefix and a tag appear. |
| TC-221 | P1 | The same short secret (six digits) on two installs. | Different tags. The tag cannot be brute-forced without the per-install key. |
| TC-222 | P1 | A secret only in a deleted branch, stash, tag, or packed ref; in a renamed file; base64 or URL-encoded; split across lines; in a sourcemap. | Found. |
| TC-223 | P1 | `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `PUBLIC_`, `EXPO_PUBLIC_`, `NUXT_PUBLIC_`, `GATSBY_` with secret-shaped values, and with harmless values. | Secret-shaped flagged. Harmless not. |
| TC-224 | P1 | `.env.local`, `.env.production` (tracked), `.env.example` with a real-looking key; `.dockerignore` with `!.env`, `COPY .env*`, multi-stage builds. | Visibility and severity correct for each. |
| TC-225 | P0 | Network blocked (fetch, sockets, DNS), then the key scan. | Scan completes. Zero outbound attempts recorded. |

### H. Code and AI-app checks

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-226 | P1 | Source and sink in different files. | Listed as "not covered by single-file analysis", never as "no issue". |
| TC-227 | P1 | ORM-parameterized queries, `escapeHtml`, DOMPurify, validation before a sink. Then remove the sanitizer. | No finding with the sanitizer. A finding without. |
| TC-228 | P1 | Python, Go, or PHP files present. | Scorecard says code rules do not cover them. |
| TC-229 | P1 | Model output reaching shell, file path, SQL, HTML, `fetch(url)`, a markdown image; an unrestricted shell tool exposed to a model; an agent loop with no step limit. Also a citation to a line that exists but is unrelated, to a vendored file, and with `..\..\` in the path. | AI rules fire. Bad citations are discarded or marked low confidence. |
| TC-230 | P1 | A full run on an AI app. | Each OWASP LLM and agentic risk has an explicit status and reason. None is a silent pass. |

### I. Ingredients and fresh danger

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-231 | P0 | A local mock OSV server and 2,500 packages. | Requests follow the real batch shape. Three batches of at most 1,000. Pagination followed. Ecosystem names correct. |
| TC-232 | P0 | HTTP 429 with and without `Retry-After`, then repeated failures. | Delays follow the policy. Retries are capped. Result labeled stale. Time bounded. |
| TC-233 | P1 | `bun.lock`, `bun.lockb`, `Pipfile.lock`, `uv.lock`, `Cargo.lock`, `go.sum`, `composer.lock`, `Gemfile.lock`. | Parsed, or listed "unchecked: unsupported lockfile". |
| TC-234 | P1 | No lockfile; a truncated lockfile; a 100 MB lockfile; duplicate keys. | "Unchecked" shown prominently, or INCONCLUSIVE. Never clean. No crash. |
| TC-235 | P1 | Withdrawn advisories, git-commit ranges, aliases (CVE and GHSA for one issue). | One finding per issue. |
| TC-236 | P1 | KEV or EPSS data stale or missing. Also a check of what leaves the machine. | Labeled stale. Severity not lowered silently. Only package names and versions leave. Opt-out makes the step "not run". |
| TC-237 | P1 | A new advisory arrives for a package that has a signed receipt. | Recheck state is stored outside the signed body. Flipping it does not break the signature. Editing the body does. |

### J. Logic checks and role-play

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-238 | P0 | An app that returns HTTP 200 with a login page for unauthorized requests. | Not Proven. Proven only when user A's data appears in user B's response. |
| TC-239 | P0 | Same-org and cross-org users, admin and member, deleted user, expired token, on a correctly built reference app. | Expected results for each pair. Zero false positives. |
| TC-240 | P0 | Tokens, cookies, `set-cookie`, fake emails, signed URLs in responses. | Redacted in findings, generated tests, and logs. |
| TC-241 | P0 | An app that listens on `0.0.0.0`, calls out to a TEST-NET address, and writes outside its copy. | Bound to loopback or flagged. Outbound recorded. The outside write marks the run tainted. |
| TC-242 | P0 | A Next.js and an Express fixture on Windows, with parent variables `API_KEY`, `AWS_*`, `GITHUB_TOKEN`, `NPM_TOKEN` set. | The app starts (the environment list includes what npm, bun, and node need on Windows). The secret variables are absent. |
| TC-243 | P1 | Port taken between check and bind; IPv4 versus IPv6; the user's dev server on 3000. App spawns grandchildren and detached processes. | Retry works. No collision. Zero survivors after timeout and after an engine crash. |
| TC-244 | P1 | A slow-starting app, one that crashes after five seconds, one with intermittent 500s. | Skipped or retried per policy. Never Proven from a 500. |
| TC-245 | P1 | Seed data and the user's real database file. | No real-looking personal data. Accounts removed after the run. The user's database hash is unchanged. |
| TC-246 | P1 | RLS enabled with `USING (true)` versus `auth.uid() = user_id`; a service-role key in the client bundle; complex middleware matchers (negative lookahead, route groups, i18n prefixes); handlers wrapped in higher-order functions. | Only the unsafe ones are flagged. Unclear routes are "unknown", never "protected". |

### K. Fix attempts and the referee

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-247 | P0 | The patch file replaced after the referee passes but before approval or apply. | Apply refuses, or reruns the referee on the exact bytes. The swapped patch is never applied. |
| TC-248 | P0 | Patches touching protected paths by rename, copy, mode change, symlink swap, `..`, and mismatched `diff --git` and `---/+++` headers. | Rejected. The file list from `git apply --numstat` matches what really changes. |
| TC-249 | P0 | Added `// nosemgrep`, `# nosec`, `eslint-disable`, `@ts-ignore`, `# noqa`, `NOSONAR`, `istanbul ignore`; a scanner exclusion; a `.gitleaksignore` entry. | Referee fails. |
| TC-250 | P0 | Deleted test, `.skip` or `xit`, weakened assertion, test path ignore, updated snapshot, lowered coverage threshold. | Referee fails. |
| TC-251 | P0 | `test` script changed to `exit 0`, CI file edit, relaxed `tsconfig`, scanner config edit, edit under `.noulette/`. | Referee fails. |
| TC-252 | P0 | A fix that creates a different new finding, or moves the same flaw to another file. | Referee fails. Same-pattern detection uses rule and function, not only the snippet. |
| TC-253 | P0 | A patch that removes a key from code while it remains in history. | Status `needs-person`. Stays blocking until a signed attestation that the key was rotated. |
| TC-254 | P1 | A dependency bump regenerating the lockfile. | Install scripts disabled. New transitive packages checked for known flaws and trap rules. Resolved host is the registry. Integrity present. A suspicious new package fails. |
| TC-255 | P1 | A test that encodes the vulnerable behavior. | The route is `needs-person` with an explanation, not endless retries. |
| TC-256 | P1 | Empty patch, whitespace-only, comments-only, 10,000 lines, binary, mode change, mixed line endings. | Fails "problem gone" where it should. Limits enforced. No crash. |
| TC-257 | P1 | The user edits the working tree during an attempt. | Apply detects the change, offers a re-attempt, and does not overwrite the user's edits. Unrelated autosaves do not cause false failures. |
| TC-258 | P1 | The spare copy. | No `.env`, `*.pem`, or credentials. Contains uncommitted files. Excludes `node_modules`. Works with paths over 260 characters. |
| TC-259 | P1 | A build or test run that logs endlessly, hangs, allocates heavily, or tries the network. | Output, time, and memory bounded. Network attempts recorded. Process tree killed. |
| TC-260 | P1 | Same failure three times; different failures up to the cap; High tier three rounds; time or token budget. | Exact stop rules followed. Reaches Held back. Clears only through a new fix and a new candidate. |
| TC-261 | P1 | A flaky generated regression test; two attempts touching the same file; an engine killed mid-attempt. | Flaky test not trusted. Conflict caught at apply. No orphan worktrees. |

### L. Signing, decisions, and receipts

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-262 | P0 | An agent replaces `.noulette/pubkey` and signs its own decision. | Local apply rejects it (trusted key comes from app data). CI rejects it (key comes from the base branch). |
| TC-263 | P0 | 20 fixed payloads (Unicode, key order, numbers, nesting, empty). | Rust signatures verify in TypeScript and the reverse. Canonical bytes are identical. |
| TC-264 | P0 | A decision signature reused as a receipt, for another project, another candidate, or after expiry. | Rejected. |
| TC-265 | P0 | Change any one of patch hash, candidate ID, tree hash, finding IDs, or expiry in a signed payload. | Verification fails. |
| TC-266 | P0 | Missing, truncated, wrong-length, or non-hex signature; a downgraded algorithm field. | Fails closed in the engine, hooks, and CI. |
| TC-267 | P0 | `sign_decision` with a traversal ID, absolute path, stream name, overlong value, or an unregistered, UNC, or junction project path. | Refused before any file is read. |
| TC-268 | P0 | Accept risk with a short reason, over 90 days, past date, no owner, or on a hard-stop finding. | Refused by the engine and the app. Expiry reopens the finding at the next run and marks the receipt for recheck. |
| TC-269 | P0 | The system clock moved back to extend an expiry. | Defined behavior: reject, or require trusted time in CI. |
| TC-270 | P1 | First-run key creation; credential deleted; replaced; rotated with old receipts present. | Documented behavior. Recovery never trusts project-writable files. |
| TC-271 | P1 | The native confirm dialog with hostile file names (right-to-left, zero-width, very long). | Text comes only from bytes Rust read. Hostile characters are shown visibly or truncated. Page-supplied text cannot change it. |
| TC-272 | P1 | A simulated compromised page calling every `invoke` command with hostile arguments. | Each command validates its input. None signs without a confirmed dialog. |
| TC-273 | P1 | Dialog dismissed or timed out; double-click; two app instances; Reject; re-approving a rejected attempt. | No signature without a click. One signature only. Reject writes no receipt and cannot be re-approved. |

### M. Gates and release

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-274 | P0 | A forged receipt on a commit containing a live fake key. | The merge gate reruns the deterministic checks on the exact commit with the pinned engine and fails. |
| TC-275 | P0 | A receipt committed inside the PR it approves. | It matches at the PR head. |
| TC-276 | P0 | A PR that edits the public key, the gate workflow, or protected files. | Requires a human review path (such as CODEOWNERS). The gate fails without it. |
| TC-277 | P0 | The engine binary in CI replaced by one byte. | Hash check fails before it runs. |
| TC-278 | P1 | No CI, or no branch protection. | The product says "Weaker protection: no merge gate" and claims no enforcement. |
| TC-279 | P1 | A repo with husky or lefthook; install the hook, then uninstall; an agent that ignores `AGENTS.md` and commits a fake key. | Existing hooks are chained. Uninstall restores the originals byte for byte. The commit is blocked by the gate, not by the advice text. `--no-verify` is documented. |
| TC-280 | P1 | Seal output with mixed line endings, case-different names, empty directories, symlinks, large files, on two machines. | Same hash on both. A tampered file fails the launch gate. |
| TC-281 | P1 | Launch with an expired receipt, a recheck-needed receipt, an artifact swapped after sealing, a receipt for another candidate. | Each fails. |
| TC-282 | P1 | Lost-key recovery in CI, and the recheck triggers (new danger note, expired risk, time limit). | Admin override is documented and logged. Each trigger flips the status. None flips back silently. |

### N. MCP server

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-283 | P0 | Out-of-order calls: apply before approval, verify before start, approval request without a referee pass. | `ok: false` with the next required step. No state change. |
| TC-284 | P0 | Findings, snippets, and paths containing "ignore previous instructions", fake tool-call JSON, and ANSI escapes. | Returned as quoted data fields, never in instruction fields. |
| TC-285 | P0 | An agent calls `noulette_approve` or any signing tool, or passes extra fields. | Unknown tool error. No MCP tool can sign or approve. |
| TC-286 | P1 | Two MCP instances, the CLI, and a hook writing at once; a process killed between the temp write and the rename. | A lock prevents torn JSON. The previous file stays intact. State recovers on restart. |
| TC-287 | P1 | Random, oversized, deeply nested, NUL, and Unicode inputs to every tool; 0, 20, 21 findings; a page past the end; large findings that force the 20 KB cap. | Validation errors, no crash. Every reply is 20 KB or less. `truncated` means the byte cap was hit. |
| TC-288 | P1 | The app open versus closed; polling a pending decision. | Same results. Pending returns wait guidance. Polling does not burn CPU. |
| TC-289 | P1 | App and engine at different versions; project paths with spaces, Unicode, long paths, OneDrive, network drives, subst drives. | Clear refusal on a schema mismatch. Paths handled. |

### O. Desktop app

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-290 | P0 | Titles, diffs, paths, and snippets containing `<script>`, `<img onerror>`, `javascript:` links, entities, and markdown. | Rendered inert. The CSP blocks inline script. No raw HTML injection. |
| TC-291 | P0 | An automated contrast check of every text color on every surface (page, card, sidebar, active nav, badges) in light and dark. | Each pair is at least 4.5:1 (3:1 for large text). Any failure fails the test. |
| TC-292 | P0 | Complete Approve, Accept risk (modal focus trap, Esc), and Reject with the keyboard only; a screen reader. | Works. Visible focus. Icon buttons have names. |
| TC-293 | P1 | The installed build: toast click, second click, toast sound plus chime, window minimized or in the tray, mute and volume. | Focuses the card. No second window. No double sound. The chime follows mute and volume. |
| TC-294 | P1 | Changing tier and auto-fix in Settings; an agent editing project files. | Settings persist in app data. The agent cannot change them. Writes are atomic. The watcher does not loop on its own writes. |
| TC-295 | P1 | 1100 by 720 minimum size; 125, 150, 200 percent scaling; high-contrast mode; reduced motion; system theme change while open. | Layout holds and follows the theme. |
| TC-296 | P1 | WebView2 missing or old; install, upgrade, uninstall on Windows Home. | Install prompt, no crash. No administrator prompt. Uninstall keeps user data unless asked. |
| TC-297 | P1 | Copy buttons for all five prompts; clipboard permission denied. | Clipboard text is identical to the catalog. A denial shows an error, never "Copied". |
| TC-298 | P1 | 1,000 file events in one second; `.noulette/` deleted and recreated; project on a disconnected drive. | Debounced. The UI stays responsive. A clear state is shown. |
| TC-299 | P1 | Startup with the network blocked. | Fonts, icons, and the chime are bundled. Zero network requests. |

### P. Pressure, scale, and determinism

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-300 | P0 | The same candidate scanned twice, and on two machines with different path roots. | Byte-identical findings in the same order (generated IDs excepted as defined). |
| TC-301 | P0 | Steps 19 and 20 run 100 times; `AGENTS.md` with CRLF; markers deleted, duplicated, or nested. | No change after the first run. Bytes outside the markers identical. CRLF preserved. Damaged markers repaired or refused with a message. |
| TC-302 | P1 | 50,000 files and 1 GB. | Finishes within a budget you set after measuring. Memory within the cap. Progress and cancel work. Cancel leaves no partial promote. |
| TC-303 | P1 | A 5,000-line diff and a 10,000-file repo. | Quick check under 2 seconds, or held with "can't tell". |
| TC-304 | P1 | The intake process audit. | Zero processes started from project content. Only allowed tools (git, gitleaks, opengrep) by absolute path with fixed arguments. |
| TC-305 | P1 | 100 consecutive runs, including failures. | No leftover processes, temp folders, file handles, worktrees, or open ports. |
| TC-306 | P1 | 10,000 mutated inputs per parser (zip, JSON, YAML, TOML, lockfiles, patches, decisions, receipts). | No crash, hang, or memory blow-up. Every failure is INCONCLUSIVE or a refusal. Crashes are saved as new fixtures. |
| TC-307 | P1 | Spaces, Unicode, emoji, over 260 characters, trailing dot, OneDrive, network share, case-insensitive names, on Windows Home. | Every step works (extends TC-149 to the engine). |
| TC-308 | P1 | Windows Defender real-time protection on, with canary fixtures. | Removal or lock is detected and reported as INCONCLUSIVE. No hang. Exclusion steps documented. |
| TC-309 | P2 | The whole suite against the built `noulette-engine.exe`; an 8-hour soak with the watcher; a 4 GB RAM machine. | Same results as source. Memory growth within budget. Timeouts never produce a pass. |

### Q. Honesty and claims

| ID | Pri | Fixture | Expected |
|---|---|---|---|
| TC-310 | P0 | Every string the product can emit: engine templates, MCP replies, UI text, receipts, README. | Never asserts "safe", "secure", "clean", or "no vulnerabilities". Allowed contexts (such as "unsafe") are listed. |
| TC-311 | P0 | Every check status: skipped, not run, unavailable, timed out, unchecked. | None produces a pass in the scorecard, receipt, or gates. A property test covers all statuses. |
| TC-312 | P0 | A scorecard with a mandatory check missing. | Join fails. Every mandatory check appears as ran, skipped, or not covered, with a reason. |
| TC-313 | P1 | Docker or sandbox absent; wording review. | "Basic protection" is shown. "Sandbox" is replaced by "test copy". "Isolated" is not used for restricted runs. |
| TC-314 | P1 | Bundled binaries, fonts, icons, and the sound; one byte of each scanner changed. | Each has a license entry and checksum. No AGPL tool is bundled. A modified scanner gives "not run (scanner modified)" at launch and at scan. |
| TC-315 | P1 | README and limits page claims; outbound connections during use. | Each claim maps to a test ID. An unmapped claim fails. No telemetry. Connections only to OSV, KEV, and EPSS when enabled. |

---

## 4. Suggested build order

1. Fix section 1 (registry and lock) and section 2 (weak tests). Nothing else is trustworthy until these are done.
2. P0 cases in sections B, C, D, E, K, L, M. They cover the trust boundaries: routing, hashes, archives, signing, and gates.
3. TC-217 (run the matrix) and TC-218 (valid fake keys). They turn two documents into real tests.
4. P1 cases by section, in the order the milestones are built.
5. P2 cases last.

## 5. Definition of done for this file

- Every row has an executable test with a matching ID, and TC-166 passes.
- Every P0 case passes against the built `.exe` on Windows Home with no administrator prompt.
- Each security test has a positive control, or a note explaining why none is possible.
- The registry lock is recomputed from a pinned hash and passes (TC-165).
- Items marked "verify against current documentation" (gitleaks pattern details, Claude Code, `.mcp.json`, and VS Code config shapes, git minimum version) have been checked and the check recorded in the test file.
