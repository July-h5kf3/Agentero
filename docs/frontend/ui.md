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
- **性能（虚拟化）**：树把可见节点**拍平为一维列表 + 窗口化**（`@tanstack/react-virtual`），只渲染视口内的行；FileTree 自持滚动容器（`treeScrollRef`），折叠文件夹用扫平行组件 `FileTreeFolderRow`（`ai-elements/file-tree.tsx`）。避免大 Vault（成百上千篇）时常驻海量 DOM，以及选中/展开/拖拽时的全树重渲染。
- **默认展开**：打开 Vault 时**只**展开 `papers/` 及其**一级**子目录（组织文件夹），其余（`notes/`、更深层 org 等）默认折叠；paper 文件夹始终作叶子、不展开。树刷新**不**重置用户展开状态。
- **选中同步 / 定位**：激活文档变化时（切换标签、从 Library 打开 paper、打开图片或其他文件、**魔棒 / 本地 PDF 入库完成后 `openPaper`**），树将高亮对应行（paper 内任意文件 → 该 paper 叶子；其它路径 → 自身或最近祖先），**自动展开祖先文件夹**并 `scrollToIndex`（`align: "center"`）滚入视口。树刷新后若目标行尚未出现在拍平行中，会重新展开祖先再滚一次（覆盖入库刚写入磁盘的竞态）。
- **Paper 行标签**（展示用，不改磁盘名）：默认 **标题 · 作者**（catalog `title` / `authors`）；设置 → **通用 → 文件树论文显示** 可选：`标题 · 作者` / `标题` / `作者 (年份) · 标题` / `文件夹名`。无元数据时回退文件夹名。实现：`formatPaperTreeLabel`（`src/lib/paper-metadata.ts`），偏好 `paperTreeLabelMode`（`agentero-settings`）。
- **虚拟节点 Library**：树顶固定一项 **Library / 论文库**（路径常量 `agentero:library`，非真实目录、不写盘）。图标 `Library`。选中后中间栏显示**全库**论文表格（见 §3）。空 Vault 时仍显示该节点。
- **组织文件夹 → 作用域论文库**：单击**非 paper** 目录（如 `papers/`、`papers/nlp/`、`papers/nlp/pretrain`）时 **同时**：(1) 树内展开/折叠子节点；(2) **同一** Library 标签页（`agentero:library`）就地按路径前缀筛选，**不**为文件夹新建 tab。点顶栏 Library 虚拟节点清除筛选回全库。**paper 文件夹**仍打开该篇 PDF/Notes（叶子、不展开）。
- **虚拟节点 Recycle Bin**：紧挨 **Library** 下方固定一项 **Recycle Bin / 回收站**（路径常量 `agentero:trash`，非真实目录、不写盘）。图标 `Trash2`。选中后中间栏显示回收站视图（见「删除」）。空 Vault 时仍显示该节点。
- **Library 行 Download**：当库内**任一** paper 资源不完整时，Library 标题右侧显示 Download；点击**批量** `paper_download_assets`。
- **Paper 行 Download**：下列任一成立即显示，hover 列出原因：
  - 本地**没有 PDF**（期望在论文根目录 `{id}.pdf`）；
  - **既没有 TeX 也没有 `PAPER.md`**（二者有其一即可，**优先 TeX**）；
  - 点击后：PDF 写入论文根目录 → arXiv 尽量下 TeX 到 `source/` → **无 TeX** 时 liteparse 写 `PAPER.md`。
- **Paper 行 Zap（精读）**：当本地资源**已齐全**（有 PDF，且有 TeX 或 `PAPER.md`）且 catalog **`is_read === false`** 时显示 `Zap` 图标；点击可**手动**启动 **paper-reader**。
- **自动精读**（设置 → Agent → **入库后自动精读**，`autoPaperReader`，**默认关**）：开启后，魔棒 / 单篇 Download 资源就绪且未读时自动 paper-reader。**Zap 不受此开关影响**。批量导入 / Zotero 不自动精读。Skill 按 provider；成功后 `is_read = true`；**`hideFromChatHistory`**。
- 顶栏单行：左侧 Vault 名称（可截断）+ 右侧 **纯图标操作**。
- 图标按钮点击反馈：统一走 `Button`（`variant="ghost"` + `size="icon-xs"` 等）的 **active** 态（背景加深 + 轻微缩放）；文件树行同样有 `active:bg-muted/80`。
- 动作映射（Lucide），从左到右：
  - **按标识符添加（魔棒）** → `WandSparkles`（紧挨 **New file 左侧**；Popover 粘贴 arXiv 链接/编号 → Host `lookup_import`）
  - 新建文件 → `FilePlus2`（在选中目录 / 文件父目录下 **树内联命名**，Enter 确认 / Esc 取消，对齐 VS Code）
  - 新建文件夹 → `FolderPlus`（同上）
