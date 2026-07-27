# Catalog（`.agentero/catalog.sqlite`）

论文集合 + 结构化 metadata 的权威存储。笔记正文仍在文件。

## 与其它存储的边界

| 存储 | 内容 |
|---|---|
| Catalog | 论文行、tags、is_read、url、body 元数据等 |
| Vault 文件 | NOTES、PDF、TeX、marks、PAPER.md |
| 应用设置 | UI / Agent 注册表（**不**存论文 meta） |

根级 `PAPERS.md` / `library.bib` **默认不生成**；需要时 `paper_export` / 规划中的 `export_papers_md`。

## 要点

- 主键：论文 `path`（Vault 相对路径）
- 字段以 `features/catalog/schema.rs` 为准
- `tags_json`：字符串或 `{name,color}`（Apple 8 色）
- `paper_rescan`：盘上有、库内无则补齐
- 删除：回收站快照；恢复 upsert

## 命令（摘要）

| Command | 说明 |
|---|---|
| `paper_list` / `paper_get` | 读 |
| `paper_set_tags` / `paper_set_is_read` | 写 |
| `paper_rescan` | 盘 → 库 |
| `paper_export` / `paper_import` | Bib 等 |

CLI：`agentero paper …` / `paper tag *`。

入库如何写 catalog：[paper-import.md](paper-import.md)。  
代码：`src-tauri/src/features/catalog/`
