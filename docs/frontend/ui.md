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
- **配色主题（tweakcn 预设）**：设置 → Appearance `uiTheme`（默认 `default` = index.css 内置外观）。全部 tweakcn 主题（36 个）打包在 `src/themes/tweakcn.json`（仅颜色 + radius，不覆盖字体/阴影），运行时经 `src/lib/ui/theme.ts` `applyUiTheme` 在 `<head>` 末尾注入 `:root` / `.dark` 变量覆盖；跨窗口经 `settings:changed` 同步。刷新主题数据：`node scripts/fetch-tweakcn-themes.mjs`。
- **界面缩放（UI Scale）**：设置 → Appearance `uiScale`，提供 5 档预设：80% / 90% / 100% / 125% / 150%（默认 100%）。通过设置 `<html>` 的 `font-size` 缩放整个界面（标题栏、侧边栏、内容区、编辑器同步放大/缩小）。工具栏按钮与标题栏随全局缩放一起调整，不再使用单独的 `toolbarIconSize`。macOS 下新建窗口会根据当前 `uiScale` 重新计算 traffic light 位置；主窗口仍使用 `tauri.conf.json` 的固定位置。

## 2. 文案 vs 图标

| 场景 | 规则 |
|---|---|
| 工具栏、侧边栏操作、可识别的动作 | **优先用图标**，不要用长按钮文案 |
| 图标含义 | 必须配 `aria-label`；悬停用 **Tooltip** 显示短标签 |
| 页面主标题、空状态、错误、表单字段 | 可用文字；错误仅在发生时出现 |
| 解释性说明文案 | 默认不展示；避免常驻帮助段落挤占空间 |

### 2.1 侧边栏文件树

- 树 UI：**AI Elements** `FileTree`（业务包装：`src/components/sidebar/file-tree.tsx`；约定见 `docs/frontend/components.md`）。
- **性能（虚拟化）**：树把可见节点**拍平为一维列表 + 窗口化**（`@tanstack/react-virtual`），只渲染视口内的行；FileTree 自持滚动容器（`treeScrollRef`），折叠文件夹用扫平行组件 `FileTreeFolderRow`（`ai-elements/file-tree.tsx`）。避免大 Vault（成百上千篇）时常驻海量 DOM，以及选中/展开/拖拽时的全树重渲染。
- **建树策略（懒加载）**（`src/lib/vault` `loadVaultTree` / `listVaultDirChildren`）：
  - **全量递归（eager）**：`papers/`、`notes/`、`plans/`、`.agents/`（产品面：paper marker、笔记、skill）。
  - **浅层 + 按需**：Vault 根下其它目录（如 `src/`、`thesis/`、`scripts/`）打开时只 list **一层内容**（文件 + 子目录壳），子目录标 `childrenPending`；**展开子目录**时再 list 一层（可继续下钻）。不展开则不再往下扫。
  - **永不解析**：`TREE_IGNORE_NAMES`（`.git`、`.agentero`、`.venv`、`node_modules`、`__pycache__`、`site-packages`、`.codex` 等）以及其它以 `.` 开头的项（例外：`.agents`、`.env.example`）和 `*.egg-info` **直接跳过**，不进入树、不发 SFTP list。
  - 本地与远程同一套规则；远程大杂项目录（如含完整代码仓的 Vault）因此可在「产品目录全量 + 其它根目录各 1 次 list」内打开。
- **默认展开**：打开 Vault 时**只**展开 `papers/` 及其**一级**子目录（组织文件夹），其余（`notes/`、更深层 org 等）默认折叠；paper 文件夹始终作叶子、不展开。树刷新**不**重置用户展开状态。
- **根目录加载态**：打开 Vault 后根目录尚未加载完成时保留虚拟 Library / Recycle Bin，并显示文件夹行 shimmer 骨架；仅在加载完成且 Vault 确实为空时显示「暂无文件夹」。
- **选中同步 / 定位**：激活文档变化时（切换标签、从 Library 打开 paper、打开图片或其他文件、**魔棒 / 本地 PDF 入库完成后 `openPaper`**），树将高亮对应行（paper 内任意文件 → 该 paper 叶子；其它路径 → 自身或最近祖先），**自动展开祖先文件夹**并 `scrollToIndex`（`align: "center"`）滚入视口。树刷新后若目标行尚未出现在拍平行中，会重新展开祖先再滚一次（覆盖入库刚写入磁盘的竞态）。
- **Paper 行标签**（展示用，不改磁盘名）：默认 **标题 · 作者**（catalog `title` / `authors`）；设置 → **通用 → 文件树论文显示** 可选：`标题 · 作者` / `标题` / `作者 (年份) · 标题` / `文件夹名`。无元数据时回退文件夹名。实现：`formatPaperTreeLabel`（`src/lib/paper`），偏好 `paperTreeLabelMode`（XDG `settings.json`）。
- **文件树排序**（展示用，不改名不移动）：默认 **显示名称 A–Z**（与「论文显示」`paperTreeLabelMode` 一致，按树中所见标签排序，而非磁盘文件夹名）；设置 → **通用 → 文件树论文排序** 可选：`显示名称 A–Z` / `标题 A–Z` / `作者 A–Z` / `年份（新→旧）` / `年份（旧→新）` / `添加时间（新→旧）`。同目录下目录优先于文件；元数据排序时组织文件夹在前（按名）、paper 按所选键（缺元数据回退显示名，年份/添加时间缺失排最后）。实现：`sortFileTreeNodes`，偏好 `paperTreeSortMode` + `paperTreeLabelMode`。

- **虚拟节点 Library**：树顶固定一项 **Library / 论文库**（路径常量 `agentero:library`，非真实目录、不写盘）。图标 `Library`。选中后中间栏显示**全库**论文表格（见 §3）。空 Vault 时仍显示该节点。
- **组织文件夹 → 作用域论文库**：单击**非 paper** 目录（如 `papers/`、`papers/nlp/`、`papers/nlp/pretrain`）时 **同时**：(1) 树内展开/折叠子节点；(2) **同一** Library 标签页（`agentero:library`）就地按路径前缀筛选，**不**为文件夹新建 tab。点顶栏 Library 虚拟节点清除筛选回全库。**paper 文件夹**仍打开该篇 PDF/Notes（叶子、不展开）。
- **虚拟节点 Recycle Bin**：紧挨 **Library** 下方固定一项 **Recycle Bin / 回收站**（路径常量 `agentero:trash`，非真实目录、不写盘）。图标 `Trash2`。选中后中间栏显示回收站视图（见「删除」）。空 Vault 时仍显示该节点。
- **虚拟节点 广场（Plaza）**（**设计中**，见 [`../development/plaza.md`](../development/plaza.md)）：位于 Library + Recycle Bin **之下**、真实 Vault 根目录 **之上**。父节点 `agentero:plaza` 可折叠；子节点 **Cool Papers**（中间栏 WebView 打开 papers.cool）、**播客**（占位）、**推荐**（本地库启发式列表）。**P0 不提供入库**；与 Library 正交（发现 vs 已收藏）。
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
  - **按标识符添加（魔棒）** → `WandSparkles`（Popover 粘贴 arXiv 链接/编号 → Host `lookup_import`；弹层内 **FileUp** 可多选本地 PDF → `paper_import_local_pdf`）
