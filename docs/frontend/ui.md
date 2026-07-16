# Agentero UI 规范

## 1. 主题与设计系统

- **基础组件**：以 [shadcn/ui](https://ui.shadcn.com/) 为规范（`components.json` → `style: radix-nova`，`baseColor: neutral`，CSS variables）。
- **主题**：tweakcn **modern-minimal**（覆盖 token，不另起皮肤）：
  ```bash
  pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/modern-minimal.json
  ```
- **Chat / Agent / 文件树 AI UI**：以 [**AI Elements**](https://elements.ai-sdk.dev/) 为规范（完整约定见 **`docs/frontend/components.md`**）：
  - 落盘：`src/components/ai-elements/`（`conversation`、`message`、`prompt-input`、`sources`、`file-tree` 等）
  - 安装：`pnpm dlx shadcn@latest add https://elements.ai-sdk.dev/api/registry/<name>.json -y -o`
  - 主题 **不单独配置**：继续读 shadcn CSS token，随 System / Light / Dark。
  - 传输层是 Agentero **ACP Client**（`agent_run_once` + 事件流），**不是** Vercel AI SDK `useChat`。
  - **禁止**用自研 `src/components/ai/*` 或官方 `ui/message`+`bubble` 搭新 Chat。
- 视觉原则：**尽量简约，减少不必要的元素**。
- 外观跟随 **System / Light / Dark**（`next-themes`，设置 → Appearance）。

## 2. 文案 vs 图标

| 场景 | 规则 |
|---|---|
| 工具栏、侧边栏操作、可识别的动作 | **优先用图标**，不要用长按钮文案 |
| 图标含义 | 必须配 `aria-label`；悬停用 **Tooltip** 显示短标签 |
| 页面主标题、空状态、错误、表单字段 | 可用文字；错误仅在发生时出现 |
| 解释性说明文案 | 默认不展示；避免常驻帮助段落挤占空间 |

### 2.1 侧边栏文件树

- 树 UI：**AI Elements** `FileTree`（业务包装：`src/components/layout/file-tree.tsx`；约定见 `docs/frontend/components.md`）。
- **虚拟节点 Library**：树顶固定一项 **Library / 论文库**（路径常量 `agentero:library`，非真实目录、不写盘）。图标 `Library`。选中后中间栏显示论文库表格（见 §3）。空 Vault 时仍显示该节点。
- **Library 行 Download**：当库内**任一** paper 资源不完整时，Library 标题右侧显示 Download；点击**批量** `paper_download_assets`。
- **Paper 行 Download**：下列任一成立即显示，hover 列出原因：
  - 本地**没有 PDF**（期望在论文根目录 `{id}.pdf`）；
  - **既没有 TeX 也没有 `PAPER.md`**（二者有其一即可，**优先 TeX**）；
  - 点击后：PDF 写入论文根目录 → arXiv 尽量下 TeX 到 `source/` → **无 TeX** 时 liteparse 写 `PAPER.md`。
- **Paper 行 Eye（精读）**：当本地资源**已齐全**（有 PDF，且有 TeX 或 `PAPER.md`）且 catalog **`is_read === false`** 时显示 `Eye` 图标；点击可**手动**启动 **paper-reader**。
- **自动精读**：魔棒入库 / 单篇 Download 在 PDF（或 TeX / `PAPER.md`）就绪且 `is_read === false` 时**自动**启动同一工作流；左下角先显示入库/下载任务进度，完成后接上 `paperRead` 精读进度。运行时 skill 触发按 provider：**Codex `$paper-reader`**、**Claude `/paper-reader`**、其它仅注入 `SKILL.md`。成功后 `is_read = true`，Eye 消失。
- 顶栏单行：左侧 Vault 名称（可截断）+ 右侧 **纯图标操作**。
- 动作映射（Lucide），从左到右：
  - **按标识符添加（魔棒）** → `WandSparkles`（紧挨 **New file 左侧**；Popover 粘贴 arXiv 链接/编号 → Host `lookup_import`）
  - 新建文件 → `FilePlus2`（在选中目录 / 文件父目录下 **树内联命名**，Enter 确认 / Esc 取消，对齐 VS Code）
  - 新建文件夹 → `FolderPlus`（同上）
- **刷新文件树**不在侧边栏：使用菜单 **File → Refresh File Tree**（`⌘R`）。
- **在系统文件管理器中显示**（`revealItemInDir` / `src/lib/reveal.ts`）：
  - **双击**真实文件 / 文件夹 / paper 行 → 在 Finder（macOS）/ Explorer（Windows）/ 文件管理器（Linux）中定位并选中。
  - **右键**同上节点 → 上下文菜单「在 Finder 中显示」（文案随平台切换；旁注 `⌥⌘R`）。
  - **`⌥⌘R`**：对当前选中路径执行相同操作（`shortcuts.ts` → `revealInFinder`）。
  - 虚拟节点 **Library**（`agentero:library`）不提供此操作；仅桌面端可用。
- **删除**（`remove` + 可选 `paper_delete`）：
  - **右键**真实节点 →「删除」（旁注 `⌘⌫`）；确认后删盘。
  - **`⌘⌫`**：删除当前选中项（编辑器 / 输入框聚焦时不拦截，保留系统删行首行为）。
  - 路径在 `papers/` 下时同步清理 catalog 对应行（含组织目录下嵌套 paper）；随后刷新文件树、Library 与双链索引。
  - 不可删：虚拟 Library、Vault 根。
- **多选与批量操作**（`file-tree.tsx` + 原语 `ai-elements/file-tree.tsx`）：
  - 对齐 VS Code / Finder：**无勾选框**，以**行高亮**表达选区。**Ctrl/⌘ 点击**切换单项、**Shift 点击**按可见顺序选区间；普通点击仍为单选并打开。
  - 选中 ≥1 项时树顶出现**批量条**（移动 / 删除 / 清空）；右键选中项菜单提供「删除 N 项 / 移动 N 项」；`Delete`/`⌘⌫` 批量删除，`Esc` 清空（编辑 / 输入聚焦时不拦截）。
  - **拖拽移动**：把行（或整个选区）拖到某个 `papers/` 组织文件夹（含 papers 根）即移动；仅这类文件夹是合法落点（论文文件夹与 Library 除外），hover 时以 ring 高亮。经 `onMoveTo` 复用批量移动管线，无需对话框。
  - **批量移动**（`MovePapersDialog` → `paper_move`）：把选中项移到某个 `papers/` 子文件夹（现有或新建）；移动文件夹并改写 catalog 路径前缀，随后统一刷新树 / Library / 双链。
- **不要**在侧边栏放打开 / 创建 Vault、关闭 Vault、刷新或设置入口。
- **不要**使用「Open vault… / Refresh」等文字按钮。

### 2.1.1 后台任务（左下角，IDE 风格）

- **位置**：窗口左下角固定悬浮（`BackgroundTasksPanel`，`src/components/layout/background-tasks-panel.tsx`），不占用侧栏布局；禅模式隐藏。
- **显示时机**：**有任务时**才出现；全部结束后约 4s 自动消失。
- **收起态**：一条状态条——转圈 / 完成勾 + 当前任务标题或「N 个进行中」+ 进度条；点击展开/收起。
- **展开态**：任务列表（队列序号、标题、详情、进度）；可清除已完成项。
- **外观**：`bg-popover` 实底 + 边框阴影；**hover 使用实色 `hover:bg-accent`**（禁止 `accent/40` 等半透明，避免底下内容透出）。
- **接入任务**：单篇下载、批量下载、魔棒入库、文献库导入/导出、**paper-reader 精读**等长操作经 `runBackgroundTask` / `startBackgroundTask` 登记（`kind` 含 `download` | `downloadAll` | `lookup` | `import` | `export` | `paperRead` | …）。
- **paper-reader 进度**：任务 kind=`paperRead`；title/detail 走 i18n `app:tasks.paperRead*`；plan/tool 事件会更新进度百分比；失败时 error 写入任务条。
- 交互对齐常见 IDE（VS Code 类）：不抢焦点、可折叠、只展示后台进度，错误仍可走原有 error 槽位。

### 2.2 无 Vault 欢迎页

当当前窗口未打开 Vault 时，中间栏显示欢迎页（`src/components/layout/vault-welcome.tsx`）：

- **内容**：图标 + **Create vault** / **Open vault** 按钮 + **Recent** 路径列表（可点打开，可从列表移除）。
- **不加**常驻说明文案、标题口号或快捷键提示（保持空状态极简）。
- 点选最近路径时若目录不存在：提示错误并从列表剔除。

### 2.3 原生菜单与多窗口

| 菜单 | 项 | 快捷键 | 行为 |
|---|---|---|---|
| File | New Window | `⌘N` | Host `window_new`：新 Webview 窗口（`?fresh=1`），**不**自动恢复上次 Vault |
| File | Open Vault… | `⌘O` | 选择已有文件夹并打开 |
| File | Create Vault… | `⇧⌘N` | 选择目录 → Host `vault_create` 脚手架 |
| File | Refresh File Tree | `⌘R` | 刷新当前 Vault 文件树 |
| agentero | Settings… | `⌘,` | 设置 sheet |

**窗口与路径状态**（`src/lib/vault.ts`）：

| 存储 | 键 / 用途 |
|---|---|
| `sessionStorage` | 当前窗口已打开的 Vault 路径（多窗口互不抢） |
| `localStorage` | 最近 Vault 列表（MRU，欢迎页）、上次 Vault（主窗口「恢复最近」） |
| 查询参数 `fresh=1` | 新建窗口标记：跳过自动恢复，直接欢迎页 |

主窗口在设置开启「恢复上次 Vault」且非 `fresh` 时，用 `localStorage` 上次路径自动打开；`⌘N` 窗口始终从欢迎页开始。

## 3. 布局

- 工作台默认 **三栏**：文件树 + 中间内容 + 可选右侧栏（Agent / Backlinks）。中间内容为**文档标签页**（浏览器式多 tab，见 §3.1.1），Notes 随激活文档切换。
- **论文库表格**（`src/components/layout/papers-library.tsx`）：
  - **入口**：文件树虚拟节点 `agentero:library`；亦在选中 Vault 根 / `papers/` / 未选文件时作为中间栏默认视图。
  - **数据**：Host `paper_list` → catalog.sqlite（不扫盘拼表）。前端封装 `src/lib/papers-api.ts`。
  - **列**：标题、作者、年份、类型、标识符；点击行打开对应 paper 文件夹。
  - **排序**：点击表头按该列升序 / 降序切换；同一列再点切换方向。年份列首次点击为降序（新→旧）；文字列默认升序。
  - **滚动**：容器 `.agentero-scroll-both`（**横向 + 纵向** `overflow: auto`）。表格 `w-max min-w-full` + 列 `min-width`，宽表可左右滑。
  - **中间栏 header（右侧）**：仅 **导出**（Download 图标），无「Library」文案。
    - **导出**：`paper_export` → Translator `/export?format=bibtex` → 保存对话框写 `.bib`。
  - **导入**（Upload）：在侧栏**魔棒 Popover 卡片左下角**（与「添加」按钮同一行）；打开 `.bib`/`.ris`/… → `paper_import` → Translator `/import` → catalog + paper 文件夹（默认下 PDF/TeX）。
  - **从 Zotero 迁移**（`Import` 图标，论文库工具栏左侧；仅 Library 视图）：`ZoteroMigrateDialog` → 选 Zotero 数据目录 → 预览文献/PDF 计数 + 「把 PDF 复制进知识库」勾选（默认开）→ `zotero_migrate`（直读 `zotero.sqlite`，见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md) §16）。
- **Paper Info / Notes——仅具体论文**：
  - **左侧 Paper Info**（`paper-info-panel`）：仅当存在 `paperMeta`（选中 paper 文件夹）时渲染；论文库 / 普通笔记时隐藏。
  - **Notes（WYSIWYG，无独立预览栏）**：中心切换为 Notes 时全宽编辑 `NOTES.md`；中心为 PDF/HTML 时右侧栏显示同一篇 `NOTES.md` 实时编辑。论文库视图或未选论文时隐藏。
  - **格式工具栏（WYSIWYG toolbar）**：`MarkdownEditor` 顶部可选的固定工具栏（`editor-toolbar.tsx`），提供标题（H1–H3）、引用、加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 高亮、无序 / 有序 / 待办列表等常用格式按钮，无需手写 Markdown 即可排版。由全局设置 `showEditorToolbar`（默认开）控制，Notes 面板 header 右侧另有 `PanelTop` 一键显示 / 隐藏；只读时不渲染。所有按钮均有 `aria-label` + Tooltip，i18n `editor:toolbar.*`。
  - **Notes 显示开关 / 快速打开 / 关闭文档**：`showNotes`（默认显示）控制右侧 Notes 栏是否挂载。看 PDF/HTML 时，中间栏 header 右侧提供 `NotebookPen` 快捷开关（一键显示/隐藏 Notes）；全局入口则在标题栏 **Layout 菜单**（见下）；`⌘3` 聚焦 Notes（隐藏时先显示再聚焦）。关闭当前文档为中间栏 header 右侧的 `X`（`closeDocument`）→ 关闭当前标签（等价 `⌥⌘W`）；论文库视图与欢迎页不显示。
- **⌘L** 显示 / 隐藏右侧栏；右侧栏入口为 **Agent** 与 **Backlinks**。
- **Layout 菜单**（标题栏 `PanelsTopLeft` 图标，`src/components/layout/layout-menu.tsx`）：集中式面板可见性开关（对齐 VS Code「Customize Layout」）。以复选项反映并切换 **左侧边栏 / Notes / 右侧边栏 / 禅模式**，各项显示对应快捷键；Notes 项仅在打开论文 PDF/HTML 时可用；切换时菜单保持打开。i18n `app:titlebar.layout*`。
- Backlinks 入口内采用上下分区：上方反链列表，下方 Graph。Graph 不再是独立顶层 tab。
- **Agent 禅模式**（quest / Cursor Agents Window 心智，`⌥⌘Z` 或标题栏 Focus 图标）：
  - 进入后：折叠左栏与中间主栏，右栏 Agent 铺满；系统标题栏仅拖拽区 + 退出；隐藏后台任务条与 Notes。
  - **同一** `AgentPanel` 实例保持挂载（CSS 切换 / 不 remount），会话与流式状态不丢。
  - **布局**（`variant="zen"`）：浅底全幅画布；顶栏工具与对话列同宽居中（`max-w-2xl`）；空态垂直居中；底部 Composer 圆角悬浮（无侧栏式 `border-t` 底条）。
  - 仍用 AI Elements：`Conversation` / `Message` / `PromptInput` / `Suggestion` 等。
  - 退出：标题栏 / 面板头 **X**，或再次 `⌥⌘Z`；恢复进入前左栏折叠意图与右栏默认宽度。
- **左右侧栏隔离**（`react-resizable-panels`）：
  - 左栏（文件树）与右栏（Agent/Backlinks）均为 **常驻 collapsible 面板**（`collapsedSize=0`），用 `expand`/`collapse`/`resize` 切换，**不要**对右栏做条件卸载整块 `ResizablePanel`（否则 Group 重排会冲掉左栏折叠态）。
  - 两侧使用 `groupResizeBehavior="preserve-pixel-size"`，并把上次展开像素宽记入 ref；中间主栏保持默认相对尺寸。
  - Notes 列仍随论文选中条件挂载（需真实 `defaultSize` 才能出现）；`showNotesOnRight` 变化后 rAF 再 assert 左右栏宽度/折叠意图，避免 Library ↔ paper 时左栏跳宽。
- **文档标签栏位置**：与标题栏右侧禅模式 / Layout / 右栏图标 **同一行**（`DocumentTabBar` 在 `header` 中间 flex 区；无 tab 时该区为拖拽空白）。中间栏仅保留 view mode / 文档标题工具行。
- 各栏 header 等高：统一 `h-10`（`PaneHeader` / `PANE_HEADER_CLASS`），水平对齐；错误提示等放在 header 下方，不撑高标题栏。
- 边距、分割线保持轻量；控件密度偏紧凑（icon-xs / icon-sm）。
- **面板分隔（sash）**：对齐 VS Code / Cursor——默认 **1px** 细线，hover / 拖拽时略提亮；可点区域略宽但视觉不占粗条。实现见 `src/components/layout/resizable.tsx`。
- **独立滚动**：侧边栏 / 中间内容 / 右侧 Notes **各自**滚动，顶栏固定；禁止整页连带滚动。
  - 默认竖向：`.agentero-scroll`（`overflow-x: hidden; overflow-y: auto`）。
  - 需双向滚动（论文库表）：`.agentero-scroll-both`。
- **中间栏视图切换**（纯图标 + Tooltip）：**仅 PDF · HTML**（`ViewModeToggle`）；无 PDF/HTML 时不显示切换。论文库视图下不显示。
  - Notes / 普通 Markdown 文件：**所见即所得富文本编辑**（Plate），在 Notes 侧栏或打开 `.md` 时编辑；不占中间栏切换卡片。
  - **保存**：编辑防抖后 **自动写回** 磁盘 `.md`，`⌘S` 立即保存；有未保存更改时 pane header 显示小圆点。未发生真实编辑不会写盘（打开文件不触发保存）。
  - **双链**：`[[目标#标题|别名]]` 与 `![[嵌入]]` 由 `@flowershow/remark-wiki-link` 解析并 **无损回写**；渲染仍复用既有 exists/missing 样式与点击导航。
  - **YAML frontmatter** 按字节原样保留（不经 Plate 往返）；注意 Plate 会归一化部分 Markdown 风格（列表 `-`→`*`、斜体 `*`→`_`），内容语义不变。
  - PDF / HTML **预览**：
    - **PDF 解析顺序**（本地优先）：① 论文文件夹内本地 PDF（根目录 `{id}.pdf` 优先，兼容 `source/` 等嵌套）→ `readFile` 读字节生成 `blob:` URL 交给 PDF.js（**不用** `convertFileSrc`/`asset://`，PDF.js XHR 会失败）；② **无本地 PDF** 时自动 `paper_download_assets` 尝试下载；③ 下载失败或无可用下载源时回退 catalog 远程 `pdf_url`（或 `arxiv_id` 推导 URL）。
    - **HTML**：仍读远程 `html_url`（iframe）；HTML 本身不强制本地下载。
  - **本地归档**：魔棒 / `paper_download_assets` 将 PDF 写入 `{paper}/{id}.pdf`（根目录），arXiv LaTeX 到 `source/`；预览优先读同一本地 PDF。
  - arXiv 推荐写入 catalog：
    - `pdf_url`: `https://arxiv.org/pdf/{id}`
    - `html_url`: `https://arxiv.org/html/{id}`
    - `source_url`: `https://arxiv.org/abs/{id}`
  - 若只有 `arxiv_id`，用 `src/lib/arxiv.ts` 推导远程 URL（作下载候选与 HTML/远程回退）
  - PDF：本地经 `blob:`（fs `readFile`）/ 远程 `https` 由 PDF.js 渲染；HTML：独立 iframe 打开远程页
  - **PDF 缩放**（`PdfViewer`）：工具栏放大 / 缩小 / 重置；`⌘/Ctrl`+滚轮缩放；范围约 **0.5×–3×**；**100% = 适应中间栏宽度**（非固定 pt）。i18n `viewer:pdf.zoom*`。
  - **PDF 划词操作菜单**（已落地，见 [`../development/pdf-ask.md`](../development/pdf-ask.md)）：
    - 划词后在选区旁弹出操作菜单（图标 + Tooltip）：**高亮 / 笔记 / 提问 / 翻译**；**不再默认套用琥珀高亮**，只保留浏览器原生选区。双击 / 悬停停留仍直接开问答卡（页码上下文）。
    - 高亮：`papers/<id>/highlights/<id>.json`（归一化坐标可重定位）→ 页面琥珀覆盖层；点击已有高亮出现「删除」浮层。笔记：选中原文以块引用 `> …` 追加进该篇 `NOTES.md`（经编辑器实例写入，避免覆盖未存改动），菜单内联「已加入」。提问 / 翻译复用迷你问答卡（ACP 流式）；发送过问题后锚点旁保留对话图标（Hover 回访）。
    - 提问线程落盘 `papers/<id>/asks/<threadId>.json`；高亮 / 提问 / 笔记均**不**写 PDF 二进制。
  - **PDF/HTML 时右侧自动加载该篇 `NOTES.md`**（可编辑，自动保存 / `⌘S`）
  - **HTML 沙盒**：独立 `<iframe>`；arXiv 允许 scripts（对方 origin）；布局铺满中间栏
- 无障碍：图标按钮必须有可访问名称；焦点环使用主题 `ring`。

### 3.1 快捷键（对齐 macOS / Apple HIG 习惯）

显示使用 Apple 符号：`⌘ ⌥ ⇧ ⌃`。Windows / Linux 上将 `⌘` 映射为 `Ctrl`。

| 快捷键 | 作用 | 说明 |
|---|---|---|
| `⌘,` | 打开 / 关闭 Settings | 系统级 Preferences 约定 |
| `Esc` | 关闭 Settings | 关闭 sheet / 对话框 |
| `⌘N` | 新建窗口 | `window_new`；欢迎页 + 最近列表，不恢复上次 Vault |
| `⌘O` | Open vault… | 打开文档/文件夹 |
| `⇧⌘N` | Create vault… | 创建并初始化新 Vault（含 catalog） |
| `⌘R` | 刷新文件树 | 刷新当前视图 |
| `⌥⌘R` | 在 Finder 中显示 | 定位当前选中文件/文件夹；`shortcuts.ts` → `revealInFinder` |
| `⌘⌫` | 删除选中项 | 文件树选中项；确认后删盘；`papers/` 同步 `paper_delete`；编辑区不拦截 |
| `⌥⌘S` | 显示 / 隐藏侧边栏 | 对齐 Mail / Preview 等侧边栏约定 |
| `⌘B` | 显示 / 隐藏侧边栏（别名） | 兼容常见生产力应用 |
| `⌘1` | 聚焦侧边栏 | 分区焦点（Mail 等） |
| `⌘2` | 聚焦编辑器 | |
| `⌘3` | 聚焦 Notes（`focusNotes`；论文 PDF/HTML 侧栏 Notes） | |
| `⌥⌘W` | 关闭当前标签（`closeTab`） | 关闭中间栏激活文档；`⌘W` 仍关窗口 |
| `⌥⌘→` / `⌥⌘←` | 下一 / 上一标签（`nextTab` / `prevTab`） | 在打开的文档标签间循环 |
| `⌘L` | 显示 / 隐藏右侧栏 | Agent / Backlinks（含 Graph） |
| `⌥⌘Z` | Agent 禅模式 | 全屏仅 Agent 对话（quest / Agents Window 心智）；再按退出；`toggleAgentZen` |
| `⇧⌘I` | 魔棒（按标识符添加） | 打开侧栏魔棒 Popover；`shortcuts.ts` → `magicWand`；设置 Keyboard 可见 |

- 在编辑区聚焦时同样生效；涉及浏览器保留键时需 `preventDefault`。
- 快捷键清单以设置页 **Keyboard** 为准，实现见 `src/lib/shortcuts.ts`。
- **魔棒**（已落地 v0）：侧栏 `WandSparkles` Popover；粘贴链接或编号 → Host `lookup_import` → Translator（`translatorBaseUrl`，默认 `https://translator.philfan.cn`）→ catalog + paper 壳。  
  - 目标目录：默认 `papers/`；当前在 Papers 子文件夹时写入该子路径。  
  - **始终下载 PDF** 到 `{paper}/{id}.pdf`（论文文件夹根目录）。  
  - **arXiv**：另从 `https://arxiv.org/e-print/{id}` 下载并解压 LaTeX 到 `source/`。  
  - 详见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)；i18n `sidebar:lookup.*` / `papersLibrary.*`；无 Vault 时禁用。
