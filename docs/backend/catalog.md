# 论文目录库（Catalog SQLite）

> 定义 Vault 内论文**集合索引**与**结构化元数据**的权威存储：`.motif/catalog.sqlite`。  
> `PAPERS.md` / `library.bib` **不再默认落盘**；需要时由导出命令生成。单篇正文仍是 `PAPER.md`（文件），不进库。

相关文档：[`data-model.md`](data-model.md)、[`api.md`](api.md)、[`../development/technical-plan.md`](../development/technical-plan.md)。

---

## 1. 设计目标

| 目标 | 说明 |
|---|---|
| 集合索引进库 | 「库里有哪些论文」以 SQLite 表为准，不再依赖根级 `PAPERS.md`。 |
| 元数据进库 | 单篇 title / authors / tags / URLs 等写入 catalog，不再默认写 `papers/<id>/metadata.json`。 |
| 人写内容仍文件 | `NOTES.md`、`highlights.md`、`source/`、可选 `PAPER.md` 保持 Markdown/二进制文件。 |
| 可导出、非默认 | 保留导出为 `PAPERS.md` / `library.bib` 的能力，供 Agent、引用管理器、分享使用；Create Vault **不**生成这两份文件。 |
| 与可扔缓存区分 | Catalog 是 Vault 资产（备份/同步应包含）；双链图等仍可另作可重建缓存（见 §6）。 |

---

## 2. 在三级事实来源中的位置

| 层级 | 内容 | 落盘 |
|---|---|---|
| **Tier 1a 人的知识 / 原始归档** | `AGENTS.md`、`NOTES.md`、`highlights.md`、`notes/`、`plans/`、`source/` | 文件 |
| **Tier 1b 结构化论文目录** | 论文集合 + 每篇 metadata | **`.motif/catalog.sqlite`** |
| **Tier 2 可选导出 / 派生** | `PAPERS.md`、`library.bib`、`PAPER.md`、`assets/` | 按需生成；非 Vault 必备 |
| **Tier 3 可重建缓存** | 双链边、标注坐标、全文 FTS 副本等 | 可与 catalog 同库分表，或后续独立；可整删后从文件+catalog 重建 |

原则：

1. **Catalog 不可当作「随手可删的 cache」**：删除 `catalog.sqlite` 会丢失标签、远程 URL、入库状态等元数据（除非事先 export / 备份）。
2. **笔记与 source 仍是可再生之外的用户资产**；catalog 损坏时，磁盘上的 paper 文件夹仍在，但 meta 字段不可从 NOTES 可靠还原。
3. **导出是单向投影**：`PAPERS.md` / `library.bib` 不是写回入口；改元数据只走 `paper:*` / 入库命令写 SQLite。

---

## 3. 文件位置与 Vault 校验

```text
motif-vault/
├── AGENTS.md
├── papers/               # 可含任意深度组织目录；paper 文件夹为最小单元
│   ├── 1706.03762/       # 一级：直接在 papers/ 下
│   └── nlp/
│       └── transformers/
│           └── 1706.03762/  # 嵌套：仍是一个 paper 单元（含 NOTES.md 等）
├── notes/
├── plans/
└── .motif/
    ├── catalog.sqlite    # 论文集合 + metadata（必备，Create/Open 时确保存在）
    └── config.json       # 库级设置（非机密，可选）
```

### Paper 文件夹（最小单元）

- **定义**：`papers/` 下任意深度的一个目录，其**直接子项**含 paper 标记之一：
  - 文件：`NOTES.md`、`highlights.md`、`PAPER.md`、`metadata.json`（过渡）
  - 目录：`source/`、`assets/`
- **不是 paper**：仅作分类的中间目录（如 `papers/nlp/`），无上述标记，文件树中可展开。
- **Catalog 主键**：Vault 相对路径 `path`（如 `papers/nlp/transformers/1706.03762`），不是「仅叶子目录名」。
- **逻辑 `id`**：arXiv ID / citekey，用于展示与去重；可与目录名相同，但**唯一标识落盘位置的是 `path`**。