- **新建文件 / 文件夹**：不在侧栏 Header；经文件树 **右键菜单** 启动，在选中目录 / 文件父目录下 **树内联命名**（Enter 确认 / Esc 取消，对齐 VS Code）。
- **外部 PDF 拖入入库**（窗口级 `preventDefault`，避免 WebView 导航/卡死）：非 PDF 或未落到 `papers/` 组织夹 → 无入库动作；PDF 拖到 **`papers/` 组织夹** → drop 时同步快照 `File`/`items` 并开始 `arrayBuffer`；无 `File.path` 时经 Host `paper_stage_import_file`（base64 → `~/.agentero/import-tmp/`）→ `ImportLocalPdfDialog` 确认 metadata → `paper_import_local_pdf` → 刷树 / Library / wiki → `openPaper` 第一篇。
- **内联新建进行中**时，顶栏魔棒 **保持可点**；仅在全局 `busy` 或文献导入进行中时禁用。
- **回收站入口**：文件树中 **Library 下方** 虚拟节点 `Trash2`（不在侧栏 Header）；点击后中间栏打开 `RecycleBinView`（见「删除」）。
- **刷新文件树**不在侧边栏：使用菜单 **File → Refresh File Tree**（`⌘R`）。
- **在系统文件管理器中显示**（`revealItemInDir` / `src/lib/vault/reveal.ts`）：
  - **右键**真实文件 / 文件夹 / paper 行 → 上下文菜单「在 Finder 中显示」（文案随平台切换；旁注 `⌥⌘R`）。
  - **`⌥⌘R`**：对当前选中路径执行相同操作（`shortcuts.ts` → `revealInFinder`）。
  - **不**绑定双击（单击选中 / 打开文档；双击不触发 Finder）。
  - 虚拟节点 **Library**（`agentero:library`）不提供此操作（Library 右键仅 **导出论文库**）；仅桌面端可用。
- **导出论文库**（侧栏虚拟 Library 节点右键）：`paper_export` → Translator `/export?format=bibtex` → 保存 `.bib`。
- **在终端中打开**（Host `path_open_in_terminal` / `src/lib/vault/reveal.ts` `openInTerminal`）：
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
  - **回收站浏览**：文件树中 Library 下方虚拟节点 `agentero:trash` 在**中间栏**打开回收站视图（`RecycleBinView`，`kind:"trash"` 虚拟 tab，与论文库同一位置、Zotero 风格；**非弹窗**；中间栏无独立 header）→ 列出全部已删项（名称 / 原路径 / 删除时间），逐项**恢复**（`path_restore_item`，恢复文件 + catalog 行）或**永久删除**（`path_purge_item`）。**清空回收站**在侧栏回收站节点 **右键菜单**（`path_purge_trash`，不可撤销、需确认）。删除后从这里找回。
  - 不可删：虚拟 Library、Vault 根。
- **多选与批量操作**（`file-tree.tsx` + 原语 `ai-elements/file-tree.tsx`）：
  - 对齐 VS Code / Finder：**无勾选框**，以**行高亮**表达选区。**Ctrl/⌘ 点击**切换单项、**Shift 点击**按可见顺序选区间；普通点击仍为单选并打开。
  - 选中 ≥1 项时树顶出现**批量条**（移动 / 删除 / 清空，**吸顶固定**、滚动时保持可见）；右键选中项菜单提供「删除 N 项 / 移动 N 项」；`Delete`/`⌘⌫` 批量删除，`Esc` 清空（编辑 / 输入聚焦时不拦截）。
  - **拖拽移动**：把行（或整个选区）拖到某个 `papers/` 组织文件夹（含 papers 根）即移动；仅这类文件夹是合法落点（论文文件夹与 Library 除外），hover 时以 ring 高亮。经 `onMoveTo` 复用批量移动管线，无需对话框。
  - **外部文件拖入**：与树内拖移区分；见上文「外部 PDF 拖入入库」（仅 `papers/` 组织夹 + PDF）。
  - **批量移动**（`MovePapersDialog` → `paper_move`）：把选中项移到某个 `papers/` 子文件夹（现有或新建）；移动文件夹并改写 catalog 路径前缀，随后统一刷新树 / Library / 双链。
- **不要**在侧边栏放打开 / 创建 Vault、关闭 Vault、刷新或设置入口。
- **不要**使用「Open vault… / Refresh」等文字按钮。

### 2.1.1 后台任务（左下角，IDE 风格）

- **位置**：窗口左下角固定悬浮（`BackgroundTasksPanel`，`src/components/shell/background-tasks-panel.tsx`），不占用侧栏布局；禅模式隐藏。
- **显示时机**：**有任务时**才出现；全部结束后约 4s 自动消失。
- **收起态**：一条状态条——转圈 / 完成勾 + 当前任务标题或「N 个进行中」+ 进度条；点击展开/收起。
- **展开态**：任务列表（队列序号、标题、详情、进度）；可清除已完成项。
- **取消**：进行中的任务行显示取消图标；点击后任务进入「已取消」状态。下载会中止当前读取流，批量任务和 Agent 工作流在安全检查点停止；取消不显示失败 Toast。
- **外观**：`bg-popover` 实底 + 边框阴影；**hover 使用实色 `hover:bg-accent`**（禁止 `accent/40` 等半透明，避免底下内容透出）。
- **接入任务**：单篇下载、批量下载、魔棒入库、文献库导入/导出、**paper-reader 精读**、**Zotero Connector 附件下载**等长操作经 `runBackgroundTask` / `startBackgroundTask` 登记（`kind` 含 `download` | `downloadAll` | `lookup` | `import` | `export` | `paperRead` | `connector` | …）。
- **进度语义**：下载任务在 Host 读取响应流时按实际 `downloaded_bytes / total_bytes` 更新；服务端未返回 `Content-Length` 时显示不确定进度，不显示估算百分比。批量下载 / Zotero 迁移使用实际完成项目数。查询、解析、刷新、Connector 和 paper-reader 仅在有真实百分比来源时显示百分比，否则显示状态文本与不确定进度；失败时 error 写入任务条。
- **Connector 进度**：Host 发 `connector:progress`；前端显示附件下载、正文生成、完成/失败阶段；不进入 Agent 对话历史。
- 交互对齐常见 IDE（VS Code 类）：不抢焦点、可折叠、只展示后台进度；操作级错误另走右上角 toast（见 §2.1.2）。

### 2.1.2 全局错误 Toast（右上角）

- **组件**：shadcn Sonner（`src/components/ui/sonner.tsx`），在 `main.tsx` 挂载 `<Toaster />`。
- **位置**：`top-right`，`offset` 避开标题栏；可关闭（`closeButton`），最多叠 5 条。
- **API**：`src/lib/core/notify.ts`
  - `notifyError(message)` — 操作失败（打开 Vault、删除、入库、下载、设置 Agent 等）
  - `notifyWarning(message)` — 软失败 / 部分成功
  - `notifySuccess(message)` — 少用（避免成功噪音）
  - `errorMessage(err)` — `catch` 值转可读字符串
- **约定**：跨页面的**操作失败**统一 toast；**表单字段校验**（如树内联新建命名、Popover 内输入）仍可就地 `text-destructive`。
- **禁止**再在侧栏 header 下挂常驻 error 条（已移除）。
- **诊断日志**（非 UX）：`src/lib/core/logger.ts` + Host `tauri-plugin-log`；关键操作 `op start` / `op end`。看日志方式见 [`../development/logging.md`](../development/logging.md)。失败时仍应 toast，logger 不替代本小节。

### 2.2 无 Vault 欢迎页

当当前窗口未打开 Vault 时，中间栏显示欢迎页（`src/components/shell/vault-welcome.tsx`）：

- **内容**：图标 + **Create vault** / **Open vault** / **Open remote…** / **Migrate from Zotero** 同一行按钮 + **Recent** 列表。
- **Open remote…**：共用 `RemoteVaultDialog`（SSH host / 可选 user / 远端绝对路径）；成功后进入 `remote:<sessionId>` 会话。
- **Recent**：本地绝对路径 + 远程条目（`host:remotePath` + 「远程」徽章）；可点打开 / 可从列表移除。
- **从 Zotero 迁移**（欢迎页）：先选目录创建 Vault，再打开 `ZoteroMigrateDialog`（与论文库工具栏入口共用对话框）。
- 启动恢复的上次本地路径若已不存在：清空当前 Vault 会话与缓存标签，直接回到欢迎页；该路径仍可在 Recent 中手动移除。
- **不加**常驻说明文案、标题口号或快捷键提示（保持空状态极简）。
- 点选最近**本地**路径时若目录不存在：提示错误并从列表剔除。

