---
name: equation-annotation
version: 3
description: >-
  解析论文当中的公式与变量含义，写入 {paper}/Annotation.md。
---

# 公式与符号注释

为论文建立**符号词典**表格：说明每个自由变量在文中的含义。以论文原文为准，不臆造定义。

## 输出：`{paper}/Annotation.md`

```markdown
| 符号 | 含义 | 通俗理解 |
| --- | --- | --- |
| $Q$ | 查询矩阵 | |
```

### 规则

- **正文默认中文**（标题、表头、含义、摘要）。符号本身不翻译。用户明确要求英文时改用英文。
- 优先阅读 LaTeX：尽量收录全部 **display 公式**（`equation` / `align` / `gather` / `\[` / `$$` 等）。
- 所有数学字符必须用 `$...$` 表达
- 文中未定义的符号：写「文中未明确定义」，不要猜。
- 只写 `Annotation.md`，不改 `NOTES.md`。
- 函数名（如 softmax）不必塞满全局表。
