# 全局 Dockview 工作区

> V0.6 工作区。中间栏由 **单一全局 Dockview** 管理全部打开文档；标题栏不再放文档 tab 条，PDF/HTML 也不再在中间栏切换。布局、分屏、关闭、重排尽量使用 dockview 原生能力。

## 1. 模型选型

| 模型 | 结论 |
|---|---|
| 标题栏全局 tab + 每 tab 内 Dockview | 已废弃：双轨状态、手写 split 过多 |
| **中间栏全局 Dockview（本方案）** | 每个打开文档 = 一个 dockview panel；分屏/网格/tab 栈由 dockview 原生管理 |

## 2. 行为定义

- **打开文档**：文件树 / 库表 / 命令面板 → `openTab(path)` → React `tabs[]` 插入 + **`workspaceRef.openPanel(tab, placement)`**（命令式 `addPanel`，不再经 `pendingPlacement` state 往返）。
- **论文默认（阅读布局）**：
  - 首篇 paper：PDF/HTML 打开后，`NOTES.md` **右侧分屏**（左 body、右 NOTES）。
  - 再开新 paper：**叠到同一左右两栏**（body → 左列 `within`，NOTES → 右列 `within`），**不**再拆第三列；`paperReadingPlacements` 选锚点。
  - **同步切换**：激活某篇 body tab 时，若其 NOTES 已开则同时激活右列对应 NOTES；点 NOTES tab 亦同步左列 body（`handleActivePanelChange`）。
  - **同步关闭**：paper body（PDF/HTML）与 NOTES **双向**成对关闭（`readingPairCloseIds` → `closeTab`）；任一侧 X 都会摘掉 companion。
- **文件树拖入**：`onUnhandledDragOver.accept` + `onDidDrop` → `openTab(path, { placement })`；方向为 left/right/above/below/within（中心落点 = 同组 tab）；带 placement 时不套阅读布局叠放。
- **关 panel**：dockview 原生 tab X → `onDidRemovePanel` → React `closeTab`；**焦点听 `onDidActivePanelChange`**（并做阅读布局 companion 同步）。
- **循环 panel**（`⌥⌘←/→`）：`workspaceRef.cycleActive` 按 **`api.panels` 视觉顺序** 循环，不是 React 插入序。
- **NOTES 切换**：Layout 菜单 / 快捷键 → 开/关 NOTES；开启时优先叠入右列，否则首次右侧分屏。
- **无 PDF/HTML 切换条**：`mode` 在 `loadTabResources` 时按路径与可用资源确定。

## 3. 数据结构（`src/lib/workspace/tabs`）

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

## 4. 渲染（`DockWorkspace` = 全局 Dockview）

```
中间栏一个 <DockWorkspace ref={workspaceRef}>
  └─ DockviewReact
       components.pane → DocView（params.panelId）
       tabComponents.default → WorkspaceTab（标题 / HTML 切换 / 关闭）
       tabs[] ↔ syncPanels（仅 membership：add 缺失 / remove 多余）
       title/mode → panel.api.setTitle / updateParameters（独立通道）
       openPanel(tab, placement) → api.addPanel({ position }) 命令式
       cycleActive(delta) → api.panels 顺序
       layout ↔ toJSON（单路 120ms 防抖 onDidLayoutChange）/ fromJSON
       external DnD: onUnhandledDragOver + onDidDrop（仅文件树路径）
```

