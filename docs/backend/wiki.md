# 双链与图谱索引

从 Vault 内 Markdown 解析 Obsidian 兼容 `[[wikilinks]]`，构建入/出链与 Graph；**不**使用手工图数据库。

## 模型

- 格式：`[[Concept]]`、`[[papers/…/NOTES]]`、`[[note#heading]]`、`[[note#outer#inner#leaf]]`、`[[note#^block]]`；标题路径没有层数限制。
- 标题 fragment 以 `LinkFragment::Heading { path: Vec<String> }` 保存 Markdown 实际写下的完整路径或连续后缀。完整 heading path 是 canonical identity；任意长度的路径后缀仅在唯一命中时解析成功。
- **单向写入** Markdown + 索引反查（不做目标文件自动插回链）。
- 未解析目标可为 stub 节点。
- 与 **文献引用图**（路线图 0.6）分层，边语义不复用。

## Host 能力

- 语义解析：文件、标题、block
- 标题候选：展示 canonical `outer › inner` 路径，`insert_text` 写完整 `target#outer#inner`；查询中的 `#` 与 `›` 会归一到同一路径分隔语义
- 逐级补全：尾部 `#` 保留层级状态，已确认路径按 canonical ancestor path 的后缀匹配，候选只返回其直接子标题；可连续输入任意多个层级
- 反链 / 出链查询
- `graph_get_graph` 等（nodes / edges / center / depth）— 见 [api.md](api.md)
- 嵌入目标解析（供前端 `![[...]]`）
- 链接感知重命名/移动；标题重命名事务
- 索引：`.md` 变更防抖重建（前端调度 + Host 重建）

解析、resolve、嵌入投影、前端导航与显式标题重命名共享“唯一连续后缀”规则。完整路径自然也是自身后缀；不存在或有歧义的 path 保持既有 `invalidFragment` / `ambiguous` 结果，不回退到任意同名叶标题。标题重命名根据已解析的 canonical path 计算后缀在完整路径中的偏移，只改写引用实际包含的被改名段。

## 数据流（简）

```text
Vault Markdown 变更
  → 防抖 scheduleWikiRebuild
  → Host 解析 wikilink
  → 前端 Backlinks / Graph 刷新
```

## 代码

`src-tauri/src/features/wiki/`  
前端 UI：[../frontend/wiki.md](../frontend/wiki.md)
