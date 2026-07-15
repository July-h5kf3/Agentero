# Motif / notemd 数据模型

> 定义 Vault 的落盘结构、事实来源分层与核心数据类型。时间戳统一为 ISO 8601 字符串。  
> **论文集合与结构化元数据**见专题 [`catalog.md`](catalog.md)（`.motif/catalog.sqlite`）。

## 0. 设计原则

Motif 的存储遵循两条原则:

1. **人的知识与原始归档以文件为准；结构化论文目录以 Catalog SQLite 为准**:笔记、标注、源文件必须是普通文件，可被外部编辑器打开；论文集合与 metadata 进入 `.motif/catalog.sqlite`，支持查询与入库事务。这与 Zotero（几乎一切锁在单一 sqlite、笔记不可便携）不同：**笔记层仍是 Markdown**。
2. **渐进式披露(Progressive Disclosure)**:目录与 catalog 共同构成 Agent 接口。信息按"体量递增、成本递增"分层,Agent 按需逐层下钻,而不是一次性加载整篇论文。

### 0.1 渐进式披露分层

| 层 | 载体 | Agent / UI 何时用 | 体量 |
|---|---|---|---|
| L0 指令 | `AGENTS.md` | 会话开始,总是 | 极小 |
| L1 索引 | **Catalog**（`paper_list` / 可选导出的 `PAPERS.md`） | 需要"库里有什么" | 小(每篇一行) |
| L2 条目 | `{paper}/NOTES.md` | 锁定某篇之后 | 小 |
| L2.5 证据 | `{paper}/highlights.md` | 需要用户标注 / 精确引文 | 中 |
| L3 正文 | `{paper}/PAPER.md` | 需要公式 / 实验细节 / 原文 | 大 |
| L4 原始 | `{paper}/source/*` | 需追溯或重新解析 | 很大 |

其中 `{paper}` = paper 文件夹（`papers/` 下任意深度，见下）。

`AGENTS.md` 是渐进式披露的"总开关":它本身很短,只写清楚库怎么组织、L1 以 catalog 为准（根目录通常无 `PAPERS.md`）、按什么顺序读笔记与正文、引用要带本地路径、写入先走临时文件。

### 0.2 事实来源分层

| 层级 | 内容 | 落盘 |
|---|---|---|
| **Tier 1a 人的知识 + 原始归档** | `AGENTS.md`、`NOTES.md`、`highlights.md`、`notes/`、`plans/`、`source/` | 文件 |
| **Tier 1b 结构化论文目录** | 论文集合 + 每篇 metadata | **`.motif/catalog.sqlite`** |
| **Tier 2 可选导出 / 派生** | `PAPERS.md`、`library.bib`、`PAPER.md`、`assets/` | **按需**生成，非 Vault 必备 |
| **Tier 3 可重建缓存** | 双链边、标注坐标、全文 FTS 副本等 | 可与 catalog 同库分表；可整删后重建 |

- 删除 Tier 3:重扫 Markdown + 读 catalog 标题即可恢复图谱等。
- 删除 Tier 2:可从 catalog / source 再导出或再解析。
- **删除 `catalog.sqlite`**:结构化 meta 丢失（除非事先 export 备份）；`papers/<id>/` 目录仍在。
- Tier 1a 是不可再生的用户手写与归档,任何写入都要谨慎(先临时文件、确认后落盘)。

## 1. Vault 结构

```text
motif-vault/
├── AGENTS.md              # L0 Agent 行为规范与读取协议
├── papers/                # 文献区；可含组织子目录
│   ├── 1706.03762/        # paper 单元（一级）
│   │   ├── NOTES.md
│   │   ├── highlights.md
│   │   ├── PAPER.md       # 可选
│   │   ├── assets/
│   │   └── source/
│   └── nlp/               # 组织目录（非 paper）
│       └── transformers/
│           └── 1706.03762/  # paper 单元（嵌套，最小单元仍是该文件夹）
│               ├── NOTES.md
│               └── source/
├── notes/
├── plans/
└── .motif/
    ├── catalog.sqlite     # path = paper 文件夹相对路径
    └── config.json
```

