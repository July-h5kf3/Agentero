# PDF 批注（Zotero 式）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 PDF 划词的「加入笔记」替换为 Zotero 式批注——对选中段落写备注，存进现有高亮 JSON（新增 `comment` 字段），并通过页边图标 + 右侧「批注」面板呈现，可跳转/编辑/删除，完全不写入 NOTES.md。

**Architecture:** 批注 = `comment` 非空的高亮，复用 `papers/<id>/highlights/<id>.json` 存储与既有渲染层。Phase 1 在 `pdf-viewer.tsx` 内完成创建、内联备注编辑器、页边图标、点击高亮的编辑/删除菜单（自成可用闭环）。Phase 2 把高亮列表与命令句柄提升到 `App.tsx`，新增右侧「批注」tab 面板，点卡片经 per-tab `PdfViewerHandle` 跳转/编辑/删除。

**Tech Stack:** React 19 + TypeScript、Tauri plugin-fs、react-pdf/pdfjs-dist、react-i18next、Vitest（lib 层单测）、Biome（lint/format）。

**Design spec:** `docs/superpowers/specs/2026-07-17-pdf-annotations-design.md`

**Conventions:**
- 每个 task 完成后 `pnpm run fix:ts`（Biome，pre-commit 也会跑），确保通过再 commit。
- lib 层用 Vitest TDD；UI 层用 `pnpm tauri dev` 手动验证（无组件测试基建）。
- 提交信息用 Conventional Commits，一次提交一件事。

---

## Phase 1 — 数据模型与 viewer 内批注

### Task 1: 高亮数据模型新增 `comment` 字段

**Files:**
- Modify: `src/lib/pdf-highlight/types.ts`
- Modify: `src/lib/pdf-highlight/schema.ts:30-41`
- Modify: `src/lib/pdf-highlight/io.ts:33-54`
- Create: `test/pdf-highlight.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test/pdf-highlight.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createHighlight } from "@/lib/pdf-highlight/io";
import { parsePdfHighlight } from "@/lib/pdf-highlight/schema";

const base = {
	version: 1,
	id: "h1",
	paperPath: "papers/1706.03762",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	page: 2,
	rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
	quote: "attention is all you need",
};

describe("pdf-highlight schema", () => {
	it("parses a highlight without comment (backward compatible)", () => {
		const h = parsePdfHighlight(base);
		expect(h).not.toBeNull();
		expect(h?.comment).toBeUndefined();
	});

	it("keeps a string comment", () => {
		const h = parsePdfHighlight({ ...base, comment: "这是动机" });
		expect(h?.comment).toBe("这是动机");
	});

	it("drops a non-string comment", () => {
		const h = parsePdfHighlight({ ...base, comment: 42 });
		expect(h).not.toBeNull();
		expect(h?.comment).toBeUndefined();
	});

	it("createHighlight carries an optional comment", () => {
		const h = createHighlight({
			paperPath: "papers/x",
			page: 1,
			rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
			quote: "q",
			comment: "note",
		});
		expect(h.comment).toBe("note");
		const plain = createHighlight({
			paperPath: "papers/x",
			page: 1,
			rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
			quote: "q",
		});
		expect(plain.comment).toBeUndefined();
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/pdf-highlight.test.ts`
Expected: FAIL（`createHighlight` 不接受 `comment`；`parsePdfHighlight` 不返回 `comment`）。

- [ ] **Step 3: 实现——types.ts 增加字段**

In `src/lib/pdf-highlight/types.ts`, add the field after `color?`:

```ts
	/** Reserved for future color palette; defaults to amber when absent */
	color?: string;
	/** Zotero-style annotation note; non-empty means this highlight is an annotation */
	comment?: string;
};
```

- [ ] **Step 4: 实现——schema.ts 放行可选 comment**

In `src/lib/pdf-highlight/schema.ts`, after the `if (typeof raw.color === "string") highlight.color = raw.color;` line (currently L40), add:

```ts
	if (typeof raw.color === "string") highlight.color = raw.color;
	if (typeof raw.comment === "string" && raw.comment.trim()) {
		highlight.comment = raw.comment;
	}
	return highlight;
```

- [ ] **Step 5: 实现——io.ts createHighlight 接受 comment**

In `src/lib/pdf-highlight/io.ts`, extend the `createHighlight` input type and body. Change the input signature (L33-40) to add `comment?: string;`, and after `if (input.color) highlight.color = input.color;` (L52) add:

```ts
		if (input.color) highlight.color = input.color;
		if (input.comment?.trim()) highlight.comment = input.comment;
		return highlight;
```