### 2.2.1 侧栏切换知识库（有 Vault 时）

左侧文件树顶栏标题（`VaultSidebarHeader`，`src/components/sidebar/file-tree.tsx`）为下拉菜单：

| 区块 | 内容 |
|---|---|
| Recent | 远程 MRU（徽章）+ 本地 MRU；当前项 ✓；可单项移除 |
| 操作 | **Open vault…** / **Open remote…** / **Create vault** |

- **Open remote…** 与欢迎页共用 `RemoteVaultDialog`（`src/components/dialogs/remote-vault-dialog.tsx`）。
- 远程会话伪路径 **`remote:<sessionId>` 不得**写入本地 recent（见 §2.3 存储表）；每次 SSH 连接都会换新 session id，误写入会导致「同一远端目录出现多条不同建议」。

### 2.3 原生菜单与多窗口

| 菜单 | 项 | 快捷键 | 行为 |
|---|---|---|---|
| File | New Window | `⌘N` | Host `window_new`：新 Webview 窗口（`?fresh=1`），**不**自动恢复上次 Vault |
| File | Open Vault… | `⌘O` | 选择已有文件夹并打开 |
| File | Create Vault… | `⇧⌘N` | 选择目录 → Host `vault_create` 脚手架 |
| File | Refresh File Tree | `⌘R` | 刷新当前 Vault 文件树 |
| File | Close | `⌘W` | 自定义菜单项 `close_tab_or_window`：有弹层时先关最顶层（`overlay-stack`）；否则关当前文档 tab；仅剩全库时关窗（非系统 CloseWindow） |
| agentero | Settings… | `⌘,` | 打开 / 关闭 App 内设置浮层（见 §4） |

**窗口与路径状态**（`src/lib/vault`、`src/lib/vault/remote/remote-vault.ts`）：

| 存储 | 键 / 用途 |
|---|---|
| `sessionStorage` | 当前窗口已打开的 Vault（本地绝对路径 **或** 存活中的 `remote:<sessionId>`；多窗口互不抢） |
| `localStorage` `agentero-recent-vaults` | **仅本地**路径 MRU（欢迎页 / 切换菜单）；**排除** `remote:…` |
| `localStorage` 上次 Vault 键 | 主窗口「恢复最近」——**仅本地**路径；远程不写、不自动恢复 |
| `localStorage` `agentero-recent-remote-vaults` | 远程 MRU：`{ kind:"remote", host, user?, remotePath, label }` |
| `sessionStorage` 远程 meta | 当前会话 `RemoteSessionInfo`（展示名 / host / path） |
| 查询参数 `fresh=1` | 新建窗口标记：跳过自动恢复，直接欢迎页 |

主窗口在设置开启「恢复上次 Vault」且非 `fresh` 时，用本地上次路径自动打开；**远程 Vault 须重新 SSH 连接**（欢迎页或切换菜单的远程 recent / Open remote…）。`⌘N` 窗口始终从欢迎页开始。

## 3. 布局

### 3.0 应用弹层栈（overlay-stack）

应用级 **sheet / Dialog** 不再各自绑定关闭键，而是注册到统一栈，由全局快捷键按 LIFO 关闭。

| 项 | 说明 |
|---|---|
| 实现 | `src/lib/core/overlay-stack.ts`；React 接入 `src/hooks/use-overlay-registration.ts`（`useOverlayRegistration` / `useAnyOverlayOpen`） |
| 注册 | 弹层 `open === true` 时 `pushOverlay({ id, close })`；关闭或卸载时 dispose（idempotent） |
| 关闭 | `closeTopOverlay()` 弹出栈顶并调用其 `close`；`⌘W`（`closeTabOrWindow`）与 `Esc`（`closeSheet`）共用 |
| 门控 | `useAppShortcuts(anyOverlayOpen, …)`：`whenSettingsClosed` 实际表示「无弹层」；有弹层时挡 Vault/导航类快捷键，避免误触 |
| 开关类 | `⌘,` 设置、`⌘K`/`⌘P` 命令面板、`⇧⌘P` 命令模式：自身可再按关闭（不依赖 `whenSettingsClosed`） |

**已注册 id（须保持稳定）**

| id | 组件 |
|---|---|
| `settings` | `SettingsWindow`（App 内浮层，所有平台） |
| `command-palette` | `CommandPalette`（Go / Commands 共用） |
| `zotero-migrate` | `ZoteroMigrateDialog` |
| `move-papers` | `MovePapersDialog` |
| `agent-permission` | Agent 权限询问 Dialog |

**新弹层约定**：在 Dialog / 全屏 sheet 内调用 `useOverlayRegistration("stable-id", open, () => onOpenChange(false))` 即可自动支持 `Esc` / `⌘W`。**不**把普通 Popover / Tooltip / 树内联重命名注册进栈。

单测：`test/overlay-stack.test.ts`。

- 工作台默认 **三栏**：文件树 + 中间 **Dockview 工作区** + 可选右侧栏（Agent / Backlinks）。文档 panel 由 dockview 管理（见 §3.1.1 / [`../development/tab-split.md`](../development/tab-split.md)）；论文 NOTES 为独立 dockview panel，默认与 PDF **左右分屏**。
- **论文库表格**（`src/components/library/papers-library.tsx`）：
  - **入口**：
    1. 虚拟节点 `agentero:library` → **全库**（清除 `libraryScopePath`）；
    2. 单击**非 paper** 目录 → 聚焦**同一** Library tab，设置 `libraryScopePath` 做前缀过滤（**不新建 tab**）；
    3. **默认页**：有 Vault 且 tab 条为空时自动 `ensureFullLibraryTab()`。
  - **作用域**：App 状态 `libraryScopePath`（vault-relative，如 `papers/nlp/pretrain`）；null = 全库。过滤：`filterPapersByScope` 内存前缀匹配。无 per-folder RPC、不扫盘。
  - **性能**：全库一次 `paper_list`；切文件夹仅改 scope + filter；见 `test/library-scope.test.ts` latency。
  - **数据**：Host `paper_list` → catalog.sqlite。**catalog 权威**；空态「重新扫描 papers/」（`paper_rescan`）。
  - **打开文档加载态**：论文、PDF、HTML 或 Markdown tab 资源尚未加载完成时显示内容 shimmer 骨架；不显示论文库空态。
  - **列**：标题、作者、年份、**标签**、类型、标识符；**单击**单元格复制对应字段（作者复制完整列表，非 et al. 缩写；标题下出版物单独可复制；行内标签 chip 复制该标签；复制**短延迟提交**，双击打开论文时取消，避免与双击冲突）；**双击**行打开对应 paper 文件夹。
  - **列自定义**（顺序 + 显隐）：**右键表头**弹出上下文菜单勾选显示/隐藏列；**拖拽表头** `<th>` 改变列顺序（拖拽时列半透明、落点高亮）；菜单底部「重置列」恢复默认。**标题列不可隐藏**（承载阅读热力与出版物副标题，勾选框禁用且 normalize 强制可见）；表格使用固定布局和各列固定权重，标题列约占 32%，标题正文单行显示，超出以省略号截断，悬浮仍可查看完整标题。布局持久化到 `settings.json` 的 `libraryColumns`（`LibraryColumnPref[] = {key, visible}[]`，数组顺序即显示顺序），前后端均 reconcile（去重、丢未知 key、补新列为可见、强制 title 可见）。实现：`COLUMN_META` + `colgroup` + `renderCell` 按 key 渲染；右键菜单基于 `src/components/ui/context-menu.tsx`（radix `ContextMenu`）。
  - **阅读热力（标题背景）**：聚合该篇 `marks/`（`kind`: highlight / ask / translate）的**页码 + 页内 y**，画成**标题文字横向背景脊条**（左=文首、右=文末；局部深浅=该位置交互强度）。颜色为 **Apple system green** 浅色洗（`oklch(0.65 0.17 145)` ≈ `#34C759`，与标签 green 同系，低比例 `color-mix` 保持浅色不抢眼）。悬停标题可看高亮 / 对话 / 翻译分项。可选 `reading-meta.json` 记录 PDF 总页数以对齐全文跨度。实现：`src/lib/paper/reading-heatmap/`、`ReadingTitleHeat`。
  - **标签**：行内 tag 单击复制该标签。标题列搜索同时匹配 title / tag 子串；**标签列表头**筛选图标可多选标签（OR）过滤行。
  - **排序**：点击表头升序 / 降序；年份列首次为降序；文字列默认升序。
  - **滚动**：`.agentero-scroll-both`；表格 `w-max min-w-full`。
  - **表头内控件**（无独立中间栏 header 行）：**标题列标题右侧**为无 placeholder 的搜索框；**标签列表头**为筛选图标（Popover 勾选标签）。
  - **导出**（侧栏 Library 虚拟节点 **右键菜单**）：`paper_export` → Translator `/export?format=bibtex` → 保存 `.bib`（与回收站「清空」同为虚拟节点右键入口）。
  - **导入**（Upload）：魔棒 Popover 左下角 → `paper_import`。
  - **从 Zotero 迁移**：左侧栏 Header **魔杖旁 Zotero 图标**（欢迎页仍有入口）；不在 Library 中间栏。
