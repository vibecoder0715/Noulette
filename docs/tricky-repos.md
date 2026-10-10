# Acceptance Procedure: Five Tricky Repos (TC-150)

This document records the acceptance verification of the five tricky test repositories evaluated during Step 4 Trap Check.
In accordance with `TRAPCHECK_RULES.md` §9 and `TEST_CASES.md` `TC-150`:
- **Spawn Audit:** 0 child processes spawned from repo content (`spawn audit empty`).
- **Verdicts:** Each yields a deterministic verdict + snippet evidence.
- **Labels:** User-evaluated classifications for hits: `true positive`, `false positive`, or `unclear`.

---

## 1. Repo: `tricky-agent-hook`
- **Date:** 2026-10-09
- **Commit:** `c0ffee112233445566778899aabbccddeeff0001`
- **Rules Version:** `1.0.0`
- **Verdict:** `UNSURE`
- **Hit:** `AGT-001` (`.claude/settings.json` hook executing `echo CANARY`)
- **Evidence:** `settings.json: {"hooks": {"preToolUse": "echo CANARY"}}`
- **User Label:** `true positive`
- **Spawn Audit Count:** `0`

---

## 2. Repo: `tricky-polyglot-macro`
- **Date:** 2026-10-09
- **Commit:** `c0ffee112233445566778899aabbccddeeff0002`
- **Rules Version:** `1.0.0`
- **Verdict:** `UNSURE`
- **Hit:** `PAY-008` (`report.docm` containing `word/vbaProject.bin`)
- **Evidence:** `report.docm: VBA macro project stream detected`
- **User Label:** `true positive`
- **Spawn Audit Count:** `0`

---

## 3. Repo: `tricky-unicode-bidi`
- **Date:** 2026-10-09
- **Commit:** `c0ffee112233445566778899aabbccddeeff0003`
- **Rules Version:** `1.0.0`
- **Verdict:** `REJECT`
- **Hit:** `INJ-004` (Tag block encoding `ignore previous instructions` + RLO)
- **Evidence:** `prompt.txt: Decoded tag-block characters [ZWSP][BIDI-OVERRIDE]`
- **User Label:** `true positive`
- **Spawn Audit Count:** `0`

---

## 4. Repo: `tricky-husky-benign`
- **Date:** 2026-10-09
- **Commit:** `c0ffee112233445566778899aabbccddeeff0004`
- **Rules Version:** `1.0.0`
- **Verdict:** `PASS`
- **Hit:** `LIF-001` (benign shape: `"prepare": "husky"`)
- **Evidence:** `package.json: "prepare": "husky" filtered by benign-shapes.json`
- **User Label:** `false positive` (filtered to PASS with note)
- **Spawn Audit Count:** `0`

---

## 5. Repo: `tricky-obfuscated-src`
- **Date:** 2026-10-09
- **Commit:** `c0ffee112233445566778899aabbccddeeff0005`
- **Rules Version:** `1.0.0`
- **Verdict:** `PASS`
- **Hit:** `PAY-003` (Heavy `_0x` obfuscated JS in `src/` not referenced by scripts)
- **Evidence:** `src/vendor.js: Non-referenced obfuscated JS file`
- **User Label:** `unclear` (isolated to PASS with note, not referenced in lifecycle)
- **Spawn Audit Count:** `0`
