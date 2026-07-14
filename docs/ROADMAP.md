# Motif / notemd Roadmap

## 1. Roadmap 原则

- 先验证 Agent-first 闭环，再扩展传统文献管理能力。
- 先做好 arXiv，不急于覆盖所有论文来源。
- 所有核心数据必须能从本地 Markdown 重建。
- 阅读器服务于审阅和修正，不在早期追求完整 Zotero/PDF 批注体验。
- Agent 采用 **BYOA**：Motif 只做 ACP Client，不捆绑 Agent；能力必须可解释、可追溯、可被用户修正。

## 2. 版本规划

## V0.1 本地 Vault 与 Markdown 工作台

目标：让产品从 Tauri 模板变成一个可用的本地 Markdown 知识库壳。

关键交付：

- 创建和打开本地 Vault。
- 初始化 `AGENTS.md / PAPERS.md / papers / notes / plans`。
- 三栏工作台：文件树、Markdown 编辑/预览、右侧信息面板。
- Markdown 文件读取、编辑、保存。
- 最近 Vault 记录与应用重启恢复。

验收标准：

- 用户可以创建一个空 Vault 并看到标准目录结构。
- 用户可以创建、编辑、保存一个 Markdown note。
- 重启应用后可以回到最近使用的 Vault。

## V0.2 arXiv 入库闭环

目标：完成从用户输入（ID/URL/关键词/话题/描述）到本地 Markdown 文献资产的首个闭环，并保留 Agent 的检索与推荐能力。

关键交付：

- 输入 arXiv ID/URL/关键词/话题/自然语言描述。
- 输入分类与意图解析：规则识别精确 ID/URL，Agent 处理模糊输入。
- Agent 检索 arXiv 候选论文并返回列表供用户确认（单选/多选）。
- 获取论文元数据。
- 创建 `papers/<id>/`（arxiv 用 arXiv ID，非 arxiv 用 citekey），写入 `metadata.json`。
- 获取 LaTeX source / HTML / PDF 资源，source 保存到 `source/`。
- 仅在无 LaTeX source 或需要可读结构化正文时生成 `PAPER.md`。
- 生成默认结构的 `NOTES.md`，并创建空的 `highlights.md`。
- 更新 `PAPERS.md`（派生索引）与 `library.bib`，并同步刷新 `.motif/cache.sqlite`（查询缓存）。
- 在 UI 中展示入库进度、成功结果和失败原因。

验收标准：

- 输入 `1706.03762` 后能生成对应论文目录和核心 Markdown 文件。
- 输入一段描述或关键词后，Agent 能返回候选论文列表，用户确认后完成入库。
- 连续入库 3 篇论文后，`PAPERS.md` 有 3 条有效索引，SQLite 索引可从各篇 `metadata.json` 重建。
- 有 LaTeX source 的论文优先保留 `.tex` 源文件，`PAPER.md` 为可选生成。
- 重复入库时不会破坏用户已修改的 `NOTES.md`。

## V0.3 Agent 工作流（ACP Client + BYOA）

目标：将 Motif 实现为 **ACP Client**，连接用户本机已安装的 Agent，按 Vault 规则完成总结 / 问答 / Related Work。

关键交付：

- ACP Client：stdio JSON-RPC 会话、权限请求转发、流式输出事件。
- BYOA 注册表：预设模板（OpenCode / Gemini CLI / Claude ACP / Codex ACP）+ 自定义 `command` / `args` / `env`；默认 agent 选择。
- 可执行文件探测与空状态安装指引（Motif **不打包** agent 二进制）。
- 会话 `cwd` = 当前 Vault；工作流 prompt 模板注入 + `AGENTS.md` 约束。
- 内置工作流：
  - 总结当前论文。
  - 基于本地库问答。
  - 生成 Related Work 草稿。
- Agent 读取路径回显（Sources）。
- 写文件前临时草稿确认机制。
- 密钥边界：模型 API Key 由 Agent CLI 管理，Motif 不要求 `CLAUDE_*` / 同类 BYOK 表单。

验收标准：