- **Paper Info / Notes——仅具体论文**：
  - **左侧 Paper Info**（`sidebar/paper-info-panel`）：仅当存在 `paperMeta`（选中 paper 文件夹）时渲染；论文库 / 普通笔记时隐藏。展开时顶部边框为**纵向拖拽把手**（可键盘 ↑/↓，Shift 加速），调节内容区高度（120–560px，localStorage `agentero.paperInfoHeight` 持久化）；作者与摘要不再行数截断，超出滚动。**Tags** 可编辑：输入框在 chip 上方；输入框**右侧圆形色点**打开色盘（Apple 风格 8 色 + 默认）；回车添加、chip 上 × 删除 → Host `paper_set_tags`（catalog 权威；`tags_json` 可为 `"name"` 或 `{"name","color"}`）。
  - **Notes（WYSIWYG）**：作为 **dockview panel** 打开 `NOTES.md`（论文默认与 PDF **左右分屏**：左 PDF、右 NOTES）；Layout / 快捷键开关。论文库视图或未选论文时不自动开 NOTES。
  - **格式工具栏（WYSIWYG toolbar）**：`MarkdownEditor` 顶部可选固定工具栏（`editor-toolbar.tsx`）：标题、引用、加粗/斜体等、列表、**插入图片**。全局设置 `showEditorToolbar`（默认开）；只读时不渲染。i18n `editor:toolbar.*`。
  - **编辑体验**：Plate list 可编辑；文本选区中性色；文档末与图片后保持 trailing paragraph。
  - **Markdown 图片**（已落地）：粘贴/工具栏 → `{mdDir}/assets/` + `![](./assets/…)`；选中显示源码；删节点且无引用时延迟 GC。实现：`src/lib/markdown/image.ts`；约定见 [`../backend/data-model.md`](../backend/data-model.md)。
  - **Notes 开关**：Layout 菜单 / 快捷键切换当前论文的 NOTES panel（`toggleNotesSplit`）；`⌘3` 聚焦 Notes（未开则先打开）。关闭文档 panel 走 dockview tab `X` 或 `⌘W`（有弹层时先关弹层，见 §3.0）。
- **⌘L** 显示 / 隐藏右侧栏；右侧栏入口为 **Agent** 与 **Backlinks**。
- **Layout 菜单**（标题栏 `PanelsTopLeft`，`src/components/shell/layout-menu.tsx`）：切换 **左侧边栏 / Notes panel / 右侧边栏 / 禅模式**；Notes 项仅在打开论文 PDF/HTML（或 NOTES 本身）时可用。i18n `app:titlebar.layout*`。
- Backlinks 入口内上下分区：上方反链，下方 Graph（非独立顶层 tab）。
- **Agent 禅模式**（`⌥⌘Z` 或 Layout 菜单）：折叠左栏与中间主栏，Agent 全屏；标题栏仅拖拽 + 返回；隐藏后台任务条；**同一** `AgentPanel` 不 remount。禅模式布局见 §3.2 / components.md。
- **左右侧栏隔离**（`react-resizable-panels`）：
  - 左栏与右栏均为 **常驻 collapsible**（`collapsedSize=0`），用 `expand`/`collapse`/`resize` 切换，**不要**条件卸载整块右栏 `ResizablePanel`。
  - `groupResizeBehavior="preserve-pixel-size"`；上次展开像素宽记入 ref。
- **文档 tab 位置**：标题栏**无**文档 tab；由中间栏 dockview 原生管理（见 §3.1.1）。
- 各栏 header 等高：`h-10`（`PaneHeader`）；操作错误走右上角 toast（§2.1.2）。
- **面板分隔（sash）**：默认 **1px** 细线；实现见 `src/components/ui/resizable.tsx`。
- **独立滚动**：侧边栏 / 中间 dockview 内容 **各自**滚动，顶栏固定。
  - 默认竖向：`.agentero-scroll`；双向（论文库表）：`.agentero-scroll-both`。