- **内联新建进行中**时，顶栏其它图标（魔棒 / 新建文件 / 新建文件夹）**保持可点**（可切换新建类型或打开魔棒）；仅在全局 `busy` 或文献导入进行中时禁用。
- **回收站入口**：文件树中 **Library 下方** 虚拟节点 `Trash2`（不在侧栏 Header）；点击后中间栏打开 `RecycleBinView`（见「删除」）。
- **刷新文件树**不在侧边栏：使用菜单 **File → Refresh File Tree**（`⌘R`）。
- **在系统文件管理器中显示**（`revealItemInDir` / `src/lib/reveal.ts`）：
  - **右键**真实文件 / 文件夹 / paper 行 → 上下文菜单「在 Finder 中显示」（文案随平台切换；旁注 `⌥⌘R`）。
  - **`⌥⌘R`**：对当前选中路径执行相同操作（`shortcuts.ts` → `revealInFinder`）。
  - **不**绑定双击（单击选中 / 打开文档；双击不触发 Finder）。
  - 虚拟节点 **Library**（`agentero:library`）不提供此操作；仅桌面端可用。
- **在终端中打开**（Host `path_open_in_terminal` / `src/lib/reveal.ts` `openInTerminal`）：
  - **右键**真实文件 / 文件夹 / paper 行 →「在终端中打开」（旁注 `⌥⌘T`）。
  - **`⌥⌘T`**：对当前选中路径执行相同操作（`shortcuts.ts` → `openInTerminal`）。
  - **文件夹**（含 paper 目录）：终端 cwd 为该目录本身。
  - **文件**：终端 cwd 为文件所在父目录。
  - 使用系统默认终端：macOS `Terminal.app`；Windows 优先 `wt`（Windows Terminal）否则 `cmd`；Linux `xdg-terminal-exec` / `$TERMINAL` / 常见终端回退。
  - 虚拟 Library 不可用；仅桌面端。
- **删除（回收站）**（`path_trash`；不再物理 `remove`）：
  - **右键**「删除」（旁注 `⌘⌫`）、**`⌘⌫`**、批量条 / 右键「删除 N 项」：均**移入 Vault 回收站** `.agentero/.trash/<批次>/`，**不弹确认、不弹提示**（随时可从回收站找回）。
  - `papers/` 下的项移入回收站时**快照并移除** catalog 对应行（含嵌套 paper），从回收站恢复时一并恢复；随后刷新文件树、Library 与双链索引。
  - `⌘⌫` 在编辑器 / 输入框聚焦时不拦截（保留系统删行首行为）。
  - **回收站浏览**：文件树中 Library 下方虚拟节点 `agentero:trash` 在**中间栏**打开回收站视图（`RecycleBinView`，`kind:"trash"` 虚拟 tab，与论文库同一位置、Zotero 风格；**非弹窗**；中间栏不重复文档级 title/关闭行；视图内 `PaneHeader` 与侧栏 Header 同高 `h-10`，右侧「清空回收站」）→ 列出全部已删项（名称 / 原路径 / 删除时间），逐项**恢复**（`path_restore_item`，恢复文件 + catalog 行）或**永久删除**（`path_purge_item`），顶部可**清空回收站**（`path_purge_trash`，不可撤销、需确认）。删除后从这里找回。
  - 不可删：虚拟 Library、Vault 根。
- **多选与批量操作**（`file-tree.tsx` + 原语 `ai-elements/file-tree.tsx`）：
  - 对齐 VS Code / Finder：**无勾选框**，以**行高亮**表达选区。**Ctrl/⌘ 点击**切换单项、**Shift 点击**按可见顺序选区间；普通点击仍为单选并打开。
  - 选中 ≥1 项时树顶出现**批量条**（移动 / 删除 / 清空，**吸顶固定**、滚动时保持可见）；右键选中项菜单提供「删除 N 项 / 移动 N 项」；`Delete`/`⌘⌫` 批量删除，`Esc` 清空（编辑 / 输入聚焦时不拦截）。
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
- 交互对齐常见 IDE（VS Code 类）：不抢焦点、可折叠、只展示后台进度；操作级错误另走右上角 toast（见 §2.1.2）。

### 2.1.2 全局错误 Toast（右上角）

- **组件**：shadcn Sonner（`src/components/ui/sonner.tsx`），在 `main.tsx` 挂载 `<Toaster />`。
- **位置**：`top-right`，`offset` 避开标题栏；可关闭（`closeButton`），最多叠 5 条。
- **API**：`src/lib/notify.ts`
  - `notifyError(message)` — 操作失败（打开 Vault、删除、入库、下载、设置 Agent 等）
  - `notifyWarning(message)` — 软失败 / 部分成功
  - `notifySuccess(message)` — 少用（避免成功噪音）
  - `errorMessage(err)` — `catch` 值转可读字符串
- **约定**：跨页面的**操作失败**统一 toast；**表单字段校验**（如树内联新建命名、Popover 内输入）仍可就地 `text-destructive`。
- **禁止**再在侧栏 header 下挂常驻 error 条（已移除）。
- **诊断日志**（非 UX）：`src/lib/logger.ts` + Host `tauri-plugin-log`；关键操作 `op start` / `op end`。看日志方式见 [`../development/logging.md`](../development/logging.md)。失败时仍应 toast，logger 不替代本小节。

