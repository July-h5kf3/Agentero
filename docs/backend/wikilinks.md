# Agentero 双链设计（Obsidian 兼容）

> 状态：语义索引、精确导航、入/出链关系面、输入补全、链接感知的改名/移动，以及 Markdown、图片与 PDF 的只读嵌入均已实现。
> 相关：`docs/development/prd.md` · `docs/development/technical-plan.md` §5.5–5.6 · `docs/development/roadmap.md` V0.4 · `docs/backend/api.md` §3.8 · `docs/backend/data-model.md`

本文定义 Agentero 如何实现类似 Obsidian 的 `[[双链]]`：语法、索引、反链、编辑器与开源选型。

---

## 1. 目标与非目标

### 1.1 目标

- 用户在 Markdown 中书写 `[[...]]`，与 **Obsidian 兼容**，可在 Agentero / Obsidian 间互开 Vault。
- 点击双链可跳转到 Vault 内文件、标题或 block ID；目标文件缺失时可创建，缺失或歧义的 fragment 只报告错误。
- 查看某文件的显式 **入链（backlinks）** 与 **出链（outgoing links）**。
- 图谱视图展示节点与 `links_to` 等边；**可从 Markdown 全量重建**。
- `![[...]]` 使用同一 resolver 显示 Vault 内 Markdown 全文、标题、block、图片或 PDF，并允许跳转到来源。
- Agent 生成/改写笔记时 **保留** `[[...]]` 字面量，不破坏链接。

### 1.2 非目标（MVP）

- **不**在目标文件正文里自动插入回链（不做“双向写盘”）。
- **不**把 SQLite 当作第二事实来源。
- **不**渲染远程 URL、Canvas、搜索结果、音频/视频或插件自定义 embed；未支持类型保留原始 Markdown 并显示可诊断状态。
- **不**替换 Plate 编辑器为 Logseq/Foam 等整应用。

### 1.3 核心模型（与 Obsidian 一致）

| 概念 | 含义 |
|---|---|
| **出链** | 文件 A 正文中的 `[[B]]` → 边 `A → B`（写入 Markdown） |
| **反链** | 打开 B 时，索引查询「谁链到 B」→ 列表展示（**派生**，不写回 B） |
| **双向可见** | 单向写入 + 反向查询，不是两处都写链接 |

```text
事实来源：Vault 内 *.md 中的 [[...]] 文本
     │
     ▼ 解析 + resolve
边表 / 反查索引（内存；后续可入 catalog 可重建表）
     │
     ├── 预览/编辑器：高亮、点击跳转
     ├── 反链面板
     └── 图谱
```

---

## 2. 语法与解析

### 2.1 支持的形式（V0.4）

| 写法 | 含义 |
|---|---|
| `[[Note]]` | 按标题 / 路径片段解析到笔记 |
| `[[papers/1706.03762/NOTES]]` | 相对 Vault 根的路径（可省略 `.md`） |
| `[[Note\|显示名]]` | 出链目标 `Note`，展示文案 `显示名` |
| `[[Note#Heading]]` / `[[#Heading]]` | 跳到跨文件或当前文件标题；重复标题不会任意选择 |
| `[[Note#^block-id]]` / `[[#^block-id]]` | 跳到可验证的 Obsidian block ID |
| `[显示名](./Note.md#Heading)` | Vault 内标准 Markdown 相对链接，与 Wikilink 共享 resolver |
| `![[Note]]` | 只读嵌入整篇 Markdown |
| `![[Note#Heading]]` / `![[Note#^block-id]]` | 只读嵌入标题区段或 block 所在行 |
| `![[image.png]]` / `![[image.png\|320x200]]` | 嵌入 Vault 图片；alias 可指定宽度或宽高 |
| `![[document.pdf]]` | 使用现有 PDF 组件嵌入 Vault PDF |

leading YAML frontmatter 的 `aliases` 列表会参与目标解析；`title` 不会被当作 alias。

### 2.2 解析规则（概要）

1. 从 Markdown 源文本提取 Wikilink、embed token 和 Vault-local Markdown links；fenced code、inline code、外部 URL 不产生关系。
2. occurrence 保留语法、embed 标记、目标字节范围、alias/label、typed fragment、行号和上下文。
3. resolver 先匹配路径（Markdown link 先按来源目录），再匹配唯一后缀、唯一文件名和唯一 YAML alias；任意多命中返回 `ambiguous`。
4. 目标文件命中后按 heading 层级或 block ID 验证 fragment，返回 `resolved`、`missing`、`ambiguous` 或 `invalidFragment`。