- **中间栏视图**：
  - 普通 Markdown / NOTES：**Plate WYSIWYG**；防抖自动保存 + `⌘S`；未真实编辑不写盘。
  - **双链**：`[[…]]` / `![[…]]` 经 remark-wiki-link 解析并无损回写。
  - **YAML frontmatter** 按字节保留；Plate 会归一化部分 Markdown 风格。
  - PDF / HTML / **图片** 预览：
    - **PDF（任意路径）**：Vault 内任意 `.pdf` → `readFile` → `blob:` → **EmbedPDF / PDFium**（**不用** `convertFileSrc`/`asset://`）。
    - **PDF（论文单元）**：① 本地根目录 `{id}.pdf` 优先；② 无本地时 `paper_download_assets`；③ 失败回退远程 `pdf_url`。
    - **HTML**：仍读远程 `html_url`（iframe）；本地 `.html` 文件尚无 file 沙盒预览。
    - **图片**：常见格式 `.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.bmp` / `.svg` / `.avif` / `.ico` → `readFile` → `blob:` → 中间栏 `ImageViewer`（居中 contain、可滚动）；任意 Vault 路径。
  - **本地归档**：魔棒 / `paper_download_assets` 将 PDF 写入 `{paper}/{id}.pdf`（根目录），arXiv LaTeX 到 `source/`；预览优先读同一本地 PDF。
  - arXiv 推荐写入 catalog：
    - `pdf_url`: `https://arxiv.org/pdf/{id}`
    - `html_url`: `https://arxiv.org/html/{id}`
    - `source_url`: `https://arxiv.org/abs/{id}`
  - 若只有 `arxiv_id`，用 `src/lib/paper/arxiv.ts` 推导远程 URL（作下载候选与 HTML/远程回退）
  - PDF：本地经 `blob:`（fs `readFile`）/ 远程 `https` 由 EmbedPDF（PDFium）渲染；HTML：独立 iframe 打开远程页；图片：`blob:` + `<img>`
  - **PDF 缩放**（`PdfViewer`）：工具栏放大 / 缩小 / 重置 / **适应宽度**（`RotateCcw`，= 重置到 100%）/ **适应整页**（`MoveVertical`，缩放到整页高度铺满视口）；`⌘/Ctrl`+滚轮缩放；范围约 **0.5×–3×**；**100% = 适应中间栏宽度**（非固定 pt）；**放大后**缩放停下 ~160ms 后按**真实比例**重渲染页面（`width = 基准宽 × 缩放`、transform 归 1），文本层与画布同尺度 → 清晰且**划词/高亮顺滑**（对齐 Zotero），手势中以 transform 比值即时反馈；**缩放后**中间栏可**双向滚动/平移**（横向 + 纵向，`agentero-scroll-both`），滚轮缩放以光标为锚点。i18n `viewer:pdf.zoom*`。
  - **PDF 性能**：EmbedPDF Tiling / 视口渲染，按可见区域绘制；缩放与滚动由引擎插件处理。
  - **PDF 页码导航**：底部居中页码 pill（`‹ [当前页] / 总页数 ›`，输入数字回车跳页）；当前页用 `IntersectionObserver` 跟踪；键盘 `PageDown/PageUp` 翻页、`Home/End` 首/末页（PDF 区悬停或聚焦时生效，输入框内不拦截）；**续读**：按论文（路径）记住上次页码，重开自动续上（`pdf-reading-position.ts`，localStorage）。i18n `viewer:pdf.prevPage/nextPage/goToPage`。
  - **PDF 大纲（书签）**：有大纲时左上 `List` 切换左侧浮层目录（`@embedpdf/plugin-bookmark`）；点条目跳页；无大纲不显示。i18n `viewer:pdf.outline`。
  - **PDF 文档内查找**（`⌘/Ctrl+F`）：右上查找条（查询 + 命中计数 + 上/下一个 + `Esc` 关闭；`Enter`/`Shift+Enter` 循环）。EmbedPDF `/plugin-search`：查询条 + 命中计数 + 上/下一个；命中滚动并高亮。i18n `viewer:pdf.find*`。
  - **PDF 沉浸式阅读**（工具栏 `Maximize2` 进入 / `Minimize2` 或 `Esc` 退出）：折叠左右侧栏 + 隐藏中间栏头，PDF 铺满窗口；正文**限宽 ≤ 1100px 居中**（舒适阅读 + 两侧留白），缩放 / 页码 / 大纲 / 查找浮层照常；切到非 PDF tab 自动退出。i18n `viewer:pdf.zenEnter/zenExit`。
  - **PDF 划词操作菜单**（已落地，见 [`../development/pdf-ask.md`](../development/pdf-ask.md)）：
    - 划词后在选区旁弹出操作菜单（图标 + Tooltip）：**5 色色板 + 复制 / 笔记 / 提问 / 翻译**（点色板 = 该色**高亮**；复制 / 笔记有内联确认）；选区以**平滑蓝色覆盖层**呈现（`selectionRectsByPage` 按行合并 rects + `SELECTION_CSS` 隐藏原生 `::selection`，对齐 Zotero、点掉即消）。双击 / 悬停停留仍直接开问答卡（页码上下文）。
    - 划词标记统一落在 **`papers/<id>/marks/`**：高亮 / 批注 → **`marks/annotations.json`**（EmbedPDF 注解；`contents` 非空 = 批注）；提问 / 翻译 → **`marks/<id>.json`**（`kind`: `ask` / `translate`）。提问为多轮 `messages`；成功翻译含 `result` 可回访。翻译 API 失败时仅保留当前错误卡片，不落盘且不显示页边入口，卡片提供跳转翻译设置。均不写 PDF 二进制 / 默认不写 `NOTES.md`。右侧「批注」tab 总览高亮与提问。
  - **PDF 引用与插图（规划中）**：本地 paper PDF 由 Host 生成 `source/agentero-cite.json`、`source/agentero-figures.json` 和 `source/agentero-figures/*.png`；右侧 `Paper Content` 展示 citations/figures。引用 hover 只高亮并预览，点击或侧栏操作跳至参考文献；figure card 跳至 PDF bbox。`@` 菜单和拖拽支持结构化 citation/figure context。完整契约见 [`../backend/pdf-analysis.md`](../backend/pdf-analysis.md)。
  - **PDF/HTML 时默认同组打开 `NOTES.md` panel**（可编辑，自动保存 / `⌘S`；Layout 菜单可关）
  - **HTML 沙盒**：独立 `<iframe>`；arXiv 允许 scripts（对方 origin）；布局铺满中间栏
- 无障碍：图标按钮必须有可访问名称；焦点环使用主题 `ring`。

### 3.1 快捷键（对齐 macOS / Apple HIG 习惯）

显示使用 Apple 符号：`⌘ ⌥ ⇧ ⌃`。Windows / Linux 上将 `⌘` 映射为 `Ctrl`。

| 快捷键 | 作用 | 说明 |
|---|---|---|
| `⌘,` | 打开 / 关闭 Settings | 系统级 Preferences 约定；App 内居中浮层，`Esc` / `⌘W` 关闭 |
| `⌘+` / `⌘=` | 放大界面 | 全局 UI Scale +5%（`zoomIn`）；对齐浏览器 / VS Code |
| `⌘-` | 缩小界面 | 全局 UI Scale -5%（`zoomOut`） |
| `⌘0` | 重置界面缩放 | 恢复 100%（`zoomReset`） |
| `⌘P` / `⌘K` | 快速打开（开关） | 论文标题·作者·id 即时 quick-open + 去抖 `vault_search` 全文；输入 `>` 可切命令模式（`CommandPalette` · `quickOpen`） |
| `⇧⌘P` | 命令面板（开关） | 执行应用命令（设置 / 侧栏 / Vault / 标签…）；与快速打开共用浮层（`commandPalette`） |
| `Esc` | 关闭最顶层弹层 | 统一经 `overlay-stack`：设置 / 命令面板 / Zotero 迁移 / 移动论文 / Agent 权限等 |
| `⌘W` | 关闭最顶层弹层 / 标签 / 窗口 | 有注册弹层时先关弹层；否则关当前 tab；仅剩全库 Library 时关窗（File → Close 同源） |
| `⌘N` | 新建窗口 | `window_new`；欢迎页 + 最近列表，不恢复上次 Vault |
| `⌘O` | Open vault… | 打开文档/文件夹 |
| `⇧⌘N` | Create vault… | 创建并初始化新 Vault（含 catalog） |
| `⌘R` | 刷新文件树 | 刷新当前视图 |
| `⌥⌘R` | 在 Finder 中显示 | 右键或快捷键定位当前选中文件/文件夹（无双击）；`shortcuts.ts` → `revealInFinder` |
| `⌥⌘T` | 在终端中打开 | 文件夹 = 自身 cwd，文件 = 父目录；系统默认终端；`shortcuts.ts` → `openInTerminal` |
| `⌘←` | 折叠选中文件夹 | `collapseTreeCurrent`：已展开的组织夹折叠自身；叶子 / 已折叠则折最近展开的父级（对齐 VS Code `list.collapse` 心智）。编辑区不拦截（保留 ⌘← 行首） |
| `⇧⌘←` | 折叠文件树至默认 | `collapseTreeDefault`：只展开 `papers/`，列出其直接子项，**不**展开组织子目录；`notes/` 等收起。编辑区不拦截 |
| `⌘⌫` | 删除选中项 | 文件树选中项；移入回收站 `.agentero/.trash/`（**无确认 / 无 Undo toast**；从回收站视图恢复）；`papers/` 行随删随快照 catalog；编辑区不拦截 |
| `⌥⌘S` | 显示 / 隐藏侧边栏 | 对齐 Mail / Preview 等侧边栏约定 |
| `⌘B` | 显示 / 隐藏侧边栏（别名） | 兼容常见生产力应用 |
| `⌘1` | 聚焦侧边栏 | 分区焦点（Mail 等） |
| `⌘2` | 聚焦编辑器 | |
| `⌘3` | 聚焦 Notes（`focusNotes`；论文 PDF/HTML 侧栏 Notes） | |
| `⌥⌘→` / `⌥⌘←` | 下一 / 上一 panel | 按 dockview `api.panels` **全局**视觉序循环（`cycleActive`） |
| `Ctrl+]` / `Ctrl+[` | 组内下一 / 上一 tab | dockview `keyboardNavigation`（当前聚焦 **group 内**） |
| `F6` / `Shift+F6` | 下一 / 上一分屏 group | dockview；`Ctrl+Shift+方向键` 按空间方向聚焦相邻 group |
| `Ctrl+M` | 键盘停靠 panel | dockview：武装 → 方向键选目标 → `Enter` / `Esc` |
| `⌘L` | 显示 / 隐藏右侧栏 | Agent / Backlinks（含 Graph） |
| `⌥⌘Z` | Agent 禅模式 | 全屏仅 Agent 对话；再按退出；`toggleAgentZen` |
| `⇧⌘I` | 魔棒（按标识符添加） | 打开侧栏魔棒 Popover；`shortcuts.ts` → `magicWand` |

