# Agentero / notemd Roadmap

## 1. Roadmap 原则

- 先验证 Agent-first 闭环，再扩展传统文献管理能力。
- 先做好 arXiv，不急于覆盖所有论文来源。
- 所有核心数据必须能从本地 Markdown 重建。
- 阅读器服务于审阅和修正，不在早期追求完整 Zotero/PDF 批注体验。
- Agent 采用 **BYOA**：Agentero 只做 ACP Client，不捆绑 Agent；能力必须可解释、可追溯、可被用户修正。
- UI 以“少入口、强上下文”为原则：右侧栏保留 Agent、Backlinks、批注和按需出现的 Paper Content；Backlinks 下方承载 Graph。

## 2. 当前状态快照

| 版本 | 状态 | 说明 |
|---|---|---|
| V0.1 本地 Vault 与 Markdown 工作台 | ✅ 基本完成 | 工作台、Create Vault + catalog、多窗口（⌘N）+ 欢迎页、树内联新建 / Finder / **回收站删除** / 多选拖拽、PDF 阅读工具（导航·适应整页·大纲·查找·平滑划词）/ 图片 / Notes、WYSIWYG + 内嵌图 `./assets/`、**Library + tags + Rescan**、**Vault 文件监听**、左右侧栏 collapsible、后台任务条、**全局错误 Toast**。 |
| V0.2 arXiv / 标识符入库闭环 | 🟡 精确路径基本完成 | **魔棒 + Translator** 入库、catalog 权威、`paper_list` / `paper_get` / `paper_set_tags`、**默认下载 PDF + arXiv e-print 解压 LaTeX**、单篇/Library **补下缺失资源**、**无 TeX 时 liteparse → `PAPER.md`** 已落地；Agent 关键词候选、`catalog:export_*` 仍待。 |
| V0.3 Agent 工作流（BYOA） | 🟡 进行中 | 通用 ACP Client（OpenCode、Gemini、Claude、Codex、Qoder、Grok、自定义）统一 ACP 协议（Codex 经 `@agentclientprotocol/codex-acp` 适配器）；**统一会话历史**（`agent_list_sessions` / `agent_load_session`，ACP `session/list` + `session/load`）；**paper-reader 精读**（可选自动 + Zap 手动；`is_read`）；**全局权限模式**（受限 / **每次询问** / 自动批准）；**面板工作流**（Summarize → `summary`、Ask library / List claims → `qa`、Draft Related Work → `related_work`）；**权限询问**（`agent:permission-request` 对话框）；**当前论文默认 context** + **`agentPersonalPrompt`**；模型收藏；**AGENTS.md 自动注入仍待**。 |
| V0.4 双链、反链与图谱 | ✅ 基本完成 | 反链、预览双链跳转、缺失目标创建、Graph 与 `graph_get_graph` 已落地；**`.md` 变更防抖重建索引**（`scheduleWikiRebuild`，~900ms）；`[[` 补全 / Plate 内联节点可后续增强。 |
| V0.5 Importer 架构与本地 PDF 入库 | 🟡 本地 PDF 入库已落地 | **本地 PDF 导入**（魔棒弹层多选 / **拖到 `papers/` 组织夹** → metadata 确认 → 复制 PDF + catalog + liteparse `PAPER.md`）已落地；Importer trait 抽象、DOI 识别、PdfParser（MinerU）仍在规划。 |
| V0.6 工作区标签页与分屏 | 🟢 已完成 | **全局 Dockview 工作区 + 默认全库 + 文件夹作用域库 + 上下左右多分屏（PDF\|NOTES / 拖文件树并入）已落地**；标题栏无文档 tab；与左右侧栏 collapsible 共存。 |
| V0.7 引用关系与 Connected Papers | ⏳ 待实现 | 先落地本地 PDF citation/figure sidecar 与 Paper Content 侧栏，再做引用图、Connected Papers 和外部关系补全。 |
| **CLI（headless Vault 接口）** | ✅ MVP | 设计见 [`cli.md`](cli.md)；代码 **`cli/`** + workspace；path 依赖 `agentero_lib`；`vault`/`tree`/`paper`/`import`/`export`/`config`；**无 BYOA**；`cargo build -p agentero-cli`。graph/doctor 仍待 P1。 |
| **Vault 采纳 / 现有文件夹整理** | ⏳ 待设计 | 打开非标准或半结构目录时 **自动发现与改造** 为 Agentero Vault（脚手架 + catalog + paper 单元识别）；**编程路径**（确定性扫描/迁移）与 **Skill + Agent 路径** 均可；不静默覆盖用户文件。 |
| **远程 Vault（SSH/SFTP）+ 远端 BYOA** | ✅ MVP | 文件权威远端；SFTP IO；catalog work mirror；ACP over SSH；PDF cache。设计见 [`remote-vault.md`](remote-vault.md)。 |
| Release CI | ✅ 完成 | push `v*` tag 时构建 macOS/Linux/Windows Tauri 安装包并上传草稿 Release。 |

**精确 arXiv/标识符入库（可用）**：魔棒粘贴 ID/URL → Translator → catalog + `NOTES.md` 壳 → `source/` PDF（arXiv 含 TeX）→ Library 表可见；缺资源时树行/Library 可补下。

## 3. 版本规划

## V0.1 本地 Vault 与 Markdown 工作台

目标：让产品从 Tauri 模板变成一个可用的本地 Markdown 知识库壳。

关键交付：

