# 工作台壳

## 布局

- **左栏**：文件树 + 选中论文时 Paper Info（常驻 collapsible，`preserve-pixel-size`）。
- **中间**：无 Vault 欢迎页；有 Vault 时为全局 Dockview（见 [workspace.md](workspace.md)）。
- **右栏**（可选）：Agent 或 Backlinks（同样 collapsible）。
- 左右栏折叠：`⌥⌘S` / `⌘L`（不重叠）。

实现：`src/components/shell/`、`src/lib/shell/ui-store.ts`、`hooks/use-zen-layout.ts`。

## 欢迎页与多窗口

- 无 Vault：最近路径 MRU、打开 / 创建 / 从 Zotero 迁移。
- `⌘N` → Host `window_new`（`?fresh=1`）；Vault 与 dock 布局按窗口 session 隔离。
- 当前窗口 Vault：`sessionStorage`；MRU / 上次路径：`localStorage`。

## 全局 Toast

- 操作失败 / 警告：右上角 Sonner。
- API：`notifyError` / `notifyWarning`（`src/lib/core/notify.ts`）。
- 表单就地校验不走 Toast。

## 后台任务条

- 左下角：下载、入库、导入导出、paper-reader 等。
- Hover 实色不透明；任务可取消。
- 实现：`src/lib/core/background-tasks.ts`。

## 弹层栈

- `overlay-stack`：`Esc` / `⌘W` 先关最顶层 sheet/Dialog，再关 active panel。
- 仅剩全库 Library 且无弹层时，`⌘W` 关窗。

## 快捷键（壳层）

| 快捷键 | 行为 |
|---|---|
| `⌘,` | 开/关设置窗口 |
| `⌘N` | 新窗口 |
| `⌘W` / `Esc` | 关弹层 → 关 panel → 关窗 |
| `⌥⌘←/→` | 循环 Dockview panel |
| `⌥⌘Z` | Agent 禅模式 |
| `⌘P` / `⌘K` | 快速打开 |
| `⇧⌘P` | 命令面板 |
| `⇧⌘I` | 魔棒 |
| `⌘R` | 刷新文件树 |
| `⌥⌘R` | Finder 显示 |
| `⌥⌘T` | 终端打开 |
| `⌘⌫` | 移入回收站 |

完整快捷键绑定：`src/lib/shell/shortcuts.ts`。文案 i18n 见 [settings.md](settings.md)。

## 设计约定

- 工具栏优先图标 + `aria-label` + Tooltip；避免常驻解释文案。
- 基础组件 shadcn/ui；Chat/树 AI UI 用 AI Elements（[components.md](components.md)）。
