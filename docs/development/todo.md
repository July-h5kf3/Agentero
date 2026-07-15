# Motif TODO

## P0 — 近期闭环

1. **Create Vault 初始化** ✅
   - 创建标准目录：`papers/`、`notes/`、`plans/`、`.motif/`。
   - 生成 Vault 内 `AGENTS.md` 模板。
   - 初始化 `.motif/catalog.sqlite`（schema v1，`path` 主键）。
   - **不**默认生成 `PAPERS.md` / `library.bib`（导出能力另做）。
   - 初始化后打开 `AGENTS.md`。

2. **arXiv 精确入库**
   - 支持输入 arXiv ID / URL。
   - 拉取 metadata，写入 catalog `papers` 表。
   - 写入默认 `NOTES.md`、空 `highlights.md`。
   - 入库后自动打开 paper，并刷新 Backlinks/Graph。

3. **Agent 工作流入口**
   - 在 Agent 面板增加“Summarize paper / Ask library / Draft Related Work”。
   - workflow prompt 自动注入 Vault 内 `AGENTS.md`。
   - 输出必须包含 Sources；写入前先进入草稿确认。

4. **文件与索引同步**
   - 将最近 Vault、UI 偏好迁到 Tauri Store。
   - 增加文件监听，外部编辑器修改后自动刷新当前文件与 wiki 索引。
   - 保存失败、外部冲突和未保存状态要有明确提示。

## P1 — 中期增强

1. **Catalog 导出与检索**
   - `catalog:export_papers_md` / `catalog:export_bibtex`。
   - 可选 FTS5；Agent 工作流临时导出 L1 列表。

2. **本地 PDF importer**
   - 文件选择 / 拖拽 / 批量导入。
   - DOI / arXiv ID 识别，元数据确认面板。
   - 生成 citekey、`PAPER.md`、`NOTES.md`；metadata 写入 catalog。
   - 默认本地解析，MinerU BYOK 后可选云端解析。

3. **双链与图谱增强**
   - 源码编辑 `[[` 补全。
   - Plate 内联 wikilink 节点，序列化仍保持 `[[...]]`。
   - Graph 增加全屏/聚焦模式、邻居高亮、节点搜索。
   - 双链边可写入 catalog 可重建表并支持增量重建。

4. **Release 完善**
   - tag 构建已完成；后续补签名、公证、自动 changelog。
   - 同步 `package.json`、`src-tauri/tauri.conf.json` 和 tag 版本号。
   - Release artifact 命名规范化，区分 macOS arch / Windows / Linux。

## P2 — 长期方向

1. **Zotero/BibTeX 迁移工具**
   - 解析 Zotero export 或 BibTeX。
   - 由 Agent 辅助重组为 Motif vault。
   - 保留原始附件与引用 key 映射。

2. **用户友好的 Skills / Workflows**
   - 粗读论文。
   - 多篇对比。
   - Related Work 草稿。
   - Idea 批判性评估。
   - 实验复现清单。

3. **PDF / HTML 标注系统**
   - 参考 Hypothesis 风格的边注、评论、锚点。
   - 标注正文进入 `highlights.md`，坐标/锚点缓存可重建。
   - PDF.js / HTML iframe 都需要统一标注模型。

4. **更大范围导入**
   - DOI / 网页 importer。
   - 浏览器插件一键收集。
   - 远程 PDF 链接入库。

5. **多端与协作**
   - iPadOS 触控布局。
   - Git 版本管理集成。
   - 可选云同步与多设备阅读。
