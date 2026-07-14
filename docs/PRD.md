# Motif / notemd Agent-first 文献库 MVP PRD

## 1. 背景与定位

Motif / notemd 是一个面向人和 Agent 共用的本地科研文献库。它不是传统 Zotero 的替代品，而是围绕 Agent 的信息处理方式重新组织文献、笔记、索引和引用路径。

传统文献工具主要解决“存储文献”的问题，但在 Agent 工作流里会出现三个断层：

- PDF 高亮、批注和人的阅读记忆被锁在单篇文件里，Agent 难以全局检索。
- 每次和 Agent 对话都需要重新提供上下文，知识库缺少稳定的路由表。
- PDF 对人眼友好，但对模型有大量排版噪音，公式、表格、引用关系也不够可寻址。

本产品的核心主张是：让人和 Agent 都可以读、改、链接文献，并且把论文粗读、Idea寻找等工作让 Agent 帮忙。

## 2. 产品目标

### 2.1 MVP 目标

验证一个 Agent-first 的研究闭环：

1. 用户输入 arXiv ID、URL、关键词、话题、一段描述，或直接导入本地 PDF 文件。
2. 系统借助 Agent 能力解析输入意图、检索候选论文，并在需要时让用户确认目标论文；确认后优先拉取 tex 源文件，并保留 pdf、html 版本的链接。仅在无 tex 源或 Agent 明确需要可读结构化正文时才生成 `PAPER.md`。
3. Agent完成粗读 生成结构化 `NOTES.md`，并更新全局 `PAPERS.md` 索引。

用户部分：
4. Markdown 工作台里审阅、编辑、补充双链。可以选择预览pdf、html版本，并可以做批注
5. Agent 基于本地索引和笔记回答问题，并输出读取过的本地文件路径。
6. 关系图谱展示论文、笔记、概念之间的连接。

### 2.2 成功标准

- 用户可以在 5 分钟内完成一个新 Vault 的创建、arXiv 论文入库、笔记生成和人工修订。
- 输入 3 篇 arXiv 论文后，系统能生成稳定的 `metadata.json / NOTES.md / PAPERS.md`（及按需 `PAPER.md`）结构。
- 用户能通过 `[[双链]]` 连接论文、概念、作者和 Idea，并看到反链（类似 Obsidian；设计见 `docs/WIKILINKS.md`）
- Agent 回答跨论文问题时，必须展示读取过的本地文件路径。
- 关系图谱能反映 Markdown 双链和论文关系，而不是依赖不可见数据库。

## 3. 目标用户

### 3.1 核心用户

- AI/ML/科研方向的研究者、学生、工程师。
- 已经使用 Obsidian、VS Code、Cursor、Claude、Codex 或 Zotero 管理论文的人。
- 愿意把研究过程沉淀为 Markdown 文件，并希望 Agent 能复用这些上下文的人。

### 3.2 典型场景

- 快速入库 arXiv 论文，并生成结构化笔记。
- 比较多篇论文的方法差异、贡献边界和实验结论。
- 围绕一个新 Idea 检索相关论文，让 Agent 给出批判性意见。
- 写 Related Work 时要求每条论述都能追溯到本地路径。
- 用双链把论文、概念、作者、项目想法连接成知识图谱。

## 4. MVP 范围

### 4.1 P0 功能

#### Vault 管理

- 支持选择或创建本地 Vault 文件夹。
- 所有核心数据以 Markdown 和源文件落盘。
- 应用重新打开后能恢复最近使用的 Vault。
- 不把用户知识锁进私有数据库；数据库或索引只能作为缓存。

#### arXiv 入库

