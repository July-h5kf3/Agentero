# Dockview 文档工作区

中间栏由 **单一全局 Dockview** 管理全部打开文档；标题栏**无**文档 tab 条。

## 行为

| 场景 | 行为 |
|---|---|
| 打开文档 | 文件树 / Library / 命令面板 → `openTab` → `workspaceRef.openPanel` |
| 首篇 paper | PDF/HTML 默认组 + `NOTES.md` 右分屏（阅读默认） |
| 再开 paper | body 走自由 dock 放置（当前组 / 默认，可再拖分屏）；NOTES 优先叠进已有笔记列；body↔NOTES **焦点仍同步** |
| 同步关闭 | 关 paper body 时一并关 NOTES；关 NOTES 保留 body |
| 文件树拖入 | left/right/above/below/within 分屏落点 |
| 关 panel | dockview X → `closeTab`；焦点 `onDidActivePanelChange` |
| 循环 | `⌥⌘←/→` 按 `api.panels` **视觉序** |
| NOTES 开关 | Layout 菜单 / 快捷键；优先叠右列 |
| 打开笔记 | 论文 tab 右键 /文件树论文行右键 → NOTES 进右侧阅读列（已开则聚焦） |
| 关光文档 | 回到全库 Library panel |

标签组 chip 的颜色菜单会将展开/收起 icon 染为对应颜色，并同步用于组内 tab 的强调线；清除颜色后恢复默认颜色。

布局只存 dockview `toJSON()`；path/mode 在 panel params。

启动恢复只 hydrate 每个 Dockview group 当前可见的 panel；隐藏标签在首次切换到前台时再读取资源。PDFium 保留当前可见与最近使用的至多两个 PDF viewer，本地 PDF `ArrayBuffer` 离开保留集合后释放，避免多标签工作区重启时并发加载全部 PDF 并长期占用 WebContent 内存。

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