Add `comment?: string;` to the input object type alongside `color?: string;`.

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm exec vitest run test/pdf-highlight.test.ts`
Expected: PASS（4 项）。

- [ ] **Step 7: Commit**

```bash
git add src/lib/pdf-highlight/types.ts src/lib/pdf-highlight/schema.ts src/lib/pdf-highlight/io.ts test/pdf-highlight.test.ts
git commit -m "feat(pdf): add optional comment field to highlight model"
```

---

### Task 2: i18n 文案——「笔记」改「批注」+ 新词条

**Files:**
- Modify: `src/i18n/locales/en/viewer.json`
- Modify: `src/i18n/locales/zh-CN/viewer.json`

- [ ] **Step 1: 更新 en/viewer.json 的 `selection` 块**

Replace the `selection` object with:

```json
	"selection": {
		"menuLabel": "Selection actions",
		"highlight": "Highlight",
		"note": "Annotate",
		"ask": "Ask",
		"translate": "Translate",
		"noteAdded": "Added to notes",
		"removeHighlight": "Remove highlight",
		"editComment": "Edit note",
		"translateAction": "Translate this passage"
	},
```

- [ ] **Step 2: 新增 `annotations` 块到 en/viewer.json**

After the `pdfAsk` object (before `selection`), add:

```json
	"annotations": {
		"title": "Annotations",
		"empty": "No annotations yet. Select text in the PDF and choose Annotate.",
		"placeholder": "Write a note…",
		"save": "Save",
		"cancel": "Cancel",
		"delete": "Delete",
		"editorLabel": "Annotation note",
		"pinAria": "Open annotation: {{preview}}",
		"panelAria": "Annotations for this paper"
	},
```

- [ ] **Step 3: 同步 zh-CN/viewer.json 的 `selection` 块**

```json
	"selection": {
		"menuLabel": "选区操作",
		"highlight": "高亮",
		"note": "批注",
		"ask": "提问",
		"translate": "翻译",
		"noteAdded": "已加入笔记",
		"removeHighlight": "删除高亮",
		"editComment": "编辑批注",
		"translateAction": "翻译这段文字"
	},
```

- [ ] **Step 4: 新增 `annotations` 块到 zh-CN/viewer.json**

```json
	"annotations": {
		"title": "批注",
		"empty": "还没有批注。在 PDF 中选中文本并点「批注」。",
		"placeholder": "写点备注…",
		"save": "保存",
		"cancel": "取消",
		"delete": "删除",
		"editorLabel": "批注备注",
		"pinAria": "打开批注：{{preview}}",
		"panelAria": "本论文的批注"
	},
```

- [ ] **Step 5: 校验 JSON + commit**

Run: `pnpm run fix:ts` (Biome 会格式化/校验 JSON)
Expected: 无错误。

```bash
git add src/i18n/locales/en/viewer.json src/i18n/locales/zh-CN/viewer.json
git commit -m "i18n(viewer): rename note action to annotate and add annotation strings"
```

---

### Task 3: 内联批注编辑器组件

**Files:**
- Create: `src/components/viewer/pdf-ask/annotation-editor.tsx`

- [ ] **Step 1: 创建组件**

Create `src/components/viewer/pdf-ask/annotation-editor.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AnnotationEditorProps = {
	/** Screen point near the highlight (from popoverScreenPoint) */
	screen: { x: number; y: number };
	/** The highlighted passage, shown read-only */
	quote: string;
	/** Existing note text when editing; empty for a fresh annotation */
	initialComment?: string;
	/** Save the (possibly empty) note; empty means "no comment / plain highlight" */
	onSave: (text: string) => void;
	/** Delete the whole highlight */
	onDelete: () => void;
	/** Dismiss without saving */
	onClose: () => void;
};

const BOX_W = 260;

/** Floating note editor anchored next to a highlight. */
export function AnnotationEditor({
	screen,
	quote,
	initialComment,
	onSave,
	onDelete,
	onClose,
}: AnnotationEditorProps) {
	const { t } = useTranslation("viewer");
	const [text, setText] = useState(initialComment ?? "");
	const ref = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		ref.current?.focus();
	}, []);

	const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
	const vh = typeof window !== "undefined" ? window.innerHeight : 800;
	let left = screen.x;
	left = Math.min(Math.max(12, left), vw - BOX_W - 12);
	let top = screen.y;
	top = Math.min(Math.max(12, top), vh - 180);

	return (
		<div
			className={cn(
				"fixed z-50 flex w-[260px] flex-col gap-2 rounded-xl border border-border/80 bg-background p-3 shadow-2xl ring-1 ring-black/5 dark:ring-white/10",
			)}
			style={{ left, top }}
			role="dialog"
			aria-label={t("annotations.editorLabel")}
			onMouseDown={(e) => e.stopPropagation()}
		>
			<blockquote className="max-h-16 overflow-y-auto border-amber-400 border-l-2 pl-2 text-muted-foreground text-xs">
				{quote}
			</blockquote>
			<textarea
				ref={ref}
				className="min-h-16 w-full resize-none rounded-md border border-border/80 bg-transparent p-2 text-sm outline-none focus:ring-1 focus:ring-ring"
				placeholder={t("annotations.placeholder")}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						onSave(text);
					}
					if (e.key === "Escape") {
						e.preventDefault();
						onClose();
					}
				}}
			/>
			<div className="flex items-center justify-between">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="text-destructive hover:text-destructive"
					onClick={onDelete}
				>
					{t("annotations.delete")}
				</Button>
				<div className="flex items-center gap-1">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						{t("annotations.cancel")}
					</Button>
					<Button type="button" size="sm" onClick={() => onSave(text)}>
						{t("annotations.save")}
					</Button>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: 校验类型 + commit**