- 支持输入 arXiv ID、arXiv URL、关键词、话题或一段自然语言描述。
- 当输入不是精确 ID/URL 时，调用 Agent 检索 arXiv 候选论文并返回列表供用户确认。
- Agent 应给出候选论文的标题、作者、摘要片段及推荐理由，用户确认后再进入入库流程。
- 为每篇论文创建独立目录：`papers/<id>/`（arxiv 用 arXiv ID，非 arxiv 用 citekey）。
- 写入 `metadata.json`，作为该篇元数据的事实来源。
- 优先获取 arXiv LaTeX source 作为结构化来源；HTML/PDF 作为人类阅读补充。
- 仅在无 LaTeX source 或 Agent/用户需要时才生成 `PAPER.md`；有 source 时直接保留原始 `.tex`。
- 生成 `NOTES.md`（默认三段论结构），并创建空的 `highlights.md` 供标注写入。
- 更新根目录 `PAPERS.md`（派生索引）与 `library.bib`，并同步刷新 `.motif/cache.sqlite`（查询缓存）。
- 对重复入库、网络失败、缺少 HTML/LaTeX、解析失败给出明确状态。

#### 本地 PDF 入库

- 支持从文件选择器选择或拖拽导入本地 PDF，支持一次批量导入多篇。
- 通过统一的 Importer 抽象接入：arXiv 与本地 PDF 是首批两个 importer，共用同一套落盘结构与状态契约。
- 采用可插拔 PDF 解析器（BYOK）：默认使用本地嵌入式解析器（离线、开箱即用）；用户在设置中配置 MinerU API Key 后，默认优先云端 MinerU 以获得更高解析质量，失败时自动降级回本地解析器。
- 元数据混合获取 + 入库前确认：先从 PDF 提取 DOI / arXiv ID 并查询 Crossref / arXiv 获取权威元数据；无标识符或查询失败时由 Agent 从正文抽取候选；入库前弹出确认面板供用户校对、修正标题、作者、年份、摘要与标签。
- 为每篇创建 `papers/<citekey>/` 目录（citekey 由作者、年份、标题派生，冲突时追加后缀），写入 `metadata.json`（`type` 为 `pdf`）。
- 原始 PDF 保存到 `source/`；因无 LaTeX source，PDF 来源必定生成 `PAPER.md` 作为唯一可读正文，并在 `metadata.json` 记录 `body_source`（`pdf`/`ocr`）与 `body_quality`。
- 生成 `NOTES.md` 与空的 `highlights.md`，更新 `PAPERS.md`、`library.bib` 与 `.motif/cache.sqlite`。
- 使用云端 MinerU 前需明确提示用户 PDF 将上传至第三方服务；默认本地解析不外传数据。

#### Markdown 工作台

- 左侧：Vault 文件树与 paper 元信息。
- 中间：Markdown / PDF / HTML 视图切换。
- 右侧 Preview/Notes：Markdown 预览，或阅读 PDF/HTML 时展示该篇 `NOTES.md`。
- 可选右侧栏：Agent，或 Backlinks+Graph（上方反链，下方图谱）。
- 支持打开、编辑、保存 Markdown。
- 支持基本标题、列表、代码块、链接、表格预览。

#### 双链与反链

- 支持 Obsidian 兼容双链格式：`[[Concept]]`、`[[papers/1706.03762/NOTES]]`。
- 点击双链可以跳转到已有文件。
- 对不存在的双链目标提供创建入口。
- 展示当前文件的反链列表。
- Agent 生成内容时需要保留双链格式。

#### Agent 集成（ACP Client + BYOA）

- Motif 作为 **ACP Client** 连接用户本机已安装的 coding agent；**不内置、不捆绑** Agent 二进制或 Claude Agent SDK。
- **BYOA（Bring Your Own Agent）**：用户在设置中添加 Agent（预设模板：OpenCode / Gemini CLI / Claude ACP / Codex ACP，或自定义 `command` + `args` + `env`）。模型与 API Key 由各 Agent CLI 自行管理，Motif 不持有模型密钥。
- 会话工作目录为当前 Vault 根目录，使 Agent 直接读写本地 Markdown 资产。
- MVP 提供 3 个内置**工作流 prompt**（由 Host 注入，仍由用户选定的 Agent 执行）：
  - 总结当前论文。
  - 基于本地库问答。
  - 生成带本地路径引用的 Related Work 草稿。
