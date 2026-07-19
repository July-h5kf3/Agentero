# Paper 入库流水线（统一方案）

> 状态：**设计已落库，实现未统一**（各入口仍分叉编排；砖块已部分复用）  
> 目标：把「创建 paper 单元」收敛为 **Host 唯一落盘内核 + 前端唯一后置策略**；各入口只做元数据 / 来源适配。  
> 相关：[`identifier-lookup.md`](identifier-lookup.md)（魔棒）、[`connector.md`](connector.md)（浏览器插件）、[`catalog.md`](catalog.md)、[`data-model.md`](data-model.md)、[`api.md`](api.md)、[`../development/cli.md`](../development/cli.md)、[`../frontend/ui.md`](../frontend/ui.md)。

---

## 1. 问题陈述

Agentero 已有多条「把论文放进 Vault」的路径。落盘相关 **砖块** 多数已共用：

| 砖块 | 位置（概念） |
|------|----------------|
| Zotero 形 JSON → `PaperMeta` | `map_zotero_item` / `enrich_remote_urls` |
| NOTES 壳 + 时间戳 | `write_paper_shell` / `write_paper_shell_opts` |
| catalog 行 | `paper_record_from_meta` + `papers::upsert_paper` |
| 远程 PDF / arXiv TeX | `ensure_paper_assets` |
| 无 TeX → 可读正文 | `maybe_generate_paper_md_after_download` |

但 **编排**（路径分配、去重、资源同步/异步、结果形状、UI 后置）在每条入口各自实现，导致：

- 去重语义不一致（有的按 catalog id，有的按目录是否存在，有的几乎不去重）
- 路径碰撞策略重复实现（`unique_paper_path` 不止一处）
- 资源时序不同（同步 await vs Connector 后台 spawn）
- 前端是否 `openPaper`、是否 auto paper-reader、是否 rebuild wiki 各写一套
- 结果类型分裂（`LookupImportResult` / `ConnectorImportResult` / `PaperImportResult` / migrate outcome…）

本文档先固定 **现状盘点** 与 **目标架构**，实现按 §7 分期推进。

---

## 2. 现状：入口总表

### 2.1 创建新 paper（真正入库）

| # | 入口 | 用户从哪进 | Host 主路径 | 元数据来源 | 资源策略 | 前端完成后 |
|---|------|------------|-------------|------------|----------|------------|
| 1 | **魔棒** | 侧栏 / `⇧⌘I` | `lookup_import` → `import_by_identifier` | Translator（标识符/URL）+ arXiv 回退 | **同步** `ensure_paper_assets` + liteparse | 刷树 / Library / wiki → **`openPaper`** → 可选 **auto paper-reader** |
| 2 | **Zotero Connector** | 官方浏览器扩展 | HTTP `saveItems` → `import_connector_item` | 插件 Translator JSON → `map_zotero_item` | **异步** 后台下载（躲 ~15s 超时）；`saveAttachment` 再写 PDF | `connector:item-saved` → 刷树/Library → **`openPaper`** + toast；**无** auto reader |
| 3 | **本地 PDF** | 魔棒弹层 / Library 导入 / **拖到 papers/ 组织夹** | `paper_import_local_pdf` → `import_local_pdfs`（`entries` 可带 title/authors/year/id） | 默认文件名 stem；拖入弹窗可确认/改 meta | **复制** `{id}.pdf` + liteparse | 刷树/wiki/Library → **只 open 第一篇**；**无** auto reader；非 PDF / 非 papers 落点：仅 `preventDefault` 不导航 |
| 4 | **Bib/RIS 等文献库** | Library 导入 | `paper_import` → `import_catalog` | Translator `/import` 批量 | **同步** 每篇 `ensure_paper_assets` | 刷树/Library；错误 toast；**不 open**、**无** reader |
| 5 | **Zotero 桌面迁移** | 欢迎页 / 侧栏对话框 | `migrate_zotero` | `zotero.sqlite` → `map_zotero_item` | 可选 **拷贝 storage PDF** | 对话框进度 + 刷新；**不逐篇 open** |
| 6 | **CLI** | `agentero import id` / `import bib` | 直接调 1 / 4 | 同 1 / 4 | 同 1 / 4 | 无 UI |

### 2.2 非新建、但同属「paper 资源生命周期」

