# 开发

开发分区说明 Agentero 要构建什么、当前完成了什么、还剩什么，以及发布和文档如何维护。

## 技术与流程选型

| 领域 | 选型 | 原因 |
|---|---|---|
| 产品文档来源 | `docs/development/` 下的 Markdown | 需求和路线图可以在 Git 中 review、追踪和重构。 |
| 应用包管理 | [pnpm](https://pnpm.io/) | 快速、基于 lockfile 的 Node 依赖管理。 |
| TypeScript 质量 | [Biome](https://biomejs.dev/) | 前端代码与文档相关文件的格式化和检查。 |
| Rust 质量 | [`cargo fmt`](https://doc.rust-lang.org/cargo/commands/cargo-fmt.html) + [`cargo clippy`](https://doc.rust-lang.org/clippy/) | Rust 官方格式化与 lint 工具。 |
| 桌面构建 | [Tauri CLI](https://v2.tauri.app/reference/cli/) | 本地和 CI 中构建桌面应用。 |
| 发布 CI | [GitHub Actions](https://docs.github.com/actions) + [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) | `v*` tag 触发 macOS、Linux、Windows 安装包构建。 |
| 文档站 | [MkDocs](https://www.mkdocs.org/) + Read the Docs 主题 | 静态文档部署到 `gh-pages` 分支。 |

## 当前实现状态

| 区域 | 状态 | 摘要 |
|---|---|---|
| V0.1 工作台 | ✅ | 文件树（Finder / **回收站** / 多选拖拽）、Markdown IO + **内嵌图**、**文件监听**、Library + tags + **Rescan**、多窗口、catalog、后台任务条、全局 Toast |
| V0.2 标识符入库 | 🟡 精确路径 ✅ | 魔棒 + Translator、catalog 权威、**默认 PDF + arXiv TeX**、单篇/Library **补下缺失**；关键词 Agent 候选与 export 仍待 |
| V0.3 Agent | 🟡 | BYOA + ACP / Codex 原生 runtime、流式 UI、Sources、**paper-reader 自动+Zap**、**全局权限模式**、模型收藏；面板 workflow 与写入确认仍待 |
| V0.4 双链/图谱 | ✅ | Backlinks + Graph 同栏；`graph_get_graph` |
| 阅读增强 | 🟡 | 任意路径 PDF/图；**导航·适应整页·大纲·⌘F·真实 scale·平滑划词**；划词菜单 MVP；`highlights.md` 导出仍待 |
| 翻译服务 | ✅ 首版 | 应用级可插拔 TranslateService（free + BYOA Agent，无付费 API）；设置 → 翻译；见 [`translate.md`](translate.md) |
| V0.5 Importer | ⏳ | 本地 PDF / PdfParser 规划中 |
| V0.6 标签页与分屏 | 🟡 标签页 ✅ | **文档标签页已落地**（`⌘W` 关 tab / 无 tab 关窗）；**分屏（split）** 仍待 |
| V0.7 引用关系 | ⏳ | Connected Papers 式邻域、文内引用 hover→Info、引用 Agent 工作流（规划中） |
| CLI headless | ✅ MVP | `cli/` + workspace；`agentero` bin；Vault/catalog/import/export/`paper set-tags`；无 BYOA（见 [`cli.md`](cli.md)） |
| Vault 采纳 | ⏳ | 打开已有文件夹时自动发现/整理；编程 + 可选 Skill（见 roadmap） |
| Release CI | ✅ | `v*` tag → 三平台桌面安装包 + **CLI `agentero` 预编译包**（同草稿 Release） |

更细的勾选表见 [`roadmap.md`](roadmap.md)；可执行任务见 [`todo.md`](todo.md)。

## 本分区文档

- [`prd.md`](prd.md)：产品需求、范围、用户流程、验收标准。
- [`roadmap.md`](roadmap.md)：状态快照、完成项和优先级路线图。
- [`todo.md`](todo.md)：按 P0/P1/P2 拆分的可执行 backlog。
- [`technical-plan.md`](technical-plan.md)：跨前后端的技术方案和模块设计。
- [`cli.md`](cli.md)：CLI 语义与技术栈——目录 **`cli/`**，不迁 core，path 依赖 `agentero_lib`；Vault 管理/发现/暴露 + 文献基础；无 BYOA；Agent 友好 JSON（**MVP 已落地**）。
- [`pdf-ask.md`](pdf-ask.md)：PDF 划词提问（MVP 已落地；选区/双击/悬停 → 迷你问答 → JSON → 锚点图标）技术栈与数据契约。
- [`translate.md`](translate.md)：翻译服务（首版已落地；应用级可插拔 **免费 MT + BYOA Agent**；设置 → 翻译页；PDF 划词为首个消费方）。
- [`.md`](.md)：简短产品假设。

## 交叉引用

- 前端 UI 细节：[`../frontend/index.md`](../frontend/index.md)
- 后端数据与 API 契约：[`../backend/index.md`](../backend/index.md)
- 论文目录库 Catalog：[`../backend/catalog.md`](../backend/catalog.md)
- 魔棒与 Translator：[`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)
- 总体技术框架：[`../index.md`](../index.md)
