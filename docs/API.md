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
- Host 作为 **ACP Client** 连接用户本机 Agent；Frontend 只面对下方 `agent:*` 命令与事件，**不** 直接暴露 ACP JSON-RPC 细节。

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
| `pdf:progress` | 本地 PDF 入库进度更新 | `{ job_id: string, stage: string, progress?: number, message?: string }` |
| `pdf:completed` | PDF 入库完成 | `{ job_id: string, paper: Paper, created_paths: string[] }` |
| `pdf:failed` | PDF 入库失败 | `{ job_id: string, error: AppError }` |
| `agent:stream` | Agent 流式输出 | `{ sessionId, chunk, kind: "message" \| "thought" }`（`thought` = ACP reasoning） |
| `agent:tool` | ACP tool call 创建/更新 | `{ sessionId, toolCallId, title?, kind?, status?, input?, output?, full? }` |
| `agent:plan` | ACP 执行计划 | `{ sessionId, entries: { content, status, priority }[] }` |
| `agent:usage` | 上下文 token 用量 | `{ sessionId, used, size }` |
| `agent:permission_request` | Agent 请求权限（读/写/网络等） | `{ session_id: string, request_id: string, kind: string, detail: object }` |
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
    generate_paper_md?: boolean; // 是否强制生成 PAPER.md
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
  - 创建 `papers/<id>/` 与 `papers/<id>/source/`，写入 `metadata.json`（元数据事实来源）。
  - 下载 LaTeX source、PDF、HTML 到 `source/`。
  - 无 tex 源或需要可读结构化正文时，生成 `papers/<id>/PAPER.md`。
  - 调用 Agent 生成 `papers/<id>/NOTES.md`，并创建空的 `papers/<id>/highlights.md`。
  - 更新 `PAPERS.md`（派生索引）与 `library.bib`，刷新 `.motif/cache.sqlite`。


### 3.4 本地 PDF 入库

本地 PDF 通过统一 Importer 接入，与 arXiv 共用 `papers/<id>/` 输出结构。入库分两步：先解析并混合获取元数据供用户确认，再正式入库。

#### `pdf:prepare`

对本地 PDF 做轻量解析并混合获取候选元数据，供入库前确认，不落盘。

- **参数**

```ts
{
  paths: string[]; // 本地 PDF 绝对路径，可批量
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    drafts: PdfMetadataDraft[]; // 每篇一个候选元数据草稿
  };
}
```

- **行为**
  - 复制 PDF 到临时目录，提取首页文本并识别 DOI / arXiv ID。
  - 命中标识符时查询 Crossref / arXiv 获取权威元数据；未命中或失败时由 Agent 从正文抽取候选。
  - 生成建议 citekey，并标记与已入库论文的重复情况。

#### `pdf:import`

根据用户确认后的元数据正式入库。

- **参数**

