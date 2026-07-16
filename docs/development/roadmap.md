# Motif / notemd Roadmap

## 1. Roadmap 原则

- 先验证 Agent-first 闭环，再扩展传统文献管理能力。
- 先做好 arXiv，不急于覆盖所有论文来源。
- 所有核心数据必须能从本地 Markdown 重建。
- 阅读器服务于审阅和修正，不在早期追求完整 Zotero/PDF 批注体验。
- Agent 采用 **BYOA**：Motif 只做 ACP Client，不捆绑 Agent；能力必须可解释、可追溯、可被用户修正。
- UI 以“少入口、强上下文”为原则：右侧栏只保留 Agent 与 Backlinks 两个入口，Backlinks 下方承载 Graph。

## 2. 当前状态快照

| 版本 | 状态 | 说明 |
|---|---|---|
| V0.1 本地 Vault 与 Markdown 工作台 | ✅ 基本完成 | 工作台、Create Vault + catalog、多窗口（⌘N）+ 欢迎页、树内联新建 / **Finder 显示 / 删除**、PDF/HTML/Notes、WYSIWYG Markdown、**论文库表格 + 虚拟 Library 节点**、左右侧栏 collapsible 隔离、后台任务条（含 paper-reader；hover 实色）、Preview/Info 仅在具体论文时显示。 |
| V0.2 arXiv / 标识符入库闭环 | 🟡 精确路径基本完成 | **魔棒 + Translator** 入库、catalog 权威、`paper_list` / `paper_get`、**默认下载 PDF + arXiv e-print 解压 LaTeX**、单篇/Library **补下缺失资源**、**无 TeX 时 liteparse → `PAPER.md`** 已落地；Agent 关键词候选、`catalog:export_*` 仍待。 |
| V0.3 Agent 工作流（BYOA） | 🟡 进行中 | 通用 ACP Client（OpenCode、Gemini、Claude、Qoder、Grok、自定义）+ Codex 原生 App Server thread/history；**paper-reader 精读**（入库/单篇 Download **自动** + 文件树 Eye 手动；catalog `is_read`）；**全局权限模式**（设置 → Agent：受限 / 自动批准）；其它内置工作流、逐项权限确认 UI、写入草稿确认仍待。 |
| V0.4 双链、反链与图谱 | ✅ 基本完成 | 反链、预览双链跳转、缺失目标创建、Graph 与 `graph_get_graph` 已落地；`[[` 补全 / Plate 内联节点可后续增强。 |
| V0.5 Importer 架构与本地 PDF 入库 | ⏳ 待实现 | Importer trait、本地 PDF 拖拽入库、PdfParser（liteparse / MinerU）仍在规划；魔棒 v0 已可复用部分写盘路径。 |
| V0.6 工作区标签页与分屏 | ⏳ 待实现 | 中间栏由「单文件固定排布」升级为可开多标签、可分屏；与当前左右侧栏 collapsible 共存。 |
| V0.7 引用关系与 Connected Papers | ⏳ 待实现 | 文内引用 hover → 右侧 Paper Info；引用图 / Connected-Papers 式探索；配套 Agent 工作流。 |
| Release CI | ✅ 完成 | push `v*` tag 时构建 macOS/Linux/Windows Tauri 安装包并上传草稿 Release。 |

**精确 arXiv/标识符入库（可用）**：魔棒粘贴 ID/URL → Translator → catalog + `NOTES.md` 壳 → `source/` PDF（arXiv 含 TeX）→ Library 表可见；缺资源时树行/Library 可补下。

## 3. 版本规划

## V0.1 本地 Vault 与 Markdown 工作台

目标：让产品从 Tauri 模板变成一个可用的本地 Markdown 知识库壳。

关键交付：