| # | 入口 | Host | 作用 |
|---|------|------|------|
| 7 | 文件树 / Library **Download** | `paper_download_assets` | 已有 paper 补 PDF / TeX / `PAPER.md`；前端可 auto reader |
| 8 | Library **Rescan** | `paper_rescan` → `rebuild_from_disk` | 盘上有、catalog 无 → 补 catalog，**不新建文件夹** |
| 9 | Connector **`saveAttachment`** | `write_attachment_pdf` | 往已有 paper 写 PDF，再 emit `item-saved` |

Rescan / Download / saveAttachment **不必**全部塞进「新建 commit」，但结果字段与 UI 刷新策略应与入库管线 **对齐**（见 §5.3、§6）。

### 2.3 当前数据流（分叉）

```text
标识符 ─► Translator     插件 JSON     Bib/RIS     本地 PDF    Zotero DB
                    └──────────────┬────────────────────────┘
                                   ▼
                         PaperMeta（多数经 map_zotero_item）
                                   ▼
┌─ 路径 / 去重（各写一套）──────────────────────────────────┐
│ 魔棒：parent/id，目录已存在仍 create + upsert（弱去重）     │
│ Connector：catalog id 去重；独立 unique_paper_path         │
│ Bib：NOTES 或 catalog path 存在则 skip                     │
│ 本地 PDF：unique_paper_path（-2/-3）                        │
│ Zotero 迁移：Dedup + free_path + 笔记回填                  │
└───────────────────────────────────────────────────────────┘
                                   ▼
                    write_paper_shell + upsert_paper
                                   ▼
┌─ 资源策略（各写一套）────────────────────────────────────┐
│ 同步 await（魔棒 / Bib） / spawn 后台（Connector）         │
│ 本地 copy / Zotero storage copy / liteparse 路径不一       │
└───────────────────────────────────────────────────────────┘
                                   ▼
┌─ 前端后置（各写一套）────────────────────────────────────┐
│ openPaper?  autoReader?  wiki rebuild?  toast?             │
└───────────────────────────────────────────────────────────┘
```

### 2.4 关键分叉（维护成本）

| 点 | 现状 |
|----|------|
| 去重 | Connector：`ByCatalogId`；Bib：路径/NOTES；魔棒：几乎不挡；迁移：独立 Dedup |
| 路径碰撞 | `unique_paper_path` 在 lookup 与 connector **重复实现** |
| 资源时序 | 魔棒等 PDF 再返回；Connector 先 HTTP 201 再后台下 |
| 开 tab | 魔棒 / 本地 PDF / Connector 开；Bib 批量 / 迁移 不开 |
| auto paper-reader | 仅魔棒 + 单篇 Download |
| wiki 重建 | 魔棒 / 本地 PDF 常做；Connector / Bib 不一定 |
| 结果类型 | 多种 struct，前端难共用 |
| 事件 | 仅 Connector 发 `connector:item-saved`；其它靠 invoke 返回值 |

---

## 3. 目标架构

### 3.1 原则

1. **一条落盘权威路径**：任意入口只负责产出草稿（meta + 资源意图）；落盘 / 去重 / 资源 / 统一结果只走 `paper_commit`。
2. **入口变薄**：魔棒 / Connector / Bib / 本地 PDF / 迁移 / CLI = **Source adapter**。
3. **UI 后置统一**：刷新、开 tab、toast、auto-reader 用 **策略表**，禁止每个 `App.tsx` handler 复制粘贴。
4. **不牺牲 Connector 约束**：~15s 超时 → 「先壳后资源」是 **assets 策略**，不是分叉整条管线。
5. **local-first 不变**：Vault 文件 + catalog 仍是事实来源；不引入私有图数据库式入库状态。

### 3.2 总览图

```text
┌──────────── UI / CLI / HTTP Connector ────────────┐
│  魔棒  Connector  本地PDF  Bib  迁移  CLI  Rescan* │
└───────────────┬───────────────────────────────────┘
                │  Source adapter → PaperDraft
                ▼
┌──────────── paper_commit（Host 唯一落盘）─────────┐
│  dedupe → path → shell → catalog → assets/parse   │
│  → PaperCommitResult（+ 可选 paper:imported 事件） │
└───────────────┬───────────────────────────────────┘
                ▼
┌──────────── afterPaperImport（前端唯一后置）──────┐
│  policy: refresh / open / toast / autoReader        │
└───────────────────────────────────────────────────┘

* Rescan 是 catalog 修复，不进 commit；可共用 refresh 策略。
Download / saveAttachment → paper_attach_assets（结果字段对齐 commit）。
```

