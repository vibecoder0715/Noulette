# Noulette

[English](README_en.md) | [简体中文](README_cn.md) | [Bahasa Melayu](README_bm.md)

---

## 1. Windows 版本下载与安装

你可以直接从 GitHub Releases 下载最新官方发布包，或从仓库的 `dist/` 目录获取预编译版本：

| 安装包 | 格式 | 大小 | 说明 | 下载链接 |
| :--- | :--- | :--- | :--- | :--- |
| **Noulette 独立免安装版** | `.exe`（便携版） | 约 104 MB | 单文件免安装程序，同时支持命令行与桌面图形界面。 | [📥 下载 `noulette.exe`](https://github.com/noulette/noulette/releases/latest/download/noulette.exe)（本地：`dist/noulette.exe`） |
| **Noulette Windows 安装包** | `.msi`（安装程序） | 约 40 MB | 规范的 Windows Installer 安装包，包含开始菜单快捷方式与自动卸载支持。 | [📥 下载 `noulette-setup.msi`](https://github.com/noulette/noulette/releases/latest/download/noulette-setup.msi)（本地：`dist/noulette-setup.msi`） |

### 运行模式：
- **桌面模式**：双击 `noulette.exe`（或安装 `.msi` 后在开始菜单中打开）即可启动图形桌面客户端（基于 Tauri 2 和 Terra 设计系统构建）。
- **命令行模式**：在终端中运行 `noulette.exe <命令>`（如 `scan`、`gate`、`clone` 或 `mcp`），直接调用高性能引擎。
- **零外部依赖**：你的电脑无需额外安装 Node.js、Bun、Python 或其他外部运行环境。

---

## 2. 我们的使命与愿景

我们的使命是帮助开发团队在代码上线之前尽早发现并解决问题，让每次发布都踏实可靠。我们聚焦于三大核心目标：

1. **全面检测各类软件问题**：
   我们能够发现普通代码检查工具容易遗漏的深层问题。例如：
   - *网络安全隐患*：泄漏的云平台密钥与 API 令牌、危险的依赖预安装脚本、命令注入，以及隐秘的 Unicode 字符陷阱（如零宽空格和双向文本反转覆盖）。
   - *业务与逻辑缺陷*：权限校验疏漏、不安全的直接对象引用（IDOR），以及危及用户数据安全的操作逻辑缺陷。
   - *架构规划脱节*：为了简单应用过早引入复杂微服务的“过度设计”，或是无法承受预期用户流量和预算的“设计不足”。

2. **做出恰当、精准的决策**：
   Noulette 不会用繁杂无用的警告信息打扰你，而是为你提供清晰、基于事实的决策依据。你可以查看经过净化的可视化代码差异、核对证明清单、使用 Ed25519 密钥对认可的修改进行加密签名，或记录责任明确、有严格时限的风险特例。

3. **在交付前验证并修复缺陷**：
   仅仅发现问题还不够。只要你需要，Noulette 就能提供自动化候选补丁与针对性修复。你可以直观对比修改细节、在隔离环境中测试修复效果，并记录有据可查的发布决策——确保每个决策都明确记录已验证范围与未检查领域。

---

## 3. 核心功能与运行环境

Noulette 通过三大核心功能提供透明、有边界的工程验证：
1. 隔离接入通道：在摄入前将外部下载的代码与归档放入隔离区检查，拦截高危操作。
2. 发布前验证：在提交或发布代码前，运行 142 条 TrapCheck 规则、密钥扫描、多语言 AST 深度分析与构建验证。
3. 架构评估：动态识别项目技术栈，评估系统架构是否与用户规模和预算匹配。

*根本原则：Noulette 从不声称代码“绝对安全”或“消除一切漏洞”。每张签发的收据都清晰记录已通过的具体规则，并明确列出未覆盖的检查盲区。*

运行环境：
支持作为全功能桌面应用、独立命令行工具，以及作为 MCP 服务供 AI 编程助手直接调用，采用多语言 AST 解析器与数据流污点分析引擎。

---

## 4. 特别鸣谢

感谢以下优秀的开源项目及其贡献者为 Noulette 提供支持：

- [Tauri](https://github.com/tauri-apps/tauri) — 轻量、快速且安全的桌面应用框架。
- [Bun](https://github.com/oven-sh/bun) — 极速的 JavaScript/TypeScript 运行时、打包工具与测试运行器。
- [React](https://github.com/facebook/react) — 网页与原生界面的构建库。
- [Vite](https://github.com/vitejs/vite) — 新一代前端构建工具。
- [Lucide](https://github.com/lucide-icons/lucide) — 优雅且一致的图标库。
- [Rust](https://github.com/rust-lang/rust) 及社区库：
  - `ed25519-dalek` 与 `curve25519-dalek`（来自 [dalek-cryptography](https://github.com/dalek-cryptography)）
  - `serde`（来自 [serde-rs](https://github.com/serde-rs)）
  - `regex`（来自 Rust 项目开发团队）
  - `sha2`（来自 [RustCrypto](https://github.com/RustCrypto)）
- [Gitleaks](https://github.com/gitleaks/gitleaks) — 密钥检测规则与模式参考。
- [TypeScript](https://github.com/microsoft/TypeScript)（来自微软）。

---

## 5. 开源许可证

本项目基于 MIT 许可证开源。详情请参阅 [LICENSE.md](LICENSE.md)。