### 2.2 无 Vault 欢迎页

当当前窗口未打开 Vault 时，中间栏显示欢迎页（`src/components/layout/vault-welcome.tsx`）：

- **内容**：图标 + **Create vault** / **Open vault** / **Migrate from Zotero** 同一行按钮 + **Recent** 路径列表（可点打开，可从列表移除）。
- **从 Zotero 迁移**（欢迎页）：先选目录创建 Vault，再打开 `ZoteroMigrateDialog`（与论文库工具栏入口共用对话框）。
- **不加**常驻说明文案、标题口号或快捷键提示（保持空状态极简）。
- 点选最近路径时若目录不存在：提示错误并从列表剔除。

### 2.3 原生菜单与多窗口

| 菜单 | 项 | 快捷键 | 行为 |
|---|---|---|---|
| File | New Window | `⌘N` | Host `window_new`：新 Webview 窗口（`?fresh=1`），**不**自动恢复上次 Vault |
| File | Open Vault… | `⌘O` | 选择已有文件夹并打开 |
| File | Create Vault… | `⇧⌘N` | 选择目录 → Host `vault_create` 脚手架 |
| File | Refresh File Tree | `⌘R` | 刷新当前 Vault 文件树 |
| File | Close | `⌘W` | 自定义菜单项 `close_tab_or_window`：先关当前文档 tab；无 tab 时关当前窗口（非系统 CloseWindow） |
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
  - **入口**：
    1. 虚拟节点 `agentero:library` → **全库**（清除 `libraryScopePath`）；
    2. 单击**非 paper** 目录 → 聚焦**同一** Library tab，设置 `libraryScopePath` 做前缀过滤（**不新建 tab**）；
    3. **默认页**：有 Vault 且 tab 条为空时自动 `ensureFullLibraryTab()`。
  - **作用域**：App 状态 `libraryScopePath`（vault-relative，如 `papers/nlp/pretrain`）；null = 全库。过滤：`filterPapersByScope` 内存前缀匹配。无 per-folder RPC、不扫盘。
  - **性能**：全库一次 `paper_list`；切文件夹仅改 scope + filter；见 `test/library-scope.test.ts` latency。
  - **数据**：Host `paper_list` → catalog.sqlite。**catalog 权威**；空态「重新扫描 papers/」（`paper_rescan`）。
  - **列**：标题、作者、年份、**标签**、类型、标识符；点击行打开对应 paper 文件夹。
  - **标签筛选**：表上方汇总**当前作用域** tag chip；单元格 tag 也可筛选。标题搜索同时匹配 tag 子串。
  - **排序**：点击表头升序 / 降序；年份列首次为降序；文字列默认升序。
  - **滚动**：`.agentero-scroll-both`；表格 `w-max min-w-full`。
  - **中间栏 header**：搜索框；全库另有 Zotero 迁移；**导出**（Download 图标）。
    - **导出**：`paper_export` → Translator `/export?format=bibtex` → 保存 `.bib`。
  - **导入**（Upload）：魔棒 Popover 左下角 → `paper_import`。
  - **从 Zotero 迁移**：仅**全库**视图工具栏。
- **Paper Info / Notes——仅具体论文**：
  - **左侧 Paper Info**（`paper-info-panel`）：仅当存在 `paperMeta`（选中 paper 文件夹）时渲染；论文库 / 普通笔记时隐藏。**Tags** 可编辑：输入框在 chip 上方（多标签时无需先滚动）；回车添加、chip 上 × 删除 → Host `paper_set_tags`（catalog 权威，同步 `metadata.json`）。`loadPaperMetadata` 会注入 vault-relative `path`（`metadata.json` 投影本身不含 path），Zotero 导入等路径也可持续编辑。
  - **Notes（WYSIWYG，无独立预览栏）**：中心切换为 Notes 时全宽编辑 `NOTES.md`；中心为 PDF/HTML 时右侧栏显示同一篇 `NOTES.md` 实时编辑。论文库视图或未选论文时隐藏。
  - **格式工具栏（WYSIWYG toolbar）**：`MarkdownEditor` 顶部可选的固定工具栏（`editor-toolbar.tsx`），提供标题（H1–H3）、引用、加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 高亮、无序 / 有序 / 待办列表、**插入图片**等常用格式按钮，无需手写 Markdown 即可排版。由全局设置 `showEditorToolbar`（默认开）控制，Notes 面板 header 右侧另有 `PanelTop` 一键显示 / 隐藏；只读时不渲染。所有按钮均有 `aria-label` + Tooltip，i18n `editor:toolbar.*`。
  - **Markdown 图片**（已落地）：
    - **插入**：粘贴剪贴板图 / 工具栏「插入图片」→ 二进制写入当前 `.md` 旁 `{mdDir}/assets/` → 正文 `![alt](./assets/…)`（不写 base64）。
    - **预览**：未选中时相对路径解析为 `blob:` 位图；**选中节点**时显示 monospace Markdown 源码（`ImageElement` + `useSelected`）。
    - **删除**：节点离开文档且 managed `./assets/` URL 引用计数归零 → 删磁盘文件 → 刷新文件树（`onAssetsChanged`）。
    - 实现：`src/lib/markdown-image.ts`、`markdown-editor.tsx`、`image-node.tsx`、`editor-toolbar.tsx`；i18n `editor:toolbar.image` / `editor:image.*`。
    - 数据约定：[`../backend/data-model.md`](../backend/data-model.md)「Markdown 内嵌图片」。
  - **Notes 显示开关 / 快速打开 / 关闭文档**：`showNotes`（默认显示）控制右侧 Notes 栏是否挂载。看 PDF/HTML 时，中间栏 header 右侧提供 `NotebookPen` 快捷开关（一键显示/隐藏 Notes）；全局入口则在标题栏 **Layout 菜单**（见下）；`⌘3` 聚焦 Notes（隐藏时先显示再聚焦）。关闭当前文档为中间栏 header 右侧的 `X`（`closeDocument`）→ 关闭当前标签（等价 `⌘W`）；论文库视图与欢迎页不显示。
