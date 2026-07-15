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
| V0.1 本地 Vault 与 Markdown 工作台 | ✅ 基本完成 | 工作台、Create Vault + catalog、多窗口（⌘N）+ 欢迎页、树内联新建、PDF/HTML/Notes、WYSIWYG Markdown、**论文库表格 + 虚拟 Library 节点**、Preview/Info 仅在具体论文时显示。 |
| V0.2 arXiv / 标识符入库闭环 | 🟡 精确路径基本完成 | **魔棒 + Translator** 入库、catalog 权威、`paper_list` / `paper_get`、**默认下载 PDF + arXiv e-print 解压 LaTeX**、单篇/Library **补下缺失资源** 已落地；Agent 关键词候选、`PAPER.md` 生成、`catalog:export_*` 仍待。 |
| V0.3 Agent 工作流（BYOA） | 🟡 进行中 | 通用 ACP Client（OpenCode、Gemini、Claude、Qoder、Grok、自定义）+ Codex 原生 App Server thread/history；内置工作流、逐项权限确认、写入草稿确认仍待。 |
| V0.4 双链、反链与图谱 | ✅ 基本完成 | 反链、预览双链跳转、缺失目标创建、Graph 与 `graph_get_graph` 已落地；`[[` 补全 / Plate 内联节点可后续增强。 |
| V0.5 Importer 架构与本地 PDF 入库 | ⏳ 待实现 | Importer trait、本地 PDF 拖拽入库、PdfParser（liteparse / MinerU）仍在规划；魔棒 v0 已可复用部分写盘路径。 |
| Release CI | ✅ 完成 | push `v*` tag 时构建 macOS/Linux/Windows Tauri 安装包并上传草稿 Release。 |

**精确 arXiv/标识符入库（可用）**：魔棒粘贴 ID/URL → Translator → catalog + `NOTES.md` 壳 → `source/` PDF（arXiv 含 TeX）→ Library 表可见；缺资源时树行/Library 可补下。

## 3. 版本规划

## V0.1 本地 Vault 与 Markdown 工作台

目标：让产品从 Tauri 模板变成一个可用的本地 Markdown 知识库壳。

关键交付：

- [x] 打开本地 Vault。
- [x] 创建空 Vault 并初始化 `AGENTS.md` / `papers` / `notes` / `plans` / `.motif/catalog.sqlite`。
- [x] 工作台：文件树 + 中间内容 + Preview/Notes + 可选右侧栏。
- [x] Markdown 文件读取、编辑、保存（Plate WYSIWYG + 自动保存）。
- [x] 最近 Vault 列表（欢迎页）与主窗口恢复上次 Vault。
- [x] 多窗口：`⌘N` 新建窗口，session 级 Vault 隔离。
- [x] 树内联新建文件 / 文件夹。
- [x] Paper-centric 视图：选中 paper 后中间显示远程 PDF/HTML，右侧显示该篇 `NOTES.md`（**仅具体论文**时显示 Preview/Info）。
- [x] 侧边栏折叠、标题栏快捷按钮、Settings 窗口。
- [x] 论文库表格：虚拟节点 `motif:library`、`paper_list`、表头排序、双向滚动。
- [x] Paper Info / Notes 仅在选中具体论文时显示（Library 视图隐藏）。

验收标准：

- [x] 用户可以创建一个空 Vault 并看到标准目录结构与 catalog 数据库。
- [x] 用户可以打开、编辑、保存一个 Markdown note。
- [x] 重启应用后可以回到最近使用的 Vault（设置开启时）。
- [x] `⌘N` 打开的新窗口不自动占用上一窗口的 Vault，欢迎页可点最近路径。
- [x] 打开 Vault 后可在 Library 视图看到 catalog 中的论文列表。

后续 TODO：

- [x] 补齐“Create Vault”流程（含 catalog 初始化），而不只是打开已有目录。
- [ ] 最近 Vault / UI 偏好从 `localStorage` 迁到 Tauri Store（语义对齐现有前端 MRU）。
- [ ] 文件监听与外部编辑器修改同步。
- [ ] 增加保存状态提示和冲突处理（Markdown 已有脏点 + 自动保存，可再增强）。

## V0.2 arXiv / 标识符入库闭环

目标：从用户输入（ID/URL，后续关键词/话题/描述）到本地文献资产的闭环；精确路径优先落地，再扩展 Agent 检索。

