# 后端

后端是 Agentero 的 Tauri Host 层，负责 Rust command、本地文件系统访问、可重建索引、Agent 进程编排，以及 Vault 数据模型。

## 技术选型

| 领域 | 选型 | 原因 |
|---|---|---|
| 桌面 Host | [Tauri 2](https://v2.tauri.app/) | 安全的原生壳、文件系统权限、小体积安装包。 |
| 系统语言 | [Rust](https://www.rust-lang.org/) | 适合安全本地 IO、异步服务和强约束命令契约。 |
| Tauri 文件系统 | [`tauri-plugin-fs`](https://v2.tauri.app/plugin/file-system/) | 读写用户选择的 Vault 文件。 |
| Tauri 对话框 | [`tauri-plugin-dialog`](https://v2.tauri.app/plugin/dialog/) | 原生文件夹 / 文件选择。 |
| Tauri Store | [`tauri-plugin-store`](https://v2.tauri.app/plugin/store/) | 已接入插件；**应用设置**与 **Agent 注册表**已迁 XDG 文件（`~/.config/agentero/`）；最近 Vault 等仍以前端 `localStorage` 为主。 |
| Agent 协议 | [Agent Client Protocol](https://agentclientprotocol.com/) | Agentero 作为 Client 连接用户本机 BYOA Agent。 |
| Markdown 图谱 | Rust Wiki 索引 + Markdown 解析 | 反链和图谱必须从 Vault Markdown 派生。 |
| 论文目录库 | SQLite / [`rusqlite`](https://crates.io/crates/rusqlite)（bundled） | `.agentero/catalog.sqlite`：论文集合 + metadata 权威存储；可选导出 `PAPERS.md` / BibTeX。 |
| 标识符查元数据 | 本机 [Zotero Translators](https://www.zotero.org/support/dev/translators) Runtime（旁路进程） | 魔棒：DOI / ISBN / PMID / arXiv 等；不链进主二进制。见 [`identifier-lookup.md`](identifier-lookup.md)。 |
| PDF 解析 | 计划使用 `liteparse` / MinerU BYOK | 默认本地优先，可选云端提高解析质量。 |

## Host 职责

- 校验并访问用户显式选择的 Vault 路径。
- 读写 Markdown 笔记与 source；维护 **catalog**（论文 meta / 集合）。笔记内嵌图由前端写入 `{mdDir}/assets/`（见 [`data-model.md`](data-model.md)「Markdown 内嵌图片」）；Host 提供 fs 权限，无独立 image Tauri command。
- 从 Markdown 构建双链、反链和图谱索引（paper 标题可读 catalog）。
- 向前端暴露 Tauri invoke commands 与 event streams。
- 启动并管理 **ACP-compatible Agent**（现网：本机进程；规划中：远程 Vault 时经 SSH 在**远端**启动），但不托管模型密钥（BYOA）。远程设计见 [`../development/remote-vault.md`](../development/remote-vault.md)。
- 提供 catalog 导出；双链等可重建索引与 catalog 分层清晰。
- 标识符魔棒入库：`lookup_import` 调用 Translator（可配置 base URL）、写 catalog，并**默认下载 PDF**（arXiv 另解压 LaTeX）；`paper_download_assets` 按需补下；无 TeX 时 **liteparse → `PAPER.md`**（`paper_parse_body`）；论文库列表 `paper_list`。
- 精读状态：`paper_set_is_read`（catalog `is_read`）；前端入库/单篇 Download 后可自动跑 paper-reader。
- 标签：`paper_set_tags` / `papers::set_tags`（catalog `tags_json` 整表替换；元素可为字符串或 `{name,color?}` Apple 8 色）；Paper Info 增删与选色；Library 染色 chip 与筛选；CLI `paper tag list|set|add|rm` / `list --tag`（CLI 仅名称）。
- **Zotero Connector 兼容服务**（MVP）：本机 `127.0.0.1:23119` 兼容官方浏览器扩展保存协议 → 当前 Vault；与 Zotero 桌面端端口互斥、默认关；见 [`connector.md`](connector.md)。
- **Paper 入库流水线统一**（设计）：多入口应收敛为 Host `paper_commit` + 前端 `afterPaperImport`；见 [`paper-import-pipeline.md`](paper-import-pipeline.md)。
- 原生菜单 Close（`close_tab_or_window` / `⌘W`）：由前端先关文档 tab，无 tab 时关窗口（见 [`api.md`](api.md) §3.10）。
- **双链**索引（`graph_*`）与规划中的 **文献引用图**（roadmap V0.7）分层；后者不复用双链边语义。

## 本分区文档

- [`api.md`](api.md)：Tauri invoke commands、event contracts、Graph 与 Agent API 形状。
- [`data-model.md`](data-model.md)：Vault 结构、paper 文件、分层规则、运行时类型。
- [`catalog.md`](catalog.md)：Catalog SQLite schema、导出、Host 实现与迁移。
- [`identifier-lookup.md`](identifier-lookup.md)：魔棒（Identifier Lookup）与 Translator 后端（v0 已落地 + 后续扩展）。
- [`paper-import-pipeline.md`](paper-import-pipeline.md)：多入口入库现状、统一 `paper_commit` / `afterPaperImport` 设计与分期（**设计已落库**）。
- [`connector.md`](connector.md)：Zotero Connector 兼容 HTTP 服务（方案一：本机 23119；MVP 已落地）。
- [`wikilinks.md`](wikilinks.md)：Obsidian 兼容双链语法、反链查询、图谱模型（与 V0.7 文献引用图边界见文内 §6.5）。
- CLI（MVP）：[`../development/cli.md`](../development/cli.md) — 代码在 **`cli/`**（bin `agentero`）；path 复用 `features::{vault,catalog,import}` + `core::error`；Vault 管理/发现/暴露；无 BYOA。

## Host 源码布局（feature-first）

```text
src-tauri/src/
  app/           # run()、menu、logging、command 注册
  core/          # error、fs、paths、log_util
  features/      # 每域一文件夹（与前端 src/lib 对齐）
    vault/ catalog/ import/ wiki/ agent/ connector/ remote/ …
    # 每域：mod.rs 对外 API + commands.rs 薄壳 + 按需 models.rs
  lib.rs         # mod 声明 + pub 导出
  main.rs
```

入库相关在 **`features/import/`**（原 `lookup` + `pdf_parse` + `paper_import` + Zotero 迁移命令）。魔棒 Tauri command 名仍为 `lookup_import` 等（契约不变）。

## 交叉引用

- 前端布局与 Graph 位置：[`../frontend/ui.md`](../frontend/ui.md)
- 产品需求：[`../development/prd.md`](../development/prd.md)
- 实现状态：[`../development/roadmap.md`](../development/roadmap.md)