**合法 Vault 最低条件**（打开目录 / `vault_create`）：

- 存在 `papers/`、`notes/`、`plans/`（目录可空）
- 存在 `AGENTS.md`（建议；缺失时可提示补模板）
- 存在或可初始化 `.motif/catalog.sqlite`（schema 版本匹配）

**不再要求**：根级 `PAPERS.md`、`library.bib`、各篇 `metadata.json`。

文件树 UI **忽略** `.motif/`（与现网一致），避免把 sqlite 当普通笔记展示。

---

## 4. Schema

### 4.1 版本

表 `schema_meta`：

| 列 | 类型 | 说明 |
|---|---|---|
| `key` | TEXT PRIMARY KEY | 如 `schema_version`、`motif_app` |
| `value` | TEXT NOT NULL | |

当前 **`schema_version = 1`**。打开 Vault 时：

1. 若文件不存在 → 创建并执行 migration v1。
2. 若 version &lt; 当前 → 顺序 migration。
3. 若 version &gt; 应用支持 → 报错，提示升级应用。

### 4.2 表 `papers`（集合 + 元数据）

一行一篇论文；**主键是 paper 文件夹的 Vault 相对路径**（支持 `papers/` 下任意深度嵌套）。

| 列 | 类型 | 说明 |
|---|---|---|
| `path` | TEXT PRIMARY KEY | paper 文件夹路径，如 `papers/1706.03762` 或 `papers/nlp/1706.03762` |
| `id` | TEXT NOT NULL | 逻辑 id（arXiv ID 或 citekey），用于展示/去重查询 |
| `type` | TEXT NOT NULL | `arxiv` \| `pdf` \| `html` \| `doi` \| `other` |
| `title` | TEXT NOT NULL | |
| `authors_json` | TEXT NOT NULL | JSON 数组 `string[]` |
| `year` | INTEGER | 可空 |
| `abstract` | TEXT | |
| `tags_json` | TEXT NOT NULL DEFAULT `'[]'` | JSON 数组 |
| `arxiv_id` | TEXT | |
| `doi` | TEXT | |
| `pdf_url` | TEXT | 远程预览 URL，不强制落盘 PDF |
| `html_url` | TEXT | |
| `source_url` | TEXT | 如 abs 页 |
| `body_source` | TEXT | `latex` \| `html` \| `pdf` \| `ocr` |
| `body_quality` | TEXT | `high` \| `medium` \| `low` |
| `bibtex_key` | TEXT | 导出 BibTeX 时的 key；默认可等于 `id` 规范化结果 |
| `citation_count` | INTEGER | |
| `status` | TEXT NOT NULL | `pending` \| `importing` \| `completed` \| `failed` |
| `summary` | TEXT | 短摘要/一行说明（可选，供列表与导出表） |
| `added_at` | TEXT NOT NULL | ISO 8601 |
| `updated_at` | TEXT NOT NULL | ISO 8601 |

索引建议：

- `idx_papers_id` ON `papers(id)`
- `idx_papers_year` ON `papers(year)`
- `idx_papers_type` ON `papers(type)`
- `idx_papers_status` ON `papers(status)`
- `idx_papers_arxiv` ON `papers(arxiv_id)` WHERE `arxiv_id` IS NOT NULL
- `idx_papers_doi` ON `papers(doi)` WHERE `doi` IS NOT NULL
- `idx_papers_bibtex` ON `papers(bibtex_key)` WHERE `bibtex_key` IS NOT NULL

可选后续（非 v1 必须）：

- `papers_fts`（FTS5：title / abstract / tags / authors）用于库内搜索。
- `wiki_edges` / `highlight_anchors` 作为 **Tier 3** 同库缓存表（见 §6）。

### 4.3 与 TypeScript 类型对齐

