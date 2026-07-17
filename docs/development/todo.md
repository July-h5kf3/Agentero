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
   - [x] 精读：魔棒/单篇 Download 后自动 paper-reader；资源齐全且未读时 Zap 可手动 → `is_read`。
   - [x] Library 行：库内任一篇仍缺资源 → 批量 Download。
   - [x] 快捷键 `⇧⌘I`（打开魔棒）；本机 Translator sidecar 捆绑仍待。

2c. **论文库表格 UI** ✅
   - [x] 虚拟节点 `agentero:library`；中间栏 catalog 表（`paper_list`）。
   - [x] 表头排序；横向/纵向滚动。
   - [x] 仅具体论文时显示 Paper Info / Notes（Library 隐藏）。
   - [x] Library 行批量补资源（与 2b 联动）。
   - [x] **Tags**：Paper Info 增删 → `paper_set_tags`；Library 列展示 + chip 筛选。
   - [x] **Tags CLI**：`paper set-tags` / `list --tag` / `tags`（与 Host 共用 `papers::set_tags`）。

2d. **文件树与侧栏 UX** ✅
   - [x] 在 Finder 中显示：右键 / `⌥⌘R`（`revealItemInDir`；无双击）。
   - [x] 在终端中打开：右键 / `⌥⌘T`（文件夹 = 自身；文件 = 父目录；Host `path_open_in_terminal`）。
   - [x] 删除：右键 / `⌘⌫`；确认；`papers/` 下同步 `paper_delete`。
   - [x] 左右侧栏 collapsible 常驻 + `preserve-pixel-size`（交替 `⌥⌘S` / `⌘L` 不重叠）。
   - [x] 后台任务条（下载 / 入库 / 导入导出 / paper-reader；hover 实色不透明）。

2e. **PDF 阅读增强** ✅
   - [x] 缩放：工具栏 +/- / 重置；`⌘/Ctrl`+滚轮（0.5×–3×，100%=适应栏宽）。
   - [x] 划词提问 MVP：M1–M4（见 3. PDF 划词提问）。
   - [x] 本地 PDF 直接预览（优先本地 → 无本地时 `paper_download_assets` → 失败再远程 `pdf_url`）。

2f. **Markdown 内嵌图片** ✅
   - [x] 粘贴 / 工具栏插入 → `{mdDir}/assets/` + `![](./assets/…)`（`src/lib/markdown-image.ts`）。
   - [x] 选中图片节点显示 Markdown 源码；未选中 `blob:` 预览。
   - [x] 删除节点且引用计数归零时 GC managed assets 文件并刷新文件树。
   - [x] 单测 + 文档（data-model / ui / technical-plan / test 冒烟表）。

3. **Agent 工作流入口**
   - [x] **paper-reader 精读**：入库/单篇 Download **自动** + 文件树 Zap 手动（资源齐全 + `is_read=false`）→ paper-reader skill（Codex `$` / Claude `/` / 其它注入）→ `NOTES.md` → `paper_set_is_read`；左下角任务进度（lookup/download → paperRead）。
   - [x] skill 运行时语法按 Agent 模板分流（Host `SkillMentionStyle`）。
   - [x] **全局权限模式**：设置 → Agent（`restricted` / `autoApprove`），替代 per-provider YOLO。
   - [ ] 在 Agent 面板增加“Summarize paper / Ask library / Draft Related Work”。
   - [ ] workflow prompt 自动注入 Vault 内 `AGENTS.md`。
   - [ ] 输出必须包含 Sources；写入前先进入草稿确认。
   - [ ] 权限「每次询问」档 + 逐项确认 UI。

4. **文件与索引同步**
   - 将最近 Vault、UI 偏好迁到 Tauri Store。
   - [x] 文件监听（`notify` → `vault:file-changed`）：外部编辑器 / Agent 修改后自动重载当前打开的 `.md`/`NOTES.md` 与文件树（当前策略：覆盖本地未存改动）。
   - [ ] 文件变更后增量刷新 wiki 双链 / Backlinks 索引（当前重载编辑器与文件树，未重建索引）。
   - [ ] 保存失败、外部冲突和未保存状态要有明确提示（当前冲突为静默覆盖本地）。

4b. **Vault 采纳 / 现有文件夹发现（编程优先）** — roadmap「Vault 采纳」
   - 场景：用户 **打开已有文件夹**（非 Create Vault），自动 **发现** 是否已是 Agentero Vault、缺什么、盘上有哪些 paper/PDF 候选。
   - [ ] 设计：`docs/development/vault-adopt.md`（发现报告 JSON、安全级/确认级动作、与 `vault_create` 边界）。
   - [ ] Host：`vault_inspect`（只读报告）——结构、catalog、paper 单元、散落 PDF、与 catalog 漂移。
   - [ ] Host：安全自动整理——缺 `papers|notes|plans|.agentero` 则补空目录；`ensure_catalog` + schema migrate；缺失则种子 `AGENTS.md` / bundled skills（**不覆盖**）。
   - [ ] 打开文件夹 UX：就绪则静默；半结构/未知则横幅或对话框「可整理」，进度进后台任务条。
   - [ ] 幂等：已就绪 Vault 重复打开不反复打扰。
   - 路径：**以编程为主**；不确定命名/归类留给 P1 skill 或确认面板。

