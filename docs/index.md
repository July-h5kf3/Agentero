# Motif 文档

Motif 是一个本地优先、Agent-first 的科研工作台，由 Tauri 桌面 Host、React 前端和普通文件组成的 Vault 数据模型构成。本文档按工作边界分层：前端 UI、后端/Host 数据契约、开发与产品流程。

## 技术框架

```text
Motif 桌面应用
├── Frontend Webview
│   ├── React 19 + TypeScript + Vite
│   ├── Tailwind CSS 4 + shadcn/ui + AI Elements
│   ├── Plate Markdown 编辑
│   ├── react-pdf / iframe 阅读器
│   └── react-force-graph-2d 图谱面板
├── Tauri Host
│   ├── Rust + Tauri 2 commands/events
│   ├── 文件系统访问与 Vault IO
│   ├── 双链 / 反链 / 图谱索引
│   ├── 面向 BYOA Agent 的 ACP Client
│   └── 本地配置与可重建缓存
└── Vault
    ├── Markdown 笔记与 paper notes / source
    ├── .motif/catalog.sqlite（论文集合 + metadata 权威）
    ├── 可选导出 PAPERS.md / library.bib（非默认）
    └── papers/<id>/ 下 NOTES、highlights、可选 PAPER.md、source/
```

## 文档分层

| 分层 | 目录 | 说明 |
|---|---|---|
| 前端 | [`frontend/`](frontend/index.md) | 工作台 UI、组件约定、AI Elements 接入、右侧栏行为。 |
| 后端 | [`backend/`](backend/index.md) | Tauri command 契约、Vault 数据模型、Catalog SQLite、双链/反链/图谱索引。 |
| 测试 | [`test/`](test/index.md) | 前端 Vitest、Rust 单测、临时 Vault fixture 与验证策略。 |
| 开发 | [`development/`](development/index.md) | 产品需求、路线图、实现 backlog、发布与开发流程。 |

## 当前 UI 形态

- 默认工作台：文件树 + 中间内容 +（按需）Notes + 可选右侧栏。
- 文件树顶部有虚拟节点 **Library**；中间栏可展示 catalog **论文库表格**（排序、双向滚动），数据来自 `paper_list`。
- **Paper Info / Notes** 仅在选中具体论文时出现；论文库视图不显示。
- 无 Vault 时中间栏为欢迎页（最近路径 + 打开 / 创建）；`⌘N` 可开多窗口。
- 可选右侧栏只有两个顶层入口：Agent 与 Backlinks。
- Backlinks 视图上方显示反链，下方显示 Graph；Graph 不是独立顶层 tab。
- 魔棒：侧栏粘贴标识符 → Translator → catalog + **默认下载 PDF**（arXiv 含 LaTeX 解压）。
- 补资源：paper 行缺 PDF 或 arXiv 缺 TeX 时 Download；Library 行可**批量**补全部缺失（见 [`backend/identifier-lookup.md`](backend/identifier-lookup.md)）。
- 实现状态与路线图：[`development/roadmap.md`](development/roadmap.md)。

## 关键三方技术

| 领域 | 三方库 / 服务 |
|---|---|
| 桌面 Host | [Tauri 2](https://v2.tauri.app/)、[Rust](https://www.rust-lang.org/) |
| 前端运行时 | [React](https://react.dev/)、[TypeScript](https://www.typescriptlang.org/)、[Vite](https://vite.dev/) |
| 样式与 UI | [Tailwind CSS](https://tailwindcss.com/)、[shadcn/ui](https://ui.shadcn.com/)、[Radix UI](https://www.radix-ui.com/)、[Lucide](https://lucide.dev/) |
| Agent UI | [AI Elements](https://elements.ai-sdk.dev/)、[Streamdown](https://github.com/vercel/streamdown)、[Agent Client Protocol](https://agentclientprotocol.com/) |
| 编辑器与阅读器 | [Plate](https://platejs.org/)、[react-pdf](https://github.com/wojtekmaj/react-pdf)、[pdfjs-dist](https://github.com/mozilla/pdf.js) |
| 图谱 | [react-force-graph-2d](https://github.com/vasturiano/react-force-graph) |
| 文档站 | [MkDocs](https://www.mkdocs.org/) + [Read the Docs 主题](https://www.mkdocs.org/user-guide/choosing-your-theme/#readthedocs) |

## 推荐阅读顺序

- 产品状态与路线图：[`development/roadmap.md`](development/roadmap.md)
- 前端布局：[`frontend/ui.md`](frontend/ui.md)
- 后端 API 契约：[`backend/api.md`](backend/api.md)
- Vault 数据模型：[`backend/data-model.md`](backend/data-model.md)
- 论文目录库：[`backend/catalog.md`](backend/catalog.md)
- 魔棒入库与 Translator：[`backend/identifier-lookup.md`](backend/identifier-lookup.md)
- 测试与验证：[`test/index.md`](test/index.md)