- **论文行 Download**：缺本地 PDF，或既无 TeX 也无 `PAPER.md` 时显示；hover 列出原因 → `paper_download_assets`（已有资源跳过）。下载后若仍无 TeX 且有 PDF，Host 自动 liteparse 写 `PAPER.md`。Library 行可对库内全部不完整 paper **批量** Download。
- **论文行 Eye（精读）**：资源齐全且 catalog `is_read === false` 时显示；点击**手动**启动 paper-reader（`agent_run_once` + skill；**Codex 用 `$paper-reader`，Claude 用 `/paper-reader`，其它靠注入正文**）→ 写/更新 `{paper}/NOTES.md` → `paper_set_is_read(true)`。魔棒入库 / 单篇 Download 成功后会**自动**同一工作流（批量不连跑）。进度在左下角后台任务条（lookup/download → paperRead）。

### 3.1.1 文档标签页（已落地）与分屏（规划，roadmap V0.6）

**浏览器式文档标签页**（`src/components/layout/document-tab-bar.tsx`、模型 `src/lib/tabs.ts`）位于**窗口标题栏**（与禅模式 Focus 图标同行）：

- **多 tab**：paper / Markdown / PDF / HTML / Library 各占一个 tab，可切换、关闭（`X` / 中键 / `⌥⌘W`）、拖拽重排；同一路径已开则聚焦其 tab（不重复打开）。
- **常驻挂载**：每个 tab 的内容组件保持 mounted（非激活 `hidden`），切换瞬时并保留 **PDF 滚动位置/缩放** 与编辑器状态。PDF 多篇同开会同时占用内存（符合浏览器式取舍）。
- **状态派生**：`activeTab` 驱动 `selectedPath` / `centerMode` / `paperMeta` / Notes；文件树选中与「新建父目录」上下文用独立的 `treeSelectedPath`（跟随激活文档，folder 新建时可指向文件夹）。
- **持久化**：`agentero-open-tabs`（`{tabs:[{path,mode}], activeIndex}`）按窗口保存，重开窗口恢复 tab 集与激活项；`⌘N` 各窗口独立。
- **NOTES 编辑器**：每篇 paper 的 `NOTES.md` 编辑器也按 tab 常驻挂载在右侧 Notes 栏；paper-reader / download 写回后按路径 reseed 对应 tab。

