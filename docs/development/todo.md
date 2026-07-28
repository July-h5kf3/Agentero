# Agentero TODO

仅列**未完成**项。当前发布 **`0.2.1`**。版本切片见 [`roadmap.md`](roadmap.md)；已实现能力见 [`../frontend/`](../frontend/index.md) · [`../backend/`](../backend/index.md)。

## 0.3 — 入库与 Agent 补强

- [ ] 关键词/描述 → Agent 候选列表确认后入库
- [ ] 本机 Translator sidecar 捆绑（可选）
- [ ] 前端 `afterPaperImport` 策略表统一各入口后置
- [ ] Zotero 迁移走 `paper_commit`；remote 镜像层收敛；统一 `paper:imported` 事件
- [ ] workflow prompt 自动注入 Vault 内 `AGENTS.md`
- [ ] 最近 Vault / UI 偏好与 XDG settings 完全对齐
- [ ] 设置「打开/导出日志文件夹」
- [ ] `catalog:export_papers_md`（Markdown 表）
- [ ] CLI：`graph` / `doctor` / shell completions
- [ ] CLI：`export papers-md`（随 Host 导出）

## 0.4 — Vault 采纳与导入加深

- [ ] Vault 采纳：`vault_inspect` + 安全补脚手架/catalog（不覆盖用户文件）
- [ ] 确认后：散落 PDF → paper 单元 + catalog
- [ ] catalog ↔ 磁盘漂移报告与可选清理
- [ ] Skill `vault-organize`；CLI `vault inspect|adopt`
- [ ] 从 PDF 识别 DOI/arXiv + 元数据确认增强
- [ ] MinerU BYOK 云端解析（可选）

## 0.5 — 广场 Plaza

设计稿：[`plaza.md`](plaza.md)

- [ ] 侧栏虚拟 `agentero:plaza` + Cool Papers WebView / 推荐 v0 / 播客占位
- [ ] 从发现流解析 URL → 魔棒入库（可后置）

## 0.6 — 引用关系

设计稿：[`pdf-analysis.md`](pdf-analysis.md)

- [ ] 本地 PDF citation/figure sidecar + Paper Content 侧栏
- [ ] 文内引用 hover → Paper Info
- [ ] cites/cited_by 缓存 + Connected Papers 式邻域 UI
- [ ] Agent：Explore citations / Map related work / Ingest neighborhood
- [ ] PDF 正文层检索；搜索历史/过滤；命令注册表 + MRU

## 0.7+ — 体验与平台

- [ ] Graph 全屏/聚焦、邻居高亮、节点搜索；边级增量索引
- [ ] tab pin、命名工作区会话
- [ ] PDF 无文本层降级；HTML 标注统一模型
- [ ] 翻译：更多 adapter / 消费方 / 词典
- [ ] 更多 Skills（多篇对比、Idea 评估、实验复现清单等）
- [ ] 自动 changelog；多 arch artifact 命名
- [ ] iOS/iPad 纯远程客户端：Bridge + 二维码配对 + relay E2EE + 远程 Agent（[`ios-remote.md`](ios-remote.md)）
- [ ] Git 集成 / 可选云同步
- [ ] 引用图 deeper（聚类、作者机构图）
- [ ] CLI domain 抽离独立 crate（仅当边界成为问题时）
