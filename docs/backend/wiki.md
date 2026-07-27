# 双链与图谱索引

从 Vault 内 Markdown 解析 Obsidian 兼容 `[[wikilinks]]`，构建入/出链与 Graph；**不**使用手工图数据库。

## 模型

- 格式：`[[Concept]]`、`[[papers/…/NOTES]]`、`[[note#heading]]`、`[[note#^block]]`。
- **单向写入** Markdown + 索引反查（不做目标文件自动插回链）。
- 未解析目标可为 stub 节点。
- 与 **文献引用图**（路线图 0.6）分层，边语义不复用。

## Host 能力

- 语义解析：文件、标题、block
- 反链 / 出链查询
- `graph_get_graph` 等（nodes / edges / center / depth）— 见 [api.md](api.md)
- 嵌入目标解析（供前端 `![[...]]`）
- 链接感知重命名/移动；标题重命名事务
- 索引：`.md` 变更防抖重建（前端调度 + Host 重建）

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
