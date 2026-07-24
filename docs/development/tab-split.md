# Tab 内分屏（split）

> V0.6 分屏 MVP 的设计与实现记录。标题栏全局 tab 条保持不动，分屏发生在**单个 tab 内部**：一个 tab = 一个工作区，最多左右两格（`primary | split`）。基于既有 `react-resizable-panels`，不引入 docking 库。

## 1. 模型选型

对比过三种模型：

| 模型 | tab 条位置 | 结论 |
|---|---|---|
| Docking 库（Dockview / flexlayout-react） | 每个分屏格自带 tab 栈，tab 条必须离开标题栏 | 与「标题栏全局单 tab 条」结构冲突，放弃 |
| Emacs/tmux（全局 tab 池 + 格子为视口） | 标题栏不动 | 需要「聚焦格」概念，交互解释成本高，放弃 |
| **分屏放进 tab 内部（本方案）** | 标题栏不动 | 格子属于 tab；切 tab 时整个分屏布局跟随；改动最小 |

## 2. 行为定义

- **论文默认分屏**：新建论文 tab（kind=paper 且 mode 为 pdf/html、有 `NOTES.md`）时，默认左 PDF、右 NOTES.md（WYSIWYG）。会话恢复按持久化内容还原，用户关掉的分屏不会复活。
- **拖拽触发**：
  - 拖标题栏 tab 到内容区右半落点 → 该 tab 成为当前 tab 的右格（原 tab 从 tab 条移除）；
  - 拖文件树节点到内容区右半落点 → 该路径以分屏打开。
- **⌘W 两段式**：有分屏先关分屏，再按才关 tab（无需聚焦格概念）。
- **⌘\\**：论文 tab 一键切换 NOTES 分屏（与标题栏 NotebookPen 按钮同一 handler）。
- **收编 Notes 列**：原右侧硬编码 NOTES 列（`showNotesOnRight` + `NotesEditorTab`）删除，由通用 split 取代；每 tab 独立分屏比例，右格可为任意文档（两篇 paper 并排）。

## 3. 数据结构（`src/lib/tabs.ts`）

```ts
export type DocTabBase = { /* 原 DocTab 全部字段：id/path/kind/title/mode/资源/编辑器状态 */ };
export type DocTab = DocTabBase & {
  split: DocTabBase | null;   // 右格；仅一层，不递归
  splitPct: number | null;    // 右格宽度百分比（null = 默认）
};
```

- 右格 pane 的 `id` 仍由 path 派生（与单开成 tab 时一致）→ PDF 阅读位置 / 高亮 / ask 线程持久化天然共享。
- **单实例规则**：同一 path 不允许同时存在于 tab 条与某个 split 中；打开一个已在 split 里的 path → 激活其宿主 tab。

### 纯函数（单测于 `test/tabs.test.ts`）

| 函数 | 说明 |
|---|---|
| `setTabSplit(prev, tabId, pane)` | 设置右格（已有则替换，返回被替换 pane 供 blob 回收） |
| `closeTabSplit(prev, tabId)` | 关闭右格，返回 removed pane |
| `moveTabIntoSplit(prev, sourceTabId, targetTabId, activeId)` | 拖 tab 并入 target 右格：source 从 tab 条移除并处理 activeId |
| `findTabHostingSplitPath(prev, path)` | 单实例规则查询 |
| `patchTabSplit(prev, tabId, patch)` | 给右格打 patch（dirty/seed 等） |
| `createNotesSplitPane(tab)` | 由 paper tab 合成 NOTES pane（复用 notesSeed，无二次 IO） |
| `removeTab` / `removeTabsUnderPath` | 连带回收 split blob；path 命中 split 时摘除 split |
| `syncTabSeedsForPath` / `reseedNotesTab` / `reseedMarkdownTab` | 同时遍历 split pane |
| 持久化 `PersistedTab` | 增 `split?: { path, mode }` 与 `splitPct?`；恢复时 split 走 `loadTabResources` |

## 4. 渲染（`App.tsx`）

```
tab.split == null →  <TabCenter tab={tab}/>（现状不变）
tab.split != null →
  <ResizableGroup direction="horizontal">
    <ResizablePanel minSize={220}> <TabCenter tab={tab}/> </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel minSize={220} defaultSize={splitPct ?? 40}>
      <SplitPaneHeader/>   ← 细头条：图标 + 标题 + dirty 圆点 + 关闭 X
      <TabCenter tab={tab.split}/>
    </ResizablePanel>
  </ResizableGroup>
```

- keep-alive 不变：tab 容器仍 `hidden` 切换，split pane 随宿主常驻。
- **pdfLru** 从 tab id 扩展为 pane id；`registerPdfHandle` / highlights / asks 回调按 pane id。
- pdfZen 只渲染聚焦 PDF pane，split 隐藏。
- 中间切到 markdown 模式且右格即该论文 NOTES 时隐藏 split，避免同文件双编辑器。

## 5. 拖拽落点（`src/components/layout/split-drop-overlay.tsx`）

- `document-tab-bar.tsx` 的 `onDragStart` 增 `dataTransfer.setData("application/x-agentero-tab", tab.id)`。
- 内容区 dragover 检测 tab 类型或文件树 `text/plain` 多行路径 payload → 显示右半高亮落点。
- drop：tab → `moveTabIntoSplit`；文件树路径 → `loadTabResources` 建 pane → `setTabSplit`。library/trash/目录拒绝并 toast。
- 与外部文件导入（`use-external-file-drop`）互不干扰：内部拖拽无 `Files` 类型。

## 6. MVP 限制

- 仅 2 格水平分屏；无竖直 / 网格 / 拖拽合并（roadmap 非目标）。
- library / trash tab 不参与分屏（筛选状态为全局单例）。
- 右格不可再作为拖拽源拖出（后续增强）。
