# 前端

前端是 Motif 的 Tauri Webview UI，负责浏览 Vault、阅读论文、编辑 Markdown、导航反链/图谱，以及与本地 ACP Agent 对话。

## 技术选型

| 领域 | 选型 | 原因 |
|---|---|---|
| 应用 UI | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | 组件化模型适合复杂桌面工作台，TypeScript 提供类型约束。 |
| 构建 | [Vite](https://vite.dev/) | Tauri Webview 的快速开发服务器与生产构建。 |
| 样式 | [Tailwind CSS 4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) | 基于 token 的简约 UI 与可访问基础组件。 |
| 基础交互 | [Radix UI](https://www.radix-ui.com/) | shadcn 组件底层的键盘与可访问性行为。 |
| 图标 | [Lucide React](https://lucide.dev/) | 适合桌面工具栏的紧凑图标语言。 |
| Agent UI | [AI Elements](https://elements.ai-sdk.dev/) | Conversation、PromptInput、Sources、Reasoning、FileTree 等现成模式。 |
| Markdown 编辑 | [Plate](https://platejs.org/) + `@platejs/markdown` | 兼容 Markdown 的 WYSIWYG 编辑，并保留插件扩展空间。 |
| PDF 阅读 | [react-pdf](https://github.com/wojtekmaj/react-pdf) + [pdf.js](https://github.com/mozilla/pdf.js) | 根据 metadata 中的远程 URL 在应用内阅读论文。 |
| 图谱 | [react-force-graph-2d](https://github.com/vasturiano/react-force-graph) | Canvas 力导向图，适合 Obsidian 式研究网络。 |
| 分栏 | [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | 实现桌面式可拖拽工作台面板。 |

## 布局模型

- 左侧栏：Vault 文件树（新建文件 / 文件夹 / 刷新）与 paper 元信息。
- 中间栏：无 Vault 时为欢迎页（最近路径 + 打开 / 创建）；有 Vault 时为 Markdown / PDF / HTML。
- 右侧 Preview：Markdown 渲染预览或当前 paper 的 `NOTES.md`。
- 可选右侧栏：Agent 或 Backlinks。
- Backlinks 右侧栏：上方反链列表，下方 Graph 面板。
- 多窗口：`⌘N` 新开窗口，当前 Vault 按窗口隔离（sessionStorage）。

## 本分区文档

- [`ui.md`](ui.md)：布局、快捷键、设置、可访问性与交互规则。
- [`components.md`](components.md)：AI Elements 组件清单与业务组件接入约定。

## 交叉引用

- 后端图谱与反链 API：[`../backend/api.md`](../backend/api.md)
- 双链与图谱模型：[`../backend/wikilinks.md`](../backend/wikilinks.md)
- 路线图与 backlog：[`../development/roadmap.md`](../development/roadmap.md)