---

## 4. Host：`paper_commit`

建议模块：`src-tauri/src/services/lookup/commit.rs`（或新建 `services/paper_import/`，初期放 lookup 旁即可，避免过早拆 crate）。

### 4.1 输入：`PaperDraft` + `PaperCommitOptions`

**`PaperDraft`（概念）**

| 字段 | 说明 |
|------|------|
| `meta: PaperMeta` | 已 map / 已 enrich 的元数据 |
| `source` | 枚举：`MagicWand` / `Connector` / `LocalPdf` / `Bib` / `ZoteroMigrate` / `Cli` / … |
| `extra_notes_blocks?` | 迁移用笔记 / 批注追加块 |

**`PaperCommitOptions`（概念）**

| 字段 | 类型（概念） | 说明 |
|------|----------------|------|
| `vault` | `Path` | Vault 根 |
| `parent_dir` | vault 相对 | 经 `normalize_parent_dir` |
| `dedupe` | 见 §4.2 | 去重策略 |
| `path_policy` | `PreferId` \| `UniqueSuffix` | 目录名策略 |
| `assets` | 见 §4.3 | 资源策略 |
| `shell.abstract_mt` | `bool` | Connector 默认 `false`（超时） |
| `emit_event` | `bool` | 是否发统一 `paper:imported` |

`meta.meta_source` 由 adapter 写入（如 `zotero-connector`、`lookup`、`local-pdf`）。

### 4.2 去重策略 `dedupe`

| 策略 | 行为 | 建议用于 |
|------|------|----------|
| `ByCatalogId` | catalog 已有同 `id` → `status: deduped`，返回已有 path，**不覆盖** NOTES | Connector、魔棒（目标默认）、CLI id |
| `ByPathOrNotes` | `{parent}/{id}` 已是 paper 或 catalog 有该 path → `skipped` | Bib 批量（兼容现状） |
| `None` | 不去重（慎用） | 调试 |

**产品默认建议**：单篇入口统一 **`ByCatalogId`**；重复时前端 toast「已在库中」并 `openPaper` 已有路径，而不是再写一份。

迁移的 Dedup（doi/isbn/多键）可作为 `ByCatalogId` 的扩展或 `ZoteroMigrate` 专用 pre-check，在 adapter 层解析出 canonical id 后再 commit。

### 4.3 资源策略 `assets`

| 策略 | 行为 | 用于 |
|------|------|------|
| `SyncDownload` | await `ensure_paper_assets` + liteparse；结果里 `pdf/tex/paperMd` 可信 | 魔棒、Bib、CLI |
| `AsyncDownload` | 落盘后 `spawn` 下载；结果 `assetsPending: true` | Connector `saveItems` |
| `CopyPdf { path }` | 复制本地 PDF 到 `{id}.pdf` + liteparse | 本地 PDF、Zotero storage |
| `None` | 只写壳 + catalog | 仅元数据、或附件稍后到 |

`saveAttachment` / `paper_download_assets` 走 **`paper_attach_assets`**（对已有 path），返回与 commit 相同的 assets 字段子集。

### 4.4 固定步骤（只实现一次）

1. `normalize_parent_dir`
2. 校验 `meta.id` 非空
3. 按 `dedupe` 早退 → `deduped` / `skipped`
4. 按 `path_policy` 分配 `path_rel`（**合并**现有两份 `unique_paper_path`）
5. `create_dir_all` + `write_paper_shell_opts` + 可选 `extra_notes_blocks`
6. `paper_record_from_meta` + `upsert_paper`
7. 按 `assets` 执行下载/复制/parse
8. 组装 `PaperCommitResult`；可选 `app.emit("paper:imported", …)`

### 4.5 输出：`PaperCommitResult`

所有入口（含 CLI JSON）对齐同一形状（camelCase 与现有前端一致）：

```text
{
  status: "created" | "deduped" | "skipped",
  path: string,          // vault 相对
  id: string,
  title: string,
  paperDir: string,      // 绝对路径
  pdf: bool,
  tex: bool,
  paperMd: bool,
  assetMessages: string[],
  assetsPending?: bool,  // AsyncDownload
  source?: string        // 便于 UI / 日志
}
```