- [x] 打开本地 Vault。
- [x] 创建空 Vault 并初始化 `AGENTS.md` / `papers` / `notes` / `plans` / `.agents`（含 `skills/`）/ `.agentero/catalog.sqlite`。
- [x] 工作台：文件树 + 中间内容 + Preview/Notes + 可选右侧栏。
- [x] Markdown 文件读取、编辑、保存（Plate WYSIWYG + 自动保存；顶部可选**格式工具栏**，设置 `showEditorToolbar` / Notes header 一键开关）。
- [x] Markdown **图片**：粘贴 / 工具栏 → `./assets/` + `![](./assets/…)`；相对路径预览；**选中显示源码**；删除节点且无引用时同步删 assets 文件（见 `src/lib/markdown/image.ts`、data-model）。
- [x] 最近 Vault 列表（欢迎页）与主窗口恢复上次 Vault。
- [x] 多窗口：`⌘N` 新建窗口，session 级 Vault 隔离。
- [x] 树内联新建文件 / 文件夹。
- [x] 文件树：**Finder 显示**（`⌥⌘R`）；**终端打开**（`⌥⌘T`）；**多选 + 拖拽移动**；**删除**走回收站（`path_trash`，无确认 / 无 Undo toast；Library 下虚拟节点 `agentero:trash` → 中间栏浏览 / 恢复 / 永久删除，侧栏右键清空；`papers/` 快照 catalog）；**选中同步 / 定位**（激活文档与魔棒入库后展开祖先并滚到对应行）；**Paper 行标签**默认标题 · 作者（`paperTreeLabelMode`，设置 → 通用）。
- [x] Paper-centric 视图：选中 paper 后中间 PDF（本地优先 / 远程回退）或 HTML，右侧 `NOTES.md`（**仅具体论文**）。
- [x] Vault **任意路径** PDF / 常见图片中间栏预览（`blob:`）。
- [x] **PDF 阅读操作**：页码导航；**适应宽度 / 适应整页**；真实 scale 重渲染 + 放大后平移；**大纲**；**⌘F 查找**；**平滑划词覆盖层**；**沉浸式阅读**（全屏 + 限宽居中）；**标注面板**（高亮总览·改色·导出 NOTES）。
- [x] 侧边栏折叠、标题栏快捷按钮、Settings；左右侧栏 **常驻 collapsible + preserve-pixel-size**。
- [x] 论文库表格：`agentero:library`、`paper_list`、表头排序、**tags 筛选**、**Rescan**（`paper_rescan`）、双向滚动。
- [x] **全库搜索 + 快速打开**：命令面板 `⌘K`/`⌘P`（论文标题/作者即时 quick-open + `vault_search` 全文正文匹配；命中论文映射为打开该论文）。
- [x] **论文库默认页**：关光文档 tab 后回到全库；仅剩全库时 `⌘W` 关窗。
- [x] **文件夹作用域库**：单击非 paper 目录 → 同 Library 表，`path` 前缀过滤内存 `libraryPapers`。
- [x] Paper Info / Notes 仅具体论文；Paper Info **Tags** 可编辑。
- [x] 后台任务条（含 paper-reader；hover 实色；支持取消）；**全局错误 Toast**。
- [x] **Vault 文件监听**（`notify` → `vault:file-changed`）：外部/Agent 改盘自动重载打开的 Markdown 与文件树；有未存改动时提示重载；写盘前冲突检测（`diskConflict.saveBlocked`）。

验收标准：

- [x] 用户可以创建一个空 Vault 并看到标准目录结构与 catalog 数据库。
- [x] 用户可以打开、编辑、保存一个 Markdown note。
- [x] 重启应用后可以回到最近使用的 Vault（设置开启时）。
- [x] `⌘N` 打开的新窗口不自动占用上一窗口的 Vault，欢迎页可点最近路径。
- [x] 打开 Vault 后可在 Library 视图看到 catalog 中的论文列表。
- [x] 关光文档 tab 后中间栏为全库 Library；点组织文件夹只显示该路径下论文且不重新 `paper_list`。

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
- [x] 创建 `papers/<id>/`（或当前 Papers 子文件夹下）、`NOTES.md` 壳（标注走 `marks/`）。
- [x] **始终下载 PDF** 到 `{paper}/{id}.pdf`（论文根目录）；**arXiv e-print 解压 LaTeX** 到 `source/`（无下载开关）。
- [x] 中间栏 **PDF 预览本地优先**：本地 `{paper}/*.pdf` → 缺省时自动 `paper_download_assets` → 失败回退远程 `pdf_url`；HTML 仍用远程 `html_url`。
- [x] `paper_list` / `paper_get`；Library 表格 + 虚拟节点。
- [x] 按需补下：`paper_download_assets`；paper 行缺 PDF 或 arXiv 缺 TeX 时 Download；**Library 行批量补下全部缺失**。
- [x] **无 TeX 时 liteparse → `PAPER.md`**：下载后自动；`paper_parse_body`（Download 流程内触发）。
- [x] **paper-reader 精读**：入库/单篇 Download 后可自动；资源齐全且 `is_read=false` 时文件树 Zap 手动（见 V0.3）。
- [x] Library 导入/导出：`paper_import` / `paper_export`（Translator `/import` + `/export`，Zotero JSON 数组）。
- [x] 入库错误经全局 Toast（`notifyError`）展示；重复不覆盖用户 `NOTES.md`。
- [x] 删除 paper / 组织目录：移入回收站 + catalog 快照移除（恢复时 upsert；含嵌套 path）。

### 未完成

