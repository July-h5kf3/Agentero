# Motif / notemd 技术方案

> 本文档基于 `docs/PRD.md`、`docs/UI.md`、`docs/ROADMAP.md` 与当前仓库现状编写，用于指导 MVP 及后续演进的技术选型与模块划分。

## 1. 技术定位与目标

- **本地优先（Local-first）**：Vault 以 Markdown + 源文件为事实来源，数据库/索引仅作为缓存。
- **跨平台但 Mac 优先**：MVP 以 macOS 桌面应用为主，技术栈保留向 iPadOS 扩展的能力。
- **Agent-first**：前端为人类提供审阅、编辑、导航界面；后端 Rust 宿主提供文件系统、网络、索引、Agent 编排能力。
- **可迁移**：Vault 离开应用后仍能被 Obsidian、VS Code、Cursor 直接打开。

## 2. 整体架构

```text
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Web)                          │
│  React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui    │
│  - 三栏工作台                                                │
│  - Markdown 编辑/预览                                        │
│  - PDF / HTML 阅读器                                         │
│  - 双链/反链/图谱                                            │
│  - Agent 面板                                                │
└───────────────────────────┬─────────────────────────────────┘
│                           │ Tauri invoke / event
┌───────────────────────────▼─────────────────────────────────┐
│                 Host (Tauri 2 + Rust)                        │
│  - 文件系统操作（读写 Vault、文件树、文件监听）               │
│  - arXiv / HTTP 抓取                                         │
│  - Markdown / 双链 / 图谱索引                                 │
│  - Agent 编排（ACP 协议）                                     │
│  - 本地配置与最近 Vault 存储                                  │
└───────────────────────────┬─────────────────────────────────┘
│                           │ ACP (stdio JSON-RPC)
┌───────────────────────────▼─────────────────────────────────┐
│              Agent Server (ACP-compatible)                   │
│  - opencode（默认内置，开箱即用）                             │
│  - Claude Code / Gemini CLI / 其他（用户可选切换）            │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 为什么选 Tauri 2

- Rust 宿主能直接、安全地操作本地文件系统，符合本地优先定位。
- 前端使用成熟的 Web 技术栈，UI 开发效率高于纯原生。
- Tauri 2 支持 iOS/iPadOS 构建（`tauri ios`），与 MVP 的 Mac-first、后续 iPadOS 策略一致。
- 包体小、内存占用低，适合作为常驻研究工具。

### 2.2 前后端职责边界

| 能力 | Frontend | Host (Rust) |
|---|---|---|
| 文件树展示/交互 | 渲染、事件 | 读取目录、监听变化 |
| Markdown 编辑 | Plate.js WYSIWYG 编辑器 | 持久化到磁盘 |
| 双链解析与高亮 | 正则 + AST 渲染 | 构建全局索引、反链查询 |
| 图谱 | 可视化组件（React Flow） | 输出节点/边数据 |
| PDF/HTML 阅读 | react-pdf 渲染 | liteparse 解析文本、提供本地文件路径/URL |
| arXiv 抓取 | 输入/进度展示 | HTTP 下载、LaTeX/HTML/PDF 获取 |
| Agent 调用 | 展示对话与结果 | 通过 ACP 协议与 Agent 通信、编排 prompt、写入文件 |
| 配置/最近 Vault | 读取与展示 | 使用 Tauri Store 持久化 |

## 3. 前端技术栈

### 3.1 基础框架

| 库/工具 | 版本/说明 | 用途 |
|---|---|---|
| React | ^19.1.0 | UI 组件与状态驱动 |
| TypeScript | ~5.8.3 | 类型安全 |
| Vite | ^7.0.4 | 构建与 HMR |
| Biome | 2.5.2 | Lint + Format（已配置） |

### 3.2 UI 与样式

| 库/工具 | 说明 | 用途 |
|---|---|---|
| Tailwind CSS | 原子化 CSS | 布局、间距、响应式 |
| shadcn/ui | 基于 Radix UI 的 headless 组件 | 按钮、输入框、对话框、下拉菜单、侧边栏 |
| Radix UI Primitives | shadcn/ui 底层 | 可访问性、键盘交互、弹窗管理 |
| Lucide React | 图标库 | 工具栏、文件树、状态图标 |
| tweakcn 主题 | `modern-minimal` | 已确定的视觉主题，保持简约 |

> 主题安装命令（已记录于 `docs/UI.md`）：
> `pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/modern-minimal.json`

### 3.3 Markdown 编辑与预览

采用 **Plate.js WYSIWYG 编辑器**方案，编辑即预览，无需分屏切换：

| 库 | 用途 |
|---|---|
| `@platejs/core` + 插件体系 | 基于 Slate.js 的富文本编辑器框架，WYSIWYG 编辑 Markdown |
| `@platejs/markdown` | Markdown ↔ Slate 序列化/反序列化，支持导入导出 |
| `@platejs/ai` | 内置 AI 能力，可直接对接 Agent 工作流（补全、改写、总结） |
| Plate shadcn/ui 组件 | 工具栏、浮动菜单、AI 面板等 UI 组件，与项目 shadcn/ui 体系一致 |
| 自定义 `[[双链]]` 插件 | 基于 Plate 插件机制实现双链输入、解析、高亮与点击跳转 |

**选型理由**：
- **所见即所得**：用户无需在源码和预览之间切换，编辑体验接近 Notion/Obsidian Live Preview。
- **与 shadcn/ui 原生集成**：Plate 的 UI 组件直接基于 shadcn/ui 构建，与项目现有组件体系无缝配合。
- **内置 AI 能力**：`@platejs/ai` 提供编辑器内 AI 交互（补全、改写、内联建议），可通过 ACP 对接 Agent 工作流。
- **插件架构**：双链、数学公式（KaTeX）、代码高亮等均可通过 Plate 插件扩展。
- **Markdown 兼容**：通过 `@platejs/markdown` 实现 Markdown 文件的导入（反序列化为 Slate 文档）和保存（序列化为 Markdown 文本），保持与 Vault 文件的兼容。

**注意事项**：
- Plate 内部使用 Slate 数据模型，保存时需序列化为 Markdown 再写入磁盘，确保 Vault 文件仍为标准 Markdown。
- Agent 写入的 Markdown 同样需反序列化为 Slate 文档后展示在编辑器中。
- 对于习惯源码编辑的用户，后续可考虑提供 CodeMirror 源码模式作为可选切换。

### 3.4 PDF / HTML 阅读器

| 类型 | 方案 |
|---|---|
| PDF 渲染（前端） | `react-pdf`（基于 PDF.js 的 React 组件封装），提供页面渲染、缩放、翻页 |
| PDF 解析（Rust） | `liteparse`（LlamaIndex 开源 Rust 解析器），提取结构化文本 + bounding box，支持 Markdown/JSON/Text 输出 |
| HTML（arXiv HTML）| Tauri Webview 内嵌 `iframe` 或独立 Webview 窗口 |
| 本地 HTML | 通过 Tauri `convertFileSrc` 转换为安全 URL 后加载 |

**分工说明**：
- **渲染层**（`react-pdf`）：负责在 Webview 中展示 PDF 页面，供用户审阅、缩放、翻页浏览。
- **解析层**（`liteparse`）：在 Rust 端提取 PDF 文本内容，用于生成 `source/PAPER.md`、Agent 上下文读取、全文检索索引等。输出支持 Markdown（含标题/表格/列表重建）、JSON（含 bounding box）和纯文本。
- `liteparse` 内置 Tesseract OCR，对扫描型 PDF 也能处理；支持多格式（PDF/DOCX/XLSX/PPTX/图片）。

> MVP 阅读器以审阅和定位为主，不实现完整批注系统。

### 3.5 关系图谱

| 库 | 用途 |
|---|---|
| `@xyflow/react`（React Flow）| 节点/边渲染、缩放、拖拽、点击交互 |

**原因**：React Flow 对可控布局友好，易于从 Rust 索引数据生成 Paper/Note/Concept 节点，并绑定点击打开文件事件。

### 3.6 状态管理

| 库 | 用途 |
|---|---|
| Zustand | 全局状态：当前 Vault、打开的文件、Agent 会话、UI 布局 |

**原因**：MVP 规模下 Zustand 足够轻量；无需 Redux 的样板代码。

### 3.7 路由（可选）

MVP 为单窗口桌面应用，暂不使用前端路由。若后续需要多视图（图谱全屏、设置页），引入：

| 库 | 用途 |
|---|---|
| TanStack Router | 类型安全路由 |

## 4. 后端/宿主层（Tauri + Rust）

### 4.1 Tauri 插件

| 插件 | 用途 |
|---|---|
| `tauri-plugin-fs` | 读/写/监听 Vault 文件与目录 |
| `tauri-plugin-dialog` | 选择/创建 Vault 文件夹 |
| `tauri-plugin-store` | 持久化用户配置、最近 Vault、API Key（加密存储后续补充） |
| `tauri-plugin-opener` | 打开外部链接（已配置） |
| `tauri-plugin-http`（可选）| 前端直接发起受控 HTTP 请求 |
| `tauri-plugin-process` / `tauri-plugin-shell` | 后续用于调用外部工具 |

### 4.2 Rust Crates

| Crate | 用途 |
|---|---|
| `tauri` / `tauri-build` | 应用框架 |
| `serde` / `serde_json` | 序列化与 IPC |
| `agent-client-protocol` | ACP 协议 Rust SDK，通过 stdio JSON-RPC 与 Agent 通信 |
| `reqwest` + `tokio` | 异步 HTTP，抓取 arXiv 资源 |
| `pulldown-cmark` 或 `comrak` | Markdown 解析、提取双链、标题、frontmatter |
| `regex` | 双链、arXiv ID 解析 |
| `thiserror` / `anyhow` | 错误处理 |
| `notify` | 文件系统监听，实时同步外部编辑器修改 |
| `dirs` | 获取系统配置/缓存目录 |
| `tempfile` | Agent 生成内容临时文件，确认后写入 |
| `walkdir` | 遍历 Vault 构建索引 |
| `liteparse` | PDF/文档解析：提取结构化文本 + bounding box，输出 Markdown/JSON/Text，内置 OCR |
| `rusqlite` | 本地 SQLite 索引，缓存论文元数据与全文检索 |

### 4.3 核心 Rust 模块设计

```text
src-tauri/src/
  main.rs          # 入口
  lib.rs           # Tauri Builder、命令注册
  commands/        # invoke 命令
    vault.rs       # 创建/打开/列出 Vault、最近记录
    file.rs        # 文件读写、监听
    input.rs       # 输入分类与候选论文查询
    arxiv.rs       # arXiv 入库命令
    agent.rs       # Agent 流程触发与状态
    graph.rs       # 图谱节点/边查询
  services/        # 业务逻辑
    vault.rs       # Vault 初始化与校验
    fs.rs          # 安全文件操作（路径白名单）
    input.rs       # 输入分类、意图解析、候选检索
    arxiv.rs       # arXiv HTML/LaTeX/PDF 抓取与解析
    markdown.rs    # Markdown 解析、双链提取、索引构建
    agent/         # Agent 编排（基于 ACP 协议）
      acp.rs       # ACP client 封装：spawn agent 子进程、stdio JSON-RPC 通信
      session.rs   # 会话管理：创建/切换/恢复 agent 会话
      prompts.rs   # 系统提示与 AGENTS.md 注入
      workflows.rs # 总结/问答/Related Work 流程
      search.rs    # Agent 驱动的论文检索/候选生成
  models/          # 数据类型
    vault.rs
    paper.rs
    note.rs
    graph.rs
    agent.rs
    candidate.rs   # 候选论文/检索结果
  error.rs         # 应用错误类型