### 2.3 落盘纪律

- 编辑器内部可用 AST / Plate 节点表示 wikilink。
- **序列化必须写回** `[[...]]` 文本，禁止不可逆变成仅 HTML。
- Agent 工作流 prompt / `AGENTS.md` 约束：涉及双链必须保留 `[[...]]`。

---

## 3. 索引与存储

### 3.1 边模型

```ts
type ResolvedLink = {
  occurrence: {
    source: string;
    targetRaw: string;
    syntax: "wikilink" | "markdown";
    embed: boolean;
    displayText?: string;
    fragment?: { kind: "heading"; path: string[] } | { kind: "block"; id: string };
    sourceRange: { start: number; end: number };
  };
  status: "resolved" | "missing" | "ambiguous" | "invalidFragment";
  targetPath?: string;
  candidates?: string[];
};
```

反链查询：

```text
backlinks(path) = { e.source | e.target_path == path }
```

### 3.2 缓存位置

- 双链边：当前为**内存索引**；后续可落入 `.agentero/catalog.sqlite` 的可重建表（与 `papers` 权威表区分，见 [`catalog.md`](catalog.md) §6）。
- **Paper 标题**：读 catalog `papers.title`，不读 `metadata.json`。
- 可整删重建：重扫全部 Markdown 中的 Wikilink 与 Vault-local Markdown link，再 join catalog 取 paper label。
- 当前更新策略：文件系统事件经约 900ms 防抖后全量重建内存索引；Backlinks / Graph 使用全局索引 revision 刷新。嵌入内容另按解析后的目标绝对路径订阅，只使被改目标的投影失效，避免普通文本自动保存让全部嵌入重新加载。边级增量重建与 SQLite 边缓存仍是后续工作。

### 3.3 图谱节点 / 边类型（与 TECH §5.6 对齐）

| 类型 | 说明 |
|---|---|
| 节点 `paper` / `note` / `concept` | 论文目录、自由笔记、仅被链接的概念 stub |
| 边 `links_to` | 双链出边 |
| 边 `has_note` 等 | 结构关系（论文→NOTES），非 `[[ ]]` 亦可存在 |

---

## 4. 产品表面

### 4.1 预览 / 编辑

| 能力 | 当前行为 |
|---|---|
| 链接点击 | Wikilink 和 Vault-local Markdown link 都先交给 Host resolver；后者按来源目录解析，外部 URL 保持普通外链行为。 |
| `[[` 补全 | 搜索 Vault 路径、alias、标题与 block；重名时显示路径，写入规范化可移植文本。 |
| Plate WYSIWYG | Wikilink 使用稳定的 non-void 内联节点；文本子节点保存完整 `[[...]]` / `![[...]]` 源码。selection 进入语法范围时显示源码，离开后立即恢复链接或嵌入投影，序列化仍写回原生 Markdown。 |

### 4.2 只读嵌入

- `wiki_embed_read` 先使用 Host resolver 得到规范目标，再返回 Markdown 全文、一个标题区段、一个 block 行，或图片/PDF 类型；前端不复制 fragment 解析规则。
- Markdown 投影在独立的只读 Plate 子树中渲染，不参与父文档 selection、autosave、dirty state 或图片 GC。嵌入内部的普通双链继续使用现有跳转契约。
- 嵌入预览保持挂载；光标进入对应语法时仅隐藏预览并显示源码，离开后恢复预览，避免编辑态/预览态反复销毁组件。
- 多层嵌入通过规范目标与 fragment 组成 ancestry key；检测循环引用，并限制为最多 4 层。
- 图片与 PDF 复用本地文件字节缓存和既有查看组件。Markdown 投影缓存上限为 128 项，附件字节缓存上限为 32 项。
- watcher 完成索引重建后，只通知本批次真正变化的目标路径。普通编辑触发的全局索引刷新不会改变其它嵌入的请求 key。

### 4.3 入链与出链面板

- Backlinks 入口的上半区域显示入链、出链两个区段；Graph 仍在下方。
- 每个 occurrence 显示路径、可选 fragment、上下文和解析状态。缺失、歧义、无效 fragment 可诊断，不能伪装成可跳转按钮。
- 点击入链打开其来源；点击出链使用同一 fragment-navigation 链路。

### 4.4 缺失目标

- 点击不存在的 `[[Concept]]` → 确认创建 `notes/<slug>.md`（默认 frontmatter 可极简）。
- 创建后刷新索引并跳转。

### 4.5 改名与移动稳定性

