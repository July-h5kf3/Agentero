# 开发

开发分区说明 Motif 要构建什么、当前完成了什么、还剩什么，以及发布和文档如何维护。

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

- V0.1 本地工作台基本完成：文件树、Markdown IO、paper 视图、设置与最近 Vault 恢复；**Create Vault**（含 catalog schema）已落地。
- V0.3 Agent 进行中：BYOA 注册表、ACP run-once、流式 UI 与 Sources 已有；workflow prompt 和写入确认仍待补齐。
- V0.4 反链与图谱基本完成：Backlinks 和 Graph 位于同一个右侧栏中。
- V0.2 arXiv 入库和 V0.5 Importer 架构仍在规划。
- Release CI 已支持 `v*` tag 构建 Tauri 安装包。

## 本分区文档

- [`prd.md`](prd.md)：产品需求、范围、用户流程、验收标准。
- [`roadmap.md`](roadmap.md)：状态快照、完成项和优先级路线图。
- [`todo.md`](todo.md)：按 P0/P1/P2 拆分的可执行 backlog。
- [`technical-plan.md`](technical-plan.md)：跨前后端的技术方案和模块设计。
- [`hypothesis.md`](hypothesis.md)：简短产品假设。

## 交叉引用

- 前端 UI 细节：[`../frontend/index.md`](../frontend/index.md)
- 后端数据与 API 契约：[`../backend/index.md`](../backend/index.md)
- 论文目录库 Catalog：[`../backend/catalog.md`](../backend/catalog.md)
- 魔棒与 Translator：[`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)
- 总体技术框架：[`../index.md`](../index.md)