运行时 `PaperMetadata` 与表行一一对应（`authors` / `tags` 由 JSON 列反序列化）。  
`Paper` 仍附带 Vault 相对路径：

```ts
interface Paper extends PaperMetadata {
  path: string;             // = catalog path，paper 文件夹（可嵌套）
  vault_path: string;       // 同 path，或带尾 /
  notes_path: string;       // {path}/NOTES.md
  highlights_path: string;  // {path}/highlights.md
  source_dir: string;       // {path}/source/
  paper_md_path?: string;   // {path}/PAPER.md 若存在
}
```

---

## 5. 实现方式（Host）

### 5.1 模块划分

```text
src-tauri/src/
  services/catalog/
    mod.rs          # 打开/关闭连接、per-vault 连接池（当前 1 vault）
    schema.rs       # DDL + migrations
    papers.rs       # CRUD、列表过滤、按 id 查询
    export.rs       # → PAPERS.md / library.bib 字符串或写路径
  commands/
    catalog.rs      # 或并入 paper.rs：list / get / upsert / export
    vault.rs        # create/open 时 ensure_catalog
```

依赖：**`rusqlite`**（`bundled` feature，避免系统 sqlite 差异）。

### 5.2 连接与生命周期

| 时机 | 行为 |
|---|---|
| `vault_create`（已实现） | 建目录骨架 + `ensure_catalog(path)` 空库 |
| `vault:open`（规划） | `ensure_catalog` + migration；失败则 open 失败 |
| `vault:close`（规划） | 关闭连接，释放锁 |
| `window_new`（已实现） | 新 Webview 窗口（与 Vault 打开无关） |
| 入库完成 | 事务内 `INSERT OR REPLACE` papers 行 + 文件系统写 NOTES/source |
| UI 改标签/标题 | `paper:update` 只更新 SQLite（及 `updated_at`） |

路径：`{vault_root}/.motif/catalog.sqlite`。  
使用 `PRAGMA foreign_keys = ON`；写操作包在事务中，与「先落盘笔记再改 status」的顺序在 importer 中约定（建议：目录与 NOTES 成功后再把 `status` 置 `completed`）。

### 5.3 列表与查询（应用内 L1）

前端「论文库 / 筛选」**只读 catalog**，不扫盘拼表：

- `paper:list`：支持 year、tag、type、query（LIKE 或 FTS）
- `paper:get`：单篇 meta + 解析出的路径字段
- 文件树仍扫 `papers/` 目录；**标题展示**优先 `paper:get` / 批量 map，缺失则回退目录名

### 5.4 导出（保留能力，非默认文件）

| 命令（建议名） | 输出 |
|---|---|
| `catalog:export_papers_md` | Markdown 表（原 `PAPERS.md` 形态） |
| `catalog:export_bibtex` | BibTeX 文本（原 `library.bib` 形态） |

参数建议：

```ts
{
  vault_path: string;
  /** 若提供则写入该绝对或 Vault 相对路径；否则只返回 content 字符串 */
  dest_path?: string;
}
```

导出表头（`PAPERS.md` 形态）与历史一致，便于 Agent / 人工阅读：

```md
| ID | Title | Authors | Year | Path | Tags | Summary |
| --- | --- | --- | --- | --- | --- | --- |
```

- **Create Vault / 日常入库：不写这两份文件。**
- 用户在设置或命令面板触发「导出论文索引 / 导出 BibTeX」时生成。
- Agent 工作流若需要文件形态 L1：可在 prompt 前 **临时导出到** `.motif/export/PAPERS.md`（gitignore 友好）或会话临时目录，而不污染 Vault 根。

### 5.5 与 importer 的写路径

```text
import paper
  → 创建 paper 文件夹（默认 `papers/<id>/`，也可 `papers/<org>/…/<id>/`）
  → 事务写入 catalog.papers（path = 该文件夹相对路径）
  → 不更新根级 PAPERS.md / library.bib
  → 可选：emit 事件供 UI 刷新 paper:list
```

