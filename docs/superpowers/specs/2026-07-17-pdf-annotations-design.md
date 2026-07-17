# PDF 批注（Zotero 式）设计

日期：2026-07-17
状态：已通过 brainstorming，待写实现计划

## 背景与动机

PDF 划词菜单当前有 `高亮 / 笔记 / 提问 / 翻译` 四个动作。其中「笔记」只是把 `> 引文` 追加进论文的 `NOTES.md`（`src/App.tsx` `handleAddPdfNote` → `MarkdownEditor.appendMarkdown`）。用户希望这不再是「把选中文本塞进笔记文件」，而是像 Zotero 那样对某段原文做**批注**：给该段落写一条备注，并在界面上以「页边图标 + 右侧批注面板」的形式呈现，可跳转、编辑、删除。

核心决策（brainstorming 结论）：
- **批注 = 带备注的高亮**。
- **存储复用现有高亮 JSON**，新增 `comment` 字段。
- **完全独立于 NOTES.md**，不写入笔记文件。
- **显示方案 C**：页边图标 + 右侧批注面板，两者联动。

## 现状（关键文件）

- 主视图：`src/components/viewer/pdf-viewer.tsx`
  - 划词菜单处理：`handleMenuHighlight`（L1117-1140）、`handleMenuNote`（L1142-1146）、`handleMenuAsk`、`handleMenuTranslate`。
  - 高亮加载：打开 tab 时 `listPdfHighlights(paperAbsPath)`（L620-646）。
  - 点击已有高亮 → 浮动删除按钮（L1646-1666）→ `removeHighlight`（L1148-1157）。
- 划词菜单组件：`src/components/viewer/pdf-ask/selection-menu.tsx`（四个按钮，`handleNote` L58-66）。
- 高亮渲染层：`src/components/viewer/pdf-ask/highlight-layer.tsx`（`pointer-events-none` 的 amber rects）。
- 页边气泡（提问）：`src/components/viewer/pdf-ask/ask-gutter.tsx`（每页 chat 图标 pin，含碰撞避让 `layoutPins`）。
- 就地弹层：`src/components/viewer/pdf-ask/ask-popover.tsx`；定位工具 `src/lib/pdf-ask/geometry.ts`（`anchorFromSelection`、`popoverScreenPoint`、`PDF_PAGE_ATTR`）。
- 高亮数据模型：`src/lib/pdf-highlight/types.ts`（`PdfHighlight`），校验 `src/lib/pdf-highlight/schema.ts`，IO `src/lib/pdf-highlight/io.ts`（`createHighlight`/`writePdfHighlight`/`listPdfHighlights`/`deletePdfHighlight`；文件位于 `papers/<paperPath>/highlights/<id>.json`）。
- 笔记追加链路（将被移除）：`src/App.tsx` `handleAddPdfNote`（L411-453），prop 传递经 `src/components/layout/tab-center.tsx:126` `onAddPdfNote`，写入 `MarkdownEditor.appendMarkdown`（`src/components/editor/markdown-editor.tsx:150-171`）。
- 右栏容器与 tab：`src/App.tsx`（`rightSidebarTab: "agent" | "backlinks"`，状态 L188-217，挂载 L2329-2410）。
- per-tab 命令句柄的既有范式：`notesEditorHandles`（`src/App.tsx:2299-2302`）。

## 设计

### 1. 数据模型

在 `PdfHighlight` 增加可选字段：

```ts
type PdfHighlight = {
  version: 1;
  id: string;
  paperPath: string;
  createdAt: string;
  updatedAt: string;
  page: number;
  rects: PdfHighlightRect[];
  quote: string;
  color?: string;
  comment?: string; // 新增：非空即视为「批注」
};
```

- **批注 = `comment` 非空的高亮**；纯高亮 = 无 `comment` 或为空。
- 向后兼容：老 JSON 缺该字段照常解析；`version` 保持 `1`（仅新增可选字段，无破坏性变更，无需迁移）。
- `schema.ts` 的 `parsePdfHighlight` 放行可选 `comment`（string，可缺省）；写入前 `trim`，空串视为无备注（不写该字段或写空后不生成图标/卡片）。
- 更新备注时刷新 `updatedAt`，其余字段不变。
- 存储路径不变：`papers/<paperPath>/highlights/<id>.json`。

### 2. 划词创建与按钮调整

划词菜单把「笔记」替换为「**批注**」：
- 图标由 `NotebookPen` 换为批注类图标（如 `MessageSquareText` / `StickyNote`）；文案 i18n key `selection.note` 的值改为「批注 / Annotate」（或新增 `selection.annotate` key，弃用 `note`）。
- 点「批注」的流程：
  1. 复用现有 `handleMenuHighlight` 的几何逻辑（`mergeRectsByLine` + 丢弃零宽 caret）先创建并 `writePdfHighlight` 持久化一条高亮。
  2. 立即在该段附近弹出**备注输入浮框**（复用 `popoverScreenPoint` 定位，聚焦 textarea）。
  3. 保存（Enter / 失焦 / 保存键）→ 设置该高亮 `comment` 并 `writePdfHighlight` 回写；本地 state 同步。
  4. 若用户留空关闭 → 保留为纯高亮（不生成批注图标/卡片）。