规划中（尚未实现）：

- **2 格分屏**（水平或垂直）：例如 PDF | NOTES、两篇 paper 并排；分屏快捷键随实现补入本表与 `shortcuts.ts`。
- tab 固定（pin）、按 paper 分组、「当前 tab vs 新 tab 打开」策略可配。
- 与 Agent 面板 **会话标签** 分离（不同概念）。

### 3.1.2 规划：文内引用 hover → Paper Info（roadmap V0.7）

阅读 PDF/HTML/`PAPER.md` 时，对文内引用锚点 hover，右侧 Paper Info 展示**被引论文**元信息（库内打开 / 库外缓存 + 入库）。引用邻域图与 Agent 引用工作流见 roadmap V0.7；**不**与 Backlinks 双链 Graph 混为一谈。

### 3.2 Agent 右侧栏（AI Elements）

| 要求 | 说明 |
|---|---|
| 入口 | `⌘L`、标题栏右侧 Agent 图标、菜单 **View → Toggle Chat** |
| 结构 | 会话标签 · Agent 选择 / 新建 / 历史操作 + 消息列表 + Composer |
| 消息组件 | AI Elements `Message` + `MessageContent` + `MessageResponse`（`from="user" \| "assistant"`） |
| 列表滚动 | `Conversation` + `use-stick-to-bottom`（`ConversationScrollButton`） |
| 输入 | 单层 Composer：当前文件以可切换 chip 呈现（打开文件时默认未选中的虚线态，点击加入/移出上下文），`@` 文件提及和 `$` 本机技能显示为可移除 context chip；候选列表支持 `↑` / `↓`、`Enter`，当前项仅使用背景高亮；文字与 context chip 按 Vault、Agent、session 独立持久化，发送成功后清空该 session 已发送的一次性上下文；发送按钮与 `↵` 均可提交，输出期间按钮和 `Esc` 均可中止，`⇧↵` 换行；Agent 输出期间仍可编辑下一条输入；底栏空闲时使用主要色，仅存在正在输出的 Agent 消息时切换为次要色，Fast 的启用色保持不变；`/` 文本原样透传给 ACP Agent |
| 业务壳 | `src/components/layout/agent-panel.tsx`：注册表、流式事件、默认 Agent |
| Sources | `ai-elements/sources`：Vault 相对路径列表 |
| 不内置 | 模型 Key、Agent 二进制（BYOA） |
| 规范文档 | **`docs/frontend/components.md`** |