Run: `pnpm run fix:ts`
Expected: 无错误（若 `Button` 无 `size="sm"` 变体，改用现有变体，检查 `src/components/ui/button.tsx`）。

```bash
git add src/components/viewer/pdf-ask/annotation-editor.tsx
git commit -m "feat(pdf): add inline annotation note editor component"
```

---

### Task 4: 页边批注图标组件

**Files:**
- Create: `src/components/viewer/pdf-ask/annotation-gutter.tsx`

- [ ] **Step 1: 创建组件**

Create `src/components/viewer/pdf-ask/annotation-gutter.tsx`（复用 `ask-gutter.tsx` 的 `layoutPins` 碰撞思路，改用批注图标与 amber 配色）：

```tsx
import { MessageSquareText } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export type AnnotationPin = {
	id: string;
	/** 0–1 page-normalized anchor (top-right of the highlight) */
	x: number;
	y: number;
	preview: string;
};

type AnnotationGutterProps = {
	/** Pins for this page only */
	items: AnnotationPin[];
	activeId: string | null;
	onOpen: (id: string) => void;
};

const PILL = 20;
const GAP = 4;

function layoutPins(
	items: AnnotationPin[],
	pageW: number,
	pageH: number,
): Array<{ id: string; leftPct: number; topPct: number }> {
	const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
	const placed: Array<{ id: string; x: number; y: number }> = [];
	for (const it of sorted) {
		let x = it.x;
		let y = it.y;
		let guard = 0;
		while (guard < 12) {
			let hit = false;
			for (const p of placed) {
				const dx = (x - p.x) * pageW;
				const dy = (y - p.y) * pageH;
				if (Math.hypot(dx, dy) < PILL + GAP) {
					y += (PILL + GAP) / (pageH || 1);
					hit = true;
					break;
				}
			}
			if (!hit) break;
			guard += 1;
		}
		y = Math.min(0.98, Math.max(0.02, y));
		x = Math.min(0.98, Math.max(0.02, x));
		placed.push({ id: it.id, x, y });
	}
	return placed.map((p) => ({ id: p.id, leftPct: p.x * 100, topPct: p.y * 100 }));
}

/** Note icons next to annotated highlights; click opens the note editor. */
export function AnnotationGutter({
	items,
	activeId,
	onOpen,
}: AnnotationGutterProps) {
	const { t } = useTranslation("viewer");
	if (!items.length) return null;
	const laid = layoutPins(items, 600, 800);
	const byId = new Map(items.map((it) => [it.id, it]));

	return (
		<div className="pointer-events-none absolute inset-0 z-[9]" aria-hidden={false}>
			{laid.map((pos) => {
				const item = byId.get(pos.id);
				if (!item) return null;
				return (
					<button
						key={item.id}
						type="button"
						className={cn(
							"pointer-events-auto absolute flex size-6 -translate-y-1/2 items-center justify-center rounded-md border border-amber-600/40 bg-background text-amber-600 shadow-sm transition-transform hover:scale-110 dark:text-amber-400",
							activeId === item.id && "ring-2 ring-ring ring-offset-1",
						)}
						style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%` }}
						aria-label={t("annotations.pinAria", { preview: item.preview })}
						onClick={(e) => {
							e.stopPropagation();
							onOpen(item.id);
						}}
					>
						<MessageSquareText className="size-3.5" strokeWidth={2} />
					</button>
				);
			})}
		</div>
	);
}
```

> 注：批注 pin 锚点用高亮首个 rect 的右上（`x + w`, `y`），与提问气泡（选区中点）通常不重叠；若同页碰撞由各自 `layoutPins` 分别避让，MVP 接受偶发相邻。

- [ ] **Step 2: 校验 + commit**

Run: `pnpm run fix:ts`
Expected: 无错误（确认 `lucide-react` 有 `MessageSquareText`；若无则用 `StickyNote`）。

```bash
git add src/components/viewer/pdf-ask/annotation-gutter.tsx
git commit -m "feat(pdf): add annotation gutter pin component"
```

---

### Task 5: viewer 接入批注创建 + 编辑器 + 页边图标

**Files:**
- Modify: `src/components/viewer/pdf-viewer.tsx`（imports、state、handlers、render）

- [ ] **Step 1: 补充 imports**

In `src/components/viewer/pdf-viewer.tsx`, ensure the geometry helpers are imported. Find the import block that includes `clientPointInPage` (around L47) and make sure it also imports `findPageElByNumber` and `popoverScreenPoint` from `@/lib/pdf-ask/geometry`. Add the two component imports near the other `pdf-ask` component imports:

```tsx
import { AnnotationEditor } from "@/components/viewer/pdf-ask/annotation-editor";
import {
	AnnotationGutter,
	type AnnotationPin,
} from "@/components/viewer/pdf-ask/annotation-gutter";
```

- [ ] **Step 2: 新增 state（在 `highlightMenu` state 之后，约 L227）**

```tsx
	/** Inline note editor for an annotation, anchored to a highlight */
	const [commentEditor, setCommentEditor] = useState<{
		id: string;
		screen: { x: number; y: number };
	} | null>(null);
	/** Transient focus flash after jump-to-highlight from the panel */
	const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
		null,
	);
