# Markdown 与双链

Agentero 的笔记就是普通 Markdown 文件。你可以在应用内编辑，也可以用任何外部编辑器打开。

## 基础 Markdown

```markdown
# 一级标题
## 二级标题

- 项目符号
- 另一个项目

1. 编号列表
2. 编号列表

**粗体**，*斜体*，`行内代码`

```rust
// 代码块
```

> [!NOTE]
> 支持 Obsidian 风格的 Callout。
```

## 公式

行内公式：`$E=mc^2$`

块级公式：

```markdown
$$\int_a^b f(x) dx$$
```

> [!TIP]
> 输入 `\$a\$` 会保持为普通文本；`$a$` 会渲染为公式。

## 双链

用双方括号链接到另一篇笔记：

```markdown
[[03 论文导入与管理]]
```

链接到笔记中的某个标题：

```markdown
[[03 论文导入与管理#Library]]
```

嵌套标题使用完整路径：

```markdown
[[03 论文导入与管理#导入#Zotero]]
```

Agentero 会索引所有 `[[...]]` 双链，用于 **Backlinks** 面板和 **Graph** 视图。

## 图片

在 Markdown 笔记中粘贴图片，Agentero 会自动把它存到该笔记的 `assets/` 文件夹：

```markdown
![示意图](./assets/diagram.png)
```

如果图片不再被引用，会被自动清理。

## 下一步

- [[02 Agent 与 Skill]]
- [[03 论文导入与管理]]