- **⌘L** 显示 / 隐藏右侧栏；右侧栏入口为 **Agent** 与 **Backlinks**。
- **Layout 菜单**（标题栏 `PanelsTopLeft` 图标，`src/components/layout/layout-menu.tsx`）：集中式面板可见性开关（对齐 VS Code「Customize Layout」）。以复选项反映并切换 **左侧边栏 / Notes / 右侧边栏 / 禅模式**，各项显示对应快捷键；Notes 项仅在打开论文 PDF/HTML 时可用；切换时菜单保持打开。i18n `app:titlebar.layout*`。
- Backlinks 入口内采用上下分区：上方反链列表，下方 Graph。Graph 不再是独立顶层 tab。
- **Agent 禅模式**（quest / Cursor Agents Window 心智，`⌥⌘Z` 或标题栏 Focus 图标）：
  - 进入后：折叠左栏与中间主栏，右栏 Agent 铺满；系统标题栏仅拖拽区 + **返回**（`ArrowLeft`，不再用关闭 `X`）；隐藏后台任务条与 Notes；Agent 面板头**无**重复退出按钮。
  - **同一** `AgentPanel` 实例保持挂载（CSS 切换 / 不 remount），会话与流式状态不丢。
  - **布局**（`variant="zen"`）：
    - **左侧栏**（Quest 式弱对比）：浅灰底；顶部 pill「新建会话」；下方静音分区标题 + **单行**历史标题列表（当前会话高亮；运行中小绿点）。无「外部会话」开关；无 agent/状态/时间元信息堆叠。
    - **主区顶栏**：仅 **Agent 切换**（**无** 1/2/3 会话数字标签页；历史切换走左侧列表或侧栏 History 弹出层）。
    - **对话区**（AI Elements）：`Conversation` 视口**全宽**（滚动条贴主区最右，`agentero-scroll`）；消息 / Composer 内容 `max-w-2xl` 居中；空态垂直居中；组件：`Message` / `Reasoning` / `Plan` / `Tool` / `PromptInput` / `Suggestion` / `Sources` / `Checkpoint` 等。
  - **侧栏模式**（非禅）：顶栏仍为 Agent 切换 + 新建 + History 弹出层（Codex 可开「外部会话」）；无 1/2/3 数字标签。
  - **历史过滤**：精读 `paper_reader`、PDF 划词提问等非 Composer 工作流传 `hideFromChatHistory`，不写入 Codex 会话索引、不出现在对话记录（含旧标题启发式过滤）；进度只走左下角后台任务条。
  - 退出：标题栏 **返回图标**，或再次 `⌥⌘Z`；恢复进入前左栏折叠意图与右栏默认宽度。
- **左右侧栏隔离**（`react-resizable-panels`）：
  - 左栏（文件树）与右栏（Agent/Backlinks）均为 **常驻 collapsible 面板**（`collapsedSize=0`），用 `expand`/`collapse`/`resize` 切换，**不要**对右栏做条件卸载整块 `ResizablePanel`（否则 Group 重排会冲掉左栏折叠态）。
  - 两侧使用 `groupResizeBehavior="preserve-pixel-size"`，并把上次展开像素宽记入 ref；中间主栏保持默认相对尺寸。
  - Notes 列仍随论文选中条件挂载（需真实 `defaultSize` 才能出现）；`showNotesOnRight` 变化后 rAF 再 assert 左右栏宽度/折叠意图，避免 Library ↔ paper 时左栏跳宽。