**消息树（AI Elements；不带头像）**

```text
Conversation
  └── ConversationContent
        ├── Message from="user" → MessageContent → MessageResponse
        └── Message from="assistant" → MessageContent
              ├── Reasoning（ACP thought，可选）
              ├── MessageResponse
              └── Sources（可选）
PromptInput → Body / Footer / Submit
```

**Agent 切换**：点击 Composer 上方的 Agent 图标打开下拉，列表来自 catalog + 注册表；选择后设为默认并用于后续 `runOnce`。

**消息编辑与重发**：会话空闲时（发送成功、停止或失败后）hover 已发送的用户消息会显示 **Edit（铅笔）** 与 **Copy** 两个图标按钮；运行中不显示 Edit，须先按 `Esc` / 点击停止。点击 Edit 就地把气泡替换为文本框（`↵` 重新发送、`⇧↵` 换行、`Esc` 取消），重发时会丢弃**该消息及其之后的所有内容**（旧回答 / 被中断的运行）并以新文本发起一次全新的 turn，用于修正发错的输入。切换会话 / 标签 / 新建对话会自动取消未完成的编辑。（重发沿用普通发送的 session 续接规则：非 Codex 每次新建 session；Codex 续接原生 thread，因此可见转录被截断但 Agent 侧线程记忆不随之回退。）

