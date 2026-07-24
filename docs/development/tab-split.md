# 全局 Dockview 工作区

> V0.6 工作区。中间栏由 **单一全局 Dockview** 管理全部打开文档；标题栏不再放文档 tab 条，PDF/HTML 也不再在中间栏切换。布局、分屏、关闭、重排尽量使用 dockview 原生能力。

## 1. 模型选型

| 模型 | 结论 |
|---|---|
| 标题栏全局 tab + 每 tab 内 Dockview | 已废弃：双轨状态、手写 split 过多 |
| **中间栏全局 Dockview（本方案）** | 每个打开文档 = 一个 dockview panel；分屏/网格/tab 栈由 dockview 原生管理 |

## 2. 行为定义

- **打开文档**：文件树 / 库表 / 命令面板 → `openTab(path)` → React `tabs[]` 插入 + **`workspaceRef.openPanel(tab, placement)`**（命令式 `addPanel`，不再经 `pendingPlacement` state 往返）。
- **论文默认**：paper（pdf/html）打开时，再开 `NOTES.md` 为**同一 group 内的 sibling tab**（`openPanel(..., { direction: "within", referencePanelId })`），与 PDF 共用 tab 条。
- **文件树拖入**：`onUnhandledDragOver.accept` + `onDidDrop` → `openTab(path, { placement })`；方向为 left/right/above/below/within（中心落点 = 同组 tab）。
- **关 panel**：dockview 原生 tab X → `onDidRemovePanel` → React 只删 `tabs[]` 数据；**焦点完全听 `onDidActivePanelChange`**（不按扁平列表另算 neighbor）。
- **循环 panel**（`⌥⌘←/→`）：`workspaceRef.cycleActive` 按 **`api.panels` 视觉顺序** 循环，不是 React 插入序。
- **NOTES 切换**：Layout 菜单 / 快捷键 → 开/关 NOTES 为同组 tab。
- **无 PDF/HTML 切换条**：`mode` 在 `loadTabResources` 时按路径与可用资源确定。

## 3. 数据结构（`src/lib/tabs.ts`）

```ts
export type DocTab = {
  id: string;           // path-derived
  path: string;
  kind: "library" | "trash" | "paper" | "file";
  title: string;
  mode: CenterViewMode; // 打开时确定，无 in-pane 切换
  // … resources / editor seeds …
};

// 布局不在 DocTab 上嵌套：
// App 持有 dockLayout: unknown | null  // api.toJSON()
// 每个 panel 的 params: { panelId, path, mode } 供 layout 单源持久化
```

- 所有打开文档是**扁平 peer**，不再有 `DocTab.panes` / `split`。
- 单实例：同一 path 只存在一个 panel；再打开则 `activatePanel`。

### 关键纯函数

| 函数 | 说明 |
|---|---|
| `insertPlaceholderTab` / `removeTab` / `patchTab` | 扁平列表增删改（`removeTab` **不**计算 neighbor active） |
| `createNotesSplitPane` | 从 paper 派生 NOTES panel |
| `tabHasNotesSplit(tabs, paper)` | NOTES 是否已在列表中 |
| `extractTabsFromLayout` / `panelPersistParams` | 从 layout 反推 tab 列表；写入 panel params |
| 持久化 | **只存 `{ layout }`**；restore 时从 layout.panels 的 params 反推 `tabs[]` + active |

## 4. 渲染（`TabWorkspace` = 全局 Dockview）

```
中间栏一个 <TabWorkspace ref={workspaceRef}>
  └─ DockviewReact
       components.pane → TabCenter（params.panelId）
       tabComponents.default → DockviewDefaultTab（原生标题/关闭）
       tabs[] ↔ syncPanels（仅 membership：add 缺失 / remove 多余）
       title/mode → panel.api.setTitle / updateParameters（独立通道）
       openPanel(tab, placement) → api.addPanel({ position }) 命令式
       cycleActive(delta) → api.panels 顺序
       layout ↔ toJSON（单路 120ms 防抖 onDidLayoutChange）/ fromJSON
       external DnD: onUnhandledDragOver + onDidDrop（仅文件树路径）
```

| 能力 | 谁负责 |
|---|---|
| Tab 标题 / 关闭 / 组内切换 | dockview 原生 |
| 上下左右分屏、多格网格 | dockview 原生 `addPanel({ position })` + 内部拖拽 |
| 布局持久化 | **仅** `api.toJSON()`（params 含 path/mode） |
| 打开放置 / 循环焦点 | `TabWorkspaceHandle`（imperative） |
| 文档内容 / 资源加载 | React `DocTab` + `TabCenter` |
| 侧栏 Paper Info / active id | `onDidActivePanelChange` → React |

## 5. 标题栏

- 仅保留侧栏折叠、Layout 菜单、Agent/Backlinks/Annotations、窗口控件。
- **无** `DocumentTabBar`；中间拖拽区为 `data-tauri-drag-region`。

## 6. 限制

- 浮动窗 / popout 关闭（`disableFloatingGroups`）。
- 文件树拖入开新 panel；dockview 内部 panel 拖拽重组不经 React。
- Library / Trash 也是普通 panel（可与其它文档并排）。
