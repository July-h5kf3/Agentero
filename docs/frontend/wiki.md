# 双链 UI

右侧 **Backlinks** 栏：上方反链列表，下方 **双链 Graph**（非文献引用图）。

## 编辑器

- `[[wikilink]]` Live Preview；光标进入显示源码。
- 输入 `[[`：文件 / alias / 标题 / block 候选。
- 序列化必须写回 `[[...]]`（Obsidian 兼容）。
- `![[...]]`：嵌入 Markdown 区段、图片、PDF（只读）；普通编辑不刷新无关嵌入。

## Graph

| 项 | 说明 |
|---|---|
| 库 | `react-force-graph-2d`（Canvas 力导向） |
| 数据 | Host `graph_get_graph` → nodes / edges |
| 节点启发 | paper / note / index / stub |
| 壳 | 嵌在 Backlinks 下方，非独立顶层 tab |
| 交互 | 缩放、拖拽、点击打开文件/paper |

数据必须来自 Markdown 双链索引，不能来自手工图数据库。

## 链接修复（前端触发）

- Agentero 内重命名/移动：事务化修复已解析链接。
- 外部本地 rename：按设置 `ask` / `always`。
- 显式标题重命名事务。

## 代码

- 面板：`src/components/wiki/`
- 逻辑：`src/lib/wiki/`、`wiki-completion.ts`、`wiki-embed.ts`、`wiki-navigation.ts`、`wiki-heading-rename.ts`
- Host：[../backend/wiki.md](../backend/wiki.md)