**会话标签**：运行中的 Agent session 不会锁定标签栏。用户可随时切换并查看其它已打开的会话，也可在新会话中发起独立运行；同一 session 在运行期间保持只读，避免重入。流式消息、工具调用和最终状态仍只写回它们所属的 session。

**上下文提及**：Composer 默认附带当前打开的 Vault 文件；输入 `@` 可按 Vault 内 Markdown 路径筛选并加入 context chip。发送时 Agentero 将这些 Vault 相对路径追加到 prompt，并将第一个路径传为 `target`，Agent 仍按自身权限读取文件。

**本机技能**：Composer 统一用 `$` 打开技能选择器（Agentero UI 约定，与运行时触发语法无关）。可选来源：`~/.agents/skills`、`${CODEX_HOME:-~/.codex}/skills`、`~/.claude/skills`、当前 Vault `.agents/skills`。选中后显示为 context chip；发送时 Host 重新解析技能 id、校验文件大小，并**按当前 Agent 模板**组装 prompt：

| Agent 模板 | 运行时 skill 提及 | Host 行为 |
|---|---|---|
| **Codex** (`codex-acp`) | **`$skill-id`** | 用户 prompt 前缀 `$id` + 注入完整 `SKILL.md`（双保险） |
| **Claude** (`claude-acp`) | **`/skill-id`** | 用户 prompt 前缀 `/id` + 注入完整 `SKILL.md` |
| 其它（OpenCode / Gemini / Qoder / Grok / custom） | 无原生触发 | 仅注入 `SKILL.md` 正文，并在 prompt 中说明不要等待 `$`/`/` 命令 |