- Agentero 发起的文件、目录与 `papers/` 内移动先从改名前的 `WikiIndex` 生成精确编辑计划，再执行主路径移动、Markdown 原子写入、catalog path 更新（如适用）与索引重建。只改写此前已明确解析到被移动路径的 occurrence；alias、heading/block fragment、embed 标记及 Markdown link label 保持不变。
- 每个来源文件均经过未保存编辑和内容 hash 预检；写入或后续 catalog 更新失败时，事务尽力恢复已写 Markdown 与主路径。结果显式报告 `not-needed`、`completed` 或 `manual-recovery-required` 的 rollback 状态。
- 本地外部改名只接受 watcher 提供的单个可靠 old/new 配对。默认 General 设置 `autoUpdateInternalLinks: "ask"`：先显示旧/新路径、受影响来源和跳过项，确认后才写入。`"always"` 仍须通过同一配对、dirty path、hash 与最终磁盘状态校验；预检失败不会写 Markdown。apply 在写入后失败时 Host 返回 rollback 状态，审阅 Dialog 据此区分零写入、已回滚和需要人工恢复，避免把部分写入报成未写入。不可信事件只刷新树和索引，不授权 Markdown 改写。
- 外部修复只改写引用文件，不会移动已由 Finder、Obsidian 或 Agent 改名的主文件。remote Vault 没有本地 watcher 自动修复；显式 Agentero 改名/移动仍由 Host capability 与事务预检决定是否可执行。
- 已知限制：手工修改 Markdown heading 不会同步其它文件中的 `#heading` fragment。后续应通过显式“重命名当前小标题”事务修正，并将可持久化 Metadata Cache 作为独立的索引加速层；调研与实施边界见 [`../research/wikilink-heading-reference-stability.md`](../research/wikilink-heading-reference-stability.md)。

### 4.6 图谱（Backlinks 右侧栏下方）

产品形态：

- 右侧边栏只有 Agent 与 Backlinks 两个顶层入口；Graph 嵌在 Backlinks 入口下方。
- 上方 `BacklinksPanel` 展示当前 Markdown 文件的入链和出链 occurrence；下方 `GraphPanel` 展示力导向关系图。
- 点击节点打开对应文件 / paper（paper 级路径走现有 openPaper 逻辑）。
- 模式：**全图** | **当前邻域**（`center` + `depth`，默认 depth=2）。

数据：

- 唯一事实来源：Markdown 中的 `[[wikilink]]`（内存索引，可 `graph_rebuild` 重建）。
- Host：`graph_get_graph`（见 `docs/backend/api.md` §3.8）。
- Demo（无 Tauri）：前端用 demo vault 文件内容现算 nodes/edges。

验收：20+ 节点可交互；选中 paper 时邻域图以当前 paper 为中心；不依赖手写图数据库。

---

## 5. Host API

见 `docs/backend/api.md` §3.8：

| 命令 | 状态 | 用途 |
|---|---|---|
| `graph_get_backlinks` | ✅ | `{ vaultPath, path }` → 反链列表 |
| `wiki_get_outgoing` | ✅ | `{ vaultPath, path }` → 当前文件的显式出链 occurrence |
| `wiki_resolve` | ✅ | `{ vaultPath, sourcePath, linkText, syntax? }` → 统一解析结果 |
| `wiki_embed_read` | ✅ | `{ vaultPath, sourcePath, linkText }` → 规范解析结果与 Markdown / image / PDF 投影类型 |
| `wiki_search` | ✅ | `{ vaultPath, query }` → 文件、标题、block 候选 |
| `wiki_move` | ✅ | `{ vaultPath, fromRel, toRel, dirtyPaths? }` → 链接感知的本地文件/目录 rename 或 move |
| `wiki_external_rename_preview` | ✅ | 可信外部 rename 的只读 repair candidate |
| `wiki_apply_external_rename_repair` | ✅ | 确认后执行 candidate 的 Markdown repair，并重新校验 hash / dirty path |
| `graph_rebuild` | ✅ | 全量重建内存索引 |
| `graph_get_graph` | ✅ | 全图或局部邻域 `{ nodes, edges }` |

索引更新：Markdown 保存、Vault 扫描、打开 Vault 后 `rebuild`；查询侧 `ensure_vault` 惰性重建。

---

## 6. 开源参考与选型

### 6.1 可直接依赖（解析 / 渲染）