- Agent 读取顺序遵循渐进式披露：`AGENTS.md -> PAPERS.md -> NOTES.md -> highlights.md -> PAPER.md -> source/`，仅在需要时逐层下钻。
- Agent 输出必须展示读取过的文件路径；写回 Vault 前需用户确认（临时草稿 → 正式文件）。
- 未检测到可用 Agent 时，设置与 Agent 面板展示安装/配置指引，不阻塞 Vault 与阅读功能。

#### 阅读器

- 支持在应用内打开 PDF。
- 支持在应用内打开 arXiv HTML 或本地 HTML。
- 支持基础搜索、缩放、页内定位。
- 标注（引文 + 想法）以 `highlights.md` 落盘，坐标缓存于 `.motif/`；MVP 提供轻量标注捕获，不做完整 PDF 批注同步系统。

#### 关系图谱

- 基于 Markdown 双链和论文索引生成图谱。
- 节点至少包括 Paper、Note、Concept/Stub。
- 点击节点可以打开对应 Markdown。
- 图谱数据必须能从本地 Markdown 重建。
- MVP UI 中图谱位于 Backlinks 右侧栏下方，与当前文件反链共享上下文。

### 4.2 P1 暂缓

- Zotero 全量替代能力。
- 云同步、多人协作、权限管理。
- 浏览器插件。
- 移动端和平板端。
- 通用 DOI、任意网页、远程 PDF 链接入库（本地 PDF 文件入库已纳入 P0）。
- 完整 PDF 高亮批注同步。
- 高级 BibTeX 清洗和引用格式管理。
- 多 Agent 可视化编排。

## 5. 文件结构与数据约定

### 5.1 Vault 结构

```text
motif-vault/
  AGENTS.md              # L0 Agent 行为规范与读取协议
  PAPERS.md              # L1 全局论文索引（派生自各篇 metadata.json，可重建）
  library.bib            # 派生 BibTeX 汇总（引用导出）
  papers/
    1706.03762/          # arxiv 用 arXiv ID；非 arxiv 用 citekey
      metadata.json      # 该篇元数据的事实来源
      NOTES.md           # L2 结构化笔记
      highlights.md      # L2.5 标注：引文 + 想法
      PAPER.md           # L3 派生可读正文（可选）
      assets/            # 引用图片（派生自 source）
      source/            # L4 原始归档（始终存在，只增不改）
        *.tex            #   LaTeX 源文件
        original.pdf
        original.html
        ocr/             #   OCR/解析中间产物
  notes/
    *.md
  plans/
    *.md
  .motif/                # Tier 3 缓存（可整删重建，进 .gitignore）
    cache.sqlite         #   元数据/全文/双链图/标注坐标索引
    config.json          #   库级设置
```

### 5.2 核心文件

#### `PAPERS.md`

全局论文索引，也是 Agent 的第一层路由表。**由各篇 `metadata.json` 汇总生成、可随时重建**，不是手工维护的 master。

推荐字段：

```md
| ID | Title | Authors | Year | Path | Tags | Summary |
| --- | --- | --- | --- | --- | --- | --- |
```

#### `metadata.json`（每篇元数据的事实来源）

位于 `papers/<id>/metadata.json`，是单篇论文结构化元数据的唯一事实来源。与 `NOTES.md` 分离，避免机器字段与人的 prose 相互踩踏。`PAPERS.md`、`library.bib`、`.motif/cache.sqlite` 均为其派生投影。

#### `NOTES.md`（L2，事实来源）

单篇论文的结构化压缩笔记，纯粹是人的知识，不掺元数据。

默认结构：

```md
# 解决了什么问题

# 方法是什么

# 效果怎么样
```

#### `highlights.md`（L2.5，事实来源）

单篇论文的标注层，与 `NOTES.md` 分开存放：笔记是「熟的」综合知识，标注是「生的」原始证据（锚定原文位置的引文 + 想法）。引文与想法留在 Markdown（事实来源），页码/bbox 等坐标缓存于 `.motif/`（可由引文检索重建）；用 Obsidian 块引用 `^id`，让 `NOTES.md` 能精确引用某条标注。

#### `PAPER.md`（L3，派生）