- **文档标签栏位置**：与标题栏右侧禅模式 / Layout / 右栏图标 **同一行**（`DocumentTabBar` 在 `header` 中间 flex 区；无 tab 时该区为拖拽空白）。中间栏仅保留 view mode / 文档标题工具行。
- 各栏 header 等高：统一 `h-10`（`PaneHeader` / `PANE_HEADER_CLASS`），水平对齐；全局操作错误走右上角 toast（§2.1.2），不撑高标题栏。
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
  - PDF / HTML / **图片** **预览**：
    - **PDF（任意路径）**：Vault 内任意位置的 `.pdf`（根目录、`notes/`、paper 内嵌套文件等）均可直接打开；`readFile` → `blob:` → PDF.js（**不用** `convertFileSrc`/`asset://`）。
    - **PDF（论文单元）**额外链路：① 论文文件夹内本地 PDF（根目录 `{id}.pdf` 优先，兼容 `source/` 等嵌套）；② **无本地 PDF** 时自动 `paper_download_assets`；③ 失败回退 catalog 远程 `pdf_url`（或 `arxiv_id` 推导 URL）。点开 paper 内某一具体 `.pdf` 时优先该文件字节。
    - **HTML**：仍读远程 `html_url`（iframe）；本地 `.html` 文件尚无 file 沙盒预览。
    - **图片**：常见格式 `.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.bmp` / `.svg` / `.avif` / `.ico` → `readFile` → `blob:` → 中间栏 `ImageViewer`（居中 contain、可滚动）；任意 Vault 路径。
  - **本地归档**：魔棒 / `paper_download_assets` 将 PDF 写入 `{paper}/{id}.pdf`（根目录），arXiv LaTeX 到 `source/`；预览优先读同一本地 PDF。
  - arXiv 推荐写入 catalog：
    - `pdf_url`: `https://arxiv.org/pdf/{id}`
    - `html_url`: `https://arxiv.org/html/{id}`
    - `source_url`: `https://arxiv.org/abs/{id}`
  - 若只有 `arxiv_id`，用 `src/lib/arxiv.ts` 推导远程 URL（作下载候选与 HTML/远程回退）
  - PDF：本地经 `blob:`（fs `readFile`）/ 远程 `https` 由 PDF.js 渲染；HTML：独立 iframe 打开远程页；图片：`blob:` + `<img>`
  - **PDF 缩放**（`PdfViewer`）：工具栏放大 / 缩小 / 重置 / **适应宽度**（`RotateCcw`，= 重置到 100%）/ **适应整页**（`MoveVertical`，缩放到整页高度铺满视口）；`⌘/Ctrl`+滚轮缩放；范围约 **0.5×–3×**；**100% = 适应中间栏宽度**（非固定 pt）；**放大后**缩放停下 ~160ms 后按**真实比例**重渲染页面（`width = 基准宽 × 缩放`、transform 归 1），文本层与画布同尺度 → 清晰且**划词/高亮顺滑**（对齐 Zotero），手势中以 transform 比值即时反馈；**缩放后**中间栏可**双向滚动/平移**（横向 + 纵向，`agentero-scroll-both`），滚轮缩放以光标为锚点。i18n `viewer:pdf.zoom*`。
  - **PDF 性能（页面窗口化）**：只给「当前页 ±4」（`PAGE_WINDOW`）渲染真实 `<Page>`（canvas + 文本层 + 批注层），其余为等高占位 div；`currentPage` 由 `IntersectionObserver` 跟踪、随滚动移动窗口。避免大 PDF（几十上百页）一次性挂载全部 canvas，并把缩放重渲染限制在窗口内。
  - **PDF 页码导航**：底部居中页码 pill（`‹ [当前页] / 总页数 ›`，输入数字回车跳页）；当前页用 `IntersectionObserver` 跟踪；键盘 `PageDown/PageUp` 翻页、`Home/End` 首/末页（PDF 区悬停或聚焦时生效，输入框内不拦截）；**续读**：按论文（路径）记住上次页码，重开自动续上（`pdf-reading-position.ts`，localStorage）。i18n `viewer:pdf.prevPage/nextPage/goToPage`。
  - **PDF 大纲（书签）**：有大纲时左上 `List` 按钮切换**左侧浮层目录**（`getOutline()` 读书签树；点条目经 `getDestination`/`getPageIndex` 解析跳页）；无大纲不显示。i18n `viewer:pdf.outline`。
  - **PDF 文档内查找**（`⌘/Ctrl+F`）：右上查找条（查询 + 命中计数 + 上/下一个 + `Esc` 关闭；`Enter`/`Shift+Enter` 循环）。`pdf-find.ts` 用 pdfjs `getTextContent` 逐页搜索（按页缓存）；命中滚动到该页并把该次出现映射回**文本层 rects** 高亮（复用 pdf-ask 归一化覆盖层），文本层未就绪时仅滚动。i18n `viewer:pdf.find*`。
  - **PDF 沉浸式阅读**（工具栏 `Maximize2` 进入 / `Minimize2` 或 `Esc` 退出）：折叠左右侧栏 + 隐藏中间栏头，PDF 铺满窗口；正文**限宽 ≤ 1100px 居中**（舒适阅读 + 两侧留白），缩放 / 页码 / 大纲 / 查找浮层照常；切到非 PDF tab 自动退出。i18n `viewer:pdf.zenEnter/zenExit`。
  - **PDF 划词操作菜单**（已落地，见 [`../development/pdf-ask.md`](../development/pdf-ask.md)）：
    - 划词后在选区旁弹出操作菜单（图标 + Tooltip）：**5 色色板 + 复制 / 笔记 / 提问 / 翻译**（点色板 = 该色**高亮**；复制 / 笔记有内联确认）；选区以**平滑蓝色覆盖层**呈现（`selectionRectsByPage` 按行合并 rects + `SELECTION_CSS` 隐藏原生 `::selection`，对齐 Zotero、点掉即消）。双击 / 悬停停留仍直接开问答卡（页码上下文）。
    - 高亮：`papers/<id>/highlights/<id>.json`（含 `color`（yellow/green/blue/pink/purple），归一化坐标可重定位；调色板 `lib/pdf-highlight/palette.ts`）→ 页面半透明色带覆盖层；点击已有高亮出现「删除」浮层。**标注总览**：标题栏或 PDF 工具栏 💬（`MessageSquareText`）打开右侧栏「批注」tab（`viewer/annotations-panel.tsx`）→ 总览本篇全部高亮（颜色色条 + 页码 + 引文 + 可选备注），点击跳转闪烁 / 编辑备注 / 删除。批注：选中→「批注」= 建高亮 + 内联备注编辑器写 `comment`（**不写 `NOTES.md`**），页边批注针。提问复用迷你问答卡（ACP 流式）；**翻译**当前走 Agent，规划改为调用应用级翻译服务（免费 MT / BYOA Agent，设置 → Translate，见 [`../development/translate.md`](../development/translate.md)）；发送过问题后锚点旁保留对话图标（Hover 回访）。
    - 提问线程落盘 `papers/<id>/asks/<threadId>.json`；高亮 / 提问 / 笔记均**不**写 PDF 二进制。
  - **PDF/HTML 时右侧自动加载该篇 `NOTES.md`**（可编辑，自动保存 / `⌘S`）
  - **HTML 沙盒**：独立 `<iframe>`；arXiv 允许 scripts（对方 origin）；布局铺满中间栏
