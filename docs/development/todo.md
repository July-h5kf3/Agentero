# Agentero TODO

可执行 backlog。版本级状态与验收以 [`roadmap.md`](roadmap.md) 为准；魔棒设计见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)。

## P0 — 近期闭环

1. **Create Vault 初始化** ✅
   - 创建标准目录：`papers/`、`notes/`、`plans/`、`.agentero/`、`.agents/`、`.agents/skills/`。
   - 生成 Vault 内 `AGENTS.md` 模板；种子 `.agents/README.md`（`templates/vault/.agents/`）。
   - 初始化 `.agentero/catalog.sqlite`（schema 当前版本，`path` 主键）。
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
   - [x] 精读：魔棒/单篇 Download 后自动 paper-reader；资源齐全且未读时 Eye 可手动 → `is_read`。
   - [x] Library 行：库内任一篇仍缺资源 → 批量 Download。
   - [x] 快捷键 `⇧⌘I`（打开魔棒）；本机 Translator sidecar 捆绑仍待。

2c. **论文库表格 UI** ✅
   - [x] 虚拟节点 `agentero:library`；中间栏 catalog 表（`paper_list`）。
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
   - [x] **paper-reader 精读**：入库/单篇 Download **自动** + 文件树 Eye 手动（资源齐全 + `is_read=false`）→ paper-reader skill（Codex `$` / Claude `/` / 其它注入）→ `NOTES.md` → `paper_set_is_read`；左下角任务进度（lookup/download → paperRead）。
   - [x] skill 运行时语法按 Agent 模板分流（Host `SkillMentionStyle`）。
   - [x] **全局权限模式**：设置 → Agent（`restricted` / `autoApprove`），替代 per-provider YOLO。
   - [ ] 在 Agent 面板增加“Summarize paper / Ask library / Draft Related Work”。
   - [ ] workflow prompt 自动注入 Vault 内 `AGENTS.md`。
   - [ ] 输出必须包含 Sources；写入前先进入草稿确认。
   - [ ] 权限「每次询问」档 + 逐项确认 UI。

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

4. **工作区标签页与分屏**（roadmap V0.6）
   - [ ] 中间栏文档 **标签栏**：paper / MD / PDF / HTML / Library 以 tab 打开，可关闭、切换、拖拽重排。
   - [ ] 每 tab 保留滚动位置、PDF 缩放、视图模式；未保存 MD 关闭前提示。
   - [ ] **分屏**：水平或垂直 2 格；每格独立内容（典型：PDF | NOTES，或两篇 paper 并排）。
   - [ ] 快捷键：新 tab / 关 tab / 切 tab / 分屏·取消分屏（键位写入 `docs/frontend/ui.md`）。
   - [ ] 文件树：当前 tab 打开 vs 新 tab 打开（设置可配默认）。
   - [ ] 与 `⌘N` 多窗口隔离：每窗口独立 tab 集；关窗/换 Vault 可恢复布局。
   - 说明：Agent 面板内的 **会话标签** 已存在，与本项「文档标签」分开。

5. **引用关系 / Connected Papers**（roadmap V0.7）
   - [ ] **文内引用 hover → 右侧 Paper Info**：PDF/HTML/`PAPER.md` 中识别 `[n]` / Author-year / DOI·arXiv 链接；hover 时侧栏展示目标论文 Info（库内 path / 远程缓存 metadata、入库或打开）。
   - [ ] **引用图数据**：cites / cited_by 可重建缓存（catalog 扩展表或 `.agentero/`）；外部 API 可插拔（Semantic Scholar / OpenAlex 等），失败可降级 TeX/参考文献解析。
   - [ ] **Connected Papers 式邻域 UI**：以当前 paper 为中心展示引用/被引列表 + 简易图；节点可打开 / 入库 / 进阅读队列。
   - [ ] 与 V0.4 **双链 Graph** 区分：双链 = `[[wikilinks]]`；本项 = bibliographic 引用边。

