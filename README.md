# Agentero

<p align="center">
  <strong>Agent-first 本地科研文献库</strong><br />
  Markdown Vault · 双链/反链/图谱 · arXiv 论文 · ACP Agent — 文件归你所有，不锁进私有数据库。
</p>

<p align="center">
  <a href="https://github.com/poco-ai/agentero/stargazers"><img src="https://img.shields.io/github/stars/poco-ai/agentero?style=flat&logo=github" alt="GitHub stars" /></a>
  <a href="https://github.com/poco-ai/agentero/network/members"><img src="https://img.shields.io/github/forks/poco-ai/agentero?style=flat&logo=github" alt="GitHub forks" /></a>
  <a href="https://github.com/poco-ai/agentero/issues"><img src="https://img.shields.io/github/issues/poco-ai/agentero?style=flat" alt="GitHub issues" /></a>
  <a href="https://github.com/poco-ai/agentero/pulls"><img src="https://img.shields.io/github/issues-pr/poco-ai/agentero?style=flat" alt="GitHub pull requests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/poco-ai/agentero/releases"><img src="https://img.shields.io/github/v/release/poco-ai/agentero?include_prereleases&style=flat" alt="Release" /></a>
  <a href="https://agentero.poco-ai.com"><img src="https://img.shields.io/badge/docs-online-5319E7?logo=mkdocs&logoColor=white" alt="Documentation" /></a>
</p>

---

## 为什么做 Agentero？

**Agentero** 旨在构建给 Agent 友好的、Agent 原生的文献管理方式，探索人与 Agent 在文献管理中的协作方式

传统文献管理器擅长**存 PDF**，但 Agent 工作流需要更稳定、可寻址、可复用的本地知识结构：

- 阅读高亮和笔记被锁在单篇文件里，Agent 很难跨论文复用。
- 每次对话都要重新提供上下文，缺少稳定的本地知识地图。
- PDF 对人友好，但对 Agent 来讲不是最舒服的阅读材料；结构、链接、引用路径应该可寻址。

## 功能

- **BYOA**（Bring Your Own Agent）：Agentero 只作为 ACP Client 连接用户本机 Agent，不绑定模型宿主。
  - **精读**：入库 / 单篇 Download 后可自动 paper-reader；文件树 Eye 可手动；写 `NOTES.md` 并标记 `is_read`。
- **魔棒入库**：与 Zotero 当中能力一致。
- **双链与知识图谱**：Obsidian 当中的双链与知识图谱功能。
- **桌面原生体验**

> 当前状态：早期 MVP

## Quick Start

### 桌面应用

```bash
git clone https://github.com/poco-ai/agentero.git
cd agentero
pnpm install

# 桌面应用（推荐）
pnpm tauri dev

# 仅前端预览（无原生 Vault / Agent 后端）
pnpm dev
```

### CLI（MVP）

Headless **Vault / Catalog 机器接口**：创建与发现库、列表与入库文献基础能力。**不含** BYOA / Agent 运行时。设计见 [`docs/development/cli.md`](docs/development/cli.md)。

代码目录 `cli/`，path 复用 `src-tauri` services（**不迁 core**）：

```bash
# 仓库根 Cargo workspace（members: src-tauri, cli）
cargo build -p agentero-cli
# 二进制: target/debug/agentero

export AGENTERO_VAULT=~/path/to/vault   # 或每条命令 --vault
agentero vault which --json
agentero paper list --json
agentero import id 1706.03762 --json
agentero paper get 1706.03762 --json    # 再按 suggestedReads 读本地文件
```

**给外部 Agent 的 skill**（Create Vault 会种子写入 Vault）：

| 路径 | 说明 |
| --- | --- |
| [`templates/vault/.agents/skills/agentero-cli/SKILL.md`](templates/vault/.agents/skills/agentero-cli/SKILL.md) | 模板源；协议：`--json` 摸库 → 读文件 → 入库 |
| Vault 内 `.agents/skills/agentero-cli/` | 新建 Vault 后可用；Composer `$agentero-cli` / Claude `/agentero-cli` |
| [`templates/vault/.agents/skills/paper-reader/SKILL.md`](templates/vault/.agents/skills/paper-reader/SKILL.md) | 精读写 `NOTES.md`（与 CLI 分工：CLI 不管精读） |

外部 Agent 最小协议：

```text
1. agentero vault which --json
2. agentero paper list --json
3. agentero paper get <path|id> --json
4. read_file: NOTES.md → highlights.md → PAPER.md / source/
5. agentero import id <arxiv|doi|url> --json   # 需要入库时
```

### 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm tauri dev` | 启动桌面开发应用 |
| `pnpm build` | 构建前端产物 |
| `pnpm tauri build` | 构建桌面安装包 |
| `cargo build -p agentero-cli` | 构建 CLI（bin `agentero`） |
| `cargo test -p agentero-cli` | CLI 集成测试 |
| `pnpm lint` | TypeScript（Biome）+ Rust（clippy）检查 |
| `pnpm format` | 格式化 TypeScript + Rust |

## 项目结构

```text
agentero/
├── AGENTS.md             # 面向 Agent / 开发者的仓库指南
├── mkdocs.yml            # MkDocs 文档站配置
├── src/                  # React + TypeScript 前端
├── src-tauri/            # Tauri 2 + Rust Host（Vault、Wiki、ACP）
├── cli/                  # headless CLI（bin agentero；见 docs/development/cli.md）
├── templates/vault/      # Create Vault 脚手架（含 .agents/skills）
├── docs/                 # MkDocs 文档源文件
└── package.json
```

## 技术栈

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=black" alt="Rust" />
  <img src="https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
</p>

- **桌面壳**：[Tauri 2](https://v2.tauri.app/)
- **前端**：[React](https://react.dev/)、[TypeScript](https://www.typescriptlang.org/)、[Tailwind CSS](https://tailwindcss.com/)、[shadcn/ui](https://ui.shadcn.com/)、[AI Elements](https://elements.ai-sdk.dev/)
- **编辑器**：[Plate](https://platejs.org/) / Markdown
- **Agent**：[Agent Client Protocol](https://agentclientprotocol.com/)、BYOA

## 贡献

欢迎提交 Issue 和 PR。

1. Fork 后创建功能分支。
2. 保持改动聚焦，并遵守现有 lint/format 设置（`pnpm lint` / `pnpm format`）。
3. PR 描述清楚改动内容和原因。

较大的想法请先开 issue 对齐范围。

## License

本项目使用 [MIT License](LICENSE)。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=poco-ai/agentero&type=Date)](https://www.star-history.com/#poco-ai/agentero&Date)