位于 `papers/<id>/PAPER.md`（在论文目录根部，不在 `source/` 内），面向 Agent 阅读的统一可读正文，保留章节、公式、表格、引用等结构信息，降低 PDF 排版噪音。`source/` 是异构原始归档，`PAPER.md` 提供同构可读出口；正文来源与质量记录在 `metadata.json` 的 `body_source`/`body_quality`。当 `source/` 中已存在 LaTeX 源文件时，`PAPER.md` 为可选生成项；对无 LaTeX source 的本地 PDF 来源，`PAPER.md` 为必定生成项，是该篇唯一的结构化可读正文。

#### `AGENTS.md`（L0，事实来源）

Vault 内的 Agent 行为规范，至少包含：

- 读取协议：按 `PAPERS.md → NOTES.md → highlights.md → PAPER.md → source/` 逐层下钻。
- 笔记结构规范（三段论）。
- 引用路径要求：回答必须列出读取过的本地文件路径。
- 生成内容的双链要求。
- 写入规范：先写临时文件，确认后落盘，不覆盖用户手写笔记。

## 6. 核心用户流程

### 6.1 新建知识库

1. 用户打开应用。
2. 选择“创建 Vault”。
3. 选择本地目录。
4. 系统初始化 `AGENTS.md / PAPERS.md / papers / notes / plans`。
5. 进入三栏工作台。

### 6.2 arXiv 论文入库

1. 用户在入库输入框中提供 arXiv ID、URL、关键词、话题或一段描述。
2. 系统通过规则 + Agent 判断输入类型：
   - 若为精确 ID/URL，直接进入元数据拉取。
   - 若为关键词、话题或描述，调用 Agent 检索 arXiv 候选论文并展示列表。
3. 用户从候选列表中确认目标论文（单选或多选）。
4. 系统识别论文元数据。
5. 系统将确认结果归一化为标准 arXiv ID。
6. 系统创建 `papers/<id>/`（arxiv 用 arXiv ID，非 arxiv 用 citekey），写入 `metadata.json`。
7. 系统获取 LaTeX source / HTML / PDF，source 文件保存到 `source/`。
8. 若无 LaTeX source 或需要可读结构化正文，系统生成 `PAPER.md`。
9. Agent 生成 `NOTES.md`，并创建空的 `highlights.md`。
10. 系统更新 `PAPERS.md`（派生索引）与 `library.bib`，并同步刷新 `.motif/cache.sqlite`（查询缓存）。
11. 用户进入 `NOTES.md` 审阅和修订。

### 6.3 本地 PDF 入库

1. 用户通过“导入 PDF”按钮或拖拽，选择一篇或多篇本地 PDF。
2. 系统对每篇 PDF 做轻量解析，提取首页文本并识别 DOI / arXiv ID。
3. 命中标识符时查询 Crossref / arXiv 获取权威元数据；未命中或失败时由 Agent 从正文抽取候选元数据。
4. 系统弹出确认面板，展示标题、作者、年份、摘要、标签，用户校对并修正。
5. 系统据此生成 citekey，检测重复（DOI / 标题指纹），创建 `papers/<citekey>/` 并写入 `metadata.json`。
6. 原始 PDF 保存到 `source/`；按当前解析器（默认本地，配置 Key 后优先 MinerU）全文解析生成 `PAPER.md` 与 `assets/`。
7. Agent 生成 `NOTES.md`，创建空的 `highlights.md`。
8. 系统更新 `PAPERS.md`、`library.bib` 与 `.motif/cache.sqlite`。
9. 用户进入 `NOTES.md` 审阅和修订。

### 6.4 基于本地库问答

1. 用户在 Agent 面板输入问题。
2. Agent 先读取 `PAPERS.md` 锁定候选论文。
3. Agent 读取相关 `NOTES.md`，必要时读取 `highlights.md` 获取用户标注。
4. 仅当需要公式、实验细节或原文时读取 `PAPER.md`，最后才进入 `source/`。
5. Agent 输出答案。
6. 答案末尾展示读取过的文件路径。

### 6.5 双链组织