- 无障碍：图标按钮必须有可访问名称；焦点环使用主题 `ring`。

### 3.1 快捷键（对齐 macOS / Apple HIG 习惯）

显示使用 Apple 符号：`⌘ ⌥ ⇧ ⌃`。Windows / Linux 上将 `⌘` 映射为 `Ctrl`。

| 快捷键 | 作用 | 说明 |
|---|---|---|
| `⌘,` | 打开 / 关闭 Settings | 系统级 Preferences 约定 |
| `⌘/` | 键盘快捷键速查 | 打开快捷键清单对话框（`ShortcutsDialog`） |
| `⌘K` / `⌘P` | 命令面板：搜索 / 快速打开 | 无 Vault 时提示先打开 Vault；有 Vault 时：论文标题·作者·id **即时** quick-open + 去抖 `vault_search` Markdown 全文（片段/行号；`papers/` 命中打开 paper）（`CommandPalette`；`shortcuts.ts` → `commandPalette`） |
| `Esc` | 关闭 Settings | 关闭 sheet / 对话框 |
| `⌘N` | 新建窗口 | `window_new`；欢迎页 + 最近列表，不恢复上次 Vault |
| `⌘O` | Open vault… | 打开文档/文件夹 |
| `⇧⌘N` | Create vault… | 创建并初始化新 Vault（含 catalog） |
| `⌘R` | 刷新文件树 | 刷新当前视图 |
| `⌥⌘R` | 在 Finder 中显示 | 右键或快捷键定位当前选中文件/文件夹（无双击）；`shortcuts.ts` → `revealInFinder` |
| `⌥⌘T` | 在终端中打开 | 文件夹 = 自身 cwd，文件 = 父目录；系统默认终端；`shortcuts.ts` → `openInTerminal` |
| `⌘⌫` | 删除选中项 | 文件树选中项；移入回收站 `.agentero/.trash/`（**无确认 / 无 Undo toast**；从回收站视图恢复）；`papers/` 行随删随快照 catalog；编辑区不拦截 |
| `⌥⌘S` | 显示 / 隐藏侧边栏 | 对齐 Mail / Preview 等侧边栏约定 |
| `⌘B` | 显示 / 隐藏侧边栏（别名） | 兼容常见生产力应用 |
| `⌘1` | 聚焦侧边栏 | 分区焦点（Mail 等） |
| `⌘2` | 聚焦编辑器 | |
| `⌘3` | 聚焦 Notes（`focusNotes`；论文 PDF/HTML 侧栏 Notes） | |
| `⌘W` | 关闭当前标签 / 窗口（`closeTab`） | 仅剩全库 Library 时关窗；否则关当前 tab，关空后自动全库（File → Close 同源） |
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
  - **完成后**：刷新文件树 / Library / wiki → `openPaper(paperDir)`（打开 PDF tab，并 `setTreeSelectedPath`）→ 左侧树**展开祖先并滚到新论文行**（见 §2.1 选中同步）。本地 PDF 导入同样走 `openPaper`。  
  - 详见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)；i18n `sidebar:lookup.*` / `papersLibrary.*`；无 Vault 时禁用。
