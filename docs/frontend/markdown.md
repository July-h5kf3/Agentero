# Markdown 编辑

Plate WYSIWYG；用于普通笔记与论文 `NOTES.md`。磁盘上始终是标准 Markdown，保证 Vault 可被 Obsidian / VS Code 打开。

## 技术选型

| 库 | 用途 |
|---|---|
| `@platejs/*` 插件体系 | 基于某种 Slate 模型的富文本编辑 |
| `@platejs/markdown` | Markdown ↔ 编辑器文档 序列化 |
| `prettier/standalone` + `prettier/plugins/markdown` | 用户显式触发的整篇 Markdown 格式整理；首次使用时按需加载 |
| `@platejs/media` 等 | 图片等节点 |
| 自定义双链插件 | `[[...]]` 输入、高亮、跳转；序列化必须写回 `[[...]]` |

原则：所见即所得；与 shadcn/ui 工具栏风格一致；Agent 写回的 Markdown 经反序列化再展示。编辑期间的权威状态是 Plate AST，保存时再序列化为 Markdown；应用不会在每次渲染时重新读取一份隐藏的 Markdown 源字符串。

## 能力

- 自动保存；可选顶部格式工具栏（`showEditorToolbar`）。
- **Markdown 粘贴**：普通文本粘贴默认按 Markdown 反序列化，粘贴后光标保持在插入内容之后。
- **整理 Markdown 格式**：编辑器右键显式整理当前整篇文档；只读编辑器禁用。
- **Slash 格式命令**：在可编辑正文中输入 `/` 打开轻量命令列表；使用上下方向键选择、Enter 执行、Escape 关闭。
- **美元符号**：`\$a\$` 是普通文本，`$a$` 是行内公式；两者经编辑、粘贴、整理和保存后保持不同语义。
- **Obsidian Callout**：`> [!important]` 等标准 marker 渲染为专用块，正文继续使用既有段落、列表、公式与双链节点。
- **代码块操作**：编辑态悬停或聚焦代码块时，右上角依次显示语言选择与复制按钮；只读预览只显示复制按钮。
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

### 显式格式整理

“整理 Markdown 格式”采用 `Plate AST → Markdown → Prettier → Plate AST`，处理整篇文档，不读取选区的可见文本，也不会在输入、粘贴、打开或自动保存时隐式运行。

```text
右键整理
  → 序列化当前完整快照
  → 异步加载 Prettier 并格式化
  → 再次比对当前序列化结果
  → 结果过期：提示重试，不替换编辑器内容
  → 结果未变化：恢复焦点，不写 Undo history
  → 结果有效：反序列化并以一个 history batch 替换全文
  → 按文本上下文恢复选区与焦点
```

Frontmatter 当前保存在 Plate AST 之外，因此整理时继续字节级保留；这样格式整理产生的实际正文变化可以由一次 Undo 完整撤销。Prettier 固定使用 `proseWrap: "preserve"`、`embeddedLanguageFormatting: "off"` 与 `htmlWhitespaceSensitivity: "ignore"`，避免重排正文段落或 fenced code 内部语言。

### Slash 格式命令

输入 `/` 后，编辑器根据 `/` 后的连续文本过滤命令，条目统一显示图标与本地化文案。`/` 必须位于当前文本叶开头或紧跟空白，URL、转义斜杠、代码块和只读编辑器不会触发；Wiki 双链补全活跃时优先使用 Wiki 菜单，编辑器失焦后关闭菜单。执行前会再次核对当前光标、文本位置与 `/query`，选区已经移动或文本已变化时不会删除内容。

首版命令包含一级至三级标题、无序列表、有序列表、待办列表、引用、代码块、添加内部链接、添加外部链接和 Obsidian Callout。“添加内部链接”和“添加外部链接”复用右键菜单的模板插入逻辑，分别插入 `[[]]` 与 `[]()`，并把光标放到可继续输入的位置；内部链接会继续打开双链候选。其他命令直接调用现有 Plate 块、列表与代码转换；Callout 使用 Agentero 已有的 Obsidian 节点，默认类型为 `note`，可以保留 `/query` 前的当前块文本。Callout 内仍可用 Slash 命令调整正文格式，但不会提供嵌套 Callout。完整 Plate SlashKit 中的 AI、Toggle、Columns、TOC、Date、Excalidraw 与通用非 Obsidian Callout 不接入。

### Callout

支持以下 Obsidian 形式：

```md
> [!important] 可选标题
>
> 正文可包含列表、$公式$ 与 [[双链]]。
```

已知类型使用对应图标与 light/dark 主题；未知但合法的 type 使用通用样式，并按原始大小写写回 Markdown。没有显式标题时只显示本地化默认标题，不向源码补写标题。标题行通过 Markdown hard break 与正文相连时仍可识别；`\[!important]` 的开括号已经显式转义，因此保持普通引用文本。逐字符输入完整的 `> [!important] 可选标题` 后按 Enter，会转换为 Callout 并将光标放入正文；转换不依赖粘贴或格式整理。Slash 菜单也可以插入默认 `note` Callout。正文普通段落中的 Enter 只在当前 Callout 内拆分段落，不复制整个 Callout；列表和嵌套块继续使用各自插件的 Enter 语义。光标位于正文时，第一次 `⌘A` / `Ctrl+A` 只选中当前 Callout 的全部正文，再按一次才扩展为整篇文档。编辑态点击标题可直接行内编辑，标题输入框保持透明且无边框，失焦或按 Enter 保存，按 Escape 取消；点击标题左侧图标会打开带主题色图标和本地化名称的标准类型列表。修改后的元数据通过既有自动保存写回 marker。首版不支持自定义 type 输入、`+` / `-` 折叠 marker、嵌套 Callout、工具栏插入或拖拽换类型，这些语法保持普通引用文本。

## 代码

| 路径 | 职责 |
|---|---|
| `src/components/editor/` | Plate 编辑器 |
| `src/components/editor/plugins/callout-actions.ts` | Callout 类型与标题的校验和 AST 更新 |
| `src/components/editor/plugins/slash-command.ts` | Slash trigger、过滤、stale guard 与格式转换 |
| `src/components/editor/slash-command-menu.tsx` | 图标列表、键盘选择与浮层交互 |
| `src/components/editor/plugins/markdown-kit.tsx` | Markdown 解析、序列化、粘贴与 Callout portable rules |
| `src/lib/markdown/format.ts` | 按需加载的 Prettier Markdown 纯函数 |
| `src/lib/markdown/editor-format.ts` | stale guard、frontmatter 保留、selection bookmark 与单次 Undo 事务 |
| `src/lib/markdown/image.ts` | 内嵌图 IO / GC |
| `src/lib/markdown/save-state.ts` | 保存与冲突 |
| `src/lib/vault/fs-watch.ts` | 文件变更重载 |

Vault 文件约定：[../backend/data-model.md](../backend/data-model.md)。