6. **Agent 引用与综述工作流**（衔接 V0.3 面板入口 + V0.7）
   - [ ] 面板 workflow：**Explore citations**（沿引用/被引解释相关性、建议精读顺序）。
   - [ ] 面板 workflow：**Map related work**（本地 NOTES + 引用图 → Related Work 骨架，含本地 path）。
   - [ ] 面板 workflow：**Ingest citation neighborhood**（确认后批量魔棒入库邻居）。
   - [ ] 与「Summarize / Ask library / Draft Related Work」共用 prompt 注入与草稿确认路径。

7. **Release 完善**
   - tag 构建已完成；后续补签名、公证、自动 changelog。
   - 同步 `package.json`、`src-tauri/tauri.conf.json` 和 tag 版本号。
   - Release artifact 命名规范化，区分 macOS arch / Windows / Linux。

## P2 — 长期方向

1. **Zotero/BibTeX 迁移工具**
   - 解析 Zotero export 或 BibTeX。
   - 由 Agent 辅助重组为 Agentero vault。
   - 保留原始附件与引用 key 映射。

2. **用户友好的 Skills / Workflows**
   - [x] 精读论文（paper-reader：文件树 Eye + catalog `is_read`）。
   - [ ] 多篇对比（可与分屏 + 引用邻域联动）。
   - [ ] Related Work 草稿（面板入口；与 V0.7 Map related work 可合并实现）。
   - [ ] Explore citations / Ingest neighborhood（见 P1-6；完成后勾到此处）。
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

6. **引用图增强**
   - prior / derivative 布局、相似度聚类、跨库联合图（更深 Connected Papers 体验）。
   - 作者、机构、会议关系图谱。

7. **工作区增强**
   - 超过 2 格的网格分屏；tab 固定（pin）、按 paper 分组。
   - 命名工作区会话（保存/恢复一整套 tab + 分屏布局）。

8. **多端与协作**
   - iPadOS 触控布局。
   - Git 版本管理集成。
   - 可选云同步与多设备阅读。

---

## 已完成能力速览（对照现状）

便于对照「还没做的新项」。细节与验收以 [`roadmap.md`](roadmap.md) 为准。

| 领域 | 已完成 | 未完成 / 进行中 |
|---|---|---|
| Vault / 工作台壳 | 打开·创建 Vault、catalog 初始化、多窗口 ⌘N、欢迎页 MRU、文件树新建/Finder/删除、左右侧栏 collapsible、后台任务条 | 最近 Vault 迁 Tauri Store；文件监听增量刷新 |
| 中间内容 | 单槽：Library 表 / PDF / HTML / Markdown WYSIWYG；Notes 仅具体论文时显示 | **文档标签页、分屏**（V0.6） |
| 入库 | 魔棒精确 ID/URL、Translator、默认 PDF+arXiv TeX、补下、无 TeX→PAPER.md、Library 导入导出 Bib | 关键词/Agent 候选；本地 PDF importer；部分非 arXiv PDF 下载 |
| Agent | BYOA ACP Client、Codex 原生 thread、Sources、**paper-reader**（自动+Eye）、**全局权限模式**、Skill 提及分流、会话标签（Agent 内） | 面板内置 workflow 入口、写入草稿确认、逐项权限 UI；**引用类 workflow**（V0.7） |
| 双链 / Graph | `[[wikilink]]` 跳转、反链、缺失创建、Backlinks 下 Graph | `[[` 补全、Plate 内联节点、Graph 全屏/邻居高亮 |
| 文献引用图 | — | **hover 引用→Info、Connected Papers 邻域、引用边缓存**（V0.7） |
| PDF | 缩放、划词提问 MVP（asks JSON） | 本地 PDF 直开、highlights 标注系统、M5 |
| 发布 | tag → 三平台草稿 Release | 签名/公证/changelog |
