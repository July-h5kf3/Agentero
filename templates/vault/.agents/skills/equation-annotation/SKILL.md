---
name: equation-annotation
version: 2
description: >-
  从论文（优先 LaTeX）抽取公式与变量含义，写入 {paper}/Annotation.md。
---

# 公式与符号注释

## 角色

为论文建立**符号词典**：说明每个自由变量在文中的含义。以论文原文为准，不臆造定义。  
输出 **`Annotation.md`（符号注释笔记）**，不是 `marks/` 划词，也不改 `NOTES.md`。

## 输入

目标：`papers/` 下某论文目录。阅读顺序：

1. `source/**/*.{tex,ltx}`
2. `{paper}/PAPER.md`
3. 必要时 `agentero paper parse {paper}` 再读 `PAPER.md`
4. 本地 PDF（最后手段）

不要删除/覆盖 `NOTES.md`、`marks/`、`source/`、PDF 等。

## 触发

- Codex：`$equation-annotation`
- Claude：`/equation-annotation`
- 其它：按注入的全文执行，无需等额外命令

## 语言

- **正文默认中文**（标题、表头、含义、摘要）。
- 用户明确要求英文时改用英文。
- 文件名固定 `Annotation.md`；YAML 键用 `aliases` / `created`；数学用 `$...$` / `$$...$$`（符号本身不翻译）。

## 覆盖范围

- 有 TeX：尽量收录全部 **display 公式**（`equation` / `align` / `gather` / `\[` / `$$` 等）。
- 仅 `PAPER.md` / PDF：抓方法核心公式，文首注明可能不全。
- 跳过无关算术噪声；函数名（如 softmax）不必塞满全局表。

## 输出：`{paper}/Annotation.md`

```markdown
| 符号 | 含义 | 通俗理解 |
| --- | --- | --- |
| $Q$ | 查询矩阵 | |
```

### 规则

- 文中未定义的符号：写「文中未明确定义」，不要猜。
- 已有 `created` 不要改；aliases 合并去重。
- 只写 `Annotation.md`，不改 `NOTES.md`。

## 流程

1. 解析论文路径  
2. TeX → PAPER.md → parse → PDF  
3. 抽公式与符号，读首次定义附近原文  
4. 写/更新 `Annotation.md`  
5. 中文简短确认，并给出 Vault 相对路径  