- [x] 打开本地 Vault。
- [x] 创建空 Vault 并初始化 `AGENTS.md` / `papers` / `notes` / `plans` / `.agents`（含 `skills/`）/ `.motif/catalog.sqlite`。
- [x] 工作台：文件树 + 中间内容 + Preview/Notes + 可选右侧栏。
- [x] Markdown 文件读取、编辑、保存（Plate WYSIWYG + 自动保存；顶部可选**格式工具栏**，设置 `showEditorToolbar` / Notes header 一键开关）。
- [x] 最近 Vault 列表（欢迎页）与主窗口恢复上次 Vault。
- [x] 多窗口：`⌘N` 新建窗口，session 级 Vault 隔离。
- [x] 树内联新建文件 / 文件夹。
- [x] 文件树：**在 Finder 中显示**（双击 / 右键 / `⌥⌘R`）；**删除**（右键 / `⌘⌫`，`papers/` 同步 `paper_delete`）。
- [x] Paper-centric 视图：选中 paper 后中间显示远程 PDF/HTML，右侧显示该篇 `NOTES.md`（**仅具体论文**时显示 Preview/Info）。
- [x] 侧边栏折叠、标题栏快捷按钮、Settings 窗口；左右侧栏 **常驻 collapsible + preserve-pixel-size**（交替快捷键互不冲态）。
- [x] 论文库表格：虚拟节点 `motif:library`、`paper_list`、表头排序、双向滚动。
- [x] Paper Info / Notes 仅在选中具体论文时显示（Library 视图隐藏）。
- [x] 后台任务条（左下角）：下载 / 入库 / 导入导出 / paper-reader 等长操作进度；收起态 hover 保持实色不透明。

验收标准：

- [x] 用户可以创建一个空 Vault 并看到标准目录结构与 catalog 数据库。
- [x] 用户可以打开、编辑、保存一个 Markdown note。
- [x] 重启应用后可以回到最近使用的 Vault（设置开启时）。
- [x] `⌘N` 打开的新窗口不自动占用上一窗口的 Vault，欢迎页可点最近路径。
- [x] 打开 Vault 后可在 Library 视图看到 catalog 中的论文列表。

后续 TODO：

- [x] 补齐“Create Vault”流程（含 catalog 初始化），而不只是打开已有目录。
- [ ] 最近 Vault / UI 偏好从 `localStorage` 迁到 Tauri Store（语义对齐现有前端 MRU）。

## V0.2 arXiv / 标识符入库闭环

目标：从用户输入（ID/URL，后续关键词/话题/描述）到本地文献资产的闭环；精确路径优先落地，再扩展 Agent 检索。