```

### 4.4 安全模型

- **路径白名单**：Tauri `fs` 权限仅允许访问用户显式选择的 Vault 目录及其子目录。
- **CSP 配置**：`tauri.conf.json` 中设置合理的 Content-Security-Policy，限制本地 Webview 加载外部资源。
- **API Key 存储**：API Key 由 Agent 进程自行管理（opencode 内置 auth 机制），Rust 端不直接持有 key；MVP 使用 `tauri-plugin-store` 存储用户配置；后续迁移到系统钥匙串（`keyring` crate）。
- **网络范围**：Agent 网络访问由 agent 进程自身控制；arXiv 抓取限定于 `arxiv.org` 域名。

## 4.5 本地存储分层：Tauri Store vs SQLite

MVP 涉及两类本地持久化需求，需要明确分层：

| 维度 | Tauri Store | SQLite 索引 |
|---|---|---|
| 数据类型 | 用户配置、最近 Vault 列表、API Key、UI 状态 | 论文元数据、标签、全文检索索引、双链图缓存 |
| 数据模型 | Key-Value | 关系表 + FTS |
| 典型容量 | 几十到几百条记录 | 可扩展到数万条论文与链接 |
| 查询能力 | 按 key 读取，不适合过滤/聚合 | 支持按作者、年份、标签、关键词过滤，支持复杂查询 |
| 事实来源 | 是（配置类数据无其他来源） | 否，只能从 `PAPERS.md` / `NOTES.md` / 双链重建 |
| 存放位置 | 应用配置目录（`dirs::config_dir`） | Vault 内 `.motif/cache.sqlite` 或应用缓存目录 |
| 损坏处理 | 丢失后用户重新配置 | 删除后可从 Markdown 自动重建 |

**使用原则**：
- Tauri Store 只存配置和机密，不存论文元数据。
- SQLite 是查询缓存/索引，任何写入 SQLite 的数据必须能从 Markdown 重新生成。
- Agent 路由、搜索、图谱可先读 SQLite，但最终引用和展示必须落回本地文件路径。

## 5. 核心模块搭配与数据流

### 5.1 Vault 初始化与恢复

```text
用户选择目录
  → Rust: dialog.open({ directory: true })
  → Rust: 初始化 AGENTS.md / PAPERS.md / papers / notes / plans
  → Rust: store.set('recent-vaults', [...])
  → Frontend: 加载文件树，打开 PAPERS.md