1. 用户在笔记里输入 `[[Concept]]`。
2. 系统解析并展示可点击链接。
3. 如果目标不存在，用户可以创建新 note。
4. Backlinks 右侧栏上方展示所有引用当前 note 的文件。
5. Backlinks 右侧栏下方的图谱自动更新节点和边。

## 7. 非功能要求

- 本地优先：没有网络时，用户仍然可以浏览、编辑、搜索已有 Vault。
- 可迁移：Vault 文件夹离开应用后，仍能被 Obsidian、VS Code、Cursor 或命令行直接读取。
- 可恢复：Agent 运行失败不能破坏已有文件；生成内容应尽量采用临时结果确认后写入。
- 可解释：入库和 Agent 问答需要展示关键步骤和失败原因。
- 可扩展：arXiv importer 是首个 importer，但接口需要允许后续扩展 PDF、HTML、DOI、Zotero/BibTeX。

## 8. 验收标准

- 创建新 Vault 后，目录结构符合 PRD 中的 Vault 结构。
- 输入 `1706.03762` 后，生成对应 `papers/1706.03762/metadata.json`、`NOTES.md` 与 `PAPER.md`（无 tex 源时）。
- 导入一篇本地 PDF 后，生成 `papers/<citekey>/` 目录，包含 `metadata.json`（`type=pdf`）、必定生成的 `PAPER.md`、`NOTES.md`，以及 `source/` 中的原始 PDF。
- 配置 MinerU API Key 后导入 PDF 默认走云端解析；未配置或云端失败时自动降级为本地解析，且入库流程不中断。
- 输入关键词或一段研究描述后，在已配置本机 Agent 的前提下，能检索并返回候选论文，用户确认后完成入库。
- 连续入库 3 篇 arXiv 论文后，`PAPERS.md` 至少包含 3 条索引。
- 编辑 `NOTES.md` 并保存后，文件系统中的 Markdown 内容同步更新。
- `[[双链]]` 能跳转；Backlinks 右侧栏能在上方显示引用来源，并在下方显示图谱。
- 配置并探测到本机 ACP Agent 后，跨论文问答结果包含读取文件列表；未配置时展示 BYOA 空状态而非崩溃。
- 关闭应用后重新打开，最近 Vault、文件树、Markdown 内容可以恢复。
- 图谱展示至少 20 个节点时，点击节点能打开对应文件。

## 9. 风险与对策

- arXiv HTML/LaTeX 可用性不稳定：优先采用 HTML/LaTeX，失败时降级到 PDF 解析，并明确标记质量。
- 本地 PDF 解析质量参差：默认本地解析保证可用，配置后优先云端 MinerU 提质，失败自动降级，并在 `metadata.json` 标记 `body_quality`。
- 云端 MinerU 涉及数据外传：默认本地解析不外传；启用 MinerU 前明确提示 PDF 将上传第三方服务，由用户自行决定。
- 用户未安装 / 未配置 Agent：设置与 Agent 面板提供探测与安装指引；Vault 与阅读能力不依赖 Agent。
- Agent 生成质量不稳定：把 `AGENTS.md` 与工作流 prompt 作为强约束，写回前确认，并让用户能编辑最终 Markdown。
- 不同 Agent CLI 行为差异：只依赖 ACP 公共能力；能力缺失时可读降级，不假设某单一厂商 SDK。
- 范围膨胀成 Zotero 替代品：MVP 只验证 Agent-first 入库、笔记、问答、双链、图谱闭环。
- 图谱成为装饰功能：图谱必须从真实 Markdown 双链和论文索引生成，并支持打开文件。
- 私有数据库锁定用户数据：数据库只能做缓存，Markdown 文件是事实来源。

## 10. 相关文档

- Roadmap：`docs/ROADMAP.md`
- 技术方案：`docs/TECH.md`
- UI 规范：`docs/UI.md`
- 双链/反链/图谱设计：`docs/reference/WIKILINKS.md`
- 数据模型：`docs/reference/DATA_MODEL.md`
- API 契约：`docs/reference/API.md`
