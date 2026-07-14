# 后端

后端是 Motif 的 Tauri Host 层，负责 Rust command、本地文件系统访问、可重建索引、Agent 进程编排，以及 Vault 数据模型。

## 技术选型

| 领域 | 选型 | 原因 |
|---|---|---|
| 桌面 Host | [Tauri 2](https://v2.tauri.app/) | 安全的原生壳、文件系统权限、小体积安装包。 |
| 系统语言 | [Rust](https://www.rust-lang.org/) | 适合安全本地 IO、异步服务和强约束命令契约。 |
| Tauri 文件系统 | [`tauri-plugin-fs`](https://v2.tauri.app/plugin/file-system/) | 读写用户选择的 Vault 文件。 |
| Tauri 对话框 | [`tauri-plugin-dialog`](https://v2.tauri.app/plugin/dialog/) | 原生文件夹 / 文件选择。 |
| Tauri Store | [`tauri-plugin-store`](https://v2.tauri.app/plugin/store/) | 计划用于持久化应用设置和最近 Vault。 |
| Agent 协议 | [Agent Client Protocol](https://agentclientprotocol.com/) | Motif 作为 Client 连接用户本机 BYOA Agent。 |
| Markdown 图谱 | Rust Wiki 索引 + Markdown 解析 | 反链和图谱必须从 Vault Markdown 派生。 |
| 缓存 | 计划使用 SQLite / `rusqlite` | 作为可重建查询缓存，不作为事实来源。 |
| PDF 解析 | 计划使用 `liteparse` / MinerU BYOK | 默认本地优先，可选云端提高解析质量。 |

## Host 职责

- 校验并访问用户显式选择的 Vault 路径。
- 读写 Markdown 与 metadata 文件。
- 从 Markdown 构建双链、反链和图谱索引。
- 向前端暴露 Tauri invoke commands 与 event streams。
- 启动并管理本地 ACP-compatible Agent，但不托管模型密钥。
- 确保缓存可从 Vault 文件重建。

## 本分区文档

- [`api.md`](api.md)：Tauri invoke commands、event contracts、Graph 与 Agent API 形状。
- [`data-model.md`](data-model.md)：Vault 结构、paper 文件、缓存规则、运行时类型。
- [`wikilinks.md`](wikilinks.md)：Obsidian 兼容双链语法、反链查询、图谱模型。

## 交叉引用

- 前端布局与 Graph 位置：[`../frontend/ui.md`](../frontend/ui.md)
- 产品需求：[`../development/prd.md`](../development/prd.md)
- 实现状态：[`../development/roadmap.md`](../development/roadmap.md)