设计：[`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)、[`../backend/catalog.md`](../backend/catalog.md)。

### 已落地（精确 ID/URL + 本地归档）

- [x] 侧栏魔棒：粘贴 arXiv / DOI 等链接或编号 → Host `lookup_import`。
- [x] Translator HTTP（`translatorBaseUrl`，默认 `https://translator.philfan.cn`）+ arXiv Atom fallback。
- [x] map → `PaperMetadata` → **catalog.sqlite 权威**；`metadata.json` 仅为投影。
- [x] 创建 `papers/<id>/`（或当前 Papers 子文件夹下）、`NOTES.md` / `highlights.md` 壳。
- [x] **始终下载 PDF** 到 `{paper}/{id}.pdf`（论文根目录）；**arXiv e-print 解压 LaTeX** 到 `source/`（无下载开关）。
- [x] 中间栏预览仍可用 catalog 远程 `pdf_url` / `html_url`。
- [x] `paper_list` / `paper_get`；Library 表格 + 虚拟节点。
- [x] 按需补下：`paper_download_assets`；paper 行缺 PDF 或 arXiv 缺 TeX 时 Download；**Library 行批量补下全部缺失**。
- [x] **无 TeX 时 liteparse → `PAPER.md`**：下载后自动；`paper_parse_body`（Download 流程内触发）。
- [x] **paper-reader 精读**：入库/单篇 Download 后可自动；资源齐全且 `is_read=false` 时文件树 Eye 手动（见 V0.3）。
- [x] Library 导入/导出：`paper_import` / `paper_export`（Translator `/import` + `/export`，Zotero JSON 数组）。
- [x] 入库错误行内展示；重复不覆盖用户 `NOTES.md`。
- [x] 删除 paper / 组织目录：磁盘 `remove` + catalog `paper_delete`（含嵌套 path）。

### 未完成

- [ ] 关键词/话题/自然语言描述 + 输入分类（规则 + Agent）。
- [ ] Agent 检索候选列表确认（单选/多选）。
- [ ] `catalog:export_papers_md`（Markdown 表形态；BibTeX 已由 Library 导出覆盖）。
- [x] 入库后刷新 Backlinks/Graph 索引
- [x] 魔棒快捷键 `⇧⌘I`；
- [ ] 非 arxiv 下载 PDF 有问题（10.1371/journal.pbio.0040157）

验收标准：

- [x] 输入 `1706.03762` 后生成 paper 目录、NOTES 壳、catalog 行，并尽量得到 PDF（arXiv 另有 TeX）。
- [x] 连续入库多篇后 `paper_list` / Library 可见对应行。
- [x] 缺本地资源时 paper 行 / Library 可补下。
- [x] Library 可导出 BibTeX、可导入 .bib/.ris 进 catalog。
- [ ] 关键词路径：候选列表 → 确认 → 入库。
- [ ] 可选导出 PAPERS.md 与 catalog 一致。
- [x] 重复入库不破坏已有 `NOTES.md`。

## V0.3 Agent 工作流（ACP Client + BYOA）

目标：将 Motif 实现为 **ACP Client**，连接用户本机已安装的 Agent，按 Vault 规则完成总结 / 问答 / Related Work。

关键交付：

- [x] ACP Client：stdio JSON-RPC 会话、流式输出事件。
- [x] Codex 原生 runtime：`codex app-server` 的 thread start/resume、流式 turn、原生 history 列表与 JSONL transcript 回放；不再经 ACP adapter 启动 Codex。
- [x] BYOA 注册表：预设模板 + 自定义 `command` / `args` / `env`；默认 agent 选择。
- [x] 可执行文件探测与空状态安装指引（Motif **不打包** agent 二进制）。
- [x] Composer 上下文：当前文件 chip、`@` / `$` 候选的键盘选择、本地会话标签切换。
- [x] Codex 会话配置：仅在 Codex provider 上按 App Server 模型目录显示并应用 reasoning effort 与 Fast。
- [x] **全局权限模式**：设置 → Agent（`agentPermissionMode`：`restricted` 默认 / `autoApprove`）；对所有 Agent 生效；经 `autoApprove` 传入运行；逐项「每次询问」仍待。
- [x] Agent 输出期间 Composer 仍可编辑；按 `Esc` 会取消当前 ACP session 并保留已输出内容。
- [x] 消息编辑与重发：会话空闲时 hover 用户消息可 **Edit**，就地编辑后重发（丢弃该消息及其之后内容并发起全新 turn）。
- [x] 会话 `cwd` = 当前 Vault。
- [ ] 工作流 prompt 模板注入 + `AGENTS.md` 约束。
- [x] **paper-reader 精读工作流**：
  - 魔棒入库 / 单篇 Download 资源就绪且 `is_read=false` 时**自动**启动（`maybeAutoRunPaperReader`；批量导入/批量 Download **不**连跑）。
  - 资源齐全且未读时文件树 **Eye** 可手动重跑。
  - skill（**provider 分流：Codex `$` / Claude `/` / 其它注入**）→ 写 `NOTES.md` → catalog `is_read=true`；左下角任务条（入库/下载 → 精读衔接）。
- [x] **Skill 提及按 Agent 模板**：Host `SkillMentionStyle`（`skills.rs`）；Composer `$` 仅为 UI 选 skill。
- [ ] 内置工作流：总结当前论文（面板入口）、基于本地库问答、生成 Related Work 草稿（引用类 workflow 见 V0.7）。
- [x] Agent 读取路径回显（Sources）。
- [x] 密钥边界：模型 API Key 由 Agent CLI 管理，Motif 不要求模型 BYOK 表单。

验收标准：

- [x] 用户配置并成功探测至少一个本机 Agent 后，可发起 Agent 对话。
- [x] 未安装 Agent 时有清晰空状态与配置入口，应用其余功能可用。
- [x] Agent 问答展示读取过的本地文件路径（Agent 返回 Sources 时）。
- [x] 下载完成且未读的 paper 行显示 Eye；点击后精读并标记已读。
- [x] 魔棒/单篇 Download 成功后可自动进入精读（有默认 Agent 时）。
- [ ] Related Work 草稿必须包含本地路径引用。
- [ ] Agent 失败或用户拒绝写入时，不会覆盖已有 Markdown。

细化 TODO：

- [x] paper-reader：自动触发 + 文件树 Eye + `is_read` + 后台任务进度。
- [x] 全局权限模式替代 per-provider YOLO 开关。
- [ ] 把“总结当前论文 / 本地库问答 / Related Work”做成 Agent 面板可点击 workflow。
- [ ] 将 `AGENTS.md` 自动注入 workflow prompt，并在缺失时提示初始化。
- [ ] 接入 ACP 权限确认 UI（「每次询问」档），而不是仅取消或自动选第一项。
- [ ] 写入草稿使用 diff/preview 确认后落盘。
- [x] Codex 会话恢复：按 Vault 过滤原生 Codex thread，恢复后继续使用同一 thread id。
- [ ] 为通用 ACP provider 定义持久 runtime 与原生 history 契约；当前 ACP 会话仍是一次性连接。
- [ ] Agent 输出期间的后续交互：普通 Agent 排队下一条消息，Codex 支持 guide / 引导消息。

## V0.4 双链、反链与图谱

目标：让知识库从文件集合升级为可导航的研究网络。

**设计文档**：`docs/backend/wikilinks.md`（Obsidian 兼容模型、开源选型、Phase A–D）。

关键交付：

- [x] `[[双链]]` 解析（与 Obsidian 兼容）。
- [x] 双链点击跳转。
- [x] 不存在目标的创建入口。
- [x] 当前文件反链列表。
- [x] 图谱视图。
- [x] Paper、Note、Index、Stub 节点类型。
- [x] 图谱节点点击打开文件。
- [x] 当前 UI：Backlinks 入口内上方为反链，下方为 Graph。

验收标准：

- [x] 双链可以跨 `papers/`、`notes/`、`plans/` 跳转。
- [x] 反链能显示所有引用当前文件的来源。
- [x] 图谱能从 Markdown 重建，不依赖手写数据库。
- [x] 20 个节点以内交互流畅。

后续增强 TODO：

- [ ] 源码编辑中的 `[[` 路径/标题补全。
- [ ] Plate 内联 wikilink 节点与更稳定的 Markdown 序列化。
- [ ] 图谱 hover 时只高亮直接邻居。
- [ ] 增加 Graph 全屏/聚焦模式，保留右侧栏小图作为默认入口。

## V0.5 Importer 架构与本地 PDF 入库

目标：抽象 Importer 接口，落地 arXiv 与本地 PDF 两个 importer，并为后续 HTML、DOI、Zotero/BibTeX 做架构准备。

关键交付：

- [ ] 抽象 importer 接口。
- [ ] 将 arXiv 入库实现迁移为第一个 importer。
- [ ] 实现本地 PDF importer：文件选择/拖拽/批量导入、citekey 生成与重复检测。
- [ ] 可插拔 `PdfParser`：默认本地 liteparse，配置 MinerU API Key 后优先云端 MinerU，失败自动降级。
- [ ] PDF 元数据混合获取：DOI/arXiv 标识符查询 Crossref/arXiv + Agent 正文抽取，入库前用户确认。
- [ ] 预留本地 HTML importer。
- [ ] 预留 BibTeX/Zotero importer。
- [x] **魔棒 Identifier Lookup（v0）**：HTTP Translator + `lookup_import` + 默认 PDF/LaTeX + `paper_download_assets`（见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)）。
- [ ] 将魔棒路径收编为正式 Importer 实现之一。
- [ ] 统一入库状态、错误类型和输出文件契约。