| 能力 | 谁负责 |
|---|---|
| Tab 标题 / 关闭 / 组内切换 | dockview 原生；有 `htmlUrl` 的 PDF/HTML panel 额外显示同 panel 的 HTML 切换图标 |
| Tab 右键菜单 | dockview `getTabContextMenuItems`（关闭 / 关闭其他 / 关闭全部 / 新建·移出标签组；**同组**；i18n；关闭经 `panel.api.close` → `onDidRemovePanel`） |
| Tab 组染色 / 命名 | dockview tab groups：chip **双击**内联重命名（`tabGroupChipComponent`）+ 右键 `rename` / `colorPicker` / 解散；色板复用论文标签 `tag-colors`（+ grey）；随 `toJSON()` 持久化。视觉：chip **无底色**（图标+名）；**展开**保留底部分组色线，**折叠**无 chip 下色条 |
| 键盘分屏导航 | `keyboardNavigation`（组内 `Ctrl+]`/`[`、组间 `F6`、键盘停靠 `Ctrl+M`）；与 App `⌥⌘←/→` 全局循环正交 |
| 上下左右分屏、多格网格 | dockview 原生 `addPanel({ position })` + 内部拖拽 |
| 落点 overlay | `dropOverlayModel`（content 25% 边激活）+ `onWillShowOverlay` / `onWillDrop` 否决未知外部拖拽 |
| 布局持久化 | **仅** `api.toJSON()`（params 含 path/mode；含 tab groups） |
| 打开放置 / 循环焦点 | `DockWorkspaceHandle`（imperative） |
| 文档内容 / 资源加载 | React `DocTab` + `DocView` |
| 侧栏 Paper Info / active id | `onDidActivePanelChange` → React |
| PDF panel 壳保活 | `addPanel({ renderer: 'always' })`（仅 `mode === 'pdf'`；非 PDF 为 `onlyWhenVisible`）；与 App `PDF_TAB_MOUNT_LRU` 叠加：壳常驻 + EmbedPDF 最多保活 N 份 |

## 5. 标题栏

- 仅保留侧栏折叠、Layout 菜单、Agent/Backlinks/Annotations、窗口控件。
- **无** `DocumentTabBar`；中间拖拽区为 `data-tauri-drag-region`。

## 6. 限制

- 浮动窗 / popout 关闭（`disableFloatingGroups`）。
- 文件树拖入开新 panel；dockview 内部 panel 拖拽重组不经 React。
- Library / Trash 也是普通 panel（可与其它文档并排）。

## 7. 拖拽分屏（DnD）可靠性

| 项 | 处理 |
|---|---|
| **内部 tab 分屏** | `DockviewReact` 使用 **`dndStrategy="pointer"`**（非默认 HTML5）。Tauri WKWebView 上 HTML5 DnD 不稳；pointer 用几何 hit-test，不依赖 `dragover` 冒泡。浮动/popout 已关，无跨窗 HTML5 需求。 |
| **HTML 面板 iframe** | `HtmlViewer` 在 `dragstart`…`dragend`/`drop` 期间给 sandboxed iframe 加 `pointer-events: none`，避免 HTML5 外部拖拽（文件树路径）经过 iframe 时 `dragover` 被吞、分屏 overlay 失效。PDF（EmbedPDF）无 iframe，不受影响。 |
| 文件树拖入 | 仍走 HTML5 `text/plain` + `onUnhandledDragOver` / `onDidDrop`；路径 payload 见 `tab-dnd.ts`。 |
| **overlay 几何** | `dropOverlayModel`：`content` 边激活 25%（默认 20%，宽 panel 更易分屏）；`header_space` 50%。外缘仍由 `dndEdges` 24px。 |
| **否决** | `onWillShowOverlay` / `onWillDrop`：内部 panel 拖拽一律放行；外部仅接受 vault 路径 payload，其它拖拽 `preventDefault`。 |

## 7.1 键盘导航（dockview `keyboardNavigation`）

与 App 全局快捷键**并存、职责不同**：

| 快捷键 | 作用域 | 说明 |
|---|---|---|
| `⌥⌘←` / `⌥⌘→` | App（`cycleActive`） | 按 `api.panels` **全局**视觉序循环 |
| `Ctrl+]` / `Ctrl+[` | dockview | **当前聚焦组内**下一 / 上一 tab |
| `F6` / `Shift+F6` | dockview | 下一 / 上一 **group**（多分屏格子） |
| `Ctrl+Shift+方向键` | dockview | 按空间方向聚焦相邻 group |
| `Ctrl+M` | dockview | 武装键盘停靠：方向键选目标 → `Enter` 停靠 / `Esc` 取消 |

默认避开 `Cmd`（如 `Cmd+M` 为 macOS 最小化窗口）。中间栏聚焦时生效。

## 7.2 Tab 组（染色 / 命名）

