# Markdown 编辑

Plate WYSIWYG；用于普通笔记与论文 `NOTES.md`。磁盘上始终是标准 Markdown，保证 Vault 可被 Obsidian / VS Code 打开。

## 技术选型

| 库 | 用途 |
|---|---|
| `@platejs/*` 插件体系 | 基于某种 Slate 模型的富文本编辑 |
| `@platejs/markdown` | Markdown ↔ 编辑器文档 序列化 |
| `@platejs/media` 等 | 图片等节点 |
| 自定义双链插件 | `[[...]]` 输入、高亮、跳转；序列化必须写回 `[[...]]` |

原则：所见即所得；与 shadcn/ui 工具栏风格一致；Agent 写回的 Markdown 经反序列化再展示。

## 能力

- 自动保存；可选顶部格式工具栏（`showEditorToolbar`）。
- **内嵌图**（见下表）。
- **双链 / 嵌入**：见 [wiki.md](wiki.md)。
- **外部改盘**：无未存改动则重载；有未存则 toast；内容相等抑制自写回声。
- **保存冲突**：写盘前比对上次落盘内容；磁盘已被外部改则中止并警告。

## 内嵌图片

| 项 | 方案 |
|---|---|
| 落盘 | `{mdDir}/assets/`；正文 `![alt](./assets/file.ext)`（Obsidian 兼容） |
| 插入 | 粘贴 / 工具栏 → `writeVaultBytes` |
| 预览 | 相对路径 → fs `readFile` → `blob:`；**选中**节点显示 Markdown 源码 |
| GC | 引用计数归零且 managed `./assets/` 时删除文件 |

## 数据流

```text
打开文件
  → Host 读文本
  → @platejs/markdown 反序列化
  → Plate 渲染

保存
  → 序列化为 Markdown 文本
  → Host 写盘
  → watcher → 按需重建 wiki 索引
```

## 代码

| 路径 | 职责 |
|---|---|
| `src/components/editor/` | Plate 编辑器 |
| `src/lib/markdown/image.ts` | 内嵌图 IO / GC |
| `src/lib/markdown/save-state.ts` | 保存与冲突 |
| `src/lib/vault/fs-watch.ts` | 文件变更重载 |

Vault 文件约定：[../backend/data-model.md](../backend/data-model.md)。
