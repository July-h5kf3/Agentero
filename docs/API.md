# Motif / notemd 后端 API 规范

> 本文档基于 `docs/TECH.md`、`docs/PRD.md`、`docs/ROADMAP.md` 编写，定义 Host（Tauri + Rust）暴露给前端的 Tauri invoke 命令与事件。

## 1. 分层定位

```text
Frontend (React)
       │ Tauri invoke / event
       ▼
Host (Tauri + Rust)
```

- **Frontend ↔ Host**：`invoke('namespace:command')` 请求响应，配合 Tauri event 做进度/流式推送。
- Agent 相关能力由 Host 内部托管，本文档暂不暴露其与 Agent 进程之间的私有通信协议。

## 2. 通用约定

### 2.1 命名规范

- Tauri command：`namespace:verb`（全小写，冒号分隔命名空间）。
  - 例：`vault:create`、`file:read_text`、`arxiv:import`。

### 2.2 参数与返回

- 所有请求统一通过对象传参。
- 返回结构：
  - 成功：`{ "ok": true, "data": T }`
  - 失败：`{ "ok": false, "error": { "code": "...", "message": "...", "details": {} } }`
- 流式结果通过 Tauri event 推送，不占用返回通道。

### 2.3 路径表示

- Vault 内路径统一使用相对路径（UNIX 风格 `/`），以 Vault root 为基准。
  - 例：`papers/1706.03762/NOTES.md`、`notes/transformer.md`。
- Host 负责把相对路径解析为本地绝对路径，并校验路径白名单。

### 2.4 事件约定

Host 通过 `emit('event_name', payload)` 向前端推送事件：

| 事件名 | 触发时机 | payload 关键字段 |
|---|---|---|
| `fs:changed` | Vault 内文件被外部修改 | `{ path: string, kind: 'created' \| 'modified' \| 'removed' }` |
| `arxiv:progress` | arXiv 入库进度更新 | `{ job_id: string, stage: string, progress?: number, message?: string }` |
| `arxiv:completed` | 入库完成 | `{ job_id: string, paper: Paper, created_paths: string[] }` |
| `arxiv:failed` | 入库失败 | `{ job_id: string, error: AppError }` |
| `agent:stream` | Agent 流式输出 | `{ session_id: string, chunk: string }` |
| `agent:tool_call` | Agent 调用 tool | `{ session_id: string, tool: string, args: object }` |
| `agent:completed` | Agent 回答完成 | `{ session_id: string, result: AgentResult }` |
| `agent:failed` | Agent 调用失败 | `{ session_id: string, error: AppError }` |
| `graph:updated` | 图谱索引重建 | `{ nodes: number, edges: number }` |

## 3. Host 层 Tauri invoke API

### 3.1 Vault 管理

#### `vault:create`

创建并初始化一个 Vault。

- **参数**

```ts
{
  path: string; // 本地绝对路径，由 dialog 选择或用户输入
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    vault: VaultInfo;
    created: string[]; // 创建的目录/文件相对路径列表
  };
}
```

- **行为**
  - 检查目录是否为空或已包含 Vault。
  - 创建 `AGENTS.md`、`PAPERS.md`、`papers/`、`notes/`、`plans/`。
  - 写入默认 `AGENTS.md` 模板。
  - 更新最近 Vault 列表。

#### `vault:open`

打开一个已存在的 Vault。

- **参数**

```ts
{
  path: string;
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    vault: VaultInfo;
    tree: FileNode[];
  };
}
```

- **行为**
  - 校验 Vault 结构（至少存在 `PAPERS.md`）。
  - 初始化/校验 SQLite 索引。
  - 启动文件监听。
  - 返回完整文件树。

#### `vault:close`

关闭当前 Vault。

- **参数**：无
- **返回**：`{ ok: true; data: null }`
- **行为**：停止文件监听，释放资源，不删除数据。

#### `vault:recent`

获取最近打开的 Vault 列表。

- **参数**：无
- **返回**

```ts
{
  ok: true;
  data: {
    vaults: RecentVault[];
  };
}
```

#### `vault:info`

获取当前 Vault 元信息。

- **参数**：无
- **返回**