验收标准：

- [ ] arXiv importer 行为与 V0.2 精确路径保持兼容。
- [ ] 导入本地 PDF 能生成 `papers/<citekey>/`（含必定生成的 `PAPER.md`）并进入笔记审阅。
- [ ] 配置 MinerU API Key 后 PDF 默认走云端解析，未配置或失败时自动降级本地且不中断。
- [ ] 新 importer 可以复用同一套输出结构。
- [ ] UI 不需要为每种来源重写入库流程。

## V0.6 工作区标签页与分屏

目标：中间内容区从「当前选中一项即替换」升级为 **标签式多文档工作区**，并支持 **分屏并排阅读/编辑**。

现状对照：

- 今日中间栏是单槽：Library / PDF / HTML / Markdown 互斥切换，打开新文件会替换当前内容。
- 左右侧栏已是常驻 collapsible（`preserve-pixel-size`）；Agent 禅模式是全屏 Agent，不是编辑区分屏。
- Agent 面板内部已有 **会话标签**（多 session），与「文档标签页」是不同概念。

关键交付：

- [ ] **文档标签栏**：打开 paper / Markdown / PDF / HTML / Library 时在中间区以 tab 呈现，可关闭、切换、拖拽重排。
- [ ] **标签状态**：每 tab 保留滚动位置、PDF 缩放、视图模式（PDF/HTML/Notes 侧栏上下文）；关闭前未保存 Markdown 需提示。
- [ ] **分屏（split）**：水平或垂直拆成 2 格（MVP 可先 2 格；后续可扩展 3–4 格），每格独立 tab 栈或共享 tab 池。
- [ ] **快捷键**：新建/关闭 tab、下一/上一 tab、分屏 / 取消分屏（具体键位写入 `docs/frontend/ui.md`）。
- [ ] **与文件树联动**：树选中可「在当前 tab 打开」或「新 tab 打开」；默认策略在设置中可配。
- [ ] **多窗口兼容**：`⌘N` 窗口各自有独立 tab 集（session 隔离，与 Vault session 一致）。