- [ ] 关键词/话题/自然语言描述 + 输入分类（规则 + Agent）。
- [ ] Agent 检索候选列表确认（单选/多选）。
- [ ] `catalog:export_papers_md`（Markdown 表形态；BibTeX 已由 Library 导出覆盖）。
- [x] 入库后刷新 Backlinks/Graph 索引
- [x] 魔棒快捷键 `⇧⌘I`；
- [x] 非 arxiv 下载 PDF：下载改用浏览器 UA（绕开出版商 403）+ DOI 走 Crossref 取直链 / OA PDF 兜底（如 10.1371/journal.pbio.0040157）。
- [x] 魔棒批量入库：多标识符粘贴、去重、顺序入库、批量下载队列、进度聚合。

验收标准：

- [x] 输入 `1706.03762` 后生成 paper 目录、NOTES 壳、catalog 行，并尽量得到 PDF（arXiv 另有 TeX）。
- [x] 连续入库多篇后 `paper_list` / Library 可见对应行。
- [x] 缺本地资源时 paper 行 / Library 可补下。
- [x] Library 可导出 BibTeX、可导入 .bib/.ris 进 catalog。
- [ ] 关键词路径：候选列表 → 确认 → 入库。
- [ ] 可选导出 PAPERS.md 与 catalog 一致。
- [x] 重复入库不破坏已有 `NOTES.md`。

## V0.3 Agent 工作流（ACP Client + BYOA）

目标：将 Agentero 实现为 **ACP Client**，连接用户本机已安装的 Agent，按 Vault 规则完成总结 / 问答 / Related Work。

关键交付：

- [x] ACP Client：stdio JSON-RPC 会话、流式输出事件。
- [x] Codex ACP 迁移：经 `@agentclientprotocol/codex-acp`（npm）适配器接入标准 ACP 协议；原生 `codex app-server` 模块已删除；`agent_codex_list_threads` / `agent_codex_read_thread` 由统一的 `agent_list_sessions` / `agent_load_session` 替代。
- [x] BYOA 注册表：预设模板 + 自定义 `command` / `args` / `env`；默认 agent 选择。
- [x] 可执行文件探测与空状态安装指引（Agentero **不打包** agent 二进制）。
- [x] Composer 上下文：当前文件 chip、`@` / `$` 候选的键盘选择、本地会话标签切换。
- [x] 会话配置能力：所有 provider（含 Codex）经 ACP `SessionConfigOption` 协商模型、reasoning effort 与 Fast；Composer 按已声明能力显示控件。
- [x] **全局权限模式**：设置 → Agent（`agentPermissionMode`：`restricted` 默认 / `ask` / `auto`）；对所有 Agent 生效；经 `permissionMode` 传入 `agent_run_once`。
- [x] **「每次询问」档**：`ask` 时每个 ACP 权限请求 emit `agent:permission-request`，前端对话框（Allow once / Always / Reject）→ `agent_respond_permission`（5 分钟超时取消）。
- [x] Agent 输出期间 Composer 仍可编辑；按 `Esc` 会取消当前 ACP session 并保留已输出内容。
- [x] 消息编辑与重发：会话空闲时 hover 用户消息可 **Edit**，就地编辑后重发（丢弃该消息及其之后内容并发起全新 turn）。
- [x] 会话 `cwd` = 当前 Vault。
- [ ] 工作流 prompt 模板注入 + `AGENTS.md` 约束。
- [x] **Agent 禅模式 UI**：左侧历史栏（Quest 式）、返回图标退出、全宽 Conversation 滚动、无 1/2/3 数字标签；精读/划词等 `hideFromChatHistory`。
- [x] **paper-reader 精读工作流**：
  - 设置 `autoPaperReader`（**默认关**）开启时，魔棒入库 / 单篇 Download 资源就绪且 `is_read=false` 可自动启动（批量导入/批量 Download **不**连跑）。
  - 资源齐全且未读时文件树 **Zap** 可手动重跑。
  - skill（**provider 分流：Claude `/` / 其它（含 Codex）注入**）→ 写 `NOTES.md` → catalog `is_read=true`；左下角任务条（入库/下载 → 精读衔接）。
- [x] **Skill 提及按 Agent 模板**：Host `SkillMentionStyle`（`skills.rs`）；Composer `$` 仅为 UI 选 skill。
- [x] **面板内置工作流入口**（建议 chips → 后端 workflow）：Summarize → `summary`；Ask library / List claims → `qa`；Draft Related Work → `related_work`；目标为当前聚焦 paper（提及路径或选中路径）。引用类 workflow 见 V0.7。
- [x] Agent 读取路径回显（Sources）。
- [x] 密钥边界：模型 API Key 由 Agent CLI 管理，Agentero 不要求模型 BYOK 表单。

验收标准：

- [x] 用户配置并成功探测至少一个本机 Agent 后，可发起 Agent 对话。
- [x] 未安装 Agent 时有清晰空状态与配置入口，应用其余功能可用。
- [x] Agent 问答展示读取过的本地文件路径（Agent 返回 Sources 时）。
- [x] 下载完成且未读的 paper 行显示 Zap；点击后精读并标记已读。
- [x] 魔棒/单篇 Download 成功后可自动进入精读（设置开启且有默认 Agent 时）。
- [x] 面板建议可触发 summary / qa / related_work（非仅 free chat）。
- [x] 「每次询问」下权限请求弹对话框；用户可拒绝。
- [x] Agent 改写笔记后可审阅并还原到运行前快照。
- [ ] Related Work 草稿必须包含本地路径引用（prompt 已要求 Sources；自动校验仍待）。
- [ ] 写前草稿 / dry-run 拦截（当前为写后审阅，非事前拦截）。

细化 TODO：

