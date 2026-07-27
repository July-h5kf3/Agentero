# Dockview 文档工作区

中间栏由 **单一全局 Dockview** 管理全部打开文档；标题栏**无**文档 tab 条。

## 行为

| 场景 | 行为 |
|---|---|
| 打开文档 | 文件树 / Library / 命令面板 → `openTab` → `workspaceRef.openPanel` |
| 首篇 paper | PDF/HTML 左 + `NOTES.md` 右分屏 |
| 再开 paper | 叠到同一左右两栏（body / NOTES **同步切换**）；不拆第三列 |
| 同步关闭 | paper body 与 NOTES 成对关闭 |
| 文件树拖入 | left/right/above/below/within 分屏落点 |
| 关 panel | dockview X → `closeTab`；焦点 `onDidActivePanelChange` |
| 循环 | `⌥⌘←/→` 按 `api.panels` **视觉序** |
| NOTES 开关 | Layout 菜单 / 快捷键；优先叠右列 |
| 关光文档 | 回到全库 Library panel |

布局只存 dockview `toJSON()`；path/mode 在 panel params。

## 面板类型

Library · Trash · PDF · HTML · 图片 · Markdown · 论文 NOTES。

## 代码

| 路径 | 职责 |
|---|---|
| `src/components/workspace/dock-workspace.tsx` | Dockview 宿主 |
| `src/lib/workspace/store.ts` | tabs / active / dockLayout |
| `src/lib/workspace/tabs/` | DocTab 模型、NOTES 分屏、持久化 |
| `src/lib/workspace/dock-registry.ts` | 命令式 dockview 句柄 |

PDF 分屏拖动性能：见 `docs/bug_fix/dockview-sash-pdf-resize-jank.md`。