```

### 5.2 arXiv 入库闭环

```text
用户输入 arXiv ID / URL / 关键词 / 话题 / 一段描述
  → Rust: 输入分类（规则解析 + Agent 意图识别）
     ├─ 精确 ID/URL → 直接提取标准 arXiv ID
     └─ 模糊输入 → Agent 检索 arXiv 候选并返回候选列表
  → Frontend: 展示候选论文（标题、作者、摘要片段、推荐理由）
  → 用户确认目标论文（单选/多选）
  → Rust: 归一化为标准 arXiv ID
  → Rust: 请求 arXiv API (http://export.arxiv.org/api/query)
  → Rust: 并行下载 LaTeX source / HTML / PDF（按优先级），均存入 `papers/<id>/source/`
  → Rust: 若无 LaTeX source 或需要可读结构化正文，生成 `papers/<id>/source/PAPER.md`（LaTeX/HTML/PDF → Markdown）
  → Rust: 调用 Agent 生成 `papers/<id>/NOTES.md`（三段论结构）
  → Rust: 更新 PAPERS.md（事实来源），并同步写入本地 SQLite 索引（查询缓存）
  → Frontend: 展示进度、成功、失败原因
  → Frontend: 自动打开 NOTES.md 供用户审阅
```

**输入分类与 Agent 解析**：
- 规则层先用正则识别 arXiv ID（如 `1706.03762`、`arXiv:1706.03762`）和 URL。
- 非精确输入统一交给 Agent，Agent 可调用 arXiv API 进行关键词/摘要搜索，并返回 Top-K 候选。
- 候选需包含：标题、作者、年份、arXiv ID、摘要片段、与输入意图的匹配理由。
- 用户可在列表中多选批量入库，或拒绝全部候选后重新输入。

**PAPER.md 生成策略**：
- `papers/<id>/source/` 始终存在，LaTeX source、PDF、HTML 均下载到该目录。
- Agent 优先读取 `source/` 中的 `.tex` 原始源文件。
- 仅在无 LaTeX source 或 Agent/用户需要统一可读格式时，按需生成 `papers/<id>/source/PAPER.md`：
  - 有 LaTeX source 时，通过 pandoc 或轻量 LaTeX→Markdown 转换保留章节、公式、表格。
  - 无 LaTeX source 时，次选 arXiv HTML 实验版，解析 DOM 转 Markdown。
  - 兜底使用 `liteparse` 进行 PDF 文本提取（支持 Markdown/JSON/Text 输出，内置 OCR），并明确标记质量。
- `PAPER.md` 是派生文件，可被删除或重建；`source/` 中的原始文件才是归档事实来源。

### 5.3 Markdown 工作台

```text
文件树点击
  → Frontend: 请求 Rust 读取 Markdown 文件内容
  → Frontend: @platejs/markdown 将 Markdown 反序列化为 Slate 文档
  → Frontend: Plate.js WYSIWYG 编辑器渲染（所见即所得，双链高亮可点击）
  → Frontend: 右侧面板展示反链、元信息、Agent 结果

用户保存
  → Frontend: @platejs/markdown 将 Slate 文档序列化为 Markdown 文本
  → Frontend: 将 Markdown 内容发往 Rust 写入磁盘
  → Rust: notify 触发文件变化事件
  → Frontend: 重建双链索引与图谱
```

### 5.4 双链与反链

- **双链格式**：`[[Concept]]`、`[[papers/1706.03762/NOTES]]`，与 Obsidian 兼容。
- **提取时机**：Rust 在后台遍历 Vault，构建文件→链接→目标索引。
- **前端渲染**：自定义 remark 插件将 `[[...]]` 转为 React Router/点击处理器可识别的 `<a>`。
- **反链查询**：Rust 根据当前文件路径返回所有引用它的文件列表。
- **缺失目标**：点击不存在的双链时弹出创建对话框，生成 `notes/<concept>.md`。

### 5.5 关系图谱

- **数据来源**：Rust 索引服务输出 JSON：`{ nodes: [...], edges: [...] }`。
- **节点类型**：`paper`、`note`、`concept`。
- **边类型**：`links_to`（双链）、`has_note`（论文→NOTES）、`has_source`（论文→source/PAPER.md）。
- **前端渲染**：React Flow 加载节点/边，点击节点调用 Rust 打开对应文件。

### 5.6 Agent 工作流

Agent 层统一基于 **ACP（Agent Client Protocol）** 协议，Rust 端通过 `agent-client-protocol` crate 与 Agent 子进程进行 stdio JSON-RPC 通信。

**默认内置 Agent**：opencode（通过 `opencode acp` 启动），开箱即用，支持多模型提供商（Claude、OpenAI 等）。用户可在设置中切换到其他 ACP-compatible agent（如 Claude Code、Gemini CLI）。

```text
应用启动
  → Rust: spawn `opencode acp` 子进程（默认 agent）
  → Rust: 通过 ACP stdio 建立 JSON-RPC 连接
  → Rust: 等待 agent ready

用户选择流程（总结/问答/Related Work）
  → Rust: 通过 ACP 创建/复用 session
  → Rust: 注入 AGENTS.md 作为系统提示约束
  → Rust: 按 PAPERS.md → NOTES.md → source/PAPER.md 顺序读取上下文，优先使用 `source/` 中的原始源文件
  → Rust: 通过 ACP session.prompt() 发送请求
  → Rust: 接收 agent 响应（流式/完整）
  → Rust: 返回结果 + 读取过的文件路径列表
  → Frontend: 展示结果，用户确认后写入 Markdown
```

**Agent 切换机制**：
- 默认使用内置 opencode，用户无需额外安装。
- 设置中可选择其他 ACP agent（指定 command + args），Rust 端 spawn 对应子进程即可。
- 切换 agent 不影响 Rust 业务逻辑，ACP 协议保证接口统一。

**Agent 输出规范**：
- 结果末尾必须包含 `## Sources` 或 `读取文件：` 列表。
- 涉及双链的内容必须保留 `[[...]]` 格式。
- 写入操作先写临时文件，用户确认后再移动到目标路径。
- Agent 内部路由可先查 SQLite 索引提升性能，但最终读取与引用必须对应到本地 Markdown 或 source 文件路径。

### 5.7 Agent 配置

MVP 通过 `.env` 文件配置 Agent 连接信息，支持 BYOK（Bring Your Own Key）：

| 变量名 | 说明 | 示例 |
|---|---|---|
| `OPENCODE_MODEL` | 默认使用的模型 | `anthropic/claude-sonnet-4-20250514` |
| `OPENCODE_API_KEY` | 用户自己的 API Key（由 opencode auth 管理） | `sk-ant-api03-...` |

- opencode 内置 auth 机制，API Key 由 agent 进程管理，Rust 端不直接持有。
- 用户可在应用设置中选择模型和配置 API Key，最终存入 `tauri-plugin-store` 并传递给 agent 进程。
- 若用户切换到其他 ACP agent（如 Claude Code），则由该 agent 自行管理认证。
- `.env.example` 提供模板，`.env` 已加入 `.gitignore`，避免提交真实 key。

## 6. 平台策略：Mac 优先 + iPadOS 扩展

### 6.1 Mac 优先（MVP）

- **窗口模型**：单文档多面板工作台，参考 Obsidian / Notion 桌面版。
- **Bundle 目标**：`tauri.conf.json` 中 `bundle.targets` 优先 `app`、`dmg`；暂不做 Windows/Linux 发布包，但保留跨平台构建能力。
- **原生体验**：
  - 使用 macOS 原生菜单栏（Tauri `Menu` API）。
  - 快捷键遵循 macOS 习惯：`Cmd+O` 打开 Vault、`Cmd+S` 保存、`Cmd+Shift+N` 新建笔记。
  - 支持窗口大小记忆与恢复。
- **文件系统集成**：直接读写用户选择的本地目录，与 Finder 无缝协作。

### 6.2 iPadOS 扩展（后续版本）

Tauri 2 支持 iOS/iPadOS，但需针对触控设备做以下调整：

#### 6.2.1 构建与打包

- 使用 `tauri ios init` / `tauri ios build` 生成 Xcode 工程。
- 在 `tauri.conf.json` 中补充 iOS bundle 配置：
  - `bundle.ios.minimumSystemVersion` 设为 `16.0` 或更高。
  - 配置 `identifier`、`developmentTeam`。
- Rust 代码中避免使用桌面专属插件（如 `shell`），使用 iOS 兼容的 `fs`、`dialog`、`store`。

#### 6.2.2 UI 适配

| Mac 设计 | iPadOS 调整 |
|---|---|
| 三栏固定布局 | 侧边栏可收起，主编辑区全屏；使用 Sheet/Popover 展示右侧面板 |
| 鼠标悬停提示 | 长按菜单替代 |
| 小点击区域 | 增大按钮/节点热区至 44pt |
| 多窗口自由拖拽 | 分屏/Split View 适配；暂不支持多独立窗口 |
| PDF 阅读器 | 支持 pinch 缩放、滚动阅读、Apple Pencil 批注（后续） |
| 键盘快捷键 | 同时支持外接键盘快捷键与屏幕触摸操作 |

#### 6.2.3 文件系统差异

- iPadOS 沙盒限制更强，Vault 选择通过系统文件选择器（`UIDocumentPickerViewController`）完成。
- 考虑支持 iCloud Drive / Files App 中的 Vault，保持与 macOS 相同的目录结构。
- 文件监听策略在 iOS 上受限，可改为应用激活时增量扫描。

#### 6.2.4 Agent 与网络

- iPadOS 同样通过 ACP 协议与 Agent 通信，网络策略与 macOS 一致。
- 注意后台任务限制：长时间 Agent 调用需在前台保持连接或拆分为短请求。
- ACP agent 子进程在 iOS 上可能需要适配沙盒限制，需验证 `opencode acp` 在 iOS 的可用性。

### 6.3 跨平台共享代码

- **共享层**：Rust 业务逻辑（Vault、Markdown 索引、Agent 编排）完全跨平台。
- **前端适配层**：通过 `useMediaQuery` / 平台检测（Tauri `os` API）切换布局组件。
- **平台特定代码**：封装在 `src/platform/` 下，如 `desktop.ts`、`mobile.ts`。

## 7. 开发/构建/部署

### 7.1 本地开发

```bash
pnpm install
pnpm tauri dev
```

### 7.2 构建

```bash
pnpm tauri build
```

### 7.3 代码规范

- TypeScript：Biome 已配置，提交前通过 husky + lint-staged 自动检查。
- Rust：`cargo clippy` + `cargo fmt`。
- 提交信息遵循仓库现有风格：`feat:`, `fix:`, `docs:`, `chore:`。

## 8. 依赖清单（计划）

### 8.1 前端依赖

```json
{
  "@tauri-apps/api": "^2",
  "@tauri-apps/plugin-fs": "^2",
  "@tauri-apps/plugin-dialog": "^2",
  "@tauri-apps/plugin-store": "^2",
  "@tauri-apps/plugin-opener": "^2",
  "react": "^19.1.0",
  "react-dom": "^19.1.0",
  "zustand": "^5",
  "@platejs/core": "^53",
  "@platejs/markdown": "^53",
  "@platejs/ai": "^53",
  "@xyflow/react": "^12",
  "react-pdf": "^9",
  "lucide-react": "^0.x",
  "class-variance-authority": "^0.x",
  "clsx": "^2",
  "tailwind-merge": "^2"
}
```

### 8.2 Rust 依赖

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-store = "2"
tauri-plugin-opener = "2"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
pulldown-cmark = "0.12"
regex = "1"
liteparse = "0.2"
agent-client-protocol = "0.2"
rusqlite = { version = "0.32", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
anyhow = "1"
notify = "6"
dirs = "5"
walkdir = "2"
tempfile = "3"
```

### 8.3 可选依赖

| 场景 | 库 |
|---|---|
| LaTeX → Markdown | `pandoc`（外部 CLI，可选）、`texparser` |
| 数学公式渲染 | Plate math 插件 + `katex` |
| 全文搜索 | `minisearch`（前端）或 Rust `tantivy` / SQLite FTS5 |
| 加密存储 API Key | `keyring` crate |
| 可选 ACP Agents | `opencode`（默认内置）、`claude-code`、`gemini-cli` |
| iOS 原生能力 | `tauri-plugin-os`、Swift 桥接 |

## 9. 与 Roadmap 的对应关系

| Roadmap 版本 | 技术重点 |
|---|---|
| V0.1 | 完成 Tauri + React 工作台；接入 `fs`、`dialog`、`store`；实现 Vault 初始化与文件树。 |
| V0.2 | 实现 arXiv importer；source/PAPER.md / NOTES.md 生成；PAPERS.md 更新。 |
| V0.3 | 接入 ACP 协议 + 内置 opencode agent；Agent 工作流与读取路径回显；临时文件确认机制。 |
| V0.4 | 双链解析、反链面板、React Flow 图谱。 |
| V0.5 | 抽象 `Importer` trait；预留 PDF/DOI/BibTeX 扩展点。 |
| Later | iPadOS 构建、完整 PDF 批注、云同步、多 Agent 并行。 |

## 10. 风险与技术对策

| 风险 | 对策 |
|---|---|
| arXiv HTML/LaTeX 不可用 | 降级到 `liteparse` PDF 解析（支持 Markdown 输出 + OCR），并在 `source/PAPER.md` 中标记来源质量。 |
| Agent 输出破坏用户笔记 | 所有写入先走临时文件，用户确认后再覆盖；NOTES.md 用户修改部分优先保留。 |
| 文件索引性能差 | SQLite 缓存元数据与双链；增量索引，仅在 Vault 变化时重建受影响文件。 |
| SQLite 索引损坏或过期 | 索引只能从 Markdown 重建；启动时校验版本，异常时全量重建。 |
| iPadOS 文件沙盒限制 | 使用系统文件选择器；Vault 结构保持与 macOS 一致。 |
| 跨平台 UI 差异大 | 核心组件复用，布局通过平台适配层切换。 |

## 11. 相关文档

- `docs/PRD.md`：产品需求与验收标准。
- `docs/UI.md`：视觉主题与简约设计原则。
- `docs/ROADMAP.md`：版本规划与里程碑。