- 在编辑区聚焦时同样生效；涉及浏览器保留键时需 `preventDefault`。
- 快捷键清单以设置页 **Keyboard** 为准，实现见 `src/lib/shell/shortcuts.ts`；上表 dockview 组内 / 组间键由 `keyboardNavigation` 处理，不进 `shortcuts.ts`（避免与 App 全局循环双触发）。
- **魔棒**（已落地 v0/v1）：侧栏 `WandSparkles` Popover；输入框为**可变高度 textarea**（最低约 2 行、最大高度限制，可滚动），支持一次粘贴多个标识符，以空格 / 逗号 `,` / 分号 `;` / 中文逗号 `，` / 中文分号 `；` / 换行分隔。提交后走 Host `lookup_import_batch` → Translator（`translatorBaseUrl`，默认 `https://translator.philfan.cn`）→ 逐条解析、去重、入库。  
  - 目标目录：默认 `papers/`；当前在 Papers 子文件夹时写入该子路径。  
  - **始终下载 PDF** 到 `{paper}/{id}.pdf`（论文文件夹根目录）。  
  - **arXiv**：另从 `https://arxiv.org/e-print/{id}` 下载并解压 LaTeX 到 `source/`。  
  - **批量行为**：batch 内自动按 arXiv ID / DOI 等去重；已存在于 catalog 的条目跳过；并发入库（上限可在 **Settings → General → Batch import concurrency** 调整，默认 3、范围 1–10）并在单一后台任务聚合进度；入库结束后把仍缺资源的 paper 逐个加入下载队列，左下角任务列表会显示每一篇独立的下载任务，按并发上限排队执行。**批量入库不自动连跑 paper-reader**。  
  - **完成后**：刷新文件树 / Library / wiki → 打开**第一篇**成功导入的 paper（`openPaper`）并左侧树**展开祖先滚到新论文行**（避免 tab 爆炸）；全部失败则不打开。本地 PDF 导入同样走 `openPaper`。  
  - 详见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md) / [`../backend/api.md`](../backend/api.md) §3.6；i18n `sidebar:lookup.*` / `papersLibrary.*`；无 Vault 时禁用。
- **论文行 Download**：缺本地 PDF，或既无 TeX 也无 `PAPER.md` 时显示；hover 列出原因 → `paper_download_assets`（已有资源跳过）。下载后若仍无 TeX 且有 PDF，Host 自动 liteparse 写 `PAPER.md`。Library 行可对库内全部不完整 paper **批量** Download。
- **论文行 Zap（精读）**：资源齐全且 catalog `is_read === false` 时显示；点击**手动**启动 paper-reader（`agent_run_once` + skill；**Claude 用 `/paper-reader`，其它（含 Codex）靠注入正文**）→ 写/更新 `{paper}/NOTES.md` → `paper_set_is_read(true)`。若设置开启 `autoPaperReader`，魔棒 / 单篇 Download 成功后也会自动跑（批量不连跑）。进度在左下角后台任务条。

### 3.1.1 全局 Dockview 工作区（V0.6 已落地）

中间栏由 **单一全局 Dockview** 管理全部打开文档（`src/components/workspace/dock-workspace.tsx`、模型 `src/lib/workspace/tabs`）。**标题栏无文档 tab 条**。完整契约见 [`../development/tab-split.md`](../development/tab-split.md)。

- **文档 panel**：paper / Markdown / PDF / HTML / **Library（全库或文件夹作用域）** / 回收站 / **NOTES** 各为一个 dockview panel；原生 tab 切换、关闭（`X` / `⌘W`）、组内拖拽重排；同一 path 已开则 `activatePanel`。
- **Tab 右键菜单**：关闭 / 关闭其他 / 关闭全部（**同组**）；新建标签组 / 从标签组移除（`getTabContextMenuItems`；文案走 i18n）。
- **Tab 组**：chip 右键重命名、染色、解散（`getTabGroupChipContextMenuItems`）；色板复用论文标签（`tag-colors` + grey）；底部分组线保留；仅组名 chip 浅色底（`index.css` `color-mix`）。
- **分屏**：上下左右 + 多格网格（dockview 原生）；文件树路径可拖入任意边；论文打开时默认 PDF 与 `NOTES.md` **左右分屏**（首篇 `right`，后续叠到同两栏 `within`）；切换论文时同步切换其 NOTES tab。`dropOverlayModel` 调大 content 边激活区；未知外部拖拽由 `onWillShowOverlay` / `onWillDrop` 否决。
- **默认页 = 全库 Library**：
  - 打开 Vault 无持久化布局 → `ensureFullLibraryTab()`。
  - 关 panel 后列表为空 → 自动打开全库。
  - **`⌘W` / tab X**：有注册弹层时**先关最顶层**（见 §3.0）；否则仅剩全库 `agentero:library` 时**关窗**；否则关 active panel，关空后回全库。
- **挂载策略**：PDF panel 壳用 dockview `renderer: 'always'` 保活；EmbedPDF 引擎由 App **PDF LRU**（默认 4）限流。非 PDF 默认 `onlyWhenVisible`。作用域 / 全库共用 `libraryPapers` 缓存。
- **焦点**：完全听 dockview `onDidActivePanelChange`；`⌥⌘←/→` 按 `api.panels` **视觉序**循环。
- **持久化**：**只存** dockview `toJSON()`（panel params 含 path/mode）；按窗口恢复。
- **NOTES**：`createNotesSplitPane` 派生独立 panel；paper-reader / download 写回后按路径 reseed。
- **外部/Agent 改动自动重载**：Host `notify` → `vault:file-changed`（`src/lib/vault/fs-watch.ts`）。打开中的 `.md`/`NOTES.md`：无未存改动则重载；有未存改动 toast 提示不静默覆盖；内容相等抑制自写回声。结构性变更去抖刷新文件树。
- **Wiki 索引**：`.md` 变更 → `scheduleWikiRebuild`（~900ms 防抖）。
- **保存冲突**：写盘前比对上次落盘内容；磁盘已被外部改则中止并 `notifyWarning`（`diskConflict.saveBlocked`）。

后续增强（未做）：

- tab 固定（pin）、按 paper 分组、「当前 panel vs 新 panel 打开」策略可配。
- 组最大化（`maximizeGroup`）、watermark / header actions 等。
- 与 Agent 面板 **会话标签** 分离（不同概念，已成立）。

### 3.1.2 规划：PDF 引用与插图

首个交付只处理本地 paper PDF：有 TeX 时解析 TeX/Bib/figure declaration，无 TeX 时使用 liteparse；结果写入 `source/agentero-*` 可重建 sidecar。右侧 `Paper Content` 展示 citations/figures，PDF 内 hover 高亮并预览，点击跳 reference/figure。库外引用只显示 unresolved 原始信息，不自动导入。详见 [`../backend/pdf-analysis.md`](../backend/pdf-analysis.md)。

### 3.1.3 规划：文内引用 hover → Paper Info（roadmap V0.7）

阅读 PDF/HTML/`PAPER.md` 时，对文内引用锚点 hover，右侧 Paper Info 展示**被引论文**元信息（库内打开 / 库外缓存 + 入库）。引用邻域图与 Agent 引用工作流见 roadmap V0.7；**不**与 Backlinks 双链 Graph 混为一谈。

### 3.2 Agent 右侧栏（AI Elements）

