# Motif / notemd 数据模型

> 定义 Vault 的落盘结构、事实来源分层与核心数据类型。时间戳统一为 ISO 8601 字符串。

## 0. 设计原则

Motif 的存储遵循两条原则:

1. **文件即事实来源,数据库只是缓存**:人的知识与原始归档以 Markdown / JSON / 源文件落盘;SQLite 等索引均可从文件重建、可随时删除。这是与 Zotero(事实锁在 `zotero.sqlite`)最大的区别。
2. **渐进式披露(Progressive Disclosure)**:目录结构本身就是 Agent 的接口。信息按"体量递增、成本递增"分层,Agent 按需逐层下钻,而不是一次性加载整篇论文。

### 0.1 渐进式披露分层

| 层 | 文件 | Agent 何时读 | 体量 |
|---|---|---|---|
| L0 指令 | `AGENTS.md` | 会话开始,总是 | 极小 |
| L1 索引 | `PAPERS.md` | 需要"库里有什么" | 小(每篇一行) |
| L2 条目 | `papers/<id>/NOTES.md` | 锁定某篇之后 | 小 |
| L2.5 证据 | `papers/<id>/highlights.md` | 需要用户标注 / 精确引文 | 中 |
| L3 正文 | `papers/<id>/PAPER.md` | 需要公式 / 实验细节 / 原文 | 大 |
| L4 原始 | `papers/<id>/source/*` | 需追溯或重新解析 | 很大 |

`AGENTS.md` 是渐进式披露的"总开关":它本身很短,只写清楚库怎么组织、按什么顺序读、引用要带本地路径、写入先走临时文件——相当于一张地图,而不是把内容全塞进去。

### 0.2 三级事实来源

| 层级 | 内容 | 文件 |
|---|---|---|
| **Tier 1 事实来源** | 人的知识 + 原始归档 + 结构化元数据 | `AGENTS.md`、`NOTES.md`、`highlights.md`、`metadata.json`、`notes/`、`plans/`、`source/` |
| **Tier 2 派生索引** | 可从 Tier 1 重建的可移植投影 | `PAPERS.md`、`library.bib`、`PAPER.md`、`assets/` |
| **Tier 3 缓存** | 应用私有、可整删重建 | `.motif/`(`cache.sqlite`、标注坐标、库级配置) |

- 删除 Tier 3:应用重扫 Vault 即可恢复。
- 删除 Tier 2:可从 Tier 1 重新生成。
- Tier 1 才是不可再生的用户资产,任何写入都要谨慎(先临时文件、确认后落盘)。

## 1. Vault 结构

```text
motif-vault/
├── AGENTS.md              # L0 Agent 行为规范与读取协议
├── PAPERS.md              # L1 全局论文索引(派生自各篇 metadata.json,可重建)
├── library.bib            # 派生 BibTeX 汇总(引用导出)
├── papers/                # 文献主体,每篇一个独立目录
│   └── 1706.03762/        # arxiv 用 arXiv ID;非 arxiv 用 citekey 如 vaswani2017attention
│       ├── metadata.json  # 该篇元数据的事实来源(机器写入,UI 编辑)
│       ├── NOTES.md       # L2 结构化笔记(纯人的知识)
│       ├── highlights.md  # L2.5 标注:引文 + 想法(便携 Markdown)
│       ├── PAPER.md       # L3 清洗后的统一可读正文(派生,可选)
│       ├── assets/        # PAPER.md / NOTES.md 引用的图片(派生自 source)
│       └── source/        # L4 原始归档(只增不改)
│           ├── original.pdf
│           ├── arxiv-src/ #   解包后的 LaTeX 工程:main.tex、sections/、figures/、refs.bib
│           ├── original.html
│           └── ocr/       #   OCR / 解析中间产物:page-*.json(含 bbox)、raw-text.txt
├── notes/                 # 自由概念笔记 / 作者 / idea(Markdown + 双链)
│   └── *.md
├── plans/                 # 研究计划、Related Work 草稿
│   └── *.md
└── .motif/                # Tier 3 缓存(进 .gitignore,可整删)
    ├── cache.sqlite       #   元数据 / 全文 / 双链图 / 标注坐标索引
    └── config.json        #   库级设置(非机密)
```