批量入口返回：

```text
{ items: PaperCommitResult[], errors: string[] }
```

### 4.6 统一事件（可选，P1+）

| 事件 | payload | 说明 |
|------|---------|------|
| `paper:imported` | `PaperCommitResult` | 任意 commit 成功发出；多窗口刷新幂等 |
| `connector:item-saved` | 保持现有字段 | 由 Connector 适配层从 `PaperCommitResult` 映射，**不删**，避免破坏现有监听 |

`assetsPending` 完成后可再发一次 `paper:imported`（`status: created` 且 `assetsPending: false`）或单独 `paper:assets-ready`，供 auto-reader 使用（产品二选一，见 §6.2）。

### 4.7 Source adapter 职责边界

| 入口 | Adapter 只做 | 调用 commit |
|------|--------------|-------------|
| 魔棒 | 解析标识符 → Translator → meta | `SyncDownload` + `ByCatalogId` |
| Connector | JSON → map；关 abstract MT；session 映射 | `AsyncDownload` + `ByCatalogId` |
| Bib | Translator `/import` → items[] | 循环 `SyncDownload` + `ByPathOrNotes`（或统一到 ByCatalogId） |
| 本地 PDF | stem → meta + 源文件 path | `CopyPdf` + `UniqueSuffix` |
| Zotero 迁移 | sqlite 读 + collection path + storage PDF | `CopyPdf` / `None` + notes blocks |
| CLI | 参数组装 | 与桌面同策略 |

**不进 commit 的逻辑**仍留在 adapter：HTTP 响应码、session progress、插件 targets 列表、迁移进度事件等。

---

## 5. 前端：`afterPaperImport`

### 5.1 策略表

```ts
// 概念：src/lib/paper-import.ts（或同类）
type AfterImportPolicy = {
  refreshTree: boolean;
  refreshLibrary: boolean;
  rebuildWiki: boolean;
  open: "none" | "first" | "each";
  toast: "none" | "success" | "batch-summary" | "deduped";
  autoReader: "never" | "if-assets-ready" | "when-assets-arrive";
};

const AFTER_IMPORT = {
  magicWand: {
    refreshTree: true, refreshLibrary: true, rebuildWiki: true,
    open: "each", toast: "success", autoReader: "if-assets-ready",
  },
  connector: {
    refreshTree: true, refreshLibrary: true, rebuildWiki: true,
    open: "each", toast: "success", autoReader: "never", // 或 when-assets-arrive，见 §6.2
  },
  localPdf: {
    refreshTree: true, refreshLibrary: true, rebuildWiki: true,
    open: "first", toast: "batch-summary", autoReader: "if-assets-ready",
  },
  libraryBib: {
    refreshTree: true, refreshLibrary: true, rebuildWiki: true,
    open: "none", toast: "batch-summary", autoReader: "never",
  },
  zoteroMigrate: {
    refreshTree: true, refreshLibrary: true, rebuildWiki: true,
    open: "none", toast: "batch-summary", autoReader: "never",
  },
} as const;
```

### 5.2 调用约定

```text
const result = await host…()           // 返回 PaperCommitResult | 批量
await afterPaperImport(policy, result, { vaultRoot })
```

`afterPaperImport` 内部：

1. 按 policy 刷树 / Library / 防抖 wiki  
2. `open === "each" | "first"` → `openPaper(paperDir)`（deduped 也打开已有）  
3. toast（created / deduped / 批量摘要 / 错误）  
4. `autoReader` 且资源就绪 → `maybeAutoRunPaperReader`（fire-and-forget）

`App.tsx` 中魔棒 / Connector 监听 / 本地 PDF / Bib 应变薄；Connector 监听 = `afterPaperImport(AFTER_IMPORT.connector, payload)`。

### 5.3 Download / Rescan

| 操作 | 后置 |
|------|------|
| Download | 刷树/Library；`autoReader: if-assets-ready`（保持现状）；一般 **不** 强制 re-open tab |
| Rescan | 刷 Library（+ 可选树）；`open: none` |

可与 `afterPaperImport` 共用 refresh 助手，policy 名可分开（`afterAssetsDownload`）。

---

## 6. 产品默认行为（实现前需遵守的约定）

以下为设计默认值；改产品语义时先改本文再改代码。

