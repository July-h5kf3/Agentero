# 前端

前端是 Agentero 的 Tauri Webview UI，负责浏览 Vault、阅读论文、编辑 Markdown、导航反链/图谱，以及与本地 ACP Agent 对话。

## 技术选型

| 领域 | 选型 | 原因 |
|---|---|---|
| 应用 UI | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | 组件化模型适合复杂桌面工作台，TypeScript 提供类型约束。 |
| 构建 | [Vite](https://vite.dev/) | Tauri Webview 的快速开发服务器与生产构建。 |
| 样式 | [Tailwind CSS 4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) | 基于 token 的简约 UI 与可访问基础组件。 |
| 基础交互 | [Radix UI](https://www.radix-ui.com/) | shadcn 组件底层的键盘与可访问性行为。 |
| 图标 | [Lucide React](https://lucide.dev/) | 适合桌面工具栏的紧凑图标语言。 |
| Agent UI | [AI Elements](https://elements.ai-sdk.dev/) | Conversation、PromptInput、Sources、Reasoning、FileTree 等现成模式。 |
| Markdown 编辑 | [Plate](https://platejs.org/) + `@platejs/markdown` + `@platejs/media` | WYSIWYG 编辑；内嵌图写入 `./assets/`（见 [`ui.md`](ui.md)、[`../backend/data-model.md`](../backend/data-model.md)）。 |
| PDF 阅读 | [react-pdf](https://github.com/wojtekmaj/react-pdf) + [pdf.js](https://github.com/mozilla/pdf.js) | 本地 `blob:` 优先，远程 URL 回退；支持缩放与划词操作。 |
| 全局 Toast | [Sonner](https://sonner.emilkowal.ski/)（shadcn `ui/sonner`） | 右上角操作失败 / 警告；API 见 `src/lib/notify.ts`。 |
| 图谱 | [react-force-graph-2d](https://github.com/vasturiano/react-force-graph) | Canvas 力导向图，适合 Obsidian 式研究网络。 |
| 分栏 | [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | 实现桌面式可拖拽工作台面板。 |

## 布局模型

- 左侧栏：Vault 文件树（虚拟 **Library** + 其下 **Recycle Bin**；魔棒；右键新建 / Finder / 终端 / **删除→回收站**；多选拖拽；Paper 行默认 **标题 · 作者**，排序默认文件夹名，设置可切换标签/排序预设）+ 选中论文时 **Paper Info**（Tags 可编辑）。
- 中间栏：**文档标签页**（标题栏；常驻挂载）。无 Vault 时欢迎页；可开 **Library** / Markdown / PDF / HTML / **图片** / **回收站**。
  - PDF：任意路径本地预览；**导航 / 适应宽·整页 / 大纲 / ⌘F**；真实 scale + 平滑划词；**操作菜单**（高亮 / 笔记 / 提问 / 翻译）。
  - 图片文件：常见格式 `blob:` 预览（`ImageViewer`）。
  - Markdown / Notes：Plate WYSIWYG；内嵌图 → `./assets/`。
  - 快捷键：`⌘W` / `Esc` 先关最顶层弹层（`overlay-stack`），再关标签；仅剩全库时关窗；切标签 `⌥⌘←/→`。见 [`ui.md`](ui.md) §3.0。
  - **规划（V0.6 余）**：**2 格分屏**（文档标签页已落地）。
- 右侧 Notes：**仅**论文 PDF/HTML 时显示该篇 `NOTES.md`；Library 隐藏。
- 可选右侧栏：Agent 或 Backlinks（常驻 collapsible）。
- Backlinks：上方反链，下方 **双链** Graph（非文献引用图；引用图见 V0.7）。
- 多窗口：`⌘N`；Vault 与 tab 按窗口隔离。
- 左下角：后台任务条；右上角：全局错误 Toast（[`ui.md`](ui.md) §2.1.2）。
- paper 行：资源不齐 → Download；齐且未读 → **Zap** 精读；外部改盘 → 编辑器/树自动重载。
- Library：**Rescan** 从磁盘补 catalog。

## 本分区文档

- [`ui.md`](ui.md)：布局、快捷键、全局 Toast、设置、可访问性与交互规则。
- [`components.md`](components.md)：AI Elements 组件清单与业务组件接入约定。

## 交叉引用

- 后端图谱与反链 API：[`../backend/api.md`](../backend/api.md)
- 双链与图谱模型：[`../backend/wikilinks.md`](../backend/wikilinks.md)
- 路线图与 backlog：[`../development/roadmap.md`](../development/roadmap.md)
- PDF 划词提问（MVP 已落地）：[`../development/pdf-ask.md`](../development/pdf-ask.md)