> ID 方案:arxiv 论文用标准 arXiv ID 作为目录名;非 arxiv 来源(如本地 PDF)用 citekey 作为目录名。citekey 由「第一作者姓氏 + 年份 + 标题首个实词」小写拼接生成(如 `vaswani2017attention`),冲突时追加字母后缀(`…a` / `…b`)。目录名即论文唯一标识。

## 2. 核心文件约定

### `AGENTS.md`(L0,事实来源)

Vault 内的 Agent 行为规范,至少包含:

- **读取协议**:按 `PAPERS.md → NOTES.md → highlights.md → PAPER.md → source/` 逐层下钻,仅在需要时进入下一层。
- 笔记结构规范(三段论)。
- 引用路径要求:回答必须列出读取过的本地文件路径。
- 生成内容的双链要求:保留 `[[...]]` 格式。
- 写入规范:先写临时文件,用户确认后落盘;不得覆盖用户手写笔记。

### `PAPERS.md`(L1,派生索引)

全局论文索引,是 Agent 的第一层路由表。**由各篇 `metadata.json` 汇总生成,可随时重建**,不是手工维护的 master。

推荐字段:

```md
| ID | Title | Authors | Year | Path | Tags | Summary |
| --- | --- | --- | --- | --- | --- | --- |
```

### `metadata.json`(每篇元数据的事实来源)