```

- [ ] **Step 3: 在切换论文的 reset effect 里清理新 state（约 L627-629）**

After `setHighlightMenu(null);` inside the `useEffect` that resets on `paperAbsPath` change, add:

```tsx
		setHighlightMenu(null);
		setCommentEditor(null);
		setActiveHighlightId(null);
```

- [ ] **Step 4: 新增 helper——打开编辑器**

Add near the menu handlers (before `handleMenuHighlight`, ~L1116):

```tsx
	const openCommentEditorFor = useCallback((id: string) => {
		const host = contentRef.current;
		const hl = highlightsRef.current.find((h) => h.id === id);
		if (!host || !hl) return;
		const pageEl = findPageElByNumber(host, hl.page);
		const screen = popoverScreenPoint(pageEl, hl.rects);
		if (screen) {
			setHighlightMenu(null);
			setCommentEditor({ id, screen });
		}
	}, []);

	const saveComment = useCallback(
		(id: string, text: string) => {
			const comment = text.trim();
			setHighlights((prev) =>
				prev.map((h) =>
					h.id === id
						? { ...h, comment: comment || undefined }
						: h,
				),
			);
			setCommentEditor(null);
			if (paperAbsPath) {
				const hl = highlightsRef.current.find((h) => h.id === id);
				if (hl) {
					void writePdfHighlight(paperAbsPath, {
						...hl,
						comment: comment || undefined,
					}).catch(() => undefined);
				}
			}
		},
		[paperAbsPath],
	);
```

- [ ] **Step 5: 替换 `handleMenuNote` 为 `handleMenuAnnotate`（L1142-1146）**

Replace:

```tsx
	const handleMenuNote = useCallback(() => {
		const quote = selectionMenu?.anchor.quote?.trim();
		if (quote) onAddNote?.(quote);
		// SelectionMenu shows its own confirmation, then calls onClose.
	}, [selectionMenu, onAddNote]);
```

with:

```tsx
	const handleMenuAnnotate = useCallback(() => {
		const sm = selectionMenu;
		if (!sm) return;
		setSelectionMenu(null);
		const quote = sm.anchor.quote?.trim();
		if (!quote || !sm.anchor.rects.length) return;
		const paperPath = paperRelPath || paperAbsPath || "paper";
		const hl = createHighlight({
			paperPath,
			page: sm.anchor.page,
			rects: mergeRectsByLine(
				sm.anchor.rects.filter((r) => r.w > 0 && r.h > 0),
			),
			quote,
		});
		setHighlights((prev) => [hl, ...prev]);
		window.getSelection()?.removeAllRanges();
		if (paperAbsPath) {
			void writePdfHighlight(paperAbsPath, hl).catch(() => undefined);
		}
		const host = contentRef.current;
		const pageEl = host ? findPageElByNumber(host, hl.page) : null;
		const screen = popoverScreenPoint(pageEl, hl.rects);
		if (screen) setCommentEditor({ id: hl.id, screen });
	}, [selectionMenu, paperAbsPath, paperRelPath]);
```

- [ ] **Step 6: SelectionMenu 的 `onNote` 改指向 `handleMenuAnnotate`（L1638）**

In the `<SelectionMenu ... />` JSX, change `onNote={handleMenuNote}` to `onNote={handleMenuAnnotate}`.

- [ ] **Step 7: SelectionMenu 组件去掉「已加入笔记」确认，直接触发**

In `src/components/viewer/pdf-ask/selection-menu.tsx`: replace the `handleNote` callback (L58-66) so it calls `onNote()` then `onClose()` immediately (no `noted` confirmation state), and remove the `noted` branch (L78-83) so the four buttons always render. Concretely:
- Delete the `noted` state, `timerRef`, and the `Check` import usage.
- Replace `handleNote` with:

```tsx
	const handleNote = useCallback(() => {
		onNote();
		onClose();
	}, [onNote, onClose]);