- [x] paper-reader：可选自动触发 + 文件树 Zap + `is_read` + 后台任务进度。
- [x] 全局权限模式替代 per-provider YOLO 开关（含「每次询问」）。
- [x] 把“总结当前论文 / 本地库问答 / Related Work”做成 Agent 面板可点击 workflow。
- [ ] 将 `AGENTS.md` 自动注入 workflow prompt，并在缺失时提示初始化。
- [x] 接入 ACP 权限确认 UI（「每次询问」档）。
- [x] Codex 会话恢复：经 ACP `session/resume` 统一恢复，与所有 provider 一致。
- [x] 为通用 ACP provider 定义持久 session 与历史契约：`agent_list_sessions` / `agent_load_session`（ACP `session/list` + `session/load`）。
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

- [x] 文件变更后防抖重建 wiki / Backlinks / Graph 索引（`scheduleWikiRebuild`，仅 `.md`，~900ms）。
- [ ] 源码编辑中的 `[[` 路径/标题补全。
- [ ] Plate 内联 wikilink 节点与更稳定的 Markdown 序列化。
- [ ] 图谱 hover 时只高亮直接邻居。
- [ ] 增加 Graph 全屏/聚焦模式，保留右侧栏小图作为默认入口。
- [ ] 真正的增量边更新（当前为防抖全量 rebuild，非边级增量）。

## V0.5 Importer 架构与本地 PDF 入库

目标：抽象 Importer 接口，落地 arXiv 与本地 PDF 两个 importer，并为后续 HTML、DOI、Zotero/BibTeX 做架构准备。

**入库编排统一（设计）**：多入口（魔棒 / Connector / 本地 PDF / Bib / 迁移 / CLI）收敛为 Host `paper_commit` + 前端 `afterPaperImport`——见 [`../backend/paper-import-pipeline.md`](../backend/paper-import-pipeline.md)。与下文「Importer trait」互补：trait 管 **元数据源**，`paper_commit` 管 **落盘与 UI 后置**。

关键交付：

- [ ] 抽象 importer 接口（Source adapter）。
- [ ] 将 arXiv / 魔棒入库实现迁移为第一个 adapter + **`paper_commit`**。
- [x] 本地 PDF 导入：魔棒弹层文件选择（多选，`paper_import_local_pdf`）、citekey slug 生成 + 重复检测（`-2`/`-3`）、复制 PDF + catalog + liteparse `PAPER.md`；**外部 PDF 拖到 `papers/` 组织夹** → metadata 确认对话框（`entries`）再入库；窗口级拦截默认导航防卡死；DOI 识别待增强。
- [ ] 可插拔 `PdfParser`：默认本地 liteparse，配置 MinerU API Key 后优先云端 MinerU，失败自动降级。
- [ ] PDF 元数据混合获取：DOI/arXiv 标识符查询 Crossref/arXiv + Agent 正文抽取，入库前用户确认。
- [ ] 预留本地 HTML importer。
- [x] BibTeX / Zotero 形导入（`paper_import`、Connector、迁移）已落地入口；**编排尚未统一**。
- [x] **魔棒 Identifier Lookup（v0）**：HTTP Translator + `lookup_import` + 默认 PDF/LaTeX + `paper_download_assets`（见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)）。
- [ ] 将魔棒 / Connector / 本地 PDF 收编为 adapter + 共用 `paper_commit`（pipeline P0）。
- [ ] 前端 `afterPaperImport` 策略表（pipeline P1）。
- [ ] 统一入库状态、错误类型和 `PaperCommitResult` 契约。

验收标准：

- [ ] arXiv / 魔棒 importer 行为与 V0.2 精确路径保持兼容。
- [x] 导入本地 PDF 生成 `papers/<citekey>/`（复制 PDF + liteparse `PAPER.md`）并进入笔记审阅。
- [ ] 配置 MinerU API Key 后 PDF 默认走云端解析，未配置或失败时自动降级本地且不中断。
- [ ] 新 adapter 只产出 meta / 资源意图，复用同一 `paper_commit` 输出结构。
- [ ] UI 不需要为每种来源重写刷新 / openTab / toast / auto-reader 流程。

## V0.6 工作区标签页与分屏

目标：中间内容区从「当前选中一项即替换」升级为 **标签式多文档工作区**，并支持 **分屏并排阅读/编辑**。

现状对照：

- **标签页 + 默认全库 + 文件夹作用域库 + 分屏（dockview）已落地**（见 `docs/development/tab-split.md`）。
- 左右侧栏已是常驻 collapsible（`preserve-pixel-size`）；Agent 禅模式是全屏 Agent，不是编辑区分屏。
- Agent 面板内部已有 **会话标签**（多 session），与「文档标签页」是不同概念。

关键交付：

- [x] **全局 Dockview 文档工作区**：中间栏管理 paper / Markdown / PDF / HTML / Library / 回收站 / NOTES 等 panel；dockview 原生 tab、关闭、重排；**标题栏无文档 tab**。（`src/components/workspace/dock-workspace.tsx`、`src/lib/workspace/tabs`；见 [`tab-split.md`](tab-split.md)）
- [x] **panel 状态**：内容常驻挂载，保留滚动位置、PDF 缩放、视图模式；Markdown/NOTES 自动保存（debounce + 卸载 flush）。
- [x] **默认页 = 全库 Library**：`ensureFullLibraryTab`；仅剩全库时 `⌘W` 关窗。
- [x] **文件夹作用域库**：非 paper 目录 → `filterPapersByScope` 内存前缀过滤。
- [x] **分屏**：上下左右 + 多格；论文默认 PDF\|NOTES sibling；拖文件树 → 任意边；布局仅 `toJSON()`。
- [x] **快捷键**：关闭 panel `⌘W`（弹层 → active panel → 关窗）、下一/上一 panel `⌥⌘→ / ⌥⌘←`；NOTES 切换见 Layout 菜单。
- [x] **与文件树联动**：树选中 / Library / Graph / Backlinks / wiki 跳转统一走 `openTab`；同一路径已开则聚焦其 panel。
- [x] **多窗口兼容**：`⌘N` 窗口各自独立 dock 布局（按窗口持久化恢复）。