重复入库：`id` 冲突时按 `overwrite` 策略更新行或拒绝；**不得静默覆盖**用户 `NOTES.md`。

### 5.6 备份与 Git

| 路径 | 建议 |
|---|---|
| `.motif/catalog.sqlite` | **纳入备份**；若用 Git 管理 Vault，应提交或 LFS（团队自定） |
| `.motif/export/` | 可 gitignore；纯派生 |
| 根级 `PAPERS.md` / `library.bib` | 仅在用户显式导出后出现；可提交作可读快照 |

提供 `catalog:export_*` 后，用户可选择「只提交 Markdown 导出、不提交 sqlite」——但此时 **clone 后需 import 导出文件才能恢复 catalog**（v1 可不做 import-from-md；文档标明限制即可）。

---

## 6. 与双链缓存的关系

| 数据 | 权威来源 | 存储 |
|---|---|---|
| 论文 meta / 集合 | catalog | `.motif/catalog.sqlite` → `papers` |
| 双链边 / 反链 | Vault 内 Markdown `[[...]]` | 当前内存索引；可后续写入同库 `wiki_edges`（**可重建**） |
| Paper 节点 label | catalog.title | `graph_get_graph` 解析时 join / 查询 catalog |

删除「仅缓存表」不应删除 `papers` 表。Migration 时缓存表可 `DROP` 后全量重建；`papers` 不可。

详见 [`wikilinks.md`](wikilinks.md)。

---

## 7. 渐进式披露（Agent）调整

| 层 | 原 | 现 |
|---|---|---|
| L0 | `AGENTS.md` | 不变 |
| L1 | 读根级 `PAPERS.md` | **应用内**：catalog 查询；**Agent 文件路径**：`papers/*/NOTES.md` 目录扫描，或工作流注入的导出 `PAPERS.md` / 结构化列表 |
| L2+ | NOTES → highlights → PAPER.md → source | 不变 |

`AGENTS.md` 模板应写明：

- 库内论文目录以应用 catalog 为准；根目录通常**没有** `PAPERS.md`。
- 需要总览时可请用户导出，或只打开 `papers/<id>/NOTES.md`。
- 引用仍使用 Vault 相对路径（如 `papers/1706.03762/NOTES.md`）。

---

## 8. 迁移（旧 Vault）

若发现历史布局：

| 存在 | 动作 |
|---|---|
| `papers/*/metadata.json` 且 catalog 空 | Open 时 **一次性导入** JSON → `papers` 表，成功后可保留 JSON 不动或标注 deprecated（v1 建议保留不删，避免双写） |
| 根级 `PAPERS.md` / `library.bib` | 不删除；不再自动更新。用户可继续当只读快照，或手动删 |
| 仅有 `papers/<id>/` 无 meta | 插入 `id` + title=id 的占位行，`status=completed`，供列表可见 |

---

## 9. 验收要点

- [x] Create Vault 生成 `.motif/catalog.sqlite`（v1 schema），**不**生成 `PAPERS.md` / `library.bib`。
- [ ] 入库后 `paper:list` 可见新行；磁盘上无强制 `metadata.json`。
- [ ] `catalog:export_papers_md` / `catalog:export_bibtex` 能生成与历史格式兼容的文本。
- [ ] 删除导出文件不影响 catalog 与 UI 列表。
- [ ] 打开缺 catalog 的旧目录能 init 或从 `metadata.json` 迁移。

---

## 10. 相关文档

- [`data-model.md`](data-model.md) — Vault 分层与类型
- [`api.md`](api.md) — `vault:*` / `paper:*` / `catalog:export_*`
- [`../development/technical-plan.md`](../development/technical-plan.md) — 模块与依赖
- [`../development/roadmap.md`](../development/roadmap.md) — 版本交付
