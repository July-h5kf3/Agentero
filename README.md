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
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=black" alt="Rust" />
  <img src="https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
</p>

---

## 为什么做 Agentero？

传统文献管理器擅长**存 PDF**，但 Agent 工作流需要更稳定、可寻址、可复用的本地知识结构：

- 阅读高亮和笔记被锁在单篇文件里，Agent 很难跨论文复用。
- 每次对话都要重新提供上下文，缺少稳定的本地知识地图。
- PDF 对人友好，但对模型有排版噪音；结构、链接、引用路径应该可寻址。

**Agentero** 是面向人和 Agent 共用的本地优先研究工作台。论文、笔记、索引都以 Markdown 和源文件形式存在于用户控制的 Vault 中。Agent 采用 **BYOA**（Bring Your Own Agent）：Agentero 只作为 ACP Client 连接用户本机 Agent，不绑定模型宿主。

## 功能

- **本地 Vault**：打开或创建文件夹；Create Vault 初始化目录与 `.agentero/catalog.sqlite`。
- **多窗口**：`⌘N` 新建窗口（不自动恢复上次 Vault）；欢迎页列出最近路径。
- **Markdown 工作台**：文件树（虚拟 Library 节点、内联新建文件/文件夹；刷新走 ⌘R）、中间 Markdown/PDF/HTML 或论文库表格、可选右侧栏（当前为**单槽**中间栏）。
- **论文库**：catalog 表格（`paper_list`）；表头排序；双向滚动；点击行打开 paper。
- **魔棒入库**：粘贴 arXiv 链接/编号 → Translator → catalog + **默认下载 PDF**；arXiv 另解压 LaTeX 到 `source/`。缺资源时 paper 行 / Library 行可单篇或批量补下。
- **精读**：入库 / 单篇 Download 后可自动 paper-reader；文件树 Eye 可手动；写 `NOTES.md` 并标记 `is_read`。
- **双链、反链与图谱**：跨 notes 与 papers 使用 `[[links]]`；Backlinks 右侧栏上方是反链，下方是 Graph（双链图）。
- **Agent 右侧栏**：通过 ACP（Claude、Codex、Grok Build 等）与本地 Vault 对话；设置中全局权限模式（受限 / 自动批准）。
- **Paper-centric 布局**：打开具体论文时根据 catalog 远程 URL 显示 PDF/HTML，并显示 Paper Info 与该篇 `NOTES.md` 实时编辑（论文库视图下隐藏 Notes）。
- **桌面原生体验**：Tauri 2、macOS overlay title bar、File 菜单、快捷键与 i18n。

> 当前状态：早期 MVP。进度见 [docs/development/roadmap.md](docs/development/roadmap.md)（含规划中的 **V0.6 标签页/分屏**、**V0.7 引用关系 / Connected Papers**），产品范围见 [docs/development/prd.md](docs/development/prd.md)。

## 快速开始

### 前置依赖

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Rust](https://rustup.rs/) stable
- [Tauri 2](https://v2.tauri.app/start/prerequisites/) 对应平台依赖

### 安装与运行

```bash
git clone https://github.com/poco-ai/agentero.git
cd agentero
pnpm install

# 桌面应用（推荐）
pnpm tauri dev

# 仅前端预览（无原生 Vault / Agent 后端）
pnpm dev
```

### 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm tauri dev` | 启动桌面开发应用 |
| `pnpm build` | 构建前端产物 |
| `pnpm tauri build` | 构建桌面安装包 |
| `pnpm lint` | TypeScript（Biome）+ Rust（clippy）检查 |
| `pnpm format` | 格式化 TypeScript + Rust |

## 发布

推送 `v*` tag 会触发 `.github/workflows/release.yml`，在 macOS、Ubuntu、Windows 上构建 Tauri 安装包，并上传到草稿 GitHub Release。

## 项目结构

```text
agentero/
├── AGENTS.md             # 面向 Agent / 开发者的仓库指南
├── mkdocs.yml            # MkDocs 文档站配置
├── src/                  # React + TypeScript 前端
├── src-tauri/            # Tauri 2 + Rust Host（Vault、Wiki、ACP）
├── docs/                 # MkDocs 文档源文件
└── package.json
```

## 文档

文档使用 [MkDocs](https://www.mkdocs.org/) 和 Read the Docs 主题组织：

| 分区 | 说明 |
| --- | --- |
| [docs/index.md](docs/index.md) | 整体技术框架与文档分层 |
| [docs/frontend/index.md](docs/frontend/index.md) | 前端技术选型与 UI 文档 |
| [docs/backend/index.md](docs/backend/index.md) | 后端技术选型、API 与数据模型 |
| [docs/development/index.md](docs/development/index.md) | 产品、路线图、开发与发布流程 |
| [AGENTS.md](AGENTS.md) | Agent / 开发者协作指南 |

本地预览文档：

```bash
python3 -m venv .venv-docs
. .venv-docs/bin/activate
pip install mkdocs==1.6.1
mkdocs serve
```

## 技术栈

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