验收标准：

- [x] 可同时打开至少 3 个文档标签并在其间切换而不丢滚动位置。
- [x] 关光文档 tab 后中间栏为全库；点组织文件夹只看到该路径下论文且不重新 `paper_list`。
- [x] 分屏下左格读 PDF、右格写 `NOTES.md`（或两篇 paper 并排）可用。
- [x] 关闭 Vault / 关窗不损坏磁盘文件；tab 布局可恢复（localStorage）。

后续增强：

- [ ] tab 固定（pin）、按 paper 分组、从 Backlinks/Graph 中键新 tab 打开。
- [x] 超过 2 格的网格分屏与拖拽合并（dockview multi-pane）。

## V0.7 引用关系与 Connected Papers

目标：先让用户在本地 PDF 中发现、预览和跳转引用/插图，再扩展为引用关系图和 Agent 工作流。

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

### A0. 本地 PDF 解析与 Paper Content（首个交付）

- [ ] 新增 `paper_analyze_pdf`，只处理本地 paper PDF。
- [ ] 有 TeX 时解析 TeX/Bib/figure declaration；无 TeX 时使用 liteparse。
- [ ] 生成 `source/agentero-cite.json`、`source/agentero-figures.json`、`source/agentero-figures/*.png`。
- [ ] 右侧 Paper Content 展示 citations/figures；PDF 内 hover 高亮、点击跳 reference/figure。
- [ ] Composer `@` 和拖拽支持 citation/figure structured refs；不使用 AI Elements Attachments。
- [ ] 原始 PDF、TeX/Bib、`NOTES.md`、`PAPER.md` 不被覆盖；sidecar 删除后可重建。

### B. Connected Papers 式引用关系

- [ ] **引用图数据模型**：paper → cites / cited_by（至少存 id、title、year、doi/arxiv、edge 来源）；可挂 catalog 扩展表或 `.agentero/` 可重建缓存。
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

## CLI：Vault 管理与发现（headless）

> 设计文档：[`cli.md`](cli.md)。可与 UI 版本线并行推进，不依赖 V0.5–V0.7。

目标：提供 **`agentero` CLI**，作为 Vault / Catalog 的机器接口——创建、管理、发现、暴露本地研究库，并覆盖已落地的文献基础能力（入库、补资源、`PAPER.md`、Bib 导入导出）。**不**内嵌 BYOA、不 spawn Agent、不跑 paper-reader。

架构约束（已拍板）：

- 代码在仓库根 **`cli/`**（与 `src-tauri` 并列），Cargo workspace member。
- **不迁 `agentero-core`**；path 依赖 `src-tauri` 的 `agentero_lib`，直接调用 `services::{vault,catalog,lookup,pdf_parse,wiki}`。
- CLI 源码禁止 `use …::services::agent`；可接受编译期带上 tauri 依赖图。
- 与 GUI 只通过 **同一 Vault 目录** 协作；CLI 自有 `config.toml` / `default_vault`，不读 GUI localStorage / Agent 注册表。

关键交付：

- [x] 根 `Cargo.toml` workspace：`members = ["src-tauri", "cli"]`。
- [x] **`cli/`** crate（package `agentero-cli`，bin **`agentero`**）+ clap 命令树。
- [x] 按需放宽 `services::*` 可见性（`pub` / re-export），**不搬迁模块**。
- [x] **Vault**：`create` / `which` / `info` / `check` / `use`；`--vault` / `AGENTERO_VAULT` / cwd 上溯 / default_vault。
- [x] **发现与暴露**：`tree`；`paper list|get|paths`（`get` 含 `assets` + `suggestedReads`，对齐渐进披露）。
- [x] **文献基础**：`import id|bib`、`export bib`、`paper download|parse|delete|set-read|tag list|set|add|rm`（仅 catalog 字段；**无**自动精读；`list --tag` 筛选）。
- [x] 全局 `--json` / 退出码 / 稳定 `error.code`（Agent 友好）。
- [ ] 可选随后：`graph backlinks|export|rebuild`、`doctor`、shell completions。
- [x] 文档：README 构建说明；Release 附带 `agentero` 二进制（`release.yml`）。

验收标准：

- [x] `cargo build -p agentero-cli`（或等价）产出 `agentero`。
- [x] `agentero vault create <path>` 脚手架与 Host `vault_create` 一致（含 catalog，无默认 PAPERS.md）。
- [x] 在已有 Vault 上 `paper list --json` / `paper get <id> --json` 与 catalog 语义一致。
- [x] `import id` / `export bib` 对齐 Host service（**不**调用 Agent；集成测试覆盖离线路径）。
- [x] 无 GUI 时，外部 Agent / 脚本可仅凭 CLI + 读文件完成「摸库 → 入库 → 自己写 NOTES」。

非目标（本里程碑明确不做）：

- [x] ~~`agent run` / BYOA / paper-reader / 自动写精读 NOTES~~
- [x] ~~抽离 `agentero-core` crate~~（远期可选，非本里程碑）
- [x] ~~daemon / `serve`~~

