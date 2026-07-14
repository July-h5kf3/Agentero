# Motif 双链设计（Obsidian 兼容）

> 状态：**Phase A–B 已实现**（索引 + 反链 + 预览可点）/ C–D 待做  
> 相关：`docs/PRD.md` · `docs/TECH.md` §5.5–5.6 · `docs/ROADMAP.md` V0.4 · `docs/API.md` §3.7 · `docs/DATA_MODEL.md`

本文定义 Motif 如何实现类似 Obsidian 的 `[[双链]]`：语法、索引、反链、编辑器与开源选型。

---

## 1. 目标与非目标

### 1.1 目标

- 用户在 Markdown 中书写 `[[...]]`，与 **Obsidian 兼容**，可在 Motif / Obsidian 间互开 Vault。
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
边表 / 反查索引（内存 + .motif/cache.sqlite 缓存）
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

- 派生索引：`.motif/cache.sqlite`（与 `DATA_MODEL` 一致）。
- 可整删重建：重扫 `metadata.json` + 全部 Markdown 中的 `[[...]]`。
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

### 4.4 图谱

- 数据来自索引 API（`graph:get_graph`）。
- 前端可用 React Flow / force-graph；点击节点打开文件。
- 20 节点内流畅（ROADMAP 验收）。

---

## 5. Host API（已有草案，实现时补全）

见 `docs/API.md` §3.7：

| 命令 | 用途 |
|---|---|
| `graph:get_backlinks` | `{ path }` → `{ path, backlinks[] }` |
| `graph:get_graph` | 全图或局部邻域 |

建议后续补充（实现时写入 API.md）：

| 命令 | 用途 |
|---|---|
| `graph:rebuild` | 全量重建索引 |
| `wiki:resolve` | 单条 target → path / missing |
| `wiki:search` | 补全用标题/路径搜索 |

索引更新：在 Markdown 保存、Vault 扫描、外部 `fs:changed` 后触发增量。

---

## 6. 开源参考与选型

### 6.1 可直接依赖（解析 / 渲染）

| 库 | 用途 |
|---|---|
| [landakram/remark-wiki-link](https://github.com/landakram/remark-wiki-link) | remark 管线解析/渲染 `[[wiki]]` |
| [landakram/micromark-extension-wiki-link](https://github.com/landakram/micromark-extension-wiki-link) | micromark 层 token |
| [flowershow/remark-wiki-link](https://github.com/flowershow/remark-wiki-link) / [@portaljs/remark-wiki-link](https://www.npmjs.com/package/@portaljs/remark-wiki-link) | 偏 Obsidian 风格 |

Motif 前端已用 remark/Plate Markdown 链路时，**预览侧优先接 remark-wiki-link 系**，并注入自定义 `permalink` / resolve。

### 6.2 架构参考（不必整包嵌入）

| 项目 | 看点 |
|---|---|
| [Foam](https://github.com/foambubble/foam) | 本地 vault、wikilink 跳转、补全 |
| [Quartz](https://github.com/jackyzha0/quartz) | 从 vault 批处理建 backlinks / graph |
| [Logseq](https://github.com/logseq/logseq) | 反链 UI、块模型（仅作对照） |
| [SilverBullet](https://github.com/silverbulletmd/silverbullet) | Markdown 优先 + 可扩展索引 |

### 6.3 图可视化（可选）

- [xyflow/reactflow](https://github.com/xyflow/xyflow)（TECH 已倾向）
- [react-force-graph](https://github.com/vasturiano/react-force-graph)

### 6.4 不采用

- 为双链替换整个编辑器栈。
- 自动改写目标文件插入回链（除非未来产品单独立项）。

---

## 7. 实现分期（与 ROADMAP V0.4 对齐）

### Phase A — 索引与反链（后端优先） ✅

1. Rust：`extract_wikilinks(md)` + `resolve` + **内存索引**（全量 `graph_rebuild`；尚无 SQLite 落盘）。  
2. Tauri：`graph_get_backlinks` / `graph_rebuild`（参数 `vaultPath` + `path`）。  
3. 前端：`src/lib/wiki.ts` + 编辑栏底部 `BacklinksPanel`；Demo 模式纯前端索引。  

**代码位置**：`src-tauri/src/services/wiki/` · `src-tauri/src/commands/graph.rs` · `src/components/layout/backlinks-panel.tsx`

**验收**：改 `NOTES.md` 增加 `[[x]]` 并 rebuild 后目标页反链可见；重启后 `rebuild` 可重建。

### Phase B — 预览可点 ✅

1. 预览：`rewriteWikilinksForPreview` 将 `[[...]]` 转为 markdown link（`motif-wiki:`），Plate `LinkPlugin` 渲染。  
2. 存在：实线下划线，点击打开目标；缺失：虚线样式，确认后创建 `notes/<slug>.md`（或显式路径）并跳转。  

**代码**：`src/lib/wiki.ts` · `src/components/editor/link-node.tsx` · `LinkPlugin` · `WikiNavContext`

**验收**：Demo 中 NOTES → `[[notes/idea]]` / `[[PAPERS]]` 可跳；缺失链可创建。

### Phase C — 输入补全 + Plate（可选同一版本）

1. 源码模式 `[[` 补全。  
2. Plate 内联 wikilink 节点，序列化回 `[[...]]`。  

### Phase D — 图谱

1. `graph:get_graph` + React Flow。  
2. 节点类型 paper / note / concept。  

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
- 本仓库：`docs/TECH.md` §5.5–5.6、`docs/ROADMAP.md` V0.4  
