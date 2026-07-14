# Motif UI 规范

## 1. 主题

- 使用 tweakcn **modern-minimal** 主题：
  ```bash
  pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/modern-minimal.json
  ```
- 视觉原则：**尽量简约，减少不必要的元素**。

## 2. 文案 vs 图标

| 场景 | 规则 |
|---|---|
| 工具栏、侧边栏操作、可识别的动作 | **优先用图标**，不要用长按钮文案 |
| 图标含义 | 必须配 `aria-label`；悬停用 **Tooltip** 显示短标签（英文/中文均可，保持简短） |
| 页面主标题、空状态、错误、表单字段 | 可用文字；错误仅在发生时出现 |
| 解释性说明文案 | 默认不展示；避免常驻帮助段落挤占空间 |

### 2.1 侧边栏文件树（当前）

- 顶栏单行：左侧 Vault 名称（可截断）+ 右侧 **纯图标操作**。
- 动作映射（Lucide）：
  - 打开 Vault → `FolderSearch`
  - 刷新树 → `RefreshCw`（加载中可 spin）
  - 切回 Demo → `Sparkles`（仅在非 demo 时显示）
- **不要**使用「Open vault… / Refresh / Demo」等文字按钮。
- **不要**常驻「Demo tree — open a real folder…」类说明文字。

## 3. 布局

- 工作台：可伸缩侧边栏文件树 + Markdown + Preview。
- 边距、分割线保持轻量；控件密度偏紧凑（icon-xs / icon-sm）。
- 无障碍：图标按钮必须有可访问名称；焦点环使用主题 `ring`。

### 3.1 快捷键

| 快捷键 | 作用 |
|---|---|
| `⌘B` / `Ctrl+B` | 显示 / 隐藏左侧文件树侧边栏 |

- 在编辑区聚焦时同样生效；需 `preventDefault` 避免浏览器默认书签行为（Chrome 等）。

## 4. 组件基线

- UI 组件基于 **shadcn/ui + Radix**；图标统一 **Lucide React**。
- 优先复用已有 `Button`（`variant="ghost"` + `size="icon-xs"`）与 `Tooltip`，避免自定义花哨控件。