- **论文行 Download**：缺本地 PDF，或既无 TeX 也无 `PAPER.md` 时显示；hover 列出原因 → `paper_download_assets`（已有资源跳过）。下载后若仍无 TeX 且有 PDF，Host 自动 liteparse 写 `PAPER.md`。Library 行可对库内全部不完整 paper **批量** Download。
- **论文行 Zap（精读）**：资源齐全且 catalog `is_read === false` 时显示；点击**手动**启动 paper-reader（`agent_run_once` + skill；**Codex 用 `$paper-reader`，Claude 用 `/paper-reader`，其它靠注入正文**）→ 写/更新 `{paper}/NOTES.md` → `paper_set_is_read(true)`。若设置开启 `autoPaperReader`，魔棒 / 单篇 Download 成功后也会自动跑（批量不连跑）。进度在左下角后台任务条。

### 3.1.1 文档标签页（已落地）与分屏（规划，roadmap V0.6）

**浏览器式文档标签页**（`src/components/layout/document-tab-bar.tsx`、模型 `src/lib/tabs.ts`）位于**窗口标题栏**（与禅模式 Focus 图标同行）：

- **多 tab**：paper / Markdown / PDF / HTML / **Library（全库或文件夹作用域）** 各占一个 tab，可切换、关闭（`X` / 中键 / `⌘W`）、拖拽重排；同一路径已开则聚焦其 tab。
- **默认页 = 全库 Library**：
  - 打开 Vault 无持久化 tab → `ensureFullLibraryTab()`。
  - 关 tab 后列表为空 → 自动打开全库（无「无标签」空态）。
  - **`⌘W` / tab X**：仅剩全库 `agentero:library` 时**关窗**；否则关当前 tab，关空后回全库。
- **常驻挂载**：每个 tab 保持 mounted（非激活 `hidden`）；切换保留 PDF 滚动/缩放与编辑器状态。作用域 / 全库共用 `libraryPapers` 缓存。
- **状态派生**：`activeTab` 驱动路径 / 模式 / Notes；作用域 Library 的 `path` 为文件夹绝对路径，树高亮该组织夹。
- **持久化**：`agentero-open-tabs` 按窗口保存；全库与作用域 path 均可恢复。
- **NOTES 编辑器**：每篇 paper 的 `NOTES.md` 编辑器也按 tab 常驻挂载在右侧 Notes 栏；paper-reader / download 写回后按路径 reseed 对应 tab。
- **外部/Agent 改动自动重载**：Host `notify` 监听 Vault，发 `vault:file-changed`（`src/lib/fs-watch.ts`、`App.tsx` 的 `applyDiskChange`）。打开中的 `.md`/`NOTES.md` 若磁盘内容与当前 seed 不同：**无未存改动时**从盘重载（key bump 重挂载）；**有未存改动时不静默覆盖**，弹 toast（`diskConflict`，操作「载入磁盘版」；忽略则保留本地改动）；内容相等即判定为自身 autosave 回声、跳过；重载期内 `reseedGuardRef` 阻止旧实例卸载 flush 覆盖新盘内容。结构性变更（create/remove/rename）去抖刷新文件树；纯 `modify` 不刷新树。
- **Wiki 索引刷新**：`.md` 变更经 `useVaultFileEvents.onWikiChange` → `scheduleWikiRebuild`（约 900ms 防抖）重建双链 / Backlinks / Graph，避免外部/Agent 写盘后图谱陈旧。
- **保存冲突检测（防丢数据）**：autosave / `⌘S` / 卸载 flush 写盘前，`persistFile` 比对磁盘内容与上次落盘内容；若文件已被外部修改则**中止写入**并 `notifyWarning`（`diskConflict.saveBlocked`），不静默覆盖外部变更。

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
| 结构 | 顶栏：ACP 后端选择 · 新建 · 历史 + 消息列表 + Composer |
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

**Agent 切换**：顶栏左侧当前 ACP 后端名打开下拉（列表来自 catalog + 注册表）；选择后设为默认并用于后续 `runOnce`。下拉 **「ACP backend」标题行最右侧** 齿轮（`Settings`）→ **设置 → Agent**（`onOpenAgentSettings`）。

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

**权限模式**：**设置 → Agent** 提供一个全局「权限模式」下拉（`agentPermissionMode`），对**所有 Agent** 生效（默认 **受限**），经 `runOnce` → `permissionMode` 传入：

| 档位 | 行为 |
|---|---|
| **受限**（默认） | 取消 ACP 权限请求；Codex 沙箱 `workspace-write` |
| **每次询问** | 每个 ACP 权限请求 emit `agent:permission-request`；面板对话框展示标题、受影响路径与选项（Allow once / Always / Reject）；用户点选后 `agent_respond_permission`；**5 分钟**未应答则取消 |
| **自动批准** | 选择 Agent 给出的第一个 AllowOnce 选项；Codex 沙箱 `danger-full-access`；面板下方显示风险说明 |

