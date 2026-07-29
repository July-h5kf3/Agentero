# 双链 UI

右侧 **Backlinks** 栏：上方反链列表，下方 **双链 Graph**（非文献引用图）。

## 编辑器

- `[[wikilink]]` Live Preview；光标进入显示源码。
- 输入 `[[`：文件 / alias / 标题 / block 候选。
- 嵌套标题路径没有层数限制：`[[2026-W31#07-28 周二#复盘分析#paper 阅读]]`、同文件写法与对应 `![[...]]` 均合法。
- 完整路径是标题的 canonical identity；Markdown 引用也可省略开头祖先，使用任意长度的连续路径后缀，例如唯一时 `[[2026-W31#复盘分析#paper 阅读]]` 合法。后缀命中多个标题时返回歧义，不选择第一个结果。
- 每输入一个额外 `#`，其前面的路径段成为已确认父路径，候选只显示该父标题的直接子标题。父路径本身也按后缀匹配，因此可从省略祖先的标题继续逐级补全，且没有两级或其他固定深度限制。
- 标题候选显示 canonical 路径 `外层标题 › 内层标题`，选择候选后写回完整 `外层标题#内层标题`；手写的唯一后缀保持原文。查询接受源码分隔符 `#` 和候选展示分隔符 `›`，并保留用户已输入的文件 target、alias 与 embed 标记。
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
- 外部 rename 的双链修复与警告只关注 Markdown、PDF、受支持图片和疑似目录；JSON sidecar、临时文件等明确非链接目标仍刷新工作区，但不进入双链处理。
- 显式标题重命名事务。

标题重命名、跳转和嵌入继续消费同一个结构化 `LinkFragment.path: string[]`。该数组保存 Markdown 中实际写下的完整路径或连续后缀；解析成功后再映射到唯一 canonical heading path。显式标题重命名只改写引用中实际包含的被改名路径段，省略该祖先的后缀引用保持原文。

## 代码

- 面板：`src/components/wiki/`
- 逻辑：`src/lib/wiki/`、`wiki-completion.ts`、`wiki-embed.ts`、`wiki-navigation.ts`、`wiki-heading-rename.ts`
- Host：[../backend/wiki.md](../backend/wiki.md)