5. **CLI（headless Vault 接口）** — 设计 [`cli.md`](cli.md)；**MVP 已落地**
   - 边界：**无 BYOA / 无 Agent / 无 paper-reader**；只做 Vault 管理、发现、暴露 + 文献基础能力。
   - 布局：仓库根 **`cli/`**（package `agentero-cli`，bin `agentero`）；根 Cargo workspace `members = ["src-tauri", "cli"]`。
   - 复用：**不迁 core**；path 依赖 `agentero_lib`，调用 `services::{vault,catalog,lookup,pdf_parse,wiki}`；禁止 `use …::agent`。
   - [x] Workspace + scaffold `cli/`（clap、`--vault` / env / 上溯、`--json`、退出码）。
   - [x] `vault create|which|info|check|use`（对齐 `vault_create` / catalog 初始化）。
   - [x] `tree`；`paper list|get|paths|delete|set-read|set-tags|tags|download|parse`（`get`：`assets` + `suggestedReads`；`list --tag` AND）。
   - [x] `import id|bib`、`export bib`（对齐 Host；**不**自动精读）。
   - [x] 稳定 `error.code`；集成测试（临时 Vault + `--json` 契约，`cli/tests/cli_mvp.rs`）。
   - [x] 按需放宽 service `pub`（`lib.rs` 导出 `services` / `error`；`list_by_id`）。
   - [x] README / 本仓库开发说明：`cargo build -p agentero-cli`。
   - [x] Vault skill 模板：`templates/vault/.agents/skills/agentero-cli/SKILL.md`；Create Vault 种子；README Quick Start 已写协议。

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
   - 与 **Vault 采纳** 边界：importer = 用户显式导入源；采纳 = 整夹扫描改造。

2b. **Vault 采纳 / 整理（确认迁移 + Skill 可选）** — 接 P0-4b
   - [ ] 确认后改造：散落 PDF → `papers/<id|citekey>/` + NOTES 壳 + catalog upsert（复用 lookup/import 写盘纪律）。
   - [ ] catalog ↔ 磁盘漂移修复（有盘无行 / 有行无盘的报告与可选清理索引）。
   - [x] 历史 `metadata.json` → catalog 导入（`paper_rescan` / `rebuild_from_disk`；论文库空态「重新扫描」重建行）。
   - [ ] **Skill 路径**：模板 `vault-organize`（或同名）——读 inspect 报告、提议移动/命名、经用户确认后落盘；触发 `$vault-organize` / `/vault-organize`。
   - [ ] **组合**：编程产报告与执行机械步骤；Agent 只处理模糊归类；无 Agent 时确认面板仍可用。
   - [ ] CLI（若 MVP 已有）：`vault inspect|adopt` 对齐 Host（命名实现时定）。
   - [ ] 纪律：dry-run / 计划清单；禁止静默覆盖 NOTES、禁止无确认大删。

3. **双链与图谱增强**
   - 源码编辑 `[[` 补全。
   - Plate 内联 wikilink 节点，序列化仍保持 `[[...]]`。
   - Graph 增加全屏/聚焦模式、邻居高亮、节点搜索。
   - 双链边可写入 catalog 可重建表并支持增量重建。

4. **工作区标签页与分屏**（roadmap V0.6）
   - [x] 中间栏文档 **标签栏**：paper / MD / PDF / HTML / 图片 / Library 以 tab 打开，可关闭、切换、拖拽重排。
   - [x] 每 tab 常驻挂载，保留滚动位置、PDF 缩放、视图模式；MD/NOTES 自动保存，关闭不丢内容。
   - [ ] **分屏**：水平或垂直 2 格；每格独立内容（典型：PDF | NOTES，或两篇 paper 并排）。
   - [x] 快捷键：关 tab `⌘W`（无 tab 时关窗口；File → Close / 菜单 `close_tab_or_window` 同源）/ 切 tab `⌥⌘→·⌥⌘←`；分屏·取消分屏随 split 补（键位写入 `docs/frontend/ui.md`）。
   - [x] 文件树 / Library / Graph / Backlinks / wiki 跳转统一 `openTab`；同路径已开则聚焦。
   - [x] 与 `⌘N` 多窗口隔离：每窗口独立 tab 集（`agentero-open-tabs`）；关窗/换 Vault 可恢复布局。
   - [x] 全局操作错误 Toast（`notifyError`，右上角；替代侧栏 header 错误条）。
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

7. **CLI 增强**（MVP 见 P0-5）
   - [ ] `graph backlinks|export|rebuild`（复用 wiki service；CLI 自管索引生命周期）。
   - [ ] `doctor`（Translator / catalog schema / 路径；**不** probe Agent）。
   - [ ] shell completions（bash / zsh / fish）。
   - [ ] `export papers-md`（Host 落地 `catalog:export_papers_md` 后对齐）。
   - [x] Release 附带 `agentero` 二进制（与桌面安装包同草稿 Release；见 `release.yml`）。

