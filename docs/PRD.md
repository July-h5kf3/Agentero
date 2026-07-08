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

1. 用户输入 arXiv ID、URL、关键词、话题或一段描述。
2. 系统借助 Agent 能力解析输入意图、检索候选论文，并在需要时让用户确认目标论文；确认后优先拉取 tex 源文件，并保留 pdf、html 版本的链接。仅在无 tex 源或 Agent 明确需要可读结构化正文时才生成 `paper.md`。
3. Agent完成粗读 生成结构化 `NOTES.md`，并更新全局 `PAPERS.md` 索引。

用户部分：
4. Markdown 工作台里审阅、编辑、补充双链。可以选择预览pdf、html版本，并可以做批注
5. Agent 基于本地索引和笔记回答问题，并输出读取过的本地文件路径。
6. 关系图谱展示论文、笔记、概念之间的连接。

### 2.2 成功标准

- 用户可以在 5 分钟内完成一个新 Vault 的创建、arXiv 论文入库、笔记生成和人工修订。
- 输入 3 篇 arXiv 论文后，系统能生成稳定的 `paper.md / NOTES.md / PAPERS.md` 结构。
- 用户能通过 `[[双链]]` 连接论文、概念、作者和 Idea，并看到反链,类似 Obsidian当中的设计
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
- 为每篇论文创建独立目录：`papers/<arxiv-id>/`。
- 优先获取 arXiv LaTeX source 作为结构化来源；HTML/PDF 作为人类阅读补充。
- 仅在无 LaTeX source 或 Agent/用户需要时才生成 `paper.md`；有 source 时直接保留原始 `.tex`。
- 生成 `NOTES.md`，默认使用三段论结构。
- 更新根目录 `PAPERS.md`（事实来源），并同步写入本地 SQLite 索引（查询缓存）。
- 对重复入库、网络失败、缺少 HTML/LaTeX、解析失败给出明确状态。

#### Markdown 工作台

- 左侧：Vault 文件树。
- 中间：Markdown 编辑器和预览切换。
- 右侧：元信息、反链、Agent 运行结果。
- 支持打开、编辑、保存 Markdown。
- 支持基本标题、列表、代码块、链接、表格预览。

#### 双链与反链

- 支持 Obsidian 兼容双链格式：`[[Concept]]`、`[[papers/1706.03762/NOTES]]`。
- 点击双链可以跳转到已有文件。
- 对不存在的双链目标提供创建入口。
- 展示当前文件的反链列表。
- Agent 生成内容时需要保留双链格式。

#### Agent 集成

- 内置 Claude Agent SDK。
- 支持 Bring Your Own Key。
- MVP 提供 3 个内置流程：
  - 总结当前论文。
  - 基于本地库问答。
  - 生成带本地路径引用的 Related Work 草稿。
- Agent 读取顺序必须遵循 `PAPERS.md -> NOTES.md -> source/paper.md`，优先读取 `source/` 中的原始源文件，仅在无源文件时读取 `paper.md`。
- Agent 输出必须展示读取过的文件路径。

#### 阅读器

- 支持在应用内打开 PDF。
- 支持在应用内打开 arXiv HTML 或本地 HTML。
- 支持基础搜索、缩放、页内定位。
- MVP 不做完整 PDF 高亮批注系统。

#### 关系图谱

- 基于 Markdown 双链和论文索引生成图谱。
- 节点至少包括 Paper、Note、Concept。
- 点击节点可以打开对应 Markdown。
- 图谱数据必须能从本地 Markdown 重建。

### 4.2 P1 暂缓

- Zotero 全量替代能力。
- 云同步、多人协作、权限管理。
- 浏览器插件。
- 移动端和平板端。
- 通用 DOI、任意网页、任意 PDF 链接入库。
- 完整 PDF 高亮批注同步。
- 高级 BibTeX 清洗和引用格式管理。
- 多 Agent 可视化编排。

## 5. 文件结构与数据约定

### 5.1 Vault 结构

```text
motif-vault/
  AGENTS.md
  PAPERS.md
  papers/
    1706.03762/
      paper.md          # 可选：无 LaTeX source 或需要时生成
      NOTES.md
      source/           # 优先保留 .tex 等原始源文件
      assets/
  notes/
    *.md
  plans/
    *.md
```

### 5.2 核心文件

#### `PAPERS.md`

全局论文索引，也是 Agent 的第一层路由表。