**空态建议 chips（工作流入口）**：面板空态提供可点击建议，路由到后端 purpose-built workflow（非 free chat）：

| 建议（i18n） | `workflow` | 目标 |
|---|---|---|
| Summarize | `summary` | 当前聚焦 paper（提及路径或选中路径） |
| Ask library | `qa` | 跨库问答 |
| List claims | `qa` | 当前 paper |
| Draft Related Work | `related_work` | 当前 paper |

**笔记写后审阅（信任闭环）**：BYOA Agent 直接写盘，无法可靠事前拦截。`agent_run_once` 运行前快照目标笔记（`.md` target 或论文夹 `NOTES.md`）；若内容被改写则 emit `agent:notes-review`。面板弹 **原文 / Agent 版本** 对照对话框：**Keep** 保留 Agent 版本；**Revert** 写回快照（文件监听随后重载打开的编辑器）。

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
| 分类 | General · Appearance · Agent · **Translate** · Keyboard · Privacy · About |
| 行样式 | 分组卡片（rounded + border）；左标签、右控件；行间细分隔 |
| 控件 | Switch / Select / Input；避免花哨装饰 |
| 关闭 | 右上角 `X`、点遮罩、`Esc`、再次 `⌘,` |
| 文案 | 支持国际化（i18n）：English 与简体中文可切换，English 为源语言与兜底；简短说明可作 footer |

**页面职责**

- **General**：恢复上次 Vault、退出确认；**文件树论文显示**（`paperTreeLabelMode`，默认 `title-author`：标题 · 作者；另有标题 / 作者(年)·标题 / 文件夹名）；**Translator 服务地址**（`translatorBaseUrl`，默认 `https://translator.philfan.cn`）。入库默认下载 PDF（arXiv 含 LaTeX），无「是否本地下载」开关。**Zotero Connector 兼容**开关（`connectorEnabled`，默认关；与 Zotero 桌面端互斥占用 `23119`；状态行显示监听地址 / 错误；见 [`../backend/connector.md`](../backend/connector.md)），勿与 Translator 地址混为同一设置项。
- **Appearance**：主题、**语言（跟随系统 / English / 简体中文）**、编辑字号、行号、**格式工具栏**（`showEditorToolbar`，控制 Markdown/Notes 编辑器顶部的 WYSIWYG 工具栏，默认开）。
- **Agent**（BYOA，非模型 BYOK 表单）：
  - 总开关。
  - **权限模式**（`agentPermissionMode`：受限 / 每次询问 / 自动批准，见 §3.2）。
  - **回答语言**（自动 / English / 简体中文，独立于界面语言）。
  - **入库后自动精读**（`autoPaperReader`，**默认关**）：开启后魔棒 / 单篇 Download 资源就绪且未读时自动 paper-reader；Zap 始终可手动。
  - **Common agents** 目录表：名称与 badge 组留距；badge 组内紧凑（安装列固定槽：已安装 / 未安装；ACP 列仅 ready/failed/not-probed，不把 missing 显示成「未安装」；+ adapter missing）；未安装整行置灰；默认 Agent 右侧对勾。打开页自动 scan + 并行 Probe；Refresh 可再跑。表下小字：ACP 失败时可试代理。代理开关不因 Probe busy 禁用；改代理只持久化 + scan。
  - **Claude**：`detect` 用本机 `claude`（Claude Code）；ACP 入口为 `claude-agent-acp`。若已装 Claude Code 但缺适配器，显示 **ACP adapter missing** 徽章 + **Install ACP** 小按钮 → Host `agent_open_install_terminal` 打开系统终端，展示 `npm i -g @agentclientprotocol/claude-agent-acp`，**等待用户按 Enter 才执行**（不静默安装）。装完后用户点 Refresh 再 Probe。
  - 顶部 **Refresh**（Rescan + Probe）；**Use default** 纯文字（无 icon）。
  - Custom 区：添加任意 ACP command/args。
  - 页脚说明：模型与 API Key 由各 Agent CLI 自行管理，不在 Agentero 内填写。
- **Translate（翻译）**（应用级翻译服务，见 [`../development/translate.md`](../development/translate.md)）：
  - **默认翻译服务**：多引擎免费 MT + **Agent（BYOA）**。
  - **目标语言**、PDF 划词自动译、条件显示的自定义端点（libre）。
  - **当服务 = Agent 时**（渐进披露，见 translate.md §7.6）：
    - **Agent**：下拉；默认「跟随默认 (当前 default 名)」；选项 = 本机可用 Agent；空则提示去 Agent 页。
    - **模型**：下拉；默认「跟随 Agent 默认」（`loadModelPref`）；选项 = 该 Agent 的 `loadModelCatalog`；无缓存则仅跟随项 + 一句「在 Chat 打开过一次后可选模型」。
    - 不在此页 Probe / 装适配器 / 填 API Key；不复制 Chat 完整 ModelSelector。
  - 运行时：翻译偏好独立于 Chat 当前选中；未指定则回落 default Agent + 该 Agent 模型偏好。
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