> **默认不生成**：根级 `PAPERS.md`、`library.bib`、各篇 `metadata.json`。  
> 需要可读索引或 BibTeX 时，使用 `catalog:export_papers_md` / `catalog:export_bibtex`（见 [`catalog.md`](catalog.md) §5.4）。

> **Paper 文件夹**是最小单元：以标记文件/目录识别（`NOTES.md` / `highlights.md` / `source/` 等），可位于 `papers/` 下任意深度。  
> **Catalog `path`**（Vault 相对路径）标识位置；**`id`** 为逻辑 id（arXiv ID 或 citekey）。  
> 默认入库可仍写 `papers/<id>/`；用户也可整理到 `papers/<topic>/…/<id>/`。citekey 冲突时追加字母后缀。

## 2. 核心文件约定

### `AGENTS.md`(L0,事实来源)

Vault 内的 Agent 行为规范,至少包含:

- **读取协议**:L1 以应用 catalog 为准（无默认 `PAPERS.md`）；锁定篇目后按 `NOTES.md → highlights.md → PAPER.md → source/` 下钻。
- 笔记结构规范(三段论)。
- 引用路径要求:回答必须列出读取过的本地文件路径。
- 生成内容的双链要求:保留 `[[...]]` 格式。
- 写入规范:先写临时文件,用户确认后落盘;不得覆盖用户手写笔记。

### 论文集合与 metadata（Catalog，非 Markdown 文件）

权威存储：**`.motif/catalog.sqlite`** 的 `papers` 表。  
字段、schema、导出与实现见 **[`catalog.md`](catalog.md)**。  
UI 论文库（`paper_list`）/ Paper Info / 远程 PDF·HTML URL（`paper_get`）均读 catalog，不扫 `metadata.json`。

### 可选导出：`PAPERS.md` / `library.bib`

| 文件 | 含义 | 何时出现 |
|---|---|---|
| `PAPERS.md` | Markdown 表形态的论文索引（历史 L1 文件形态） | 仅用户或工作流**显式导出** |
| `library.bib` | BibTeX 汇总 | 仅**显式导出** |

二者**不是**手工 master，也**不是**入库写路径；改 meta 只写 SQLite。导出后若用户再入库，导出文件**不会**自动更新（避免假装它是权威源）。

### `NOTES.md`(L2,事实来源)

单篇论文的结构化压缩笔记,纯粹是人的知识/综合产物,不掺元数据 frontmatter。

默认结构:

```md
# 解决了什么问题

# 方法是什么

# 效果怎么样
```

### `highlights.md`(L2.5,事实来源)

单篇论文的标注层,与 `NOTES.md` **分开存放**:笔记是"熟的"综合知识,标注是"生的"原始证据(锚定原文位置的引文 + 想法),数量多、带定位。

- **引文 + 想法**留在 `highlights.md`,是事实来源,保持便携 Markdown。
- **页码 / bbox 等渲染坐标是纯 UI 数据**,可缓存于 `.motif/`（catalog 同库缓存表或旁路文件）,按标注 id 关联;丢失后可用引文全文检索重新锚定。
- 用 Obsidian 块引用 `^id`,让 `NOTES.md` 能精确引用某条标注:`[[papers/1706.03762/highlights#^h12]]`。

格式示例:

```md
### ^h12 · p.3 §3.2
> "The Transformer ... dispensing with recurrence entirely."
想法:核心卖点是彻底抛弃 recurrence。→ [[Self-Attention]]
```

### `PAPER.md`(L3,派生)

位于 paper 文件夹根部的 `PAPER.md`(不在 `source/` 内)。面向 Agent 阅读的统一可读正文。**仍是文件，不进 catalog 正文列。**