| 要求 | 说明 |
|---|---|
| 入口 | `⌘L`、标题栏右侧 Agent 图标、菜单 **View → Toggle Chat** |
| 结构 | 顶栏：ACP 后端选择 · 新建 · 历史 + 消息列表 + Composer |
| 消息组件 | AI Elements `Message` + `MessageContent` + `MessageResponse`（`from="user" \| "assistant"`） |
| 列表滚动 | `Conversation` + `use-stick-to-bottom`（`ConversationScrollButton`） |
| 输入 | 单层 Composer：当前聚焦论文/文件**默认**加入上下文（实心 chip + 名称，可 X 移除；无虚线加号切换）；chip 展示 **paper-name / 文件名**（最后一段路径或 catalog 论文标题），tooltip 与 prompt 仍用 Vault 相对路径；`@` 文件提及和 `$` 本机技能为可移除 context chip；候选列表支持 `↑` / `↓`、`Enter`，当前项仅使用背景高亮；文字与 context chip 按 Vault、Agent、session 独立持久化，发送成功后清空该 session 已发送的一次性 `@`/`$` 上下文（当前论文保持默认附带）；发送按钮与 `↵` 均可提交，输出期间按钮和 `Esc` 均可中止，`⇧↵` 换行；**IME 组字中 `↵` 只确认候选、不发送**（见 [`../bug_fix/ime-composition-enter-submit.md`](../bug_fix/ime-composition-enter-submit.md)）；Agent 输出期间仍可编辑下一条输入；底栏空闲时使用主要色，仅存在正在输出的 Agent 消息时切换为次要色，Fast 的启用色保持不变；`/` 文本原样透传给 ACP Agent |
| 业务壳 | `src/components/agent/`：`agent-panel` 编排 + `use-agent-panel`（注册表 / 流式 / 历史）+ Composer / Transcript 子组件 |
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

**消息编辑与重发**：会话空闲时（发送成功、停止或失败后）hover 已发送的用户消息会显示 **Edit（铅笔）** 与 **Copy** 两个图标按钮；运行中不显示 Edit，须先按 `Esc` / 点击停止。点击 Edit 就地把气泡替换为文本框（`↵` 重新发送、`⇧↵` 换行、`Esc` 取消；**IME 组字中 `↵` 不重发**，见 [IME composition race](../bug_fix/ime-composition-enter-submit.md)），重发时会丢弃**该消息及其之后的所有内容**（旧回答 / 被中断的运行）并以新文本发起一次全新的 turn，用于修正发错的输入。切换会话 / 标签 / 新建对话会自动取消未完成的编辑。（重发沿用普通发送的 session 续接规则：有 `sessionId` 时经 ACP `session/resume` 续接，可见转录被截断但 Agent 侧会话记忆不随之回退。）

**会话标签**：运行中的 Agent session 不会锁定标签栏。用户可随时切换并查看其它已打开的会话，也可在新会话中发起独立运行；同一 session 在运行期间保持只读，避免重入。流式消息、工具调用和最终状态仍只写回它们所属的 session。

**上下文提及**：Composer **默认附带**当前聚焦的论文单元（文件在 paper 内时解析为 paper 文件夹）或其它打开的 Vault 路径，无需点击加号；chip 标签为 **虚拟名称**（论文优先 catalog 标题，否则路径最后一段 / paper-name），完整 Vault 相对路径仅作 tooltip 与发送给 Agent 的引用。输入 `@` 打开候选菜单：候选为 **论文文件夹 + 其它目录 + paper 外 Markdown**（paper 内 `NOTES.md` 等折叠为 paper 单元）；**空 `@`** 优先展示最近选用路径与浅层目录树（depth ≤ 2）；行右侧 **›** 可进入子目录（论文单元为叶子、不可再下钻；顶部 ‹ 或 `←` / `Esc` 返回上级）；输入关键字按路径或论文显示名筛选。论文候选标签与文件树一致（设置 → 通用 `paperTreeLabelMode`：标题 · 作者等）。从左侧文件树**拖入**文件/文件夹到输入区同样解析为 chip（`text/plain` 路径 → `mentionedPaths`，不插入纯文本路径）。Chip 图标按路径类型选择（`src/lib/agent/context-path-icon.ts`）：**论文文件夹**用 `ScrollText`（与文件树 paper 行一致，依据 marker 收集的 `vaultPaperPaths`）；**其它文件夹**用 `Folder`；**文件**按扩展名（PDF / 图片 / 代码 / Markdown 等）。发送时 Agentero 将这些 Vault 相对路径追加到 prompt，并将第一个路径传为 `target`，Agent 仍按自身权限读取文件。

> **不**接 AI Elements `Attachments` 做 Vault 上下文：那套组件面向 `FileUIPart` 二进制附件（`prompt-input` 已装未对 ACP 传文件）；本产品上下文是 **路径引用**，与 `@` chip / `composer.contextInstruction` 一致。

**本机技能**：Composer 统一用 `$` 打开技能选择器（Agentero UI 约定，与运行时触发语法无关）。可选来源：`~/.agents/skills`、`${CODEX_HOME:-~/.codex}/skills`、`~/.claude/skills`、当前 Vault `.agents/skills`。选中后显示为 context chip；发送时 Host 重新解析技能 id、校验文件大小，并**按当前 Agent 模板**组装 prompt：

| Agent 模板 | 运行时 skill 提及 | Host 行为 |
|---|---|---|
| **Claude** (`claude-acp`) | **`/skill-id`** | 用户 prompt 前缀 `/id` + 注入完整 `SKILL.md` |
| 其它（Codex / OpenCode / Gemini / Qoder / Grok / custom） | 无原生触发 | 仅注入 `SKILL.md` 正文，并在 prompt 中说明不要等待 `$`/`/` 命令 |

paper-reader 精读工作流与 Composer 共用这套规则，避免把 Codex 的 `$` 误写成 Claude 的 `/`，或反向。

**斜杠命令**：Agentero 不实现自己的 `/` 命令菜单。用户手打的 `/…` 原样透传；Claude 路径上 Host 也可能主动加上 `/skill-id` 前缀以对齐其 skill 语法。其它 provider（含 Codex）仅注入 `SKILL.md` 正文。

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

**回答语言**：**设置 → Agent** 提供一个全局「回答语言」下拉（**自动 / English / 简体中文**，存于 app settings，默认 **自动**），**独立于界面语言**，对**所有 Agent** 交互生效（Composer 对话、精读、summary/QA、PDF 划词问答）。前端 `runOnce` 统一读取该设置并透传，Host 在 `build_prompt` 为所有 workflow 追加一句语言指令；选 **自动** 时不注入任何指令，交由 Agent 依据内容决定。

**个人偏好提示词**：**设置 → Agent** 提供多行文本框（`agentPersonalPrompt`，默认空）。非空时，前端 `runOnce` 透传 `personalPrompt`，Host 在 `build_prompt` 的 system envelope 中追加 `User preference instructions` 块（所有 workflow）。留空不注入；Chat 展示经 `strip_prompt_envelope` 剥离 envelope，**不**在对话记录中显示该块。

**会话配置控件**：底栏按当前 provider 的 ACP `SessionConfigOption` 声明显示模型选择、reasoning effort 与 Fast toggle（所有 provider 含 Codex 统一）。选择在下一次 turn 中生效；未声明对应能力的 Agent 不显示也不接收这些偏好。

**会话历史**：所有 provider（含 Codex）统一经 ACP `session/list` + `session/load` 获取历史（`agent_list_sessions` / `agent_load_session`）。历史列表显示当前 Vault 下的会话；`hideFromChatHistory` 的后台运行（精读、划词提问等）不出现。

### 3.3 Backlinks + Graph 右侧栏

| 区域 | 说明 |
|---|---|
| 入口 | 标题栏右侧 Backlinks 图标；若右侧栏关闭，点击后打开并切到 Backlinks |
| 上方 | `BacklinksPanel`：当前文件的反链来源与上下文摘录 |
| 下方 | `GraphPanel`：当前邻域 / 全图切换，节点点击打开对应文件或 paper |
| 布局 | 同一右侧栏内垂直堆叠，Backlinks 约占上方区域，Graph 填充剩余高度 |
| 非目标 | 不再提供独立顶层 Graph tab；避免右侧栏入口过多 |