验收标准：

- [ ] 可同时打开至少 3 个文档标签并在其间切换而不丢滚动位置。
- [ ] 分屏下左格读 PDF、右格写 `NOTES.md`（或两篇 paper 并排）可用。
- [ ] 关闭 Vault / 关窗不损坏磁盘文件；tab 布局可恢复（localStorage 或 Tauri Store）。

后续增强：

- [ ] tab 固定（pin）、按 paper 分组、从 Backlinks/Graph 中键新 tab 打开。
- [ ] 超过 2 格的网格分屏与拖拽合并。

## V0.7 引用关系与 Connected Papers

目标：让用户在阅读时能 **发现与跳转引用/被引论文**，并在侧栏快速预览元信息；用 Agent 工作流辅助「沿引用链探索」与入库。

设计原则：

- 引用边应能 **从本地资产或可重建索引恢复**（catalog / 导出表），不依赖不可见专有图库作为唯一事实来源。
- 外部 API（Semantic Scholar / OpenAlex / Connected Papers 类服务等）仅作 **拉取与补全**；落盘后可离线浏览已缓存关系。
- 与 V0.4 **双链 Graph** 区分：双链 Graph = 用户/Agent 写的 `[[wikilinks]]`；本版本 = **文献引用图**（bibliographic citations）。

### A. 文内引用 hover → 右侧 Paper Info

- [ ] 在 PDF / HTML / `PAPER.md`（及可选 NOTES）中识别文内引用锚点（如 `[12]`、Author-year、arXiv/DOI 链接）。
- [ ] **Hover**（或短暂停留）时：右侧栏切换/叠加 **被引论文的 Paper Info**（标题、作者、年份、摘要片段、库内是否已入库、一键入库/打开）。
- [ ] 已在 Vault 内的引用：Info 展示本地 path、是否有 PDF/NOTES、`is_read`。
- [ ] 库外引用：显示远程 metadata（缓存），提供魔棒式「加入 Papers」。
- [ ] 离开 hover / 明确关闭后恢复当前 paper 的 Info；不打断中间栏阅读位置。

### B. Connected Papers 式引用关系

- [ ] **引用图数据模型**：paper → cites / cited_by（至少存 id、title、year、doi/arxiv、edge 来源）；可挂 catalog 扩展表或 `.motif/` 可重建缓存。
- [ ] **拉取**：对当前 paper 查询引用/被引（API 可插拔；失败时降级为 TeX/PDF 参考文献解析）。
- [ ] **UI**：从当前 paper 打开「引用关系」视图——中心节点 + 邻居（类似 Connected Papers 的 force / 聚类视图可后置；MVP 可用列表 + 简易图）。
- [ ] 节点操作：打开库内 paper / 入库 / 加入阅读队列 / 在 Graph（双链）中对照。
- [ ] 可选：从 Library 批量补全引用边。

### C. Agent 工作流

- [ ] 内置 workflow：**Explore citations**（沿引用/被引解释为何相关、建议优先精读哪几篇）。
- [ ] 内置 workflow：**Map related work**（基于本地 NOTES + 引用图生成 Related Work 骨架，带本地 path）。
- [ ] 内置 workflow：**Ingest citation neighborhood**（用户确认后批量魔棒入库邻居节点）。
- [ ] 与 V0.3 面板入口一致：可点击 workflow + 注入 `AGENTS.md`；写回前草稿确认。