| 来源情况 | `source/` 放什么 | `PAPER.md` |
|---|---|---|
| arxiv 有 LaTeX | **默认下载**：`{id}.pdf` + e-print 解包的 `.tex` 工程 | **按需**生成(Agent 可直接读 `.tex`) |
| 非 arxiv（有 `pdf_url`） | **默认下载** PDF | 解析成 Markdown(必生成，后续 importer) |
| 扫描件 | 原始 PDF + `ocr/` 中间产物 | OCR → Markdown(必生成,并标注质量) |

**入库下载**（`lookup_import` / `paper_download_assets`，见 [`identifier-lookup.md`](identifier-lookup.md) §1.3）：

- PDF → `{paper}/source/{id}.pdf`
- arXiv LaTeX → `https://arxiv.org/e-print/{id}` → 解压进 `source/`（拒绝路径穿越）
- 文件树：paper 行缺 PDF，或 arXiv 可取 TeX 但本地无 TeX 时，显示 Download 补下

正文来源与质量记录在 **catalog** 的 `body_source` / `body_quality` 字段。`PAPER.md` 可删可重建,`source/` 中的原始文件才是归档事实来源。中间栏 PDF/HTML **预览**仍可走 catalog 远程 URL。

## 3. 数据类型

### 3.1 Vault

```ts
interface VaultInfo {
  id: string;
  name: string;
  root_path: string;
}
```

### 3.2 文件树

```ts
interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}
```

### 3.3 论文元数据 (Catalog `papers` 行)

与 `.motif/catalog.sqlite` 中一行对应,是单篇论文结构化元数据的事实来源（不再默认落盘 `metadata.json`）。

```ts
interface PaperMetadata {
  path: string;               // paper 文件夹 Vault 相对路径（主键语义）
  id: string;                 // 逻辑 id：arXiv ID 或 citekey
  type: 'arxiv' | 'pdf' | 'html' | 'doi' | 'other';
  title: string;
  authors: string[];          // 展示用
  /** 完整 creators（Translator 映射，含 creatorType） */
  creators?: { firstName?: string; lastName?: string; name?: string; creatorType?: string }[];
  year?: number;
  /** 原始日期串（Translator `date`） */
  date?: string;
  abstract?: string;
  tags: string[];

  // 标识符
  arxiv_id?: string;
  doi?: string;
  isbn?: string;
  issn?: string;
  pmid?: string;

  // 出版信息（Translator 期刊/图书字段并入）
  publication?: string;       // publicationTitle / proceedingsTitle / bookTitle
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  place?: string;
  series?: string;
  language?: string;

  // 来源链接（UI 阅读器 PDF/HTML 模式以此为准；只存 URL，不落盘）
  /**
   * 远程 PDF URL（UI 仅流式预览，不落盘）。
   * 推荐 arXiv: `https://arxiv.org/pdf/{arxiv_id}`；缺省且有 arxiv_id 时自动推导。
   */
  pdf_url?: string;
  /**
   * 远程 HTML URL（iframe 预览，不落盘）。
   * 推荐 arXiv: `https://arxiv.org/html/{arxiv_id}`；缺省且有 arxiv_id 时自动推导。
   */
  html_url?: string;
  /** 摘要页 / 条目页，如 arXiv abs、doi.org */
  source_url?: string;

  // 正文来源与质量（本地 PDF 解析时用；魔棒通常不填）
  body_source?: 'latex' | 'html' | 'pdf' | 'ocr';
  body_quality?: 'high' | 'medium' | 'low';

  // 引用与溯源
  bibtex_key?: string;
  citation_count?: number;
  /** Translator itemType，如 journalArticle / preprint / book */
  zotero_item_type?: string;
  /** libraryCatalog，如 DOI.org (Crossref)、arXiv.org */
  meta_source?: string;
  /** Translator extra 残余 */
  extra?: string;

  /** 列表/导出用一行说明（可选） */
  summary?: string;

  // 状态与时间
  status: 'pending' | 'importing' | 'completed' | 'failed';
  added_at: string;   // ISO 8601
  updated_at: string; // ISO 8601
}
```

**元数据来源**（统一）:

- **魔棒 / 标识符入库**：Translator（含 arXiv、DOI、ISBN、PMID 等）→ **直接 map 进 `PaperMetadata`** → catalog；`pdf_url`/`html_url` 只存远程 URL。见 [`identifier-lookup.md`](identifier-lookup.md) §5。
- **本地 PDF**：提取 DOI/arXiv 后同样可走 Translator 补全，再经用户确认写 catalog。
- `type='pdf'` 时 `body_source` 为 `pdf` 或 `ocr`，`body_quality` 由解析后端决定。

### 3.4 论文运行时对象 (Paper)

Host 返回给前端的运行时对象 = catalog 行 + 解析出的 Vault 相对路径。

```ts
interface Paper extends PaperMetadata {
  vault_path: string;        // = path，paper 文件夹
  notes_path: string;        // {path}/NOTES.md
  highlights_path: string;   // {path}/highlights.md
  source_dir: string;        // {path}/source/
  paper_md_path?: string;    // {path}/PAPER.md
  pdf_path?: string;         // {path}/source/original.pdf
  assets_dir?: string;       // {path}/assets/
}
```

### 3.5 标注 (Highlight)

`highlights.md` 中每条标注的逻辑结构。`quote` / `comment` / `links` 来自 Markdown(事实来源);`page` / `bbox` 是缓存于 `.motif/` 的渲染坐标,可由 `quote` 全文检索重建。

```ts
interface Highlight {
  id: string;          // 块引用 id,对应 highlights.md 中的 ^id(如 h12)
  paper_id: string;
  quote: string;       // 引文原文(事实来源)
  comment?: string;    // 想法 / 评论
  links: string[];     // 双链目标,如 ['Self-Attention']

