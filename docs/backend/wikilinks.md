# Agentero 双链设计（Obsidian 兼容）

> 状态：**Phase A–B 已实现**（索引 + 反链 + 预览可点）/ **Phase D 基本完成**（GraphPanel + `graph_get_graph`）/ Phase C 待增强  
> 相关：`docs/development/prd.md` · `docs/development/technical-plan.md` §5.5–5.6 · `docs/development/roadmap.md` V0.4 · `docs/backend/api.md` §3.7 · `docs/backend/data-model.md`

本文定义 Agentero 如何实现类似 Obsidian 的 `[[双链]]`：语法、索引、反链、编辑器与开源选型。

---

## 1. 目标与非目标

### 1.1 目标

- 用户在 Markdown 中书写 `[[...]]`，与 **Obsidian 兼容**，可在 Agentero / Obsidian 间互开 Vault。
- 点击双链可跳转到 Vault 内目标文件；目标不存在时可创建。
- 查看某文件的 **反链（backlinks）**：谁引用了我。
- 图谱视图展示节点与 `links_to` 等边；**可从 Markdown 全量重建**。
- Agent 生成/改写笔记时 **保留** `[[...]]` 字面量，不破坏链接。

### 1.2 非目标（MVP）

- **不**在目标文件正文里自动插入回链（不做“双向写盘”）。
- **不**把 SQLite 当作第二事实来源。
- **不**第一期做完整 Obsidian 方言（callouts、embed `![[...]]`、块引用 `^id` 可第二期）。
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
| `[[Note#Heading]]` | 跳到目标文件内标题（第二期可做滚动定位） |

块引用 `[[file#^blockid]]`、嵌入 `![[file]]`：**V0.4 后**。

### 2.2 解析规则（概要）

1. 从 Markdown 源文本提取 wikilink（代码块 / 行内 code 内 **不**解析）。
2. 拆分 `target`、可选 `alias`（`|`）、可选 `heading`（`#`）。
3. **resolve(target)** 顺序建议：
   - 若以 `papers/`、`notes/`、`plans/` 等开头 → 当相对路径；补 `.md` 若缺扩展名且文件存在。
   - 否则在 Vault 内按 **路径后缀 / 文件名 stem / 标题** 模糊匹配（与 Obsidian「最短唯一路径」可逐步对齐）。
4. resolve 结果：`{ path, exists: boolean }`。

### 2.3 落盘纪律

- 编辑器内部可用 AST / Plate 节点表示 wikilink。
- **序列化必须写回** `[[...]]` 文本，禁止不可逆变成仅 HTML。
- Agent 工作流 prompt / `AGENTS.md` 约束：涉及双链必须保留 `[[...]]`。

---

## 3. 索引与存储

### 3.1 边模型

```ts
type WikiLinkEdge = {
  source: string;      // vault 相对路径，如 papers/1706.03762/NOTES.md
  target_raw: string;  // [[ ]] 内原始 target
  target_path: string | null; // resolve 后路径；null = 未解析到
  alias?: string;
  heading?: string;
};
```

反链查询：

```text
backlinks(path) = { e.source | e.target_path == path }
```

### 3.2 缓存位置

- 双链边：当前为**内存索引**；后续可落入 `.agentero/catalog.sqlite` 的可重建表（与 `papers` 权威表区分，见 [`catalog.md`](catalog.md) §6）。
- **Paper 标题**：读 catalog `papers.title`，不读 `metadata.json`。
- 可整删重建（仅边表）：重扫全部 Markdown 中的 `[[...]]` + join catalog 取 label。
- 增量：文件 mtime / fs 事件变化时，仅重算该 `source` 的出边。

### 3.3 图谱节点 / 边类型（与 TECH §5.6 对齐）

| 类型 | 说明 |
|---|---|
| 节点 `paper` / `note` / `concept` | 论文目录、自由笔记、仅被链接的概念 stub |
| 边 `links_to` | 双链出边 |
| 边 `has_note` 等 | 结构关系（论文→NOTES），非 `[[ ]]` 亦可存在 |

---

## 4. 产品表面

### 4.1 预览 / 编辑（分期）

| 阶段 | 能力 |
|---|---|
| **P0** | 中间栏预览：`[[...]]` 高亮、可点跳转；缺失目标样式区分 |
| **P1** | 源码编辑：`[[` 补全 Vault 路径/标题 |
| **P2** | Plate WYSIWYG：wikilink 内联节点 + 同上序列化 |

### 4.2 反链面板

- 展示当前打开文件的 `backlinks`：源路径 + 可选上下文摘录（一行）。
- 点击源路径打开对应文件。

### 4.3 缺失目标

- 点击不存在的 `[[Concept]]` → 确认创建 `notes/<slug>.md`（默认 frontmatter 可极简）。
- 创建后刷新索引并跳转。

### 4.4 图谱（Backlinks 右侧栏下方）

产品形态：