1. **单篇入口**（魔棒 / Connector / 单文件 PDF）→ 始终 `openPaper`（含 deduped）。  
2. **批量**（Bib / 迁移 / 多 PDF）→ 默认不连开 N 个 tab；本地 PDF 多选可 `open: "first"`。  
3. **去重默认 `ByCatalogId`**（单篇）；不覆盖用户已有 `NOTES.md`。  
4. **auto paper-reader**：仅设置开启且资源就绪；**Connector 默认 `never`**（异步完成时若要开，需 `when-assets-arrive` + 二次事件，单独立项）。  
5. **wiki**：凡 `created` 批量结束后 **防抖重建一次**（不要每篇同步全量重建）。  
6. **错误**：单篇失败 → `notifyError`；批量部分失败 → `notifyWarning` 摘要 + 明细截断。

### 6.2 Connector 与 auto-reader

| 选项 | 说明 |
|------|------|
| **A（默认）** | Connector 不跑 auto-reader；用户手动 Zap |
| **B** | `AsyncDownload` 完成后 emit `paper:assets-ready` → 前端 `when-assets-arrive` |

MVP 统一管线时选 **A**，避免与后台任务条并发策略纠缠。

---

## 7. 实现分期

| 阶段 | 内容 | 完成标准 |
|------|------|----------|
| **P0** | 抽出 `paper_commit` + `PaperCommitResult`；魔棒 + Connector + 本地 PDF 迁入；合并 `unique_paper_path` | 三入口行为与现网等价或按 §6 改进；单测覆盖 dedupe / path / assets 分支 |
| **P1** | 前端 `afterPaperImport` + 策略表；Connector 监听与魔棒共用 | `App.tsx` 无大段重复后置逻辑 |
| **P2** | Bib `import_catalog`、CLI 走 commit | 批量结果形状统一 |
| **P3** | Zotero 迁移并入（notes 回填作 draft 扩展） | 迁移不再复制 shell/upsert 代码 |
| **P4** | 统一 `paper:imported`（保留 connector 事件映射）；文档收束；可选 `paper_attach_assets` 对齐 Download | api.md 事件表更新 |

**非目标（本方案不做）**

- 改 Translator 协议或替换 catalog 权威模型  
- 强制所有批量导入逐篇 open  
- 与 Zotero 桌面同时占用 23119  
- 把 Rescan 变成「重新下载全文」

---

## 8. 与现有文档 / 代码的映射

| 现状 | 统一后 |
|------|--------|
| `import_by_identifier` | adapter + `paper_commit(SyncDownload)` |
| `import_connector_item` | adapter + `paper_commit(AsyncDownload)` |
| `import_one_local_pdf` | adapter + `paper_commit(CopyPdf)` |
| `import_one_item`（Bib） | 循环 commit |
| `migrate_one` | adapter + commit（P3） |
| `connector:item-saved` 监听 | `afterPaperImport(connector)` |
| 魔棒 `handleLookupSubmit` 后置 | `afterPaperImport(magicWand)` |

代码锚点（迁移前参考）：

- Host：`src-tauri/src/services/lookup/mod.rs`、`connector/import.rs`、`lookup/zotero_io.rs`、`lookup/zotero_db.rs`
- 前端：`src/App.tsx`（lookup / connector / local pdf / library import）、`src/lib/lookup.ts`、`src/lib/papers-api.ts`、`src/lib/connector.ts`

---

## 9. 验收清单（管线统一后）

- [ ] 魔棒 / Connector / 本地 PDF / Bib / CLI 创建的 paper 目录结构一致（`NOTES` 壳、`{id}.pdf` 位置、catalog 字段）  
- [ ] 同一 arXiv/DOI 经魔棒与 Connector 入库时 **去重语义一致**（或仅策略表差异，有文档）  
- [ ] 单篇入库后左侧树 reveal + 中间 paper tab（policy 为 open 时）  
- [ ] Connector 在慢网下仍能在超时前返回 201，PDF 随后出现且 UI 可刷新/聚焦  
- [ ] 批量导入不炸开大量 tab、不并发炸 Agent reader  
- [ ] 文档：`api.md` 结果类型与事件与本文一致；identifier-lookup / connector 交叉链到本文  

---

## 10. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-19 | 初稿：现状盘点 + `paper_commit` / `afterPaperImport` 目标架构与分期 |