## Vault 采纳：现有文件夹自动发现与整理

> 与 **Create Vault（空库脚手架）**、**CLI `vault create`** 互补：用户打开的是 **已有资料夹**（散落 PDF、Markdown 笔记、Zotero 导出、半 Agentero 结构等），产品应 **发现 → 计划 → 改造**，而非只能「从零创建」。

### 目标

打开（或 CLI 指定）一个文件夹时：

1. **发现**当前目录像什么（空壳 / 已是合法 Vault / 缺 catalog / 仅 PDF 堆 / 混杂笔记 / 未知）。
2. **整理与改造**为符合 data-model 的 Vault：`papers/`·`notes/`·`plans/`、`.agentero/catalog.sqlite`、paper 最小单元、可选 `AGENTS.md` / skills 种子。
3. 过程 **可解释、可预览、可撤销或至少可报告**；默认 **不覆盖** 用户手写笔记与已有 Markdown。

### 触发点

| 入口 | 行为（规划） |
|---|---|
| 桌面 **打开文件夹** | 打开后跑发现；若非「就绪 Vault」→ 提示整理计划或后台任务 |
| 桌面 **欢迎页 / Open** | 同上 |
| CLI（落地后） | `agentero vault adopt <path>` / `vault check --fix` 等（命名实现时定） |
| 用户手动 | 设置或命令面板「整理此文件夹为 Vault」 |

### 双路径（均可；可组合）

| 路径 | 适用 | 说明 |
|---|---|---|
| **A. 编程（确定性）** | 结构清晰、规则可写死 | Host/CLI：扫描 PDF/目录名/arXiv 模式、补脚手架、`ensure_catalog`、历史 `metadata.json` 导入、paper 文件夹识别、可选批量 `paper_download_assets` / parse；输出 diff 清单 |
| **B. Skill + Agent** | 命名混乱、多来源混杂、需语义归类 | Vault skill（如 `vault-adopt` / `vault-organize`）+ BYOA：读发现报告 → 提议移动/命名/NOTES 壳 → **用户确认后**落盘；可与 CLI/编程 API 配合执行机械步骤 |
| **组合（推荐）** | 默认产品路径 | 编程先产 **发现报告 + 安全脚手架**；不确定项交给 Agent skill 或人工确认面板 |

### 发现维度（初稿）

- 是否已有 `.agentero/catalog.sqlite`、schema 版本、能否打开。
- 是否已有 `papers/` / `notes/` / `plans/` / `AGENTS.md` / `.agents/skills`。
- `papers/` 下 paper 单元候选（含 `NOTES.md` / `source/` / 根 PDF 等标记）。
- 散落 PDF（根目录或任意子树）与可抽取标识符（arXiv/DOI）。
- 已有 Markdown 笔记是否应归入 `notes/` 而非 paper。
- 与 catalog 的漂移（盘上有、库中无 / 库中有、盘上无）。

### 改造动作分级

| 级别 | 示例 | 默认 |
|---|---|---|
| **安全自动** | 建缺失空目录、`ensure_catalog`、schema migrate、种子缺失的 `AGENTS.md`/skills（不覆盖） | 可默认开 |
| **建议确认** | 散落 PDF → `papers/<id|citekey>/`、生成 NOTES 壳、catalog upsert | 计划面板 / `--yes` / Agent 确认 |
| **禁止静默** | 覆盖用户 NOTES、删除文件、大范围重命名无备份 | 必须显式 |

### 关键交付

- [ ] 设计文档：`docs/development/vault-adopt.md`（或 backend 分册）：发现模型、报告 JSON、与 `vault_create` 边界。
- [ ] **编程路径**：`vault_inspect` / `vault_adopt`（Host + 可选 CLI）→ 发现报告 + 安全脚手架 + 可选确认后迁移。
- [ ] **Skill 路径**：模板 skill（如 `vault-organize`）描述如何读报告、提议整理、调用 CLI/不直接蛮力 `rm`。
- [ ] 打开文件夹 UX：非就绪 Vault 时横幅/对话框「可整理」+ 进度进后台任务条。
- [ ] 幂等：重复打开同一已整理库不重复打扰；报告可缓存于 `.agentero/`（可删重建）。
- [ ] 与现有 **catalog 从 metadata.json 导入**、Create Vault 种子逻辑复用，避免第三套写盘规则。

### 验收标准

- [ ] 打开「仅含若干 PDF 的普通文件夹」可得到发现报告，并在用户确认后形成合法 Vault + catalog 行（至少路径与标题/id 尽力填充）。
- [ ] 打开「已是完整 Agentero Vault」时发现为就绪，**无**破坏性改动、无多余弹窗（或仅首次静默 check）。
- [ ] 缺 catalog 的半结构库可自动 `ensure_catalog` + 扫描 paper 单元补行，不覆盖已有 NOTES。
- [ ] Agent skill 路径：在有默认 Agent 时可根据报告给出整理计划并经确认执行；无 Agent 时编程路径仍可用。

### 风险与纪律

- Local-first：改造结果仍是普通文件 + catalog，可被 Obsidian 打开。
- 不覆盖用户手写；大改前 plan / dry-run。
- Agent 路径不得绕过权限模式；破坏性操作走确认。
- 与 V0.5 本地 PDF importer、Zotero 迁移工具边界写清（采纳 = 整夹变 Vault；importer = 单次导入源）。

## 4. Later

这些能力不进入 MVP 主线，但可在上述版本之后继续规划：