推荐字段：

```md
| ID | Title | Authors | Year | Path | Tags | Summary |
| --- | --- | --- | --- | --- | --- | --- |
```

#### `NOTES.md`

单篇论文的结构化压缩笔记。

默认结构：

```md
# 解决了什么问题

# 方法是什么

# 效果怎么样
```

#### `paper.md`

面向 Agent 阅读的轻量正文，保留章节、公式、表格、引用等结构信息，降低 PDF 排版噪音。
当 `source/` 中已存在 LaTeX 源文件时，`paper.md` 为可选生成项，仅在 Agent 需要统一可读格式或源文件解析困难时按需创建。

#### `AGENTS.md`

Vault 内的 Agent 行为规范，至少包含：

- 笔记结构规范。
- 检索顺序。
- 引用路径要求。
- 生成内容的双链要求。

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
6. 系统创建 `papers/<arxiv-id>/`。
7. 系统获取 LaTeX source / HTML / PDF，source 文件保存到 `source/`。
8. 若无 LaTeX source 或需要可读结构化正文，系统生成 `paper.md`。
9. Agent 生成 `NOTES.md`。
10. 系统更新 `PAPERS.md`（事实来源），并同步更新本地 SQLite 索引（查询缓存）。
11. 用户进入 `NOTES.md` 审阅和修订。

### 6.3 基于本地库问答

1. 用户在 Agent 面板输入问题。
2. Agent 先读取 `PAPERS.md` 锁定候选论文。
3. Agent 读取相关 `NOTES.md`。
4. 仅当需要公式、实验细节或原文时读取 `paper.md/source`。
5. Agent 输出答案。
6. 答案末尾展示读取过的文件路径。

### 6.4 双链组织

1. 用户在笔记里输入 `[[Concept]]`。
2. 系统解析并展示可点击链接。
3. 如果目标不存在，用户可以创建新 note。
4. 反链面板展示所有引用当前 note 的文件。
5. 图谱自动更新节点和边。

## 7. 非功能要求

- 本地优先：没有网络时，用户仍然可以浏览、编辑、搜索已有 Vault。
- 可迁移：Vault 文件夹离开应用后，仍能被 Obsidian、VS Code、Cursor 或命令行直接读取。
- 可恢复：Agent 运行失败不能破坏已有文件；生成内容应尽量采用临时结果确认后写入。
- 可解释：入库和 Agent 问答需要展示关键步骤和失败原因。
- 可扩展：arXiv importer 是首个 importer，但接口需要允许后续扩展 PDF、HTML、DOI、Zotero/BibTeX。

## 8. 验收标准

- 创建新 Vault 后，目录结构符合 PRD 中的 Vault 结构。
- 输入 `1706.03762` 后，生成对应 `papers/1706.03762/paper.md` 和 `papers/1706.03762/NOTES.md`。
- 输入关键词或一段研究描述后，Agent 能检索并返回候选论文，用户确认后完成入库。
- 连续入库 3 篇 arXiv 论文后，`PAPERS.md` 至少包含 3 条索引。
- 编辑 `NOTES.md` 并保存后，文件系统中的 Markdown 内容同步更新。
- `[[双链]]` 能跳转；反链面板能显示引用来源。
- Agent 回答跨论文问题时，结果包含读取文件列表。
- 关闭应用后重新打开，最近 Vault、文件树、Markdown 内容可以恢复。
- 图谱展示至少 20 个节点时，点击节点能打开对应文件。

## 9. 风险与对策

- arXiv HTML/LaTeX 可用性不稳定：优先采用 HTML/LaTeX，失败时降级到 PDF 解析，并明确标记质量。
- Agent 生成质量不稳定：把 `AGENTS.md` 规范作为强约束，并让用户能编辑最终 Markdown。
- 范围膨胀成 Zotero 替代品：MVP 只验证 Agent-first 入库、笔记、问答、双链、图谱闭环。
- 图谱成为装饰功能：图谱必须从真实 Markdown 双链和论文索引生成，并支持打开文件。
- 私有数据库锁定用户数据：数据库只能做缓存，Markdown 文件是事实来源。

## 10. 相关文档

- Roadmap：`doc/ROADMAP.md`
- 主要想法来源：`docs/idea-2.md`
- 背景与产品叙事：`docs/idea-1.md`
- 演示材料：`docs/ppt/index.html`
