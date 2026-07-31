# Agentero TODO

仅列**未完成**项。当前发布 **`0.2.1`**。版本切片见 [`roadmap.md`](roadmap.md)；已实现能力见 [`../frontend/`](../frontend/index.md) · [`../backend/`](../backend/index.md)。

## 0.3 — 入库与 Agent 补强

- [ ] 关键词/描述 → Agent 候选列表确认后入库
- [x] 魔棒解析 GitHub / `npx skills` → Skill 装入 `.agents/skills/`（[#118](https://github.com/poco-ai/Agentero/issues/118)，见 [../backend/skill-import.md](../backend/skill-import.md)；首版）
- [ ] 本机 Translator sidecar 捆绑（可选）
- [ ] 前端 `afterPaperImport` 策略表统一各入口后置
- [ ] Zotero 迁移走 `paper_commit`；remote 镜像层收敛；统一 `paper:imported` 事件
- [ ] workflow prompt 自动注入 Vault 内 `AGENTS.md`
- [ ] 最近 Vault / UI 偏好与 XDG settings 完全对齐
- [ ] 设置「打开/导出日志文件夹」
- [ ] `catalog:export_papers_md`（Markdown 表）
- [ ] CLI：`graph` / `doctor` / shell completions（只读 `wiki check` 已实现）
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

设计稿与实现：[../backend/citation-parsing.md](../backend/citation-parsing.md)

- [x] 参考文献元数据解析 M1：S2/Crossref 在线 + 本地 bib/bbl → `agentero-cite.json` sidecar + 库内匹配 + `citationOnlineEnabled` 开关（Host `features/refs/`）
- [x] 引用侧栏 References 卡片（右侧栏 tab：编号/标题/作者·年份·venue/DOI·arXiv 徽标/已入库打开/未入库导入/过滤/重解析）
- [x] PDF 文中 citation 交互：Link annotation 覆盖层（点击 GoTo 跳页 / URI 外链）+ hover 引用元数据预览 → References 卡片高亮滚动（`citation-links.tsx` / `pdf-citation-preview.tsx` / `citation-hover-store.ts`）
- [x] PDF 公式与视觉区域解释：选区/框选裁剪 → 多模态 Agent → 可追问的 Ask 卡片（[#134](https://github.com/poco-ai/Agentero/issues/134)）
- [ ] 反向联动：hover 引用卡片 → PDF 文中 anchor 高亮（需 anchors bbox）
- [ ] 本地 PDF citation/figure sidecar + Paper Content 侧栏
- [ ] Agent `#` 编号提及 + 引用卡片拖拽（citation-parsing M3/M5）
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
- [x] iOS/iPad 纯远程客户端 M2：Bridge + 二维码/链接配对 + relay E2EE + Library/阅读/NOTES + 远程 Agent（见 [移动端前端与远程架构](../frontend/mobile.md)）
- [ ] iOS/iPad M3：TestFlight 内测、多主机切换、iPad 双栏、wiki backlinks、离线体验打磨
- [ ] Git 集成 / 可选云同步
- [ ] 引用图 deeper（聚类、作者机构图）
- [ ] CLI domain 抽离独立 crate（仅当边界成为问题时）