## 4. 设置窗口（Settings）

参考 **macOS System Settings / 传统 Preferences** 形态：所有平台均为 App 内**居中浮层 dialog**（`SettingsWindow` 包 `SettingsContent`，经 `overlay-stack` 注册 `settings`）。

> **注**：曾实现独立原生单例窗口（Host `settings_window_open` + `?window=settings` 路由），但该第二 webview 在 **Windows 下白屏卡死**；已改回 App 内浮层。前端路由与 `settings-window-root.tsx` 已删除，仅 Host 命令暂时保留但不再调用。

| 要求 | 说明 |
|---|---|
| 入口 | macOS：顶部菜单栏 **agentero → Settings…**，或 `⌘,`；Windows / Linux 无原生菜单栏，标题栏窗口控制按钮左侧显示 **齿轮图标**（`Settings`，hover 旋转 90°，Tooltip 含快捷键；`title-bar.tsx`，i18n `app:titlebar.settings*`）。不在侧边栏放设置图标 |
| 结构 | 左侧分类导航 + 右侧内容；居中浮层 dialog（backdrop 半透明模糊） |
| 分类 | General · Appearance · Agent · **Translate** · Keyboard · About |
| 行样式 | 分组卡片（rounded + border）；左标签、右控件；行间细分隔 |
| 控件 | Switch / Select / Input；避免花哨装饰 |
| 关闭 | 右上角 `X`、点遮罩、`Esc`、`⌘W`、再次 `⌘,`（均经 `overlay-stack`） |
| 同步 | 保存经 `settings_set` → Host 广播 `settings:changed` → 各窗口即时应用（主题 / 语言 / 列配置等），见 `../backend/api.md` |
| 文案 | 支持国际化（i18n）：English 与简体中文可切换，English 为源语言与兜底；简短说明可作 footer |

**页面职责**

- **General**：恢复上次 Vault；**文件树论文显示**（`paperTreeLabelMode`，默认 `title-author`：标题 · 作者；另有标题 / 作者 (年)·标题 / 文件夹名）；**文件树论文排序**（`paperTreeSortMode`，默认 `folder`：显示名称 A–Z，跟随 `paperTreeLabelMode`；另有标题 / 作者 / 年份新→旧 / 年份旧→新 / 添加时间新→旧）；**Translator 服务地址**（`translatorBaseUrl`，默认 `https://translator.philfan.cn`）。入库默认下载 PDF（arXiv 含 LaTeX），无「是否本地下载」开关。**Zotero Connector 兼容**开关（`connectorEnabled`，默认关；与 Zotero 桌面端互斥占用 `23119`；状态行显示监听地址 / 错误；保存成功后刷新树/Library 并 **`openPaper` 打开论文 tab**；见 [`../backend/connector.md`](../backend/connector.md)），勿与 Translator 地址混为同一设置项。
- **Appearance**：主题、**配色主题**（`uiTheme`，tweakcn 预设，默认 `default`，见 §1）、**界面缩放**（`uiScale`：80% / 90% / 100% / 125% / 150%，默认 100%；通过 `<html>` `font-size` 全局缩放，旧 `toolbarIconSize` 仅一次性迁移）、**语言（跟随系统 / English / 简体中文）**；其下分组 **Markdown 编辑器**：编辑字号、**格式工具栏**（`showEditorToolbar`，默认开）。
- **Agent**（BYOA，非模型 BYOK 表单）：
  - **权限模式**（`agentPermissionMode`：受限 / 每次询问 / 自动批准，见 §3.2）。
  - **回答语言**（自动 / English / 简体中文，独立于界面语言）。
  - **个人偏好提示词**（`agentPersonalPrompt`，多行，默认空）：自由文本注入每次 Agent turn 的 prompt envelope；留空关闭。
  - **入库后自动精读**（`autoPaperReader`，**默认关**）：开启后魔棒 / 单篇 Download 资源就绪且未读时自动 paper-reader；Zap 始终可手动。
  - **PDF 划词提问**（`pdfAsk.agentId` / `pdfAsk.modelId`）：划词「提问」对话框专用 Agent 与模型；空则跟随默认 Agent / 该 Agent 的模型偏好；与 Chat 当前选择、翻译用 Agent **相互独立**。
  - **Common agents** 目录表：名称与 badge 组留距；badge 组内紧凑（安装列固定槽：已安装 / 未安装；ACP 列 ready/failed/**探测中**（含旋转 Loader，取代静态「未探测」）；不把 missing 显示成「未安装」；+ adapter missing）；未安装整行置灰；默认 Agent 右侧对勾。打开页 soft probe（**跳过已 ready**，只测 not-probed/failed）；Refresh / 改代理 **force** 全量再 Probe。badge 用 `ProbeResult` 就地更新（不全量 scan 每行）；结束再 reconcile scan 一次。代理开关不因 Probe busy 禁用。
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
- **About**：版本与一句话定位。

实现：`src/components/settings/settings-window.tsx`（`SettingsWindow` 浮层 + 共用 `SettingsContent`）。**应用设置**持久化为 Host 文件（XDG）：

| 路径 | 说明 |
|---|---|
| `$XDG_CONFIG_HOME/agentero/settings.json` | UI 设置（通用 / 外观 / Agent 权限与语言 / 翻译等）；未设 env 时 Unix 默认 `~/.config/agentero/settings.json` |
| `$XDG_CONFIG_HOME/agentero/agents.json` | BYOA Agent 注册表（默认 Agent、自定义 command、代理） |

- 前端：`src/lib/settings`（内存缓存 + `settings_get` / `settings_set`）；启动时 `ensureSettingsLoaded()`，旧 `localStorage` 键 `agentero-settings` **一次性迁移后删除**。
- Host：`src-tauri/src/services/app_settings.rs`、`services/paths.rs`（XDG 解析）。

**Host 上下文（本机 / 远端）**：

- 设置侧栏**底部**显示 **Host**（系统图标 + 本机 hostname / 远端 `user@host`；本机用编译目标 OS，远端 `uname -s`）。
- 当前 Vault 为 `remote:…` 时：Agent 分区切换为 **远端探测**（`remote_agent_scan` + `remote_agent_probe`；**代理**与本地共用并注入远端 env；**Install ACP** 经 SSH 装适配器）；外观等仍为本机 `settings.json`。PATH / Linuxbrew 注意见 [`../bug_fix/remote-acp-path-ssh.md`](../bug_fix/remote-acp-path-ssh.md)。
- 本机 Vault / 无 Vault：Agent 分区为现有本机 catalog + probe。

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

目录分层（详情 **`docs/frontend/components.md` §6**）：

| 位置 | 职责 |
|---|---|
| `ui/` | shadcn 通用原语 |
| `ai-elements/` | AI Elements registry |
| `icons/` | 品牌图标（勿并入 `ui/`） |
| `shell/` | 真壳 + 共享 chrome（标题栏、sash、欢迎页、后台任务、ErrorBoundary） |
| `sidebar/` | 左栏：文件树、Paper Info、侧栏头 |
| `wiki/` | 双链：Backlinks、Graph |
| `agent/` | Agent 对话面板 |
| `workspace/` | Dockview 中间栏（tab 工作区 / 回收站） |
| `library/` | 论文域（表格、标签 chip、入库/移动对话框） |
| `editor/` | Plate 编辑器 + 插件 |
| `viewer/` | PDF / HTML / 图片 |
| `settings/` | 设置窗 |
| `dialogs/` | 仅全局/跨域对话框（命令面板、远端 Vault、Zotero 迁移） |

- 图标：**Lucide React**。
- 优先复用 `Button`（`variant="ghost"` + `size="icon-xs"`）、`Tooltip`、`Switch`、`Select`、`Input`、`DropdownMenu`。
- - 参考：[shadcn/ui](https://ui.shadcn.com/) · [AI Elements](https://elements.ai-sdk.dev/) · `docs/frontend/components.md`