- ~~Zotero/BibTeX 批量导入~~ ✅ 一键从本地 Zotero 迁移（直读 `zotero.sqlite` + `storage/`，可选拷 PDF；见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md) §16）；BibTeX/RIS 文件仍走 Library 导入。
- **Zotero Connector 兼容服务**（方案一，**MVP 已落地**）：Host 在 loopback 端口兼容官方浏览器扩展保存协议 → 当前 Vault；与 Zotero 桌面端端口互斥、默认关；组织子文件夹可选；**`saveAttachment`、网页快照、Cookie 下载、Connector 后台任务条已做**；detect/translators/proxies 保持安全降级；见 [`../backend/connector.md`](../backend/connector.md) **§4.5**。
- 浏览器插件（可选后续）：自研扩展或 fork，可共用入库核心、不必抢 23119。
- ~~**PDF 划词提问** MVP~~ ✅（划词操作菜单：高亮 / 批注 / 提问 / 翻译 → **`marks/*.json`**（`kind`）；平滑蓝色选区；见 [`pdf-ask.md`](pdf-ask.md)）。仍待：无文本层降级。
- ~~**翻译服务**~~ ✅ 首版（见 [`translate.md`](translate.md)）：应用级可插拔 `TranslateService`；**免费 MT + BYOA Agent**（无付费 API）；设置 → **Translate**；PDF 划词为首个消费方。T4+ 更多引擎/消费方仍待。
- ~~阅读器内 PDF 高亮 + 批注~~ ✅（就地批注 = 高亮 + 内联评论 + 页边批注针 + 右侧「批注」面板；统一 `marks/`）。
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

包含 V0.3。**已可用**：ACP 连接（含 Codex 经 `codex-acp` 适配器）、统一会话历史、paper-reader、面板 workflow、权限三档。**仍待**：`AGENTS.md` 自动注入。

### Milestone D：知识可导航 ✅

包含 V0.4。完成后，用户可以通过双链、反链、图谱组织研究上下文。

### Milestone E：来源可扩展 ⏳

包含 V0.5。完成后，产品在 arXiv 之外可稳妥导入本地 PDF，并为更多来源预留扩展点。

### Milestone F：多文档工作区 🟡

包含 V0.6。**标签页已完成**（多文档 tab、`⌘W` 先关 tab 再关窗）；**分屏**完成后用户可并排阅读/笔记。

### Milestone G：文献引用可探索 ⏳

包含 V0.7。完成后，用户可 hover 文内引用看 Info、浏览引用邻域，并用 Agent 沿引用链探索与入库。

### Milestone H：CLI 可脚本化 ✅ MVP

包含 **CLI（headless）**（[`cli.md`](cli.md)）。**MVP 已落地**：人与外部 Agent 可在无 GUI 下创建/发现 Vault、列表与入库文献基础能力；**不含** BYOA。代码在 `cli/`，复用 `agentero_lib` services，不迁 core。P1：`graph` / `doctor` / completions。

### Milestone I：现有文件夹可采纳 ⏳

包含 **Vault 采纳 / 整理**。完成后，打开非标准或半结构目录时可自动发现并（在安全范围内或经确认后）改造为 Agentero Vault；支持 **编程路径** 与 **Skill + Agent 路径**，二者可组合。

## 6. 主要 TODO 总表

### 近期优先级 P0

- [x] Create Vault：标准目录 + `AGENTS.md` + `.agentero/catalog.sqlite`。
- [x] 多窗口（⌘N）+ 欢迎页最近 Vault 列表（前端 MRU；Store 迁移仍待做）。
- [x] arXiv/标识符精确入库（魔棒 + Translator + catalog + 默认 PDF/LaTeX）。
- [x] 论文库 UI：`paper_list` + Library 虚拟节点 + 表头排序 + 双向滚动。
- [x] 缺失资源补下：单篇 Download + Library 批量 Download（`paper_download_assets`）。
- [x] 无 TeX 正文：下载后 liteparse → `PAPER.md`；`paper_parse_body`（Download 路径内）。
- [x] 文件树：Finder 显示、删除 + `paper_delete`、左右侧栏隔离。
- [x] PDF 缩放（工具栏 / `⌘`+滚轮）。
- [x] PDF 划词提问 MVP（M1–M4；见 [`pdf-ask.md`](pdf-ask.md)）。
- [x] paper-reader 精读：可选自动（入库/单篇 Download）+ Zap 手动；`is_read`；任务条进度。
- [x] Agent 全局权限模式（受限 / **每次询问** / 自动批准）+ 权限对话框。
- [x] Agent 面板 workflow：Summarize / Ask library / Draft Related Work。
- [ ] Agent 关键词候选 / 自然语言入库闭环。
- [ ] workflow prompt 自动注入 Vault `AGENTS.md`。
- [ ] Tauri Store 替代当前 localStorage 中的最近 Vault / UI 偏好。
- [x] 文件监听（`notify`）：外部/Agent 改动经 `vault:file-changed` 重载打开的编辑器与文件树；有未存改动时提示（不静默覆盖）。
- [x] 文件变更后防抖重建 wiki 索引（`scheduleWikiRebuild`）；保存冲突检测（`diskConflict.saveBlocked`）。
- [x] **全库搜索 + 快速打开**：命令面板 `⌘K`/`⌘P`（论文 quick-open + `vault_search` 全文）。
- [x] **CLI MVP**（[`cli.md`](cli.md)）：`cli/` + workspace；`vault` / `tree` / `paper` / `import` / `export` / `config`；`--json`；path 复用 services，**不迁 core、无 Agent**。
- [x] **运行日志 P0**（[`logging.md`](logging.md)）：Host/前端/CLI 统一 log + 关键操作 op start/end。
- [ ] **Vault 采纳（发现）**：打开文件夹时 inspect——合法 Vault / 半结构 / 散落 PDF / 未知；安全自动项（ensure catalog、缺目录脚手架、不覆盖种子）。