- 「高亮」按钮保留：纯高亮，不弹备注框。
- 点击已有高亮：现有「删除」浮钮扩展为 **查看/编辑备注 + 删除**。于是纯高亮日后也可补批注，实现高亮/批注统一模型。

### 3. 显示（方案 C）

- **页边图标（新增 `annotation-gutter.tsx`）**：仿 `ask-gutter.tsx`，对**有 `comment`** 的高亮在页边渲染批注图标 pin，含碰撞避让。与提问气泡区分（不同图标；若同侧碰撞则错位或分列）。点 pin → 就地打开备注浮框（读/改）。
- **右侧「批注」面板（新增 `annotations-panel.tsx`）**：右栏 tab 扩展为 `"agent" | "backlinks" | "annotations"`。
  - 列出当前论文全部批注卡片：引文（截断，左侧色条）+ 备注 + 页码。按页码/创建时间排序。
  - 点卡片 → PDF 滚动跳转到该高亮所在页与位置并闪烁强调。
  - 卡片内提供编辑/删除。
  - 仅在有 PDF 论文 tab 打开时有内容；否则空状态提示。

### 4. 数据流与新增管线

- 打开 PDF 时 `listPdfHighlights` 已加载全部高亮；`annotations = highlights.filter(h => h.comment?.trim())` 派生用于面板与页边图标。
- 状态提升：高亮 state 目前只在 `pdf-viewer.tsx` 内。方案 C 的右侧面板位于 `App.tsx` 右栏，需要：
  - viewer 经回调把（只读）高亮列表上报 App，喂给批注面板；
  - viewer 暴露 per-tab 命令句柄 `PdfViewerHandle`（仿 `notesEditorHandles` 范式），至少含 `scrollToHighlight(id)`、`editComment(id)`、`deleteHighlight(id)`，供面板点卡片跳转/编辑/删除时回调。
- 任一增删改 → `writePdfHighlight` / `deletePdfHighlight` → 更新本地 `highlights` state → 面板与页边图标同步刷新。
- 备注浮框（新增 `annotation-popover.tsx` 或复用 popover 范式）：显示引文（只读）+ textarea + 保存/取消/删除，`popoverScreenPoint` 定位。

### 5. 清理与边界

- 移除 PDF→NOTES.md 的引文追加链路：`selection-menu` 的 note 分支不再调用 `onAddNote`；删除 `App.tsx` `handleAddPdfNote`、`tab-center.tsx` 的 `onAddPdfNote` 透传。若 `MarkdownEditor.appendMarkdown` 仅被此链路使用则一并移除；若他处仍用则保留。
- 写盘失败 → `notifyError` toast（现有范式）。
- 损坏 JSON → 沿用 `listPdfHighlights` 现有静默跳过。
- 删除高亮同时移除其批注（同一条记录）。
- 归一化 0–1 坐标不变，保证缩放/重渲染对齐（现有约束）。

### 6. i18n

- English 先行再 `zh-CN`（`src/i18n/locales/`）。
- 改/加词条：`selection.*`（批注按钮文案）、新增批注面板标题、编辑、删除、textarea 占位、空状态、页边 pin 的可访问名称/Tooltip。

### 7. 文档同步

- `docs/development/pdf-ask.md`：交互矩阵、数据模型（`comment` 字段）、模块清单（新增 gutter/panel/popover）。
- `docs/backend/data-model.md`：高亮 schema 增加 `comment`。
- `docs/development/roadmap.md` / `todo.md`：勾选/更新「PDF 标注系统」条目。
- 如涉及数据契约/Vault 语义变更，按 `AGENTS.md` 规则同步。

## 验证

`pnpm tauri dev` 手动走查：
1. 划词 → 批注 → 输入备注 → 出现页边图标 + 右侧面板卡片。
2. 关闭并重开该 PDF tab → 批注仍在（持久化）。
3. 点卡片 → 跳转并闪烁；点页边图标 → 就地开框读/改。
4. 编辑备注、删除批注均生效并同步两处。
5. 纯「高亮」仍正常；点纯高亮可补备注升级为批注。
6. 确认 `NOTES.md` 未被批注流程改动。

若 dev 端口被占用或无法做浏览器级验证，需明确说明。

## 明确的非目标

- 不写入原始 PDF 二进制（annotation 全走 sidecar JSON）。
- 不把批注搬进 catalog.sqlite 作为事实来源（保持 local-first、文件为准）。
- 不实现批注导出到 NOTES.md（本期完全独立；如需可作后续）。
- 不引入跨设备同步。