```ts
{
  items: {
    tmp_id: string;             // 对应 pdf:prepare 返回的草稿
    metadata: PdfMetadataDraft; // 用户校对后的元数据
  }[];
  options?: {
    parser?: 'auto' | 'liteparse' | 'mineru'; // 默认 auto：配置并启用则 mineru，否则 liteparse
    overwrite?: boolean;        // 默认 false
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
  - 异步任务，通过 `pdf:progress` / `pdf:completed` / `pdf:failed` 事件推送结果。
  - 生成 citekey，落位 `papers/<citekey>/`，写入 `metadata.json`（`type=pdf`）。
  - 原始 PDF 存入 `source/`；用选定 `PdfParser` 全文解析生成 `PAPER.md`（PDF 来源必生成）与 `assets/`，记录 `body_source` / `body_quality`。
  - 调用 Agent 生成 `NOTES.md`，创建空 `highlights.md`。
  - 更新 `PAPERS.md`、`library.bib`，刷新 `.motif/cache.sqlite`。
  - 使用云端 MinerU 前需前端已获用户同意（PDF 将上传第三方）。

### 3.5 论文

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

### 3.6 Agent 工作流（ACP Client + BYOA）

Host 作为 ACP Client：按注册表 spawn 用户本机 Agent（`cwd` = 当前 Vault），通过 stdio JSON-RPC 会话。**不** 内置 agent 二进制；**不** 在 config 中要求模型 API Key。

#### `agent:list_agents`

列出已注册 Agent 及其探测状态。

- **参数**：无
- **返回**

```ts
{
  ok: true;
  data: {
    agents: AgentDescriptor[];
    default_id: string | null;
  };
}
```

#### `agent:upsert_agent`

新增或更新一条 Agent 注册项。

- **参数**

```ts
{
  id?: string; // 省略则新建
  name: string;
  template?: 'opencode' | 'gemini' | 'claude-acp' | 'codex-acp' | 'custom';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  set_default?: boolean;
}
```

- **返回**

```ts
{
  ok: true;
  data: {
    agent: AgentDescriptor;
  };
}
```

#### `agent:remove_agent`

删除注册项（不卸载用户本机 CLI）。

- **参数**：`{ id: string }`
- **返回**：`{ ok: true; data: null }`

#### `agent:discover`

对 PATH / 已配置绝对路径做可执行文件探测，更新 `available` 状态。

- **参数**：`{ id?: string }` // 省略则探测全部
- **返回**

```ts
{
  ok: true;
  data: {
    agents: AgentDescriptor[];
  };
}
```

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

创建新的 Agent 会话（按需 spawn ACP 子进程）。

- **参数**

```ts
{
  name?: string;
  agent_id?: string; // 默认 agent.default_id
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
  - 使用注册表中的 `command` / `args` / `env` spawn Agent，`cwd` = Vault root。
  - 加载工作流 prompt 模板与 `AGENTS.md` 作为系统约束。
  - 若 command 不可用，返回可诊断错误（含探测信息），不静默使用其他 agent。

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
  - 权限请求通过 `agent:permission_request` 推送，前端调用 `agent:respond_permission` 应答。
  - 完成时推送 `agent:completed` 事件，包含读取过的文件路径列表。
  - 若指定 `write_target`，输出先写入临时草稿，不直接覆盖目标。

#### `agent:respond_permission`

应答权限请求。

- **参数**

```ts
{
  session_id: string;
  request_id: string;
  allow: boolean;
  remember?: 'session' | 'once'; // 默认 'once'
}
```

- **返回**：`{ ok: true; data: null }`

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

关闭 Agent 会话（结束 ACP 连接并可终止子进程）。

- **参数**

```ts
{
  session_id: string;
}
```

- **返回**：`{ ok: true; data: null }`

### 3.7 双链与图谱

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

### 3.8 配置

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
  - `agent.enabled`：Agent 总开关，默认 `true`。
  - `agent.default_id`：默认 Agent 注册 id；无可用 agent 时为 `null`。
  - `agent.agents`：Agent 注册表数组（`id` / `name` / `template` / `command` / `args` / `env`）。**不** 包含模型 API Key 字段。
  - `parser.pdf.backend`：PDF 解析后端，`liteparse`（默认）或 `mineru`。
  - `parser.mineru.api_key`：云端 MinerU API Key（产品侧 BYOK，与 Agent 密钥分离）。
  - `parser.mineru.enabled`：是否启用云端 MinerU，默认 `false`。
  - `recent_vaults`：最近 Vault 列表（Host 维护，前端一般只读）。

## 4. 数据模型

完整类型定义见 `docs/DATA_MODEL.md`。API 中涉及的核心类型包括：

- `VaultInfo` / `RecentVault`
- `FileNode`
- `Paper` / `PaperMetadata`
- `Highlight`
- `ArxivCandidate` / `ArxivImportResult`
- `PdfMetadataDraft` / `PdfImportResult`
- `AgentDescriptor` / `AgentSession` / `AgentResult`
- `GraphNode` / `GraphEdge` / `Backlink`
- `AppError`

## 5. 版本与演进

| 版本 | API 重点 |
|---|---|
| V0.1 | 实现 `vault:*`、`file:*`、`config:*`。 |
| V0.2 | 增加 `arxiv:*`、`paper:*` 命令与异步任务事件；定义 `Paper` 数据结构。 |
| V0.3 | ACP Client + BYOA：`agent:list_agents` / `upsert_agent` / `discover` / 会话与权限 / 工作流。 |
| V0.4 | 增加 `graph:*` 命令。 |
| V0.5 | 抽象 importer，落地 arxiv 与本地 PDF；新增 `pdf:*` 命令与可插拔 `PdfParser`（liteparse 默认 + 云端 MinerU）。 |

后续扩展：
- `importer:import` 统一来源入口。
- `search:full_text` 本地全文搜索。
- `reader:annotations` 标注（`highlights.md`）读写。
- `sync:*` 多设备同步（远期）。
