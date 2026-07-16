# Motif TODO

可执行 backlog。版本级状态与验收以 [`roadmap.md`](roadmap.md) 为准；魔棒设计见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)。

## P0 — 近期闭环

1. **Create Vault 初始化** ✅
   - 创建标准目录：`papers/`、`notes/`、`plans/`、`.motif/`、`.agents/`、`.agents/skills/`。
   - 生成 Vault 内 `AGENTS.md` 模板；种子 `.agents/README.md`（`templates/vault/.agents/`）。
   - 初始化 `.motif/catalog.sqlite`（schema 当前版本，`path` 主键）。
   - **不**默认生成 `PAPERS.md` / `library.bib`（导出能力另做）。
   - 初始化后打开 `AGENTS.md`。

1b. **多窗口与欢迎页** ✅
   - `⌘N` / File → New Window → Host `window_new`（`?fresh=1`）。
   - 无 Vault 欢迎页：最近路径 MRU + 打开 / 创建（无常驻说明文案）。
   - 当前窗口 Vault 用 `sessionStorage`；最近列表 / 上次路径用 `localStorage`。

2. **精确标识符入库（arXiv / DOI 等）** ✅ 魔棒路径
   - [x] 支持输入 arXiv ID / URL 等（侧栏魔棒）。
   - [x] Translator → `PaperMetadata` → catalog `papers` 表。
   - [x] 写入默认 `NOTES.md`、空 `highlights.md`。
   - [x] **始终下载 PDF**；**arXiv 解压 e-print LaTeX** 到 `source/`。
   - [x] 入库后刷新文件树并打开 paper。
   - [x] 入库后刷新 Backlinks/Graph 索引。
   - [ ] 关键词/描述 Agent 候选列表确认。

2b. **魔棒 / Identifier Lookup（Translator）** ✅ v0
   - [x] UI：侧栏魔棒 → 粘贴链接或编号 → 加入 Papers。
   - [x] 目标：`papers/` 或文件树当前选中的 Papers 子文件夹。
   - [x] Host：`lookup_import` / `lookup_translator_config` / `paper_download_assets` / `paper_parse_body`。
   - [x] 设置：`translatorBaseUrl`（默认 `https://translator.philfan.cn`）；**无**「是否本地下载」开关。
   - [x] 文件树：paper 行缺 PDF，或既无 TeX 也无 `PAPER.md` → Download（hover 原因）。
   - [x] 无 TeX + 有 PDF：下载后 liteparse 生成 `PAPER.md`（Download 路径内）。
   - [x] 资源齐全且未读：文件树 Eye → paper-reader 精读 → `is_read`。
   - [x] Library 行：库内任一篇仍缺资源 → 批量 Download。
   - [x] 快捷键 `⇧⌘I`（打开魔棒）；本机 Translator sidecar 捆绑仍待。

2c. **论文库表格 UI** ✅
   - [x] 虚拟节点 `motif:library`；中间栏 catalog 表（`paper_list`）。
   - [x] 表头排序；横向/纵向滚动。
   - [x] 仅具体论文时显示 Paper Info / Notes（Library 隐藏）。
   - [x] Library 行批量补资源（与 2b 联动）。

2d. **文件树与侧栏 UX** ✅
   - [x] 在 Finder 中显示：双击 / 右键 / `⌥⌘R`（`revealItemInDir`）。
   - [x] 删除：右键 / `⌘⌫`；确认；`papers/` 下同步 `paper_delete`。
   - [x] 左右侧栏 collapsible 常驻 + `preserve-pixel-size`（交替 `⌥⌘S` / `⌘L` 不重叠）。
   - [x] 后台任务条（下载 / 入库 / 导入导出 / paper-reader；hover 实色不透明）。

2e. **PDF 阅读增强** 🟡
   - [x] 缩放：工具栏 +/- / 重置；`⌘/Ctrl`+滚轮（0.5×–3×，100%=适应栏宽）。
   - [x] 划词提问 MVP：M1–M4（见 3. PDF 划词提问）。
   - [ ] 本地 PDF 直接预览（非仅远程 `pdf_url`）。

3. **Agent 工作流入口**
   - [x] **paper-reader 精读**：文件树 Eye（资源齐全 + `is_read=false`）→ paper-reader skill（Codex `$` / Claude `/` / 其它注入）→ `NOTES.md` → `paper_set_is_read`；左下角任务进度。
   - [x] skill 运行时语法按 Agent 模板分流（Host `SkillMentionStyle`）。
   - [ ] 在 Agent 面板增加“Summarize paper / Ask library / Draft Related Work”。
   - [ ] workflow prompt 自动注入 Vault 内 `AGENTS.md`。
   - [ ] 输出必须包含 Sources；写入前先进入草稿确认。

4. **文件与索引同步**
   - 将最近 Vault、UI 偏好迁到 Tauri Store。
   - 增加文件监听，外部编辑器修改后自动刷新当前文件与 wiki 索引。
   - 保存失败、外部冲突和未保存状态要有明确提示。

## P1 — 中期增强

1. **Catalog 导出与检索**
   - [x] Library UI：Translator `/export` BibTeX + `/import` Bib/RIS（`paper_export` / `paper_import`）。
   - [ ] `catalog:export_papers_md`（Markdown 表）等其它形态。
   - [ ] 可选 FTS5；Agent 工作流临时导出 L1 列表。

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

1. **Zotero/BibTeX 迁移工具** 🟡
   - [x] 一键从本地 Zotero 迁移：直读 `zotero.sqlite` + `storage/` → catalog，可选拷本地 PDF（`zotero_scan` / `zotero_migrate`；见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md) §16）。
   - [ ] 解析 Zotero export / 独立 BibTeX 文件路径（Library 导入已覆盖 Bib/RIS 文本）。
   - [ ] 保留 Zotero 笔记 / 批注、collection 层级与引用 key 映射。

2. **用户友好的 Skills / Workflows**
   - [x] 精读论文（paper-reader：文件树 Eye + catalog `is_read`）。
   - [ ] 多篇对比。
   - [ ] Related Work 草稿。
   - [ ] Idea 批判性评估。
   - [ ] 实验复现清单。

3. **PDF 划词提问（Selection Ask）** — 设计见 [`pdf-ask.md`](pdf-ask.md)
   - [x] M1：划词弹出迷你问答卡。
   - [x] M2：`papers/<id>/asks/<threadId>.json` 读写 + 页边圆片锚点（归一化坐标）。
   - [x] M3：接入 ACP `agent_run_once` 流式多轮；结束会话落盘。
   - [x] M4：双击 / 悬停停留触发 + 防误触（阈值暂固定 700ms）。
   - [ ] M5（可选）：导出为 `highlights.md`；无文本层降级；本地 PDF TextLayer。

4. **PDF / HTML 标注系统**
   - 参考 Hypothesis 风格的边注、评论、锚点。
   - 标注正文进入 `highlights.md`，坐标/锚点缓存可重建。
   - PDF.js / HTML iframe 都需要统一标注模型。
   - 与划词提问（asks JSON）边界清晰，可互导。

5. **更大范围导入**
   - DOI / 网页 importer 深化（魔棒已部分覆盖 DOI）。
   - 浏览器插件一键收集。
   - 远程 PDF 链接入库。

6. **多端与协作**
   - iPadOS 触控布局。
   - Git 版本管理集成。
   - 可选云同步与多设备阅读。