paper-reader 精读工作流与 Composer 共用这套规则，避免把 Codex 的 `$` 误写成 Claude 的 `/`，或反向。

**斜杠命令**：Agentero 不实现自己的 `/` 命令菜单。用户手打的 `/…` 原样透传；Claude 路径上 Host 也可能主动加上 `/skill-id` 前缀以对齐其 skill 语法。Codex 使用 App Server native thread，skill 侧以 `$` 为准。

**权限模式**：**设置 → Agent** 提供一个全局「权限模式」下拉，对**所有 Agent** 的运行生效（存于 app settings，默认 **受限**）。**受限（默认）**时，Agentero 取消 ACP 的权限请求（Codex 走原生策略、沙箱为 `workspace-write`）；**自动批准**时自动选择 Agent 给出的第一个权限选项（Codex 沙箱切换为 `danger-full-access`）。选 **自动批准** 时面板下方显示一行风险说明。逐项权限确认需要由保持 ACP 会话的后续实现提供；届时可在此下拉新增「每次询问」档。

**回答语言**：**设置 → Agent** 提供一个全局「回答语言」下拉（**自动 / English / 简体中文**，存于 app settings，默认 **自动**），**独立于界面语言**，对**所有 Agent** 交互生效（Composer 对话、精读、summary/QA、PDF 划词问答）。前端 `runOnce` 统一读取该设置并透传，Host 在 `build_prompt` 为所有 workflow 追加一句语言指令；选 **自动** 时不注入任何指令，交由 Agent 依据内容决定。