  // 以下为渲染定位,缓存于 .motif,可重建
  page?: number;
  bbox?: [number, number, number, number];
}
```

## 4. Catalog 与缓存纪律

详见 [`catalog.md`](catalog.md)。摘要:

1. **Catalog（`papers` 表）是结构化目录的权威来源**，备份应包含 `.motif/catalog.sqlite`。
2. **入库与改 meta**：写 SQLite；文件系统负责对应 paper 文件夹下笔记与 source。
3. **导出** `PAPERS.md` / `library.bib` 为只读投影，默认不生成、不自动刷新。
4. **双链等 Tier 3**：可从 Markdown 重建；与 catalog 冲突时，**笔记文件赢**（链接文本）、**paper 标题以 catalog 为准**。
5. 历史 Vault 若仍有 `metadata.json`，打开时可导入 catalog（见 catalog 迁移节）。

## 5. Agent 运行时类型（应用配置，非 Vault 文件）

以下类型由 Host 配置与会话层持有，**不** 写入 Vault 目录；模型密钥不在此模型中出现。

```ts
/** 用户本机 ACP Agent 注册项（BYOA） */
interface AgentDescriptor {
  id: string;
  name: string;
  template: 'opencode' | 'gemini' | 'claude-acp' | 'codex-acp' | 'qodercli' | 'custom';
  command: string;
  args: string[];
  env?: Record<string, string>;
  available: boolean; // PATH / 绝对路径探测结果
  last_error?: string;
}

interface AgentSession {
  id: string;
  agent_id: string;
  vault_path: string;
  workflow: 'summary' | 'qa' | 'related_work' | 'free';
  created_at: string;
  status: 'idle' | 'running' | 'awaiting_permission' | 'closed' | 'failed';
}

interface AgentResult {
  session_id: string;
  message_id: string;
  content: string;
  sources: string[]; // Vault 相对路径
  draft_path?: string; // 待用户确认的临时草稿
}
```

## 6. 相关文档

- [`catalog.md`](catalog.md)：Catalog schema、导出、Host 实现。
- `docs/development/prd.md`:产品需求与验收标准(§5 文件结构)。
- `docs/development/technical-plan.md`:存储分层与入库/Agent 数据流；ACP Client + BYOA。
- `docs/backend/api.md`:Host 命令与数据模型引用。
- `docs/backend/wikilinks.md`:双链与图谱（paper 标题读 catalog）。