```ts
{
  ok: true;
  data: VaultInfo;
}
```

### 3.2 文件操作

#### `file:read_text`

读取文本文件内容。

- **参数**

```ts
{
  path: string; // Vault 相对路径
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    path: string;
    content: string;
    mtime: number; // 毫秒时间戳
  };
}
```

#### `file:write_text`

写入文本文件。

- **参数**

```ts
{
  path: string;
  content: string;
  create_dirs?: boolean; // 默认 true
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    path: string;
    mtime: number;
  };
}
```

- **行为**
  - 写入时先写临时文件，再原子重命名。
  - 触发 `fs:changed` 事件。

#### `file:list`

列出指定目录下的文件树节点。

- **参数**

```ts
{
  path?: string; // Vault 相对路径，空字符串表示 root
  depth?: number; // 默认 1，-1 表示无限
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    nodes: FileNode[];
  };
}
```

#### `file:create`

创建新文件或目录。

- **参数**

```ts
{
  path: string;
  type: 'file' | 'directory';
  content?: string; // 仅 type='file' 有效
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    path: string;
  };
}
```

#### `file:delete`

删除文件或目录。

- **参数**

```ts
{
  path: string;
  recursive?: boolean; // 默认 false
}
```

- **返回**：`{ ok: true; data: null }`

- **风险**：删除操作不可逆，前端需二次确认。

#### `file:resolve_asset_url`

将 Vault 内资源文件转换为前端可安全加载的 URL。

- **参数**

```ts
{
  path: string; // 如 papers/1706.03762/assets/figure.pdf
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    url: string; // tauri convertFileSrc 后的安全 URL
  };
}
```

### 3.3 arXiv 入库

#### `arxiv:classify_input`

对用户输入进行分类与意图解析。

- **参数**

```ts
{
  input: string;
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    kind: 'exact_id' | 'url' | 'keyword' | 'topic' | 'description';
    normalized_id?: string; // 当 kind 为 exact_id/url 时
    query?: string; // 当 kind 为 keyword/topic/description 时，整理后的查询串
  };
}
```

#### `arxiv:search_candidates`

检索 arXiv 候选论文。

- **参数**

```ts
{
  query: string;
  max_results?: number; // 默认 10
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    candidates: ArxivCandidate[];
  };
}
```

- **行为**
  - 模糊输入调用 Agent 检索，Agent 可访问 arXiv API。
  - 返回候选包含标题、作者、年份、arXiv ID、摘要片段、推荐理由。

#### `arxiv:import`

启动 arXiv 论文入库任务。

- **参数**

```ts
{
  arxiv_id: string;
  options?: {
    generate_paper_md?: boolean; // 是否强制生成 source/PAPER.md
    overwrite?: boolean; // 是否覆盖已有目录，默认 false
  };
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    job_id: string;
  };
}
```

- **行为**
  - 异步任务，通过 `arxiv:progress` / `arxiv:completed` / `arxiv:failed` 事件推送结果。
  - 创建 `papers/<id>/` 与 `papers/<id>/source/`。
  - 下载 LaTeX source、PDF、HTML 到 `source/`。
  - 无 tex 源或需要可读结构化正文时，生成 `papers/<id>/source/PAPER.md`。
  - 调用 Agent 生成 `papers/<id>/NOTES.md`。
  - 更新 `PAPERS.md` 与 SQLite 索引。


### 3.4 论文

论文数据由 arXiv 入库流程生成，也可通过本组命令查询与列表。

#### `paper:get`

获取单篇论文完整数据。

- **参数**

```ts
{
  id: string; // 论文唯一标识，如 arxiv_id
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    paper: Paper;
  };
}
```

#### `paper:list`

列出当前 Vault 中已入库的论文。

- **参数**

```ts
{
  status?: ('pending' | 'importing' | 'completed' | 'failed')[];
  tag?: string;
  limit?: number;
  offset?: number;
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    papers: Paper[];
    total: number;
  };
}
```

### 3.5 Agent 工作流

#### `agent:list_sessions`

列出当前 Vault 中的 Agent 会话。

- **参数**：无
- **返回**