**Codex 控件**：只有选中 `codex-acp` 时，底栏才显示 App Server `model/list` 提供的模型与 reasoning effort，以及仅在闪电图标内填充黄色的 Fast toggle。选择在下一次 native turn 中传给 App Server；其他 Agent 不显示也不接收这些偏好。

**Codex 历史**：Agentero 会将它创建或继续运行的 native thread id 记录在 Vault 的 `.agentero/agent-sessions/codex.json`。历史列表默认只显示这份索引中的会话，避免混入同一 Vault 工作目录下由 Codex CLI、编辑器或其它应用创建的 thread。历史面板的“External”开关仅对 Codex 生效；开启后显示 App Server 返回的全部 Vault-scoped thread。开关偏好按 Codex provider 注册项保存在本机浏览器中。

### 3.3 Backlinks + Graph 右侧栏

| 区域 | 说明 |
|---|---|
| 入口 | 标题栏右侧 Backlinks 图标；若右侧栏关闭，点击后打开并切到 Backlinks |
| 上方 | `BacklinksPanel`：当前文件的反链来源与上下文摘录 |
| 下方 | `GraphPanel`：当前邻域 / 全图切换，节点点击打开对应文件或 paper |
| 布局 | 同一右侧栏内垂直堆叠，Backlinks 约占上方区域，Graph 填充剩余高度 |
| 非目标 | 不再提供独立顶层 Graph tab；避免右侧栏入口过多 |