- 右侧边栏只有 Agent 与 Backlinks 两个顶层入口；Graph 嵌在 Backlinks 入口下方。
- 上方 `BacklinksPanel` 展示当前文件反链；下方 `GraphPanel` 展示力导向关系图。
- 点击节点打开对应文件 / paper（paper 级路径走现有 openPaper 逻辑）。
- 模式：**全图** | **当前邻域**（`center` + `depth`，默认 depth=2）。

数据：

- 唯一事实来源：Markdown 中的 `[[wikilink]]`（内存索引，可 `graph_rebuild` 重建）。
- Host：`graph_get_graph`（见 `docs/backend/api.md` §3.7）。
- Demo（无 Tauri）：前端用 demo vault 文件内容现算 nodes/edges。

验收：20+ 节点可交互；选中 paper 时邻域图以当前 paper 为中心；不依赖手写图数据库。

---

## 5. Host API

见 `docs/backend/api.md` §3.7：

| 命令 | 状态 | 用途 |
|---|---|---|
| `graph_get_backlinks` | ✅ | `{ vaultPath, path }` → 反链列表 |
| `graph_rebuild` | ✅ | 全量重建内存索引 |
| `graph_get_graph` | ✅ / Phase D | 全图或局部邻域 `{ nodes, edges }` |

建议后续补充：

| 命令 | 用途 |
|---|---|
| `wiki:resolve` | 单条 target → path / missing |
| `wiki:search` | 补全用标题/路径搜索 |

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

### Phase A — 索引与反链（后端优先） ✅

1. Rust：`extract_wikilinks(md)` + `resolve` + **内存索引**（全量 `graph_rebuild`；尚无 SQLite 落盘）。  
2. Tauri：`graph_get_backlinks` / `graph_rebuild`（参数 `vaultPath` + `path`）。  
3. 前端：`src/lib/wiki.ts` + `BacklinksPanel`；Demo 模式纯前端索引。  
4. **文件变更防抖重建**（已落地）：Vault watcher 报告 `.md` 变更后，前端 `useVaultFileEvents.onWikiChange` → `scheduleWikiRebuild`（约 **900ms** 防抖）触发全量 rebuild，使 Backlinks / Graph 在外部或 Agent 写盘后保持新鲜。非边级增量；SQLite 边缓存仍待。

**代码位置**：`src-tauri/src/services/wiki/` · `src-tauri/src/commands/graph.rs` · `src/components/layout/backlinks-panel.tsx` · `src/hooks/use-vault-file-events.ts`

### Phase B — 预览可点 ✅

1. 预览：`rewriteWikilinksForPreview` → Plate `LinkPlugin`。  
2. 存在 / 缺失链跳转与创建。  

**代码**：`src/lib/wiki.ts` · `link-node.tsx` · `WikiNavContext`

### Phase C — 输入补全 + Plate（可选同一版本）

1. 源码模式 `[[` 补全。  
2. Plate 内联 wikilink 节点，序列化回 `[[...]]`。  

### Phase D — 图谱 ✅

1. **API**：`graph_get_graph`（`center?` + `depth?`，默认全图 / depth=2）。  
2. **前端**：`getGraph()` + demo 构图；`GraphPanel`（force-graph-2d、Near / All 模式、节点点击打开）。  
3. **壳**：`rightSidebarTab` 只有 `agent` / `backlinks`；`GraphPanel` 嵌在 Backlinks 下方。  
4. **测试数据**：Demo vault 多 paper + 交叉 `[[双链]]`（图谱质量取决于 NOTES 链接，不依赖本地下载 PDF 正文）。  

**代码位置**：

- `src-tauri/src/models/wiki.rs`（`GraphNode` / `GraphEdge` / `GraphResponse`）
- `src-tauri/src/services/wiki/index.rs`（`get_graph`）
- `src-tauri/src/commands/graph.rs`（`graph_get_graph`）
- `src/lib/wiki.ts`（`getGraph` / demo）
- `src/components/layout/graph-panel.tsx`
- `src/App.tsx`（Backlinks 右侧栏内接线）

---

## 8. 与现有代码的关系

| 现状 | 说明 |
|---|---|
| Demo vault 已有 `[[papers/.../NOTES]]` 字面量 | 仅文本，未解析 |
| Plate + `@platejs/markdown` | 编辑/预览主干；双链插件待加 |
| ACP Agent | 生成笔记须保留 `[[...]]`；不负责索引 |
| Settings / Chat | 与双链无关 |

---

## 9. 风险与约束

| 风险 | 缓解 |
|---|---|
| 大 Vault 全量扫描慢 | 增量索引 + SQLite；后台队列 |
| 标题歧义（重名笔记） | resolve 规则文档化；偏好显式路径 |
| 与 Obsidian 细节不一致 | 优先兼容常见 `[[path]]` / `[[name]]` / alias |
| 编辑器插件复杂 | Phase B 先预览可点，编辑器第二期 |

---

## 10. 参考

- [Obsidian Internal links](https://obsidian.md/help/links)  
- [Agent Client Protocol](https://agentclientprotocol.com/)（Agent 侧不解析双链，只保证文件约定）  
- 本仓库：`docs/development/technical-plan.md` §5.5–5.6、`docs/development/roadmap.md` V0.4  
