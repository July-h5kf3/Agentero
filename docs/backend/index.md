# 后端

后端是 Agentero 的 Tauri Host 层，负责 Rust command、本地文件系统访问、可重建索引、Agent 进程编排，以及 Vault 数据模型。

## 技术选型

| 领域 | 选型 | 原因 |
|---|---|---|
| 桌面 Host | [Tauri 2](https://v2.tauri.app/) | 安全的原生壳、文件系统权限、小体积安装包。 |
| 系统语言 | [Rust](https://www.rust-lang.org/) | 适合安全本地 IO、异步服务和强约束命令契约。 |
| Tauri 文件系统 | [`tauri-plugin-fs`](https://v2.tauri.app/plugin/file-system/) | 读写用户选择的 Vault 文件。 |
| Tauri 对话框 | [`tauri-plugin-dialog`](https://v2.tauri.app/plugin/dialog/) | 原生文件夹 / 文件选择。 |
| Tauri Store | [`tauri-plugin-store`](https://v2.tauri.app/plugin/store/) | 已接入插件；最近 Vault / 设置目前仍以前端 `localStorage` 为主，后续迁 Store。 |
| Agent 协议 | [Agent Client Protocol](https://agentclientprotocol.com/) | Agentero 作为 Client 连接用户本机 BYOA Agent。 |
| Markdown 图谱 | Rust Wiki 索引 + Markdown 解析 | 反链和图谱必须从 Vault Markdown 派生。 |
| 论文目录库 | SQLite / [`rusqlite`](https://crates.io/crates/rusqlite)（bundled） | `.agentero/catalog.sqlite`：论文集合 + metadata 权威存储；可选导出 `PAPERS.md` / BibTeX。 |
| 标识符查元数据 | 本机 [Zotero Translators](https://www.zotero.org/support/dev/translators) Runtime（旁路进程） | 魔棒：DOI / ISBN / PMID / arXiv 等；不链进主二进制。见 [`identifier-lookup.md`](identifier-lookup.md)。 |
| PDF 解析 | 计划使用 `liteparse` / MinerU BYOK | 默认本地优先，可选云端提高解析质量。 |

## Host 职责

- 校验并访问用户显式选择的 Vault 路径。
- 读写 Markdown 笔记与 source；维护 **catalog**（论文 meta / 集合）。
- 从 Markdown 构建双链、反链和图谱索引（paper 标题可读 catalog）。
- 向前端暴露 Tauri invoke commands 与 event streams。
- 启动并管理本地 ACP-compatible Agent，但不托管模型密钥。
- 提供 catalog 导出；双链等可重建索引与 catalog 分层清晰。
- 标识符魔棒入库：`lookup_import` 调用 Translator（可配置 base URL）、写 catalog，并**默认下载 PDF**（arXiv 另解压 LaTeX）；`paper_download_assets` 按需补下；无 TeX 时 **liteparse → `PAPER.md`**（`paper_parse_body`）；论文库列表 `paper_list`。
- 精读状态：`paper_set_is_read`（catalog `is_read`）；前端入库/单篇 Download 后可自动跑 paper-reader。
- 标签：`paper_set_tags` / `papers::set_tags`（catalog `tags_json` 整表替换）；Paper Info 编辑；Library 展示与筛选；CLI `set-tags` / `list --tag` / `tags`。
- 原生菜单 Close（`close_tab_or_window` / `⌘W`）：由前端先关文档 tab，无 tab 时关窗口（见 [`api.md`](api.md) §3.10）。
- **双链**索引（`graph_*`）与规划中的 **文献引用图**（roadmap V0.7）分层；后者不复用双链边语义。

## 本分区文档

- [`api.md`](api.md)：Tauri invoke commands、event contracts、Graph 与 Agent API 形状。
- [`data-model.md`](data-model.md)：Vault 结构、paper 文件、分层规则、运行时类型。
- [`catalog.md`](catalog.md)：Catalog SQLite schema、导出、Host 实现与迁移。
- [`identifier-lookup.md`](identifier-lookup.md)：魔棒（Identifier Lookup）与 Translator 后端（v0 已落地 + 后续扩展）。
- [`wikilinks.md`](wikilinks.md)：Obsidian 兼容双链语法、反链查询、图谱模型（与 V0.7 文献引用图边界见文内 §6.5）。
- CLI（MVP）：[`../development/cli.md`](../development/cli.md) — 代码在 **`cli/`**（bin `agentero`）；不迁 core，复用 `services/*`；Vault 管理/发现/暴露；无 BYOA。

## 交叉引用

- 前端布局与 Graph 位置：[`../frontend/ui.md`](../frontend/ui.md)
- 产品需求：[`../development/prd.md`](../development/prd.md)
- 实现状态：[`../development/roadmap.md`](../development/roadmap.md)