- 用户配置并成功探测至少一个本机 Agent 后，可运行内置工作流。
- 未安装 Agent 时有清晰空状态与配置入口，应用其余功能可用。
- Agent 问答必须展示读取过的本地文件路径。
- Related Work 草稿必须包含本地路径引用。
- Agent 失败或用户拒绝写入时，不会覆盖已有 Markdown。

## V0.4 双链、反链与图谱

目标：让知识库从文件集合升级为可导航的研究网络。

**设计文档**：`docs/WIKILINKS.md`（Obsidian 兼容模型、开源选型、Phase A–D）。

关键交付：

- `[[双链]]` 解析（与 Obsidian 兼容）。
- 双链点击跳转。
- 不存在目标的创建入口。
- 当前文件反链列表。
- 图谱视图。
- Paper、Note、Concept 节点类型。
- 图谱节点点击打开文件。

验收标准：

- 双链可以跨 `papers/`、`notes/`、`plans/` 跳转。
- 反链能显示所有引用当前文件的来源。
- 图谱能从 Markdown 重建，不依赖手写数据库。
- 20 个节点以内交互流畅。

## V0.5 Importer 架构与本地 PDF 入库

目标：抽象 Importer 接口，落地 arXiv 与本地 PDF 两个 importer，并为后续 HTML、DOI、Zotero/BibTeX 做架构准备。

关键交付：

- 抽象 importer 接口。
- 将 arXiv 入库实现迁移为第一个 importer。
- 实现本地 PDF importer：文件选择/拖拽/批量导入、citekey 生成与重复检测。
- 可插拔 `PdfParser`：默认本地 liteparse，配置 MinerU API Key 后优先云端 MinerU，失败自动降级。
- PDF 元数据混合获取：DOI/arXiv 标识符查询 Crossref/arXiv + Agent 正文抽取，入库前用户确认。
- 预留本地 HTML importer。
- 预留 BibTeX/Zotero importer。
- 统一入库状态、错误类型和输出文件契约。

验收标准：

- arXiv importer 行为与 V0.2 保持兼容。
- 导入本地 PDF 能生成 `papers/<citekey>/`（含必定生成的 `PAPER.md`）并进入笔记审阅。
- 配置 MinerU API Key 后 PDF 默认走云端解析，未配置或失败时自动降级本地且不中断。
- 新 importer 可以复用同一套输出结构。
- UI 不需要为每种来源重写入库流程。

## 3. Later

这些能力不进入 MVP，但可以在 Agent-first 闭环验证后规划：

- Zotero/BibTeX 批量导入。
- 浏览器插件，一键收集网页和论文。
- 完整 PDF 高亮、批注、摘录同步。
- 远程 PDF 链接、DOI、任意网页入库。
- 多 Agent 并行读论文和综合评估。
- 论文引用关系自动抽取。
- 作者、机构、会议关系图谱。
- Git 版本管理集成。
- 云同步和多设备阅读。
- 平板端阅读体验。

## 4. 主要里程碑

### Milestone A：本地知识库可用

包含 V0.1。完成后，产品可以作为普通 Markdown vault 编辑器使用。

### Milestone B：论文可入库

包含 V0.2。完成后，产品可以把 arXiv 论文变成本地 Markdown 资产。

### Milestone C：Agent 可协作

包含 V0.3。完成后，Motif 可作为 ACP Client 连接本机 Agent，基于本地库问答和写作。

### Milestone D：知识可导航

包含 V0.4。完成后，用户可以通过双链、反链、图谱组织研究上下文。

### Milestone E：来源可扩展

包含 V0.5。完成后，产品在 arXiv 之外可稳妥导入本地 PDF，并为更多来源预留扩展点。

## 5. 风险控制

- 每个版本都必须保持 Vault 可被外部编辑器打开。
- 每个版本都必须避免覆盖用户手写笔记。
- 新 importer 不得改变已存在的 `PAPERS.md / NOTES.md` 语义；`PAPER.md` 作为派生文件可随时重建。
- SQLite 索引损坏时必须能从 `metadata.json`、`NOTES.md` 和双链自动重建。
- 图谱和搜索可以使用缓存，但缓存损坏时必须能从 Markdown 重建。
- Agent 功能失败时必须保留可读错误信息和重试入口。