验收标准：

- [ ] 打开一篇已有引用数据的 paper，hover 文内引用可在右侧看到目标 Info（库内或远程缓存）。
- [ ] 可查看至少「出链 cites」或「入链 cited_by」列表/图，并一键打开或入库。
- [ ] Agent「Explore citations」能基于本地 + 缓存引用边回答，并列出读取过的路径/来源。

## 4. Later

这些能力不进入 MVP 主线，但可在上述版本之后继续规划：

- Zotero/BibTeX 批量导入。
- 浏览器插件，一键收集网页和论文。
- ~~**PDF 划词提问** MVP~~ ✅（选区/框选/双击/悬停 → 迷你问答 → `asks/*.json` → 锚点对话图标；见 [`pdf-ask.md`](pdf-ask.md)）。仍待：导出 `highlights.md`、无文本层降级、本地 PDF TextLayer 增强。
- 完整 PDF 高亮、批注、摘录同步（`highlights.md`；可与划词提问互导）。
- 远程 PDF 链接、任意网页入库（DOI 魔棒路径可部分覆盖）。
- 多 Agent 并行读论文和综合评估。
- ~~论文引用关系自动抽取~~ → 升格为 **V0.7**（引用图 + hover Info + Agent 工作流）。
- 作者、机构、会议关系图谱。
- 更深的 Connected Papers 风格：prior/derivative 布局、相似度聚类、跨库联合图。
- Git 版本管理集成。
- 云同步和多设备阅读。
- 平板端阅读体验。
- 超过双格的复杂分屏布局与工作区会话保存/命名。

## 5. 主要里程碑

### Milestone A：本地知识库可用 ✅

包含 V0.1。完成后，产品可以作为普通 Markdown vault 编辑器使用，并浏览 catalog 论文库。

### Milestone B：论文可入库 🟡

包含 V0.2。**精确 ID/URL 路径已可用**（魔棒 → catalog + PDF/TeX 归档 + Library）；关键词/Agent 候选与导出仍属本里程碑剩余工作。

### Milestone C：Agent 可协作 🟡

包含 V0.3。完成后，Motif 可作为 ACP Client 连接本机 Agent，基于本地库问答和写作（workflow / 写入确认仍待）。

### Milestone D：知识可导航 ✅

包含 V0.4。完成后，用户可以通过双链、反链、图谱组织研究上下文。

### Milestone E：来源可扩展 ⏳

包含 V0.5。完成后，产品在 arXiv 之外可稳妥导入本地 PDF，并为更多来源预留扩展点。

### Milestone F：多文档工作区 ⏳

包含 V0.6。完成后，用户可以标签页管理打开的文档，并分屏并排阅读/笔记。

### Milestone G：文献引用可探索 ⏳

包含 V0.7。完成后，用户可 hover 文内引用看 Info、浏览引用邻域，并用 Agent 沿引用链探索与入库。

## 6. 主要 TODO 总表

### 近期优先级 P0

- [x] Create Vault：标准目录 + `AGENTS.md` + `.motif/catalog.sqlite`。
- [x] 多窗口（⌘N）+ 欢迎页最近 Vault 列表（前端 MRU；Store 迁移仍待做）。
- [x] arXiv/标识符精确入库（魔棒 + Translator + catalog + 默认 PDF/LaTeX）。
- [x] 论文库 UI：`paper_list` + Library 虚拟节点 + 表头排序 + 双向滚动。
- [x] 缺失资源补下：单篇 Download + Library 批量 Download（`paper_download_assets`）。
- [x] 无 TeX 正文：下载后 liteparse → `PAPER.md`；`paper_parse_body`（Download 路径内）。
- [x] 文件树：Finder 显示、删除 + `paper_delete`、左右侧栏隔离。
- [x] PDF 缩放（工具栏 / `⌘`+滚轮）。
- [x] PDF 划词提问 MVP（M1–M4；见 [`pdf-ask.md`](pdf-ask.md)）。
- [x] paper-reader 精读：自动（入库/单篇 Download）+ Eye 手动；`is_read`；任务条进度。
- [x] Agent 全局权限模式（受限 / 自动批准）。
- [ ] Agent 关键词候选 / 自然语言入库闭环。
- [ ] Agent workflow prompt：总结当前论文、本地库问答、Related Work。
- [ ] Agent 写入草稿确认与拒绝路径。
- [ ] Tauri Store 替代当前 localStorage 中的最近 Vault / UI 偏好。
- [ ] 文件监听与索引增量刷新。

