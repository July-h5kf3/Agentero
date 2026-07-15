# AGENTS.md

## 项目概览

Motif 是一个基于 Tauri 2 + React 19 的本地优先科研工作台。Vault 中：人的笔记与 source 以 Markdown/文件为准；论文集合与结构化 metadata 以 `.motif/catalog.sqlite` 为准（可导出 `PAPERS.md` / BibTeX，非默认落盘）。离开应用后笔记与源文件仍可被外部工具读取。

## 当前应用形态

- 前端：`src/`（React、TypeScript、Tailwind CSS 4、shadcn/ui、AI Elements）。
- Host：`src-tauri/`（Rust、Tauri commands、本地文件系统、Wiki 索引、ACP Client）。
- 工作台布局：
  - 左侧：Vault 文件树（顶部虚拟 **Library** 节点、魔棒、新建文件/文件夹）+ 选中论文时 **Paper Info**；
  - 中间：无 Vault 时欢迎页；有 Vault 时为 **论文库表格**（Library / 根 / `papers/`）或 Markdown / PDF / HTML；
  - 右侧 Notes（Preview）：**仅**打开具体论文且 PDF/HTML 时显示该篇 `NOTES.md`；
  - 可选右侧栏：`Agent` 或 `Backlinks`。
- 论文库：`paper_list` 读 catalog；表头排序；横向/纵向滚动。虚拟路径 `motif:library` 不写盘。
- 魔棒入库：默认下载 PDF 到 `source/`；arXiv 另解压 e-print LaTeX。paper 行缺 PDF 或 arXiv 缺 TeX 时显示 Download；Library 行在库内仍有缺失时显示批量 Download。
- 路线图与 backlog：`docs/development/roadmap.md`、`docs/development/todo.md`（改能力时同步勾选）。
- 多窗口：`⌘N` → Host `window_new`；当前 Vault 按窗口 session 隔离，最近列表在 localStorage。
- Backlinks 右侧栏布局：上方 Backlinks，下方 Graph；Graph 不是独立顶层 tab。
- Graph 数据必须来自 Markdown 双链或可重建索引，不能来自手工维护的图数据库。

## 开发规则

- 优先做小而聚焦的改动，避免无关重构。
- 保持 local-first：不要引入私有存储作为事实来源。
- 未经明确确认，不要覆盖用户手写的 Vault 文件。
- 编辑或生成 Markdown 时保留 Obsidian 兼容的双链文本（`[[...]]`）。
- Agent 集成采用 BYOA：Motif 只配置如何启动本机 ACP-compatible Agent，不要求用户在 Motif 内填写模型 API Key。
- UI 保持简约：图标按钮必须有可访问名称和 Tooltip；除非是必要的空状态/错误说明，否则避免常驻解释文案。
- 国际化（i18n）：所有面向用户的文案都必须经 `t()` 走 `react-i18next`，禁止硬编码字符串。English（`en`）为源语言，新增文案先登记 `en` 词条再同步 `zh-CN`（`src/i18n/locales/`）。跨命名空间用 `t("ns:key")` 并在 `useTranslation([...])` 声明；React 之外用全局 `i18n.t()`。数字/日期用 `i18n.language` 格式化。详见 `docs/frontend/ui.md` §4.1。
- 修改后需要同步更新相关文档。如果修改了 UI、数据契约、发布流程或 Vault 语义，必须同步更新相关文档。并检查 Roadmap 和 Todo。

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
- `docs/backend/catalog.md`：论文目录库（`.motif/catalog.sqlite`）与导出。
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