```

- Remove the `{noted ? (...) : (` wrapper so the `TooltipProvider` block renders unconditionally.

（保留 `onClick={handleNote}` 在批注按钮上；`selection.note` 现渲染为「批注」。`noteAdded` 词条可留作历史，不再引用。）

- [ ] **Step 8: 派生每页批注 pin，并渲染 AnnotationGutter（render，约 L1447 与 L1516-1524 附近）**

Where `pageHighlights` is computed (L1447), add below it:

```tsx
										const pageAnnotations: AnnotationPin[] = pageHighlights
											.filter((h) => h.comment?.trim())
											.map((h) => {
												const r = h.rects[0] ?? { x: 0, y: 0, w: 0, h: 0 };
												return {
													id: h.id,
													x: r.x + r.w,
													y: r.y,
													preview: h.comment ?? "",
												};
											});
```

Then inside the `<div data-pdf-ask-ui="">` that wraps `<AskGutter .../>` (L1516-1524), add the annotation gutter alongside it:

```tsx
									<div data-pdf-ask-ui="">
										<AskGutter
											items={pageSummaries}
											activeId={activeThreadId}
											onOpen={handleOpenPill}
											onEnter={cancelHoverHide}
											onLeave={scheduleHoverHide}
										/>
										<AnnotationGutter
											items={pageAnnotations}
											activeId={commentEditor?.id ?? activeHighlightId}
											onOpen={openCommentEditorFor}
										/>
									</div>
```

- [ ] **Step 9: HighlightLayer activeId 合并 flash（L1476-1479）**

Change `activeId={highlightMenu?.id ?? null}` to:

```tsx
												activeId={
													highlightMenu?.id ??
													commentEditor?.id ??
													activeHighlightId
												}
```

- [ ] **Step 10: 渲染 AnnotationEditor（在 SelectionMenu JSX 之后，highlightMenu 之前，约 L1644）**

```tsx
			{commentEditor
				? (() => {
						const hl = highlights.find((h) => h.id === commentEditor.id);
						if (!hl) return null;
						return (
							<div data-pdf-ask-ui="">
								<AnnotationEditor
									screen={commentEditor.screen}
									quote={hl.quote}
									initialComment={hl.comment}
									onSave={(text) => saveComment(hl.id, text)}
									onDelete={() => removeHighlight(hl.id)}
									onClose={() => setCommentEditor(null)}
								/>
							</div>
						);
					})()
				: null}
```

- [ ] **Step 11: 关闭 menus 的 effect 也关闭 commentEditor（约 L1160-1182）**

The `useEffect` that dismisses menus on outside pointerdown/Escape/scroll currently guards on `if (!selectionMenu && !highlightMenu) return;` and `closeAll` sets both to null. Leave `commentEditor` OUT of `closeAll` (the editor should not close on scroll/outside-click while typing; it closes via its own Save/Cancel/Escape). No change needed here, but verify the editor's own `onMouseDown stopPropagation` + `data-pdf-ask-ui` prevents the outside-pointerdown handler from closing sibling menus incorrectly.

- [ ] **Step 12: 手动验证 Phase-1 创建/编辑/图标**

Run: `pnpm tauri dev`（若端口被占用，说明无法浏览器验证并跳到 lint/commit）
验证：
1. 打开一篇 PDF，选中一段 → 菜单显示「批注」。
2. 点「批注」→ 出现高亮 + 内联备注框（聚焦）。输入文字 → ⌘/Ctrl+Enter 或点保存 → 框关闭，页边出现批注图标。
3. 点页边图标 → 重新打开备注框可编辑；点删除 → 高亮与图标消失。
4. 关闭并重开该 PDF tab → 批注与备注仍在（JSON 持久化）。
5. 纯「高亮」按钮仍工作，无备注框、无页边图标。
6. 打开该论文的 `NOTES.md` 确认未被批注流程改动。

- [ ] **Step 13: lint + commit**

Run: `pnpm run fix:ts`
Expected: 无错误。

```bash
git add src/components/viewer/pdf-viewer.tsx src/components/viewer/pdf-ask/selection-menu.tsx
git commit -m "feat(pdf): create/edit annotations inline with gutter pins"
```

---

### Task 6: 移除 PDF→NOTES.md 的引文追加链路

**Files:**
- Modify: `src/components/viewer/pdf-viewer.tsx`（去掉 `onAddNote` prop）
- Modify: `src/components/layout/tab-center.tsx:126`（去掉 `onAddPdfNote` 透传）
- Modify: `src/App.tsx`（删除 `handleAddPdfNote` 及其 prop 传递）

- [ ] **Step 1: 移除 viewer 的 `onAddNote` prop**

In `src/components/viewer/pdf-viewer.tsx`:
- Delete the `onAddNote?: (quote: string) => void;` line from `PdfViewerProps` (L114-115) and its comment.
- Remove `onAddNote,` from the destructured props (L167).

- [ ] **Step 2: 移除 tab-center 的 onAddNote 使用**

In `src/components/layout/tab-center.tsx`, delete `onAddNote={(quote) => onAddPdfNote(tab, quote)}` (L126). Then remove the now-unused `onAddPdfNote` from this component's props type and its parameter list (search `onAddPdfNote` in the file; remove the prop declaration and any pass-through). If `onAddPdfNote` was required by a parent-facing props type in this file, delete that field.

- [ ] **Step 3: 移除 App.tsx 的 handleAddPdfNote 与传递**

In `src/App.tsx`:
- Delete the `handleAddPdfNote` useCallback (L425-453).
- Delete the `onAddPdfNote={handleAddPdfNote}` prop passed to the center/tab component (L2220).
- If `notesEditorHandles` (L412) and `MarkdownEditorHandle.appendMarkdown` are now unused anywhere else, leave `notesEditorHandles` if still used for reseed elsewhere; only remove `appendMarkdown` usage. Verify with a search: `grep appendMarkdown` — if the only caller was `handleAddPdfNote`, remove the `appendMarkdown` method from `MarkdownEditorHandle` and its implementation in `src/components/editor/markdown-editor.tsx:150-171`. If still referenced elsewhere, keep it.

- [ ] **Step 4: 验证 + 手动 smoke**

Run: `pnpm run fix:ts`
Expected: 无 TS/lint 错误、无 “unused” 报错。

Run: `pnpm tauri dev` — 划词「批注」仍工作；确认没有任何路径再写 NOTES.md。

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/pdf-viewer.tsx src/components/layout/tab-center.tsx src/App.tsx src/components/editor/markdown-editor.tsx
git commit -m "refactor(pdf): drop the selection-to-NOTES.md append path"
```

---

## Phase 2 — 右侧批注面板

### Task 7: viewer 暴露句柄与高亮变更回调

**Files:**
- Modify: `src/components/viewer/pdf-viewer.tsx`

- [ ] **Step 1: 定义并导出 `PdfViewerHandle` 类型**

Add near `PdfViewerProps` in `src/components/viewer/pdf-viewer.tsx`:

```tsx
export type PdfViewerHandle = {
	getHighlights: () => PdfHighlight[];
	scrollToHighlight: (id: string) => void;
	editComment: (id: string) => void;
	deleteHighlight: (id: string) => void;
};
```

Add two optional props to `PdfViewerProps`:

```tsx
	/** Register/unregister an imperative handle for the annotations panel */
	onHandle?: (handle: PdfViewerHandle | null) => void;
	/** Called whenever the highlight list changes (for the annotations panel) */
	onHighlightsChange?: (highlights: PdfHighlight[]) => void;
```

Add `onHandle,` and `onHighlightsChange,` to the destructured props.

- [ ] **Step 2: 实现 `scrollToHighlight`（放在 `openCommentEditorFor` 附近）**

```tsx
	const scrollToHighlight = useCallback((id: string) => {
		const host = contentRef.current;
		const hl = highlightsRef.current.find((h) => h.id === id);
		if (!host || !hl) return;
		const pageEl = findPageElByNumber(host, hl.page);
		pageEl?.scrollIntoView({ behavior: "smooth", block: "center" });
		setActiveHighlightId(id);
		window.setTimeout(() => {
			setActiveHighlightId((cur) => (cur === id ? null : cur));
		}, 1600);
	}, []);
```

- [ ] **Step 3: 上报高亮变更**

Add an effect after the highlights state/ref setup:

```tsx
	useEffect(() => {
		onHighlightsChange?.(highlights);
	}, [highlights, onHighlightsChange]);
```

- [ ] **Step 4: 注册/注销句柄**

Add an effect:

```tsx
	useEffect(() => {
		if (!onHandle) return;
		onHandle({
			getHighlights: () => highlightsRef.current,
			scrollToHighlight,
			editComment: openCommentEditorFor,
			deleteHighlight: removeHighlight,
		});
		return () => onHandle(null);
	}, [onHandle, scrollToHighlight, openCommentEditorFor, removeHighlight]);
```

- [ ] **Step 5: 验证 + commit**

Run: `pnpm run fix:ts`
Expected: 无错误。

```bash
git add src/components/viewer/pdf-viewer.tsx
git commit -m "feat(pdf): expose viewer handle and highlight-change callback"
```

---

### Task 8: 批注面板组件

**Files:**
- Create: `src/components/viewer/annotations-panel.tsx`

- [ ] **Step 1: 创建组件**

Create `src/components/viewer/annotations-panel.tsx`:

```tsx
import { MessageSquareText, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AnnotationRow = {
	id: string;
	page: number;
	quote: string;
	comment: string;
};

type AnnotationsPanelProps = {
	items: AnnotationRow[];
	onJump: (id: string) => void;
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
	className?: string;
};

/** Right-sidebar list of the active paper's annotations. */
export function AnnotationsPanel({
	items,
	onJump,
	onEdit,
	onDelete,
	className,
}: AnnotationsPanelProps) {
	const { t } = useTranslation("viewer");

	return (
		<div
			className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}
			aria-label={t("annotations.panelAria")}
		>
			<div className="flex items-center gap-2 border-b px-3 py-2 text-muted-foreground text-xs">
				<MessageSquareText className="size-3.5" />
				{t("annotations.title")}
			</div>
			{items.length === 0 ? (
				<p className="px-3 py-6 text-center text-muted-foreground text-xs">
					{t("annotations.empty")}
				</p>
			) : (
				<ul className="min-h-0 flex-1 overflow-y-auto p-2">
					{items.map((a) => (
						<li key={a.id} className="mb-2">
							<div className="group rounded-lg border border-border/70 p-2 hover:border-border">
								<button
									type="button"
									className="block w-full text-left"
									onClick={() => onJump(a.id)}
								>
									<span className="text-[10px] text-muted-foreground uppercase">
										p.{a.page}
									</span>
									<blockquote className="mt-0.5 line-clamp-2 border-amber-400 border-l-2 pl-2 text-muted-foreground text-xs">
										{a.quote}
									</blockquote>
									<p className="mt-1 whitespace-pre-wrap text-foreground text-sm">
										{a.comment}
									</p>
								</button>
								<div className="mt-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={t("selection.editComment")}
										onClick={() => onEdit(a.id)}
									>
										<Pencil className="size-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={t("annotations.delete")}
										onClick={() => onDelete(a.id)}
									>
										<Trash2 className="size-3.5" />
									</Button>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
```

- [ ] **Step 2: 验证 + commit**

Run: `pnpm run fix:ts`
Expected: 无错误（确认 `Button` 有 `size="icon-xs"`，workspace-header 已在用）。

```bash
git add src/components/viewer/annotations-panel.tsx
git commit -m "feat(pdf): add annotations side panel component"
```

---

### Task 9: App 接线——per-tab 句柄、高亮态、右栏 tab

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/tab-center.tsx`
- Modify: `src/components/layout/workspace-header.tsx`

- [ ] **Step 1: App 扩展右栏 tab 类型与状态**

In `src/App.tsx`:
- Change `useState<"agent" | "backlinks">("agent")` (L192) to `useState<"agent" | "backlinks" | "annotations">("agent")`.
- Change `openRightTab` param type (L580) to `(tab: "agent" | "backlinks" | "annotations")`.

- [ ] **Step 2: App 新增 per-tab 句柄与高亮态**

Add near `notesEditorHandles` (L412):

```tsx
	/** PDF viewer imperative handles by tab id (for the annotations panel). */
	const pdfViewerHandles = useRef(new Map<string, PdfViewerHandle>());
	/** Latest highlights per PDF tab id, for the annotations panel. */
	const [pdfHighlightsByTab, setPdfHighlightsByTab] = useState<
		Record<string, PdfHighlight[]>
	>({});
```

Import the types at top of `App.tsx`:

```tsx
import type { PdfViewerHandle } from "@/components/viewer/pdf-viewer";
import type { PdfHighlight } from "@/lib/pdf-highlight/types";
import type { AnnotationRow } from "@/components/viewer/annotations-panel";
```

- [ ] **Step 3: App 派生活动 tab 的批注行 + 面板动作**

Add (after `pdfHighlightsByTab` declaration; assumes `activeTabId` exists — confirm the active-tab id variable name and adjust):

```tsx
	const activeAnnotations = useMemo<AnnotationRow[]>(() => {
		const list = activeTabId ? pdfHighlightsByTab[activeTabId] : undefined;
		if (!list) return [];
		return list
			.filter((h) => h.comment?.trim())
			.map((h) => ({
				id: h.id,
				page: h.page,
				quote: h.quote,
				comment: h.comment ?? "",
			}))
			.sort((a, b) => a.page - b.page);
	}, [activeTabId, pdfHighlightsByTab]);

	const annotationAction = useCallback(
		(fn: (h: PdfViewerHandle) => void) => {
			if (!activeTabId) return;
			const h = pdfViewerHandles.current.get(activeTabId);
			if (h) fn(h);
		},
		[activeTabId],
	);
```

> `useMemo`/`useCallback`/`useRef` 已在文件中使用；确认 `activeTabId` 就是当前活动 tab id 的变量名（若不同，替换为实际名字）。

- [ ] **Step 4: App 传高亮回调与句柄给 center**

At the center/tab component usage where `onAddPdfNote` used to be (near L2220 now removed), pass registration callbacks down. Add props on the `<TabCenter .../>` (or equivalent) call:

```tsx
							registerPdfHandle={(tabId, handle) => {
								if (handle) pdfViewerHandles.current.set(tabId, handle);
								else pdfViewerHandles.current.delete(tabId);
							}}
							onPdfHighlightsChange={(tabId, list) =>
								setPdfHighlightsByTab((prev) => ({ ...prev, [tabId]: list }))
							}
```

- [ ] **Step 5: tab-center 透传到 PdfViewer**

In `src/components/layout/tab-center.tsx`:
- Add to its props type: `registerPdfHandle: (tabId: string, handle: PdfViewerHandle | null) => void;` and `onPdfHighlightsChange: (tabId: string, list: PdfHighlight[]) => void;` (import the two types).
- In the `tab.mode === "pdf"` branch (L114-129), pass:

```tsx
					onHandle={(h) => registerPdfHandle(tab.id, h)}
					onHighlightsChange={(list) => onPdfHighlightsChange(tab.id, list)}
```

- [ ] **Step 6: workspace-header 新增「批注」toggle 按钮**

In `src/components/layout/workspace-header.tsx`:
- Change `onOpenRightTab` prop type (L43) to `(tab: "agent" | "backlinks" | "annotations") => void`; same for the `rightSidebarTab` prop type if it's typed as a union.
- Import an icon: add `MessageSquareText` to the `lucide-react` import.
- After the backlinks `<Tooltip>` block (ends L231), add:

```tsx
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													type="button"
													variant="ghost"
													size="icon-xs"
													aria-label={t("titlebar.annotationsPanel")}
													aria-pressed={rightSidebarTab === "annotations"}
													className={cn(
														rightSidebarTab === "annotations" &&
															"bg-muted text-foreground",
													)}
													onClick={() => onOpenRightTab("annotations")}
												>
													<MessageSquareText className="size-3.5" />
												</Button>
											</TooltipTrigger>
											<TooltipContent side="bottom">
												{t("annotations.title", { ns: "viewer" })}
											</TooltipContent>
										</Tooltip>
```

Add i18n key `titlebar.annotationsPanel` to the header's namespace (find where `titlebar.backlinksPanel` lives — likely `common`/`app` namespace en+zh) with values `"Annotations"` / `"批注"`.

- [ ] **Step 7: App 渲染批注面板分支**

In the right-sidebar `ResizablePanel` (after the `backlinks` branch, before `</ResizablePanel>` at L2409), add:

```tsx
								{rightSidebarOpen &&
								!agentZenMode &&
								rightSidebarTab === "annotations" ? (
									<AnnotationsPanel
										items={activeAnnotations}
										onJump={(id) =>
											annotationAction((h) => h.scrollToHighlight(id))
										}
										onEdit={(id) => annotationAction((h) => h.editComment(id))}
										onDelete={(id) =>
											annotationAction((h) => h.deleteHighlight(id))
										}
									/>
								) : null}
```

Import `AnnotationsPanel` at top of `App.tsx`.

- [ ] **Step 8: 手动验证 Phase-2**

Run: `pnpm tauri dev`
验证：
1. 打开 PDF 并创建 ≥2 条批注 → 标题栏出现「批注」图标 → 打开右栏「批注」tab，列出卡片（页码 + 引文 + 备注）。
2. 点卡片 → PDF 平滑滚动到该处并高亮闪烁 ~1.6s。
3. 卡片「编辑」→ viewer 内联备注框打开；改动保存后面板同步更新。
4. 卡片「删除」→ 高亮、页边图标、卡片同时消失。
5. 打开第二个 PDF tab，批注面板随活动 tab 切换内容；无 PDF tab 时显示空状态。

- [ ] **Step 9: lint + commit**

Run: `pnpm run fix:ts`
Expected: 无错误。

```bash
git add src/App.tsx src/components/layout/tab-center.tsx src/components/layout/workspace-header.tsx
git commit -m "feat(pdf): add annotations right-sidebar tab wired to the active PDF"
```

---

### Task 10: 文档同步

**Files:**
- Modify: `docs/development/pdf-ask.md`
- Modify: `docs/backend/data-model.md`
- Modify: `docs/development/roadmap.md`
- Modify: `docs/development/todo.md`
- Modify: `AGENTS.md`（若批注语义值得在总览提及）

- [ ] **Step 1: 更新 pdf-ask.md**

在交互矩阵与数据模型章节：把「note = append NOTES.md」改为「annotate = 高亮 + `comment`（存 `highlights/<id>.json`），完全不写 NOTES.md」；在模块清单加入 `annotation-editor.tsx`、`annotation-gutter.tsx`、`annotations-panel.tsx`、`PdfViewerHandle`；在测试清单加入「创建批注 / 编辑备注 / 面板跳转 / 删除同步」。

- [ ] **Step 2: 更新 data-model.md**

在高亮 schema 处加 `comment?: string` 字段说明（非空即批注），并注明右侧面板由活动 PDF tab 驱动、不入 catalog。

- [ ] **Step 3: 更新 roadmap.md / todo.md**

勾选/更新「PDF 标注系统」相关条目为已落地（in-viewer + 侧栏面板；导出到 NOTES.md 列为后续可选）。

- [ ] **Step 4: 提交**

```bash
git add docs/development/pdf-ask.md docs/backend/data-model.md docs/development/roadmap.md docs/development/todo.md AGENTS.md
git commit -m "docs(pdf): document Zotero-style annotation feature"
```

---

## Self-Review 记录

- **Spec 覆盖**：数据模型→Task 1；按钮改名/交互→Task 2/5;内联编辑器→Task 3/5;页边图标→Task 4/5;移除 NOTES.md 链路→Task 6;句柄与回调→Task 7;右侧面板→Task 8/9;i18n→Task 2 + Task 9 Step6;文档→Task 10。全部有对应 task。
- **Placeholder 扫描**：无 TBD/TODO；每个改代码步骤均含实际代码或精确锚点。
- **类型一致性**：`PdfViewerHandle`（getHighlights/scrollToHighlight/editComment/deleteHighlight）在 Task 7 定义、Task 9 使用一致；`AnnotationPin`（Task 4）与 viewer 派生（Task 5 Step8）字段一致；`AnnotationRow`（Task 8）与 App 派生（Task 9 Step3）一致；`comment` 字段贯穿 Task 1/5/7/8/9 命名一致。
- **执行者需现场确认的变量名**：`activeTabId`（活动 tab id）、center 组件在 App 中的实际标签名与 props、`Button` 的 size 变体、`lucide-react` 是否有 `MessageSquareText`、`titlebar.*` 所在 i18n 命名空间。这些在对应步骤已标注“确认/替换为实际名字”。