### 中期优先级 P1

- [ ] 本地 PDF importer 与 metadata 确认面板。
- [x] Catalog 权威存储 + `paper_list` / `paper_get` / `paper_delete` / 入库写路径（FTS / 双链缓存表仍待）。
- [x] Library BibTeX 导入/导出（Translator `/import` `/export`）。
- [ ] `catalog:export_papers_md`（Markdown 表）。
- [ ] `[[` 补全与 Plate wikilink 内联节点。
- [ ] Graph 全屏/聚焦模式与邻居高亮。
- [ ] **工作区标签页**：多文档 tab、关闭/重排、滚动与视图状态保留（V0.6）。
- [ ] **分屏**：中间栏 2 格并排（PDF | NOTES 或 paper | paper）（V0.6）。
- [ ] **文内引用 hover → 右侧 Paper Info**（库内/远程缓存 + 一键入库）（V0.7-A）。
- [ ] **引用关系图 / Connected Papers 式邻域**（cites / cited_by 缓存 + 列表/简图）（V0.7-B）。
- [ ] **Agent 引用工作流**：Explore citations / Map related work / Ingest neighborhood（V0.7-C）。
- [ ] Release 流程补充签名、公证、版本号同步和自动 changelog。

### Agent provider 后续改造

Codex 的原生 thread runtime 是 provider 专属实现，不应把其命令、history 文件或配置能力抽象成所有 agent 的默认行为。后续按 provider 的真实能力逐项接入：

- [ ] Claude Code：评估官方 SDK / 原生 session resume，保存 native session id，接入其历史和权限请求；不能时继续走 ACP 单轮模式。
- [ ] OpenCode：使用其原生 session API / ACP 能力确认持久会话、模型目录、权限与 history 的可用接口。
- [ ] Gemini CLI：确认 experimental ACP 的 session lifecycle 和恢复语义；在稳定前仅提供一次性 ACP run。
- [ ] Qoder CLI、Grok Build 与 Custom ACP：只暴露 ACP 已声明的能力；增加 capability discovery，避免展示不受支持的模型、effort、Fast 或 history 控件。
- [ ] 建立 provider capability contract：`persistentRuntime`、`nativeHistory`、`modelCatalog`、`reasoningEffort`、`serviceTier`、`permissionRequests`、`skillPicker`。Composer 仅按当前 provider 的能力显示对应组件；**全局权限模式**已对所有 Agent 生效，不在 per-provider 能力表重复。

### 长期优先级 P2

- [ ] Zotero/BibTeX 迁移工具。
- [ ] 浏览器插件与网页 importer。
- [x] PDF 划词提问 MVP（见 [`pdf-ask.md`](pdf-ask.md)：JSON 线程 + 锚点图标 + ACP；M5 增强仍待）。
- [ ] PDF/HTML 标注系统（`highlights.md`）。
- [ ] 多 Agent 并行综述与评估。
- [ ] 作者 / 机构 / 会议关系图谱；更深的 prior–derivative 引用布局。
- [ ] 复杂分屏（>2 格）与命名工作区会话。
- [ ] iPadOS 文件系统与触控布局适配。

## 7. 风险控制

- 每个版本都必须保持 Vault 可被外部编辑器打开。
- 每个版本都必须避免覆盖用户手写笔记。
- 新 importer 不得覆盖用户 `NOTES.md`；meta 只写 catalog；`PAPER.md` 可重建；不自动改用户导出的 PAPERS.md。
- Catalog 损坏时依赖备份/export；双链缓存可从 Markdown 重建；历史 `metadata.json` 可导入。
- 图谱和搜索可以使用缓存，但缓存损坏时必须能从 Markdown 重建。
- Agent 功能失败时必须保留可读错误信息和重试入口。
- 发布构建必须由 tag 触发；如加入签名/公证，需要保证本地开发构建不依赖发布密钥。