| 库 | 用途 |
|---|---|
| [landakram/remark-wiki-link](https://github.com/landakram/remark-wiki-link) | remark 管线解析/渲染 `[[wiki]]` |
| [landakram/micromark-extension-wiki-link](https://github.com/landakram/micromark-extension-wiki-link) | micromark 层 token |

Agentero 预览侧已用自定义 `rewriteWikilinksForPreview` + Plate Link；图谱 **不**依赖 remark-wiki-link。

### 6.2 架构参考（不必整包嵌入）

| 项目 | 看点 |
|---|---|
| [Foam](https://github.com/foambubble/foam) | 本地 vault、wikilink 跳转 |
| [Quartz](https://github.com/jackyzha0/quartz) | 从 vault 批处理建 backlinks / graph |
| [Obsidian Graph](https://help.obsidian.md/plugins/graph) | 力导向 UX 对照 |

### 6.3 图可视化 — **已定栈**

| 层 | 选型 | 说明 |
|---|---|---|
| 数据 | Rust `WikiIndex` + `graph_get_graph` | 复用 wikilink 边；不引入图数据库 |
| 可视化 | **`react-force-graph-2d`** | Canvas 力导向，贴合「中心 + 辐射」；侧栏性能足够 |
| 备选 | `@xyflow/react` | 仅当未来需要可编辑流程图式节点时再考虑 |
| UI 壳 | Backlinks 右侧栏下方 + Tailwind | 与反链共享上下文，避免额外顶层入口 |
| 模式切换 | Near / All | 当前邻域与全图切换 |

**不采用：** Neo4j 等图库；D3 从零画力导向；Cytoscape / Sigma / vis-network（集成成本高）。

### 6.4 节点类型与折叠规则

| `type` | 判定 |
|---|---|
| `paper` | **一个 paper 文件夹一个节点**（任意深度）：文件夹内路径折叠为该文件夹 path |
| `note` | `notes/` 下或其它 Markdown |
| `index` | 根级 `AGENTS.md` 及用户导出的索引类 md 等 |
| `stub` | 未解析目标（`stub:<raw>` 或 missing） |

- **Paper 标签**：优先读 catalog `papers.title`（按 path）；缺失时回退逻辑 id / 文件夹名。
- 折叠后自环（同 paper 内文件互链）丢弃。

### 6.5 与文献引用图的边界

本设计只覆盖 **Obsidian 式 `[[wikilinks]]`**（用户/Agent 写在 Markdown 里的概念与文件链接）。

**文献引用图**（paper cites / cited_by、Connected Papers 式邻域、文内 `[12]` hover → Paper Info）是另一条能力线，见 [`../development/roadmap.md`](../development/roadmap.md) **V0.7**。二者可在 UI 上对照展示，但：

- 数据源不同：双链边来自 Markdown 解析；引用边来自外部 API 或参考文献解析，缓存于 catalog / `.agentero/` 可重建结构。
- API 不同：现有 `graph_*` 服务双链；引用图使用独立 `citation:*`（名称待定），不污染双链索引语义。

### 6.6 不采用

- 为双链替换整个编辑器栈。
- 自动改写目标文件插入回链（除非未来产品单独立项）。
- 图谱常驻第四主栏或独立顶层 Graph tab（当前默认嵌在 Backlinks 下方）。
- 用双链 Graph 冒充 bibliographic 引用关系（引用探索走 V0.7）。

---

## 7. 实现分期（与 ROADMAP V0.4 对齐）

### Phase A — 索引与反链 ✅

1. Rust：`extract_wikilinks(md)` + `resolve` + **内存索引**（全量 `graph_rebuild`；尚无 SQLite 落盘）。  
2. Tauri：`graph_get_backlinks` / `graph_rebuild`（参数 `vaultPath` + `path`）。  
3. 前端：`src/lib/wiki/api.ts` + `BacklinksPanel`；Demo 模式纯前端索引。  
4. **文件变更防抖重建**（已落地）：Vault watcher 报告 Markdown、图片或 PDF 变更后，前端 `useVaultFileEvents.onWikiChange` → `scheduleWikiRebuild`（约 **900ms** 防抖）触发全量 rebuild，使 Backlinks / Graph 在外部或 Agent 写盘后保持新鲜；嵌入内容只按 watcher 本批次实际触及的目标路径失效。非边级增量；SQLite 边缓存仍待。

**代码位置**：`src-tauri/src/features/wiki/` · `src-tauri/src/features/wiki/commands.rs` · `src/components/wiki/backlinks-panel.tsx` · `src/hooks/use-vault-file-events.ts`

### Phase B — 精确导航 ✅

1. Host 解析结果贯穿 Plate link node、Document tabs 和 Markdown editor；已打开 tab 通过 one-shot navigation intent 保持编辑状态。
2. 标题与 block fragment 滚动定位并短暂高亮；`missing` 文件仍可创建，错误 fragment 不创建伪目标。

**代码**：`src/lib/wiki/api.ts` · `src/components/editor/link-node.tsx` · `src/components/editor/wikilink-node.tsx` · `src/lib/wiki/nav-context.tsx`

### Phase C — 输入补全 + Plate ✅

1. 输入 `[[` 时从 Host 搜索文件和 alias；`#` 和 `^` 仅显示已解析目标内的标题或 block 候选。Esc、方向键和 Enter 均不干扰输入法 composition。
2. 选择 alias 时写入 `[[规范路径|alias]]`；标题/block 选择写入可跳转的 `#heading` / `#^block-id`。Plate 内联节点序列化回 `[[...]]`。

### Phase D — 图谱 ✅

1. **API**：`graph_get_graph`（`center?` + `depth?`，默认全图 / depth=2）。  
2. **前端**：`getGraph()` + demo 构图；`GraphPanel`（force-graph-2d、Near / All 模式、节点点击打开）。  
3. **壳**：`rightSidebarTab` 只有 `agent` / `backlinks`；`GraphPanel` 嵌在 Backlinks 下方。  
4. **测试数据**：Demo vault 多 paper + 交叉 `[[双链]]`（图谱质量取决于 NOTES 链接，不依赖本地下载 PDF 正文）。  

**代码位置**：

- `src-tauri/src/features/wiki/models.rs`（`GraphNode` / `GraphEdge` / `GraphResponse`）
- `src-tauri/src/features/wiki/index.rs`（`get_graph`）
- `src-tauri/src/features/wiki/commands.rs`（`graph_get_graph`）
- `src/lib/wiki/api.ts`（`getGraph` / demo）
- `src/components/wiki/graph-panel.tsx`
- `src/App.tsx`（Backlinks 右侧栏内接线）

### Phase E — 链接感知改名与移动 ✅

1. `WikiRenameTransaction` 基于改名前的已解析 occurrence 生成写计划；本地 Agentero rename/move 与 `paper_move` 共享该事务。
2. 外部本地 rename 只在 watcher 提供单个可靠 old/new 配对时建立 repair candidate；`ask` 显示确认弹层，`always` 在全部安全门禁通过时执行。
3. 所有写入均重新校验 dirty path 与内容 hash；失败时报告并尽力回滚。Finder、Obsidian、Agent 已完成的主路径改名不会被 repair 反向移动。

### Phase F — Live Preview 与只读嵌入 ✅

1. `wikiLink` 使用稳定 non-void inline 保存完整源语法；selection 只切换源码/投影可见性，不替换节点。
2. `wiki_embed_read` 复用规范 resolver，支持 Markdown 全文、标题区段、block、图片和 PDF。
3. 嵌入内容只读、可点击跳转；嵌套投影具有循环检测和深度上限。
4. projection/request/附件字节使用有界缓存；watcher 按目标路径精确失效，普通父文档编辑不会刷新无关嵌入。

---

## 8. 与现有代码的关系

| 现状 | 说明 |
|---|---|
| Demo vault 已有 `[[papers/.../NOTES]]` 字面量 | 参与前端 Demo 解析；生产路径优先 Host 查询 |
| Plate + `@platejs/markdown` | 编辑/预览主干；支持 wikilink 内联节点与规范序列化 |
| ACP Agent | 生成笔记须保留 `[[...]]`；不负责索引 |
| Settings | `autoUpdateInternalLinks` 控制可信本地外部改名的 `ask` / `always` repair 策略 |

---

## 9. 风险与约束

| 风险 | 缓解 |
|---|---|
| 大 Vault 全量扫描慢 | 当前防抖全量重建优先正确性；边级增量与 SQLite 可重建缓存另立工作 |
| 标题歧义（重名笔记） | resolve 规则文档化；偏好显式路径 |
| 与 Obsidian 细节不一致 | 优先兼容常见 `[[path]]` / `[[name]]` / alias |
| 编辑器插件复杂 | 保持 Plate 内联节点与 Markdown 序列化的可逆边界，新增交互须补 round-trip 测试 |
| 嵌入递归或刷新风暴 | ancestry cycle/depth 门禁；全局索引 revision 与目标级 projection revision 分离 |

---

## 10. 参考

- [Obsidian Internal links](https://obsidian.md/help/links)  
- [Agent Client Protocol](https://agentclientprotocol.com/)（Agent 侧不解析双链，只保证文件约定）  
- 本仓库：`docs/development/technical-plan.md` §5.5–5.6、`docs/development/roadmap.md` V0.4  
