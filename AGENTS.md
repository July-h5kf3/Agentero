# AGENTS.md

## 项目概览

Motif 是一个基于 Tauri 2 + React 19 的本地优先科研工作台。Vault 是唯一事实来源：Markdown、`metadata.json`、源文件和可重建索引都必须能在离开应用后继续被外部工具读取。

## 当前应用形态

- 前端：`src/`（React、TypeScript、Tailwind CSS 4、shadcn/ui、AI Elements）。
- Host：`src-tauri/`（Rust、Tauri commands、本地文件系统、Wiki 索引、ACP Client）。
- 工作台布局：
  - 左侧：Vault 文件树与 paper 信息；
  - 中间：Markdown / PDF / HTML 视图；
  - 右侧 Preview：Markdown 渲染预览或 paper `NOTES.md`；
  - 可选右侧栏：`Agent` 或 `Backlinks`。
- Backlinks 右侧栏布局：上方 Backlinks，下方 Graph；Graph 不是独立顶层 tab。
- Graph 数据必须来自 Markdown 双链或可重建索引，不能来自手工维护的图数据库。

## 开发规则

- 优先做小而聚焦的改动，避免无关重构。
- 保持 local-first：不要引入私有存储作为事实来源。
- 未经明确确认，不要覆盖用户手写的 Vault 文件。
- 编辑或生成 Markdown 时保留 Obsidian 兼容的双链文本（`[[...]]`）。
- Agent 集成采用 BYOA：Motif 只配置如何启动本机 ACP-compatible Agent，不要求用户在 Motif 内填写模型 API Key。
- UI 保持简约：图标按钮必须有可访问名称和 Tooltip；除非是必要的空状态/错误说明，否则避免常驻解释文案。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm tauri dev
pnpm build
pnpm lint
pnpm format
pnpm tauri build
```

完成实现前运行最小必要验证。UI 改动优先启动应用并检查对应流程；如果 dev 端口被占用或无法做浏览器级验证，需要明确说明。

## 文档地图

- `README.md`：项目简介、快速开始、发布说明、文档入口。
- `docs/index.md`：整体技术框架与文档分层。
- `docs/frontend/index.md`：前端技术选型和 UI 文档入口。
- `docs/frontend/ui.md`：UI 布局、组件、快捷键和设置规范。
- `docs/frontend/components.md`：AI Elements 与组件约定。
- `docs/backend/index.md`：后端技术选型、API 和数据模型入口。
- `docs/backend/api.md`：Tauri command 与 event 契约。
- `docs/backend/wikilinks.md`：双链、反链与图谱设计。
- `docs/backend/data-model.md`：Vault 文件模型。
- `docs/development/index.md`：产品、路线图、开发和发布流程入口。
- `docs/development/roadmap.md`：实现状态与路线图。
- `docs/development/todo.md`：可执行 backlog。
- `docs/development/technical-plan.md`：跨前后端技术方案。
- `docs/development/prd.md`：产品需求和验收标准。

当修改 UI、数据契约、发布流程或 Vault 语义时，必须同步更新相关文档。

## 文档站与发布

- 文档站使用 [MkDocs](https://www.mkdocs.org/) 与 Read the Docs 主题。
- 本地预览：`python3 -m venv .venv-docs && . .venv-docs/bin/activate && pip install mkdocs==1.6.1 && mkdocs serve`。
- `.github/workflows/docs.yml` 在文档相关文件变更后构建文档并部署到 `gh-pages` 分支。

## Commit

- 提交信息必须符合 [Conventional Commits](https://www.conventionalcommits.org/) 规范。
- 一次提交只做一件事，避免混合多个 unrelated changes。

## 应用发布流程

推送 `v*` tag 会触发 `.github/workflows/release.yml`，在 macOS、Ubuntu、Windows 上构建 Tauri 安装包，并上传到草稿 GitHub Release。

不要在未补充文档和 secrets 说明的情况下加入签名、公证或自动发布步骤；本地开发构建不能依赖发布凭据。