设计：[`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)、[`../backend/catalog.md`](../backend/catalog.md)。

### 已落地（精确 ID/URL + 本地归档）

- [x] 侧栏魔棒：粘贴 arXiv / DOI 等链接或编号 → Host `lookup_import`。
- [x] Translator HTTP（`translatorBaseUrl`，默认 `https://translator.philfan.cn`）+ arXiv Atom fallback。
- [x] map → `PaperMetadata` → **catalog.sqlite 权威**；`metadata.json` 仅为投影。
- [x] 创建 `papers/<id>/`（或当前 Papers 子文件夹下）、`NOTES.md` / `highlights.md` 壳。
- [x] **始终下载 PDF** 到 `source/{id}.pdf`；**arXiv e-print 解压 LaTeX** 到 `source/`（无下载开关）。
- [x] 中间栏预览仍可用 catalog 远程 `pdf_url` / `html_url`。
- [x] `paper_list` / `paper_get`；Library 表格 + 虚拟节点。
- [x] 按需补下：`paper_download_assets`；paper 行缺 PDF 或 arXiv 缺 TeX 时 Download；**Library 行批量补下全部缺失**。
- [x] 入库错误行内展示；重复不覆盖用户 `NOTES.md`。

### 未完成

- [ ] 关键词/话题/自然语言描述 + 输入分类（规则 + Agent）。
- [ ] Agent 检索候选列表确认（单选/多选）。
- [ ] 无 LaTeX 或需要统一正文时生成 `PAPER.md`。(放在解析部分完成)
- [ ] `catalog:export_papers_md` / `catalog:export_bibtex`。
- [x] 入库后刷新 Backlinks/Graph 索引
- [x] 魔棒快捷键 `⇧⌘I`；

验收标准：

- [x] 输入 `1706.03762` 后生成 paper 目录、NOTES 壳、catalog 行，并尽量得到 PDF（arXiv 另有 TeX）。
- [x] 连续入库多篇后 `paper_list` / Library 可见对应行。
- [x] 缺本地资源时 paper 行 / Library 可补下。
- [ ] 关键词路径：候选列表 → 确认 → 入库。
- [ ] 可选导出 PAPERS.md / BibTeX 与 catalog 一致。
- [x] 重复入库不破坏已有 `NOTES.md`。

## V0.3 Agent 工作流（ACP Client + BYOA）

目标：将 Motif 实现为 **ACP Client**，连接用户本机已安装的 Agent，按 Vault 规则完成总结 / 问答 / Related Work。

关键交付：

- [x] ACP Client：stdio JSON-RPC 会话、流式输出事件。
- [x] Codex 原生 runtime：`codex app-server` 的 thread start/resume、流式 turn、原生 history 列表与 JSONL transcript 回放；不再经 ACP adapter 启动 Codex。
- [x] BYOA 注册表：预设模板 + 自定义 `command` / `args` / `env`；默认 agent 选择。
- [x] 可执行文件探测与空状态安装指引（Motif **不打包** agent 二进制）。
- [x] Composer 上下文：当前文件 chip、`@` / `$` 候选的键盘选择、本地会话标签切换。
- [x] Codex 会话配置：仅在 Codex provider 上按 App Server 模型目录显示并应用 reasoning effort 与 Fast；YOLO 保持独立权限开关。
- [x] Agent 输出期间 Composer 仍可编辑；按 `Esc` 会取消当前 ACP session 并保留已输出内容。
- [x] 会话 `cwd` = 当前 Vault。
- [ ] 工作流 prompt 模板注入 + `AGENTS.md` 约束。
- [ ] 内置工作流：总结当前论文、基于本地库问答、生成 Related Work 草稿。
- [x] Agent 读取路径回显（Sources）。
- [ ] 写文件前临时草稿确认机制。
- [x] 密钥边界：模型 API Key 由 Agent CLI 管理，Motif 不要求模型 BYOK 表单。

验收标准：

- [x] 用户配置并成功探测至少一个本机 Agent 后，可发起 Agent 对话。
- [x] 未安装 Agent 时有清晰空状态与配置入口，应用其余功能可用。
- [x] Agent 问答展示读取过的本地文件路径（Agent 返回 Sources 时）。
- [ ] Related Work 草稿必须包含本地路径引用。
- [ ] Agent 失败或用户拒绝写入时，不会覆盖已有 Markdown。

细化 TODO：

- [ ] 把“总结当前论文 / 本地库问答 / Related Work”做成可点击 workflow。
- [ ] 将 `AGENTS.md` 自动注入 workflow prompt，并在缺失时提示初始化。
- [ ] 接入 ACP 权限确认 UI，而不是自动选择或静默处理。
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

## 4. Later

这些能力不进入 MVP，但可以在 Agent-first 闭环验证后规划：

- Zotero/BibTeX 批量导入。
- 浏览器插件，一键收集网页和论文。
- 完整 PDF 高亮、批注、摘录同步。
- 远程 PDF 链接、任意网页入库（DOI 魔棒路径可部分覆盖）。
- 多 Agent 并行读论文和综合评估。
- 论文引用关系自动抽取。
- 作者、机构、会议关系图谱。
- Git 版本管理集成。
- 云同步和多设备阅读。
- 平板端阅读体验。

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

## 6. 主要 TODO 总表

### 近期优先级 P0

- [x] Create Vault：标准目录 + `AGENTS.md` + `.motif/catalog.sqlite`。
- [x] 多窗口（⌘N）+ 欢迎页最近 Vault 列表（前端 MRU；Store 迁移仍待做）。
- [x] arXiv/标识符精确入库（魔棒 + Translator + catalog + 默认 PDF/LaTeX）。
- [x] 论文库 UI：`paper_list` + Library 虚拟节点 + 表头排序 + 双向滚动。
- [x] 缺失资源补下：单篇 Download + Library 批量 Download（`paper_download_assets`）。
- [ ] Agent 关键词候选 / 自然语言入库闭环。
- [ ] Agent workflow prompt：总结当前论文、本地库问答、Related Work。
- [ ] Agent 写入草稿确认与拒绝路径。
- [ ] Tauri Store 替代当前 localStorage 中的最近 Vault / UI 偏好。
- [ ] 文件监听与索引增量刷新。

### 中期优先级 P1

- [ ] 本地 PDF importer 与 metadata 确认面板。
- [x] Catalog 权威存储 + `paper_list` / `paper_get` / 入库写路径（导出 / FTS / 双链缓存表仍待）。
- [ ] `catalog:export_papers_md` / `catalog:export_bibtex`。
- [ ] `[[` 补全与 Plate wikilink 内联节点。
- [ ] Graph 全屏/聚焦模式与邻居高亮。
- [ ] Release 流程补充签名、公证、版本号同步和自动 changelog。

### Agent provider 后续改造

Codex 的原生 thread runtime 是 provider 专属实现，不应把其命令、history 文件或配置能力抽象成所有 agent 的默认行为。后续按 provider 的真实能力逐项接入：

- [ ] Claude Code：评估官方 SDK / 原生 session resume，保存 native session id，接入其历史和权限请求；不能时继续走 ACP 单轮模式。
- [ ] OpenCode：使用其原生 session API / ACP 能力确认持久会话、模型目录、权限与 history 的可用接口。
- [ ] Gemini CLI：确认 experimental ACP 的 session lifecycle 和恢复语义；在稳定前仅提供一次性 ACP run。
- [ ] Qoder CLI、Grok Build 与 Custom ACP：只暴露 ACP 已声明的能力；增加 capability discovery，避免展示不受支持的模型、effort、Fast、YOLO 或 history 控件。
- [ ] 建立 provider capability contract：`persistentRuntime`、`nativeHistory`、`modelCatalog`、`reasoningEffort`、`serviceTier`、`permissionRequests`、`skillPicker`。Composer 仅按当前 provider 的能力显示对应组件。

### 长期优先级 P2

- [ ] Zotero/BibTeX 迁移工具。
- [ ] 浏览器插件与网页 importer。
- [ ] PDF/HTML 标注系统。
- [ ] 多 Agent 并行综述与评估。
- [ ] iPadOS 文件系统与触控布局适配。

## 7. 风险控制

- 每个版本都必须保持 Vault 可被外部编辑器打开。
- 每个版本都必须避免覆盖用户手写笔记。
- 新 importer 不得覆盖用户 `NOTES.md`；meta 只写 catalog；`PAPER.md` 可重建；不自动改用户导出的 PAPERS.md。
- Catalog 损坏时依赖备份/export；双链缓存可从 Markdown 重建；历史 `metadata.json` 可导入。
- 图谱和搜索可以使用缓存，但缓存损坏时必须能从 Markdown 重建。
- Agent 功能失败时必须保留可读错误信息和重试入口。
- 发布构建必须由 tag 触发；如加入签名/公证，需要保证本地开发构建不依赖发布密钥。