位于 `papers/<id>/metadata.json`,是这篇论文结构化元数据的唯一事实来源。与 `NOTES.md` 分离,避免机器字段与人的 prose 相互踩踏:用户编辑笔记不会碰坏元数据,importer 也能确定性地写入。`PAPERS.md`、`library.bib`、`cache.sqlite` 都是它的派生投影。字段见 [3.3](#33-论文元数据-metadatajson)。

### `NOTES.md`(L2,事实来源)

单篇论文的结构化压缩笔记,纯粹是人的知识/综合产物,不掺元数据 frontmatter。

默认结构:

```md
# 解决了什么问题

# 方法是什么

# 效果怎么样
```

### `highlights.md`(L2.5,事实来源)

单篇论文的标注层,与 `NOTES.md` **分开存放**:笔记是"熟的"综合知识,标注是"生的"原始证据(锚定原文位置的引文 + 想法),数量多、带定位。分层后 Agent 想看摘要时不会被一堆坐标噪音污染,而"用户划了哪几句"本身又是高价值的注意力信号。

- **引文 + 想法**留在 `highlights.md`,是事实来源(是人的知识),保持便携 Markdown。
- **页码 / bbox 等渲染坐标是纯 UI 数据,不是知识**,缓存于 `.motif/`,按标注 id 关联;丢失后可用引文全文检索重新锚定。
- 用 Obsidian 块引用 `^id`,让 `NOTES.md` 能精确引用某条标注:`[[papers/1706.03762/highlights#^h12]]`。

格式示例:

```md
### ^h12 · p.3 §3.2
> "The Transformer ... dispensing with recurrence entirely."
想法:核心卖点是彻底抛弃 recurrence。→ [[Self-Attention]]
```

### `PAPER.md`(L3,派生)

位于 `papers/<id>/PAPER.md`(注意:在论文目录根部,不在 `source/` 内,因为它是派生文件而 `source/` 是原始归档)。面向 Agent 阅读的统一可读正文,保留章节、公式、表格、引用等结构,降低 PDF 排版噪音。

`source/` 是**异构**的原始归档(tex / pdf / html),而 `PAPER.md` 给 Agent 提供一个**同构**的可读正文出口:

| 来源情况 | `source/` 放什么 | `PAPER.md` |
|---|---|---|
| arxiv 有 LaTeX | 解包的 `.tex` 工程 + PDF | **按需**生成(Agent 可直接读 `.tex`) |
| 非 arxiv 原生 PDF/HTML | 原始 PDF/HTML | 解析成 Markdown(必生成) |
| 扫描件 | 原始 PDF + `ocr/` 中间产物 | OCR → Markdown(必生成,并标注质量) |

正文来源与质量记录在 `metadata.json` 的 `body_source` / `body_quality` 字段,Agent 据此判断可信度。`PAPER.md` 可删可重建,`source/` 中的原始文件才是归档事实来源。

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

### 3.3 论文元数据 (metadata.json)

`papers/<id>/metadata.json` 的落盘结构,是单篇论文元数据的事实来源。

```ts
interface PaperMetadata {
  id: string;                 // arXiv ID 或 citekey,等于目录名
  type: 'arxiv' | 'pdf' | 'html' | 'doi' | 'other';
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  tags: string[];

  // 来源链接（UI 阅读器 PDF/HTML 模式以此为准）
  arxiv_id?: string;
  doi?: string;
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
  /** 摘要页等，如 `https://arxiv.org/abs/{arxiv_id}` */
  source_url?: string;

  // 正文来源与质量:渐进式披露与降级策略的决策依据
  body_source?: 'latex' | 'html' | 'pdf' | 'ocr';
  body_quality?: 'high' | 'medium' | 'low';

  // 引用
  bibtex_key?: string;
  citation_count?: number;

  // 状态与时间
  status: 'pending' | 'importing' | 'completed' | 'failed';
  added_at: string;   // ISO 8601
  updated_at: string; // ISO 8601
}
```

**元数据来源**:

- **arxiv**:由 arXiv API 提供权威字段(标题 / 作者 / 年份 / 摘要 / arxiv_id)。
- **pdf**:先从 PDF 提取 DOI / arXiv ID,命中则查询 Crossref / arXiv 获取权威字段;未命中或失败时由 Agent 从正文抽取候选,最终一律经用户在入库前确认面板校对后写入。
- `type='pdf'` 时 `body_source` 为 `pdf`(文本层)或 `ocr`(扫描件),`body_quality` 由解析后端与结果决定:MinerU → high,liteparse 文本 → medium,OCR → low。

### 3.4 论文运行时对象 (Paper)

Host 返回给前端的运行时对象 = `PaperMetadata` 反序列化后 + 解析出的 Vault 相对路径。始终存在的路径便于前端直接打开。

```ts
interface Paper extends PaperMetadata {
  vault_path: string;        // papers/<id>/                    始终存在
  metadata_path: string;     // papers/<id>/metadata.json       始终存在
  notes_path: string;        // papers/<id>/NOTES.md            始终存在
  highlights_path: string;   // papers/<id>/highlights.md       始终存在(可为空文件)
  source_dir: string;        // papers/<id>/source/             始终存在
  paper_md_path?: string;    // papers/<id>/PAPER.md            派生,可选
  pdf_path?: string;         // papers/<id>/source/original.pdf 未下载时 undefined
  assets_dir?: string;       // papers/<id>/assets/
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

## 4. 事实来源与缓存规则

`.motif/cache.sqlite` 存储元数据、全文检索、双链图与标注坐标的**派生副本**,用于文件系统做不快的查询(按作者/年份/标签过滤排序、全文检索、反链聚合、大规模)。它不是第二个事实来源,须遵守三条纪律:

1. **可整删重建**:删除 `cache.sqlite` 后,应用重扫 Vault(`metadata.json` + Markdown + 双链)即可完全恢复。
2. **写入 file-first**:先写 `metadata.json` / Markdown,再更新 SQLite 与 `PAPERS.md`;`notify` 监听外部编辑(如在 Obsidian 中修改)自动增量重建。
3. **冲突时文件赢**:SQLite 与文件不一致时以文件为准并触发重索引;Agent 可查 SQLite 加速路由,但最终引用与展示必须落回本地文件路径。

## 5. 相关文档

- `docs/PRD.md`:产品需求与验收标准(§5 文件结构)。
- `docs/TECH.md`:存储分层与入库/Agent 数据流(§4.5、§5)。
- `docs/API.md`:Host 命令与数据模型引用。