### 中期优先级 P1

- [ ] 本地 PDF importer 与 metadata 确认面板。
- [x] Catalog 权威存储 + `paper_list` / `paper_get` / `paper_delete` / 入库写路径（FTS / 双链缓存表仍待）。
- [x] Library BibTeX 导入/导出（Translator `/import` `/export`）。
- [ ] `catalog:export_papers_md`（Markdown 表）。
- [ ] `[[` 补全与 Plate wikilink 内联节点。
- [ ] Graph 全屏/聚焦模式与邻居高亮。
- [x] **工作区标签页**：多文档 tab、关闭/重排、滚动与视图状态保留；`⌘W` 关 tab / 无 tab 关窗（V0.6 标签页部分）。
- [x] **分屏**：中间栏全局 dockview 多格（PDF | NOTES、三分屏等）（扁平 `DocTab[]` + `dockLayout`）。
- [ ] **文内引用 hover → 右侧 Paper Info**（库内/远程缓存 + 一键入库）（V0.7-A）。
- [ ] **引用关系图 / Connected Papers 式邻域**（cites / cited_by 缓存 + 列表/简图）（V0.7-B）。
- [ ] **Agent 引用工作流**：Explore citations / Map related work / Ingest neighborhood（V0.7-C）。
- [ ] CLI 增强：`graph *`、`doctor`、shell completions。
- [x] Release 附带 `agentero` 二进制（`v*` tag → 草稿 GitHub Release assets）。
- [ ] **Vault 采纳（整理）**：确认后迁移散落 PDF→paper 单元、catalog 对齐、漂移修复；打开 UX + 后台任务；编程 API + 可选 `vault-organize` skill。
- [ ] Release 流程补充签名、公证、版本号同步和自动 changelog。

### Agent provider 后续改造

Codex 已迁移至标准 ACP（经 `@agentclientprotocol/codex-acp`），不再有特殊原生 runtime。后续按 provider 的真实能力逐项接入：

- [ ] Claude Code：评估官方 SDK / 原生 session resume，保存 native session id，接入其历史和权限请求；不能时继续走 ACP 单轮模式。
- [ ] OpenCode：使用其原生 session API / ACP 能力确认持久会话、模型目录、权限与 history 的可用接口。
- [ ] Gemini CLI：确认 experimental ACP 的 session lifecycle 和恢复语义；在稳定前仅提供一次性 ACP run。
- [ ] Qoder CLI、Grok Build 与 Custom ACP：只暴露 ACP 已声明的能力；增加 capability discovery，避免展示不受支持的模型、effort、Fast 或 history 控件。
- [x] 建立 provider capability contract：`ProbeResult.sessionCapabilities` 驱动 Composer 控件显示；**全局权限模式**已对所有 Agent 生效，不在 per-provider 能力表重复。

### 长期优先级 P2

- [x] 从本地 Zotero 迁移（`zotero_scan` / `zotero_migrate`：直读 sqlite、可选拷 PDF、按 collection 建子文件夹、笔记 HTML→MD、PDF 批注文本、逐条选择 / 进度）；批注原位高亮渲染仍待。
- [ ] 浏览器插件与网页 importer。
- [x] PDF 划词提问 MVP（见 [`pdf-ask.md`](pdf-ask.md)：划词操作菜单；统一 **`marks/*.json`**（kind: ask/highlight/translate）+ 页边针 + ACP；M5 增强仍待）。
- [x] PDF 标注系统（Zotero 式）：阅读器内就地批注（高亮 + 内联评论 `comment`）+ 页边批注针 + 右侧「批注」面板（活动 PDF tab；跳转闪烁 / 编辑 / 删除）；标注落 **`marks/`**（`kind: highlight`），**不**写 `NOTES.md`。**导出到 `NOTES.md` 暂不做**。
- [ ] HTML iframe 标注（PDF 侧 `marks/` 已落地）。
- [ ] 多 Agent 并行综述与评估。
- [ ] 作者 / 机构 / 会议关系图谱；更深的 prior–derivative 引用布局。
- [x] 复杂分屏（>2 格，上下左右）。
- [ ] 命名工作区会话。
- [ ] iPadOS 文件系统与触控布局适配。
- [ ] （可选）从 `agentero_lib` 抽出无 Agent 的 domain crate，供 CLI 零 tauri 依赖——**非当前 CLI 范围**。

## 7. 风险控制

- 每个版本都必须保持 Vault 可被外部编辑器打开。
- 每个版本都必须避免覆盖用户手写笔记。
- **Vault 采纳 / 整理**不得静默覆盖 NOTES 或大范围删改；安全自动项与需确认项分级；Agent 路径须走权限与确认。
- 新 importer 不得覆盖用户 `NOTES.md`；meta 只写 catalog；`PAPER.md` 可重建；不自动改用户导出的 PAPERS.md。
- Catalog 损坏时依赖备份/export；双链缓存可从 Markdown 重建；历史 `metadata.json` 可导入。
- 图谱和搜索可以使用缓存，但缓存损坏时必须能从 Markdown 重建。
- Agent 功能失败时必须保留可读错误信息和重试入口。
- 发布构建必须由 tag 触发；如加入签名/公证，需要保证本地开发构建不依赖发布密钥。