- **创建**：tab 右键「新建标签组」→ `createTabGroup` + `addPanelToTabGroup`（默认名 i18n、色 `blue`）。
- **重命名**：chip **双击**（或聚焦后 `F2`）进入内联编辑；Enter / 失焦保存，Esc 取消；空名回退默认名。
- **chip 右键**：重命名、调色板、解散（`getTabGroupChipContextMenuItems`）。
- **移出**：tab 已在组内时右键「从标签组移除」。
- **单击 chip**：折叠 / 展开组（与双击重命名错开短延时）。
- **折叠态**：dockview 底部分组线缩到 0；不在 chip 下补色条；组内 tab 由 dockview 隐藏。
- **持久化**：tab groups 含在 dockview `toJSON()` / `fromJSON()` 中，无需 React 额外状态。
- 典型用途：把同一主题的多篇 PDF + NOTES 编成带色底线的逻辑组（仍在同一 dock group 的 tab 条上）。

## 8. PDF 保活策略（壳 vs 引擎）

两层分工，不要混为一谈：

| 层 | 机制 | 目的 |
|---|---|---|
| dockview panel 壳 | PDF → `renderer: 'always'`；其它 mode → `onlyWhenVisible` | 同组切 tab 时 PDF 的 React 树不被 dockview 卸掉，LRU 才有机会命中 |
| EmbedPDF / PDFium | `App` `PDF_TAB_MOUNT_LRU`（默认 4）+ `DocView` `if (!active && !pdfKeepMounted) return null` | 限制主线程上同时存活的 PDF 文档数 |

`fromJSON` 恢复布局后按 `tab.mode` 再 `setRenderer`，避免旧快照缺 renderer 字段时丢失保活。

Dockview 拖动分隔条时会逐次更新 panel 几何，但布局持久化的 `onDidLayoutChange` 只在 sash 松手后触发。Dockview 7 默认在每个原始 `pointermove` 中同步执行递归 `layoutViews()`；高刷新输入设备可能在一帧内触发多次布局。`installDockviewSashFrameLoop` 因此只向 Dockview 转发每个 animation frame 的最后坐标，并在 `pointerup` 进入 Dockview 前同步刷新尚未处理的最终坐标；拖动状态还会阻止浏览器原生文本选择，并临时对 `.dv-view` / `.dv-render-overlay` 启用 layout + paint containment，限制 PDF 或编辑器的重排范围。PDF 的另一层成本来自 EmbedPDF viewport 的 `ResizeObserver`：每次宽高变化都会提交 viewport metrics，并带动 Scroll 可见页计算和 React 状态更新。`DockviewViewport` 保留 viewport DOM 边界对 panel 的即时跟随，sash 拖动期间仅暂停向 EmbedPDF 提交 resize metrics，因此旧页面布局会随实际边界连续裁剪或展开；松手后经单个 animation frame 提交最终尺寸。工具栏和 panel 边界始终跟随 Dockview，手动数值缩放不会被覆盖。

Dockview 7 为尚未测量的 inactive `renderer: 'always'` panel 创建 `.dv-render-overlay` 时，只先写入 `visibility: hidden` 与 `pointer-events: none`。此时 overlay 还没有 inline `left/top/width/height`，绝对定位的 static position 可能落在当前内容之后并扩大滚动区。`src/index.css` 因此在 `.agentero-dockview .dv-render-overlay` 提供 `top: 0; left: 0` 初始锚点；panel 完成布局后 Dockview 的 inline 坐标覆盖该 fallback。不得用 `display: none` 或卸载 overlay 规避空白，否则 PDF 壳保活失效。

## 9. 已用 / 刻意未用的 dockview 能力（7.0.x）

| 状态 | 能力 |
|---|---|
| 已用 | `dndStrategy: 'pointer'`、`dndEdges`、`dropOverlayModel`、`onWillDrop` / `onWillShowOverlay`、`disableFloatingGroups`、外部 DnD、`getTabContextMenuItems`、`getTabGroupChipContextMenuItems`、`tabGroupColors` / `tabGroupAccent`、`keyboardNavigation`、PDF `renderer: 'always'` |
| **模块注册** | dockview 7 的 ContextMenu / TabGroup / keyboard-dock 在 `dockview` 包 `registerModules`；`dock-workspace` 必须 `import "dockview"` 副作用导入，否则只引 `dockview-react` 时可能 tree-shake 掉注册 → **右键 tab 静默无菜单** |
| 刻意未用 | popout / floating（与 `⌘N` 多窗口策略一致）、全局 `defaultRenderer: 'always'`（非 PDF 不需要壳常驻） |
| backlog | `maximizeGroup`、watermark、header actions |