```ts
{
  ok: true;
  data: {
    sessions: AgentSession[];
  };
}
```

#### `agent:create_session`

创建新的 Agent 会话。

- **参数**

```ts
{
  name?: string;
  workflow?: 'summary' | 'qa' | 'related_work' | 'free';
  context_paths?: string[]; // 预加载的 Vault 相对路径
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    session: AgentSession;
  };
}
```

- **行为**
  - Host 内部创建 Agent 会话并加载 `AGENTS.md` 作为系统提示约束。

#### `agent:send_prompt`

向指定会话发送 prompt。

- **参数**

```ts
{
  session_id: string;
  prompt: string;
  workflow?: 'summary' | 'qa' | 'related_work' | 'free'; // 默认 'free'
  target?: string; // workflow 为 summary/qa/related_work 时的目标文件路径
  stream?: boolean; // 默认 true
  write_target?: string; // 可选：输出写入目标文件相对路径，需用户确认
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    session_id: string;
    message_id: string;
  };
}
```

- **行为**
  - 若 `stream=true`，通过 `agent:stream` 事件推送增量内容。
  - 完成时推送 `agent:completed` 事件，包含读取过的文件路径列表。
  - 若指定 `write_target`，Agent 输出先写入临时文件，不直接覆盖目标。

#### `agent:accept_draft`

将 Agent 生成的临时草稿写入正式文件。

- **参数**

```ts
{
  session_id: string;
  message_id: string;
  target: string;
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    path: string;
    mtime: number;
  };
}
```

- **行为**
  - 将临时文件移动到目标路径。
  - 若目标文件已存在且包含用户手写内容，默认合并或提示冲突。

#### `agent:close_session`

关闭 Agent 会话。

- **参数**

```ts
{
  session_id: string;
}
```

- **返回**：`{ ok: true; data: null }`

### 3.6 双链与图谱

#### `graph:get_backlinks`

获取某个文件的反链列表。

- **参数**

```ts
{
  path: string;
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    path: string;
    backlinks: Backlink[];
  };
}
```

#### `graph:get_graph`

获取全量或局部图谱数据。

- **参数**

```ts
{
  center?: string; // 中心节点 ID，为空返回全图
  depth?: number; // 默认 2
  types?: NodeType[]; // 过滤节点类型
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
}
```

#### `graph:rebuild_index`

手动触发索引重建。

- **参数**

```ts
{
  full?: boolean; // 默认 false，仅增量重建
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    indexed_files: number;
    nodes: number;
    edges: number;
  };
}
```

### 3.7 配置

#### `config:get`

获取应用配置。

- **参数**

```ts
{
  key: string;
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    key: string;
    value: unknown;
  };
}
```

#### `config:set`

设置应用配置。

- **参数**

```ts
{
  key: string;
  value: unknown;
}
```

- **返回**：`{ ok: true; data: null }`

- **常用 key**
  - `agent.command`：Agent 启动命令，默认 `opencode acp`。
  - `agent.model`：默认模型。
  - `recent_vaults`：最近 Vault 列表（Host 维护，前端一般只读）。

## 4. 数据模型

完整类型定义见 `docs/DATA_MODEL.md`。API 中涉及的核心类型包括：

- `VaultInfo` / `RecentVault`
- `FileNode`
- `Paper`
- `ArxivCandidate` / `ArxivImportResult`
- `AgentSession` / `AgentResult`
- `GraphNode` / `GraphEdge` / `Backlink`
- `AppError`

## 5. 版本与演进

| 版本 | API 重点 |
|---|---|
| V0.1 | 实现 `vault:*`、`file:*`、`config:*`。 |
| V0.2 | 增加 `arxiv:*`、`paper:*` 命令与异步任务事件；定义 `Paper` 数据结构。 |
| V0.3 | 增加 `agent:*` 命令。 |
| V0.4 | 增加 `graph:*` 命令。 |
| V0.5 | 抽象 importer，新增 `importer:*` 命令，arxiv 作为默认 importer。 |

后续扩展：
- `importer:import` 统一来源入口。
- `search:full_text` 本地全文搜索。
- `reader:annotations` PDF 批注读写。
- `sync:*` 多设备同步（远期）。
