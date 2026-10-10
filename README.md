# Noulette

[English](README_en.md) | [简体中文](README_cn.md) | [Bahasa Melayu](README_bm.md)

[![Release](https://img.shields.io/badge/release-v0.1.0-blue.svg)](https://github.com/noulette/noulette/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-brightgreen.svg)](https://github.com/noulette/noulette/releases)
[![Tests](https://img.shields.io/badge/tests-262%20passing-success.svg)](tests/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

---

## 1. Windows Downloadables & Installation

You can download the latest official release packages directly from GitHub Releases or access pre-compiled builds in the local `dist/` folder:

| Package | Format | Size | Description | Download Link |
| :--- | :--- | :--- | :--- | :--- |
| **Noulette Standalone** | `.exe` (Portable) | ~104 MB | Self-contained single-file application combining Desktop GUI and CLI. Zero installation required. | [📥 Download `noulette.exe`](https://github.com/noulette/noulette/releases/latest/download/noulette.exe) (`dist/noulette.exe`) |
| **Noulette Windows Installer** | `.msi` (Installer) | ~40 MB | Standard Windows Installer package with Start Menu shortcuts and automated uninstallation. | [📥 Download `noulette-setup.msi`](https://github.com/noulette/noulette/releases/latest/download/noulette-setup.msi) (`dist/noulette-setup.msi`) |

### Modes of Operation:
- **Desktop Mode**: Double-click `noulette.exe` (or launch via the Start Menu after installing the `.msi`) to open the graphical desktop application (built with Tauri 2 and the Terra design system).
- **CLI Mode**: Run `noulette.exe <command>` in your terminal (such as `scan`, `gate`, `clone`, or `mcp`) to use the engine directly from the command line.
- **Zero External Dependencies**: No external runtimes (Node.js, Bun, or Python) are required on your PC.

---

## 2. Mission and Vision

Our mission is to help software teams build with confidence by catching issues before code ever reaches production. We focus on three core goals:

1. **Detect Problems Across Your Entire Project**:
   We find real software issues that standard linters miss. For example:
   - *Cybersecurity Threats*: Leaked cloud keys and API tokens, unsafe pre-install scripts, command injections, and hidden Unicode tricks (such as zero-width characters or right-to-left bidi overrides).
   - *Logic & Business Flaws*: Broken access controls, IDOR vulnerabilities, and flawed business operations that risk user privacy.
   - *Architecture Mismatches*: Projects that are heavily overbuilt with unnecessary costs and microservice complexity, or underbuilt designs that cannot handle your target user traffic and budget.

2. **Make Appropriate, Precise Decisions**:
   Instead of overwhelming you with noisy warnings or vague alerts, Noulette gives you clear, evidence-based choices. You can review neutralized visual code diffs, verify proof checklists, sign off on approved changes with cryptographic Ed25519 keys, or record strict, time-limited risk exceptions with clear ownership.

3. **Verify and Remediate Before Shipping**:
   Spotting problems is only half the battle. When desired, Noulette proposes automated candidate patches and targeted fixes. You can review the exact changes, test the fix in isolation, and record bounded decisions—ensuring that verified releases document what was tested and what remains outside the verified scope.

---

## 3. Core Functions & Environments

Noulette provides transparent, bounded verification through three core functions:
1. Isolated Intake Pipeline: Inspects downloaded archives and repositories in quarantine before ingestion.
2. Pre-Release Verification: Runs 142 TrapCheck rules, secret scanners, multi-language AST analysis, and build checks before shipping code.
3. Architecture Planning: Dynamically assesses project stacks to flag overbuilt or underbuilt systems to fit your user scale and budget.

*Foundational Tenet: Noulette NEVER claims that code is "safe" or that vulnerabilities are eliminated. Every signed decision and release receipt records verified rule evaluations and explicitly lists the areas that were not checked.*

Environments:
Runs as an all-in-one desktop app, CLI tool, and MCP server for AI coding assistants using multi-language AST parsers and taint analyzers.

---

## 4. Special Thanks

Noulette is made possible thanks to these wonderful open-source projects and their contributors:

- [Tauri](https://github.com/tauri-apps/tauri) — Lightweight, fast, and secure desktop application framework.
- [Bun](https://github.com/oven-sh/bun) — Incredibly fast JavaScript/TypeScript runtime, bundler, and test runner.
- [React](https://github.com/facebook/react) — The library for web and native user interfaces.
- [Vite](https://github.com/vitejs/vite) — Next-generation frontend build tooling.
- [Lucide](https://github.com/lucide-icons/lucide) — Beautiful and consistent icon toolkit.
- [Rust](https://github.com/rust-lang/rust) & crates:
  - `ed25519-dalek` & `curve25519-dalek` by [dalek-cryptography](https://github.com/dalek-cryptography)
  - `serde` by [serde-rs](https://github.com/serde-rs)
  - `regex` by the Rust Project Developers
  - `sha2` by [RustCrypto](https://github.com/RustCrypto)
- [Gitleaks](https://github.com/gitleaks/gitleaks) — Rules and pattern inspiration for secret detection.
- [TypeScript](https://github.com/microsoft/TypeScript) by Microsoft.

---

## 5. License

This project is licensed under the MIT License. See [LICENSE.md](LICENSE.md) for details.
