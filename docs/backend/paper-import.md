# 论文入库

多入口共享落盘内核 **`paper_commit`**（`features/import/paper_import`）：分配路径、写 catalog、NOTES 壳、资源。

## 入口

| 入口 | 元数据来源 | Host / 流程 |
|---|---|---|
| 魔棒 | Translator HTTP + arXiv Atom fallback | `lookup_import_batch` |
| 本地 PDF | 用户确认 / 文件名启发式 | `paper_import_local_pdf` |
| Connector | 浏览器扩展 items JSON | `features/connector` → commit |
| Zotero 迁移 | `zotero.sqlite` + storage | `zotero_scan` / `zotero_migrate` |
| Library 导入 | Bib/RIS 等 | `paper_import` |
| CLI | 同库函数 | `agentero import` / `paper …` |

路径分配：`import::allocate_paper_path`（盘 + catalog 双查，撞名改写 id）。

## 魔棒（精确 ID/URL）

```text
粘贴 arXiv ID / DOI / URL
  → Translator（或 arXiv Atom fallback）
  → PaperMetadata → catalog upsert
  → papers/<id>/ + NOTES.md 壳（不覆盖已有 NOTES）
  → PDF → {paper}/{id}.pdf
  → arXiv e-print → 解压 LaTeX 到 source/
  → 无 TeX：liteparse → PAPER.md
  → 前端刷树 / openPaper
```

- 设置：`translatorBaseUrl`。
- 补资源：`paper_download_assets`（单篇 / Library 批量）。
- 错误：全局 Toast；重复不破坏用户 NOTES。

## 可读正文

| 情况 | 行为 |
|---|---|
| 有 TeX | 优先 TeX；不强制 `PAPER.md` |
| 无 TeX 有 PDF | 下载后 liteparse → `PAPER.md`；可 `paper_parse_body` |
| 质量字段 | catalog `body_source` / `body_quality`（实现以 schema 为准） |

`PAPER.md` 是派生文件，可删可重建；`source/` 与 PDF 才是归档事实来源。

## 本地 PDF

- 魔棒多选或拖到 `papers/` 组织夹 → metadata 确认 → 复制 PDF + catalog + 通常生成 `PAPER.md`。
- 窗口其它区域拖入不入库（防 WebView 导航）。

## Catalog 相关 command（摘要）

`paper_list` / `paper_get` / `paper_rescan` / `paper_set_tags` / `paper_set_is_read` / `paper_export` / `paper_import`  
详见 [catalog.md](catalog.md)、[api.md](api.md)。

## 规划中的增强（非现状）

- 关键词/描述 → Agent 候选确认后入库（路线图 0.3）。
- 可插拔 `PdfParser`（liteparse 默认 + 可选 MinerU BYOK）（路线图 0.4）。
- 统一 `afterPaperImport` / `paper:imported` 事件（路线图 0.3）。

## 代码

`src-tauri/src/features/import/`  
前端 UI：[../frontend/paper-import.md](../frontend/paper-import.md)