8. **Release 完善**
   - tag 构建已完成；后续补签名、公证、自动 changelog。
   - 同步 `package.json`、`src-tauri/tauri.conf.json` 和 tag 版本号。
   - Release artifact 命名规范化，区分 macOS arch / Windows / Linux。

## P2 — 长期方向

1. **Zotero/BibTeX 迁移工具** 🟡
   - [x] 一键从本地 Zotero 迁移：直读 `zotero.sqlite` + `storage/` → catalog，可选拷本地 PDF（`zotero_scan` / `zotero_migrate`；见 [`../backend/identifier-lookup.md`](../backend/identifier-lookup.md) §16）。
   - [ ] 解析 Zotero export / 独立 BibTeX 文件路径（Library 导入已覆盖 Bib/RIS 文本）。
   - [x] 按 Zotero collection 还原文件夹层级（可选；collection 名写入 tags）。
   - [x] 选择性导入指定 collection + 迁移前自愈 catalog 孤儿行（`prune_missing`）。
   - [x] 迁移 Zotero 笔记（子笔记 HTML→Markdown 追加进 NOTES.md；`htmd`）。
   - [x] 迁移 PDF 批注文本（高亮+评论→NOTES.md）+ 逐条选择/搜索 + 迁移进度 + 记住选项。
   - [ ] 批注原位高亮渲染（highlights.md 系统）与引用 key 映射。
1. **Zotero/BibTeX 迁移工具**
   - 解析 Zotero export 或 BibTeX。
   - 由 Agent 辅助重组为 Agentero vault。
   - 保留原始附件与引用 key 映射。

2. **用户友好的 Skills / Workflows**
   - [x] 精读论文（paper-reader：文件树 Zap + catalog `is_read`）。
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
   - [x] M6：划词操作菜单（高亮 / 笔记 / 提问 / 翻译）；高亮落盘 `papers/<id>/highlights/<id>.json` + 覆盖层 + 点击删除；笔记追加 `NOTES.md`（经编辑器实例，防覆盖）；翻译复用问答卡走 Agent；去掉默认琥珀高亮，仅原生选区。

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

9. **CLI domain 抽离（可选）**
   - 仅当 CLI 体积 / 依赖边界成为问题时：从 `agentero_lib` 抽出无 Agent 的 `services` 到独立 crate。
   - **当前不做**；默认保持 `cli/` → path → `agentero_lib`。

---

## 已完成能力速览（对照现状）

便于对照「还没做的新项」。细节与验收以 [`roadmap.md`](roadmap.md) 为准。

| 领域 | 已完成 | 未完成 / 进行中 |
|---|---|---|
| Vault / 工作台壳 | 打开·创建 Vault、catalog 初始化、多窗口 ⌘N、欢迎页 MRU、文件树新建/Finder/**删除（回收站 + 撤销 + 浏览恢复）**、左右侧栏 collapsible、后台任务条、**全局错误 Toast**（`notifyError`） | 最近 Vault 迁 Tauri Store；文件监听；**打开已有夹自动发现/整理**（P0-4b / P1-2b） |
| 中间内容 | **文档标签页**（常驻挂载；`⌘W` / `⌥⌘←→`）；Library 表 + **tags**；PDF / HTML / 图片 / Markdown WYSIWYG（内嵌图 → `./assets/`、选中源码、删节点 GC）；Notes 仅具体论文时显示 | **分屏**（V0.6 余量） |
| 入库 | 魔棒精确 ID/URL、Translator、默认 PDF+arXiv TeX、补下、无 TeX→PAPER.md、Library 导入导出 Bib、`paper_set_tags` | 关键词/Agent 候选；本地 PDF importer；部分非 arXiv PDF 下载 |
| Agent | BYOA ACP Client、Codex 原生 thread、Sources、**paper-reader**（自动+Zap）、**全局权限模式**、模型收藏、Skill 提及分流、会话标签（Agent 内） | 面板内置 workflow 入口、写入草稿确认、逐项权限 UI；**引用类 workflow**（V0.7） |
| 双链 / Graph | `[[wikilink]]` 跳转、反链、缺失创建、Backlinks 下 Graph | `[[` 补全、Plate 内联节点、Graph 全屏/邻居高亮 |
| 文献引用图 | — | **hover 引用→Info、Connected Papers 邻域、引用边缓存**（V0.7） |
| PDF / 媒体 | 任意路径 PDF + 常见图片预览；缩放；划词操作菜单（asks + highlights JSON） | `highlights.md` 标注系统、M5 |
| **CLI** | **MVP**（[`cli.md`](cli.md)：`cli/`、workspace、`paper set-tags` / `tags`、无 BYOA） | graph / doctor / completions（P1-7）；Release 附带二进制 |
| 发布 | tag → 三平台草稿 Release | 签名/公证/changelog；可选附带 `agentero` bin |