## 4. 设置窗口（Settings）

参考 **macOS System Settings / 传统 Preferences** 形态，而非多标签网页：

| 要求 | 说明 |
|---|---|
| 入口 | 顶部菜单栏 **agentero → Settings…**，或 `⌘,`（不在侧边栏放设置图标） |
| 结构 | 左侧分类导航 + 右侧内容；居中浮层 dialog |
| 分类 | General · Appearance · Agent · Keyboard · Privacy · About |
| 行样式 | 分组卡片（rounded + border）；左标签、右控件；行间细分隔 |
| 控件 | Switch / Select / Input；避免花哨装饰 |
| 关闭 | 右上角 `X`、点遮罩、`Esc`、再次 `⌘,` |
| 文案 | 支持国际化（i18n）：English 与简体中文可切换，English 为源语言与兜底；简短说明可作 footer |

**页面职责**

- **General**：恢复上次 Vault、退出确认；**Translator 服务地址**（`translatorBaseUrl`，默认 `https://translator.philfan.cn`）。入库默认下载 PDF（arXiv 含 LaTeX），无「是否本地下载」开关。
- **Appearance**：主题、**语言（跟随系统 / English / 简体中文）**、编辑字号、行号、**格式工具栏**（`showEditorToolbar`，控制 Markdown/Notes 编辑器顶部的 WYSIWYG 工具栏，默认开）。
- **Agent**（BYOA，非模型 BYOK 表单）：
  - 总开关。
  - **Common agents** 目录表：名称 + 状态徽章（installed / ACP ready / missing 等）；打开页自动 Probe。
  - 仅保留 **Probe** 文字按钮（无 icon）；无逐行 Probe、无 command/路径/Handshake 详情文案。
  - **Use default** 纯文字（无 icon）。
  - Custom 区：添加任意 ACP command/args。
  - 页脚说明：模型与 API Key 由各 Agent CLI 自行管理，不在 Agentero 内填写。
- **Keyboard**：只读快捷键表（按 App / Vault / Navigation 分组）。
- **Privacy**：分析与崩溃上报（默认关，本地优先）。
- **About**：版本与一句话定位。

实现：`src/components/settings-window.tsx`；持久化暂用 `localStorage`（`src/lib/settings.ts`，含 `locale` 偏好）。

## 4.1 国际化（i18n）

- 技术选型：[`react-i18next`](https://react.i18next.com/) + `i18next`，运行时切换，无需重启。
- 语言：English（`en`，源语言与兜底）、简体中文（`zh-CN`）；`locale` 偏好为 `system | en | zh-CN`，`system` 依据 `navigator.language` 解析。
- 词条目录：`src/i18n/locales/<locale>/<namespace>.json`，按功能划分命名空间（`common` `app` `settings` `agent` `sidebar` `viewer` `editor` `shortcuts` `aiElements`）。
- 类型安全：`src/i18n/i18next.d.ts` 依据英文词条推导 `t()` 的 key 类型；新增文案须先在 `en` 词条登记，并同步 `zh-CN`。
- 组件内用 `useTranslation("<ns>")`；跨命名空间用 `t("ns:key")` 前缀，并在 `useTranslation([...])` 中声明相关命名空间。React 之外的模块（如 `lib/`、`error-boundary`）用全局实例 `i18n.t(...)`。
- 数字/货币/日期用活动 locale 格式化（`Intl.*` 传入 `i18n.language`）。
- 原生 macOS 菜单同样本地化：渲染层通过 `set_locale` command 通知 Host 重建菜单（见 `docs/backend/api.md`）。
- 语言切换的联动集中在 `src/App.tsx`：`i18n.changeLanguage`、`document.documentElement.lang`、以及 `set_locale`。

## 5. 组件基线

目录分层（详情 **`docs/frontend/components.md` §0**）：

| 位置 | 职责 |
|---|---|
| `ui/` | shadcn 通用原语 |
| `ai-elements/` | AI Elements |
| `layout/` | 分栏、顶栏、文件树、Chat 面板 |
| `editor/` | Plate 编辑器 + 插件 |
| `viewer/` | PDF / HTML |
| `settings-window.tsx` | 设置窗 |

- 图标：**Lucide React**。
- 优先复用 `Button`（`variant="ghost"` + `size="icon-xs"`）、`Tooltip`、`Switch`、`Select`、`Input`、`DropdownMenu`。
- 参考：[shadcn/ui](https://ui.shadcn.com/) · [AI Elements](https://elements.ai-sdk.dev/) · `docs/frontend/components.md`
