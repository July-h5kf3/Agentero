import { createSlateEditor } from "platejs";
import { describe, expect, it } from "vitest";

import {
	isWikiLinkDraftEditingOffset,
	parseWikiLinkMarkdown,
	WikiLinkPlugin,
	wikiLinkDraftEditableBounds,
	wikiLinkDraftExteriorPlacement,
	wikiLinkRules,
	wikiLinkToMarkdown,
} from "@/components/editor/plugins/wikilink-plugin";
import {
	addRecentWikiCandidate,
	findWikiCompletionMatch,
	findWikiCompletionTrigger,
	isPlainWikiLinkArrowKey,
	isWikiCompletionSubmitKey,
	narrowExactWikiFileCandidates,
	parseWikiCompletionQuery,
	sameWikiPath,
	wikiCompletionInsert,
	wikiLinkArrowDirection,
} from "@/lib/wiki-completion";

describe("wikilink completion grammar", () => {
	it("separates file, heading, block, and same-file queries", () => {
		expect(parseWikiCompletionQuery("Target")).toEqual({
			kind: "file",
			query: "Target",
		});
		expect(parseWikiCompletionQuery("Target#Overview")).toEqual({
			kind: "heading",
			target: "Target",
			query: "Overview",
		});
		expect(parseWikiCompletionQuery("#^summary")).toEqual({
			kind: "block",
			target: "",
			query: "summary",
		});
		expect(parseWikiCompletionQuery("Target#^验收")).toEqual({
			kind: "block",
			target: "Target",
			query: "验收",
		});
		expect(parseWikiCompletionQuery("Target^验收")).toEqual({
			kind: "block",
			target: "Target",
			query: "验收",
		});
		expect(parseWikiCompletionQuery("Target|alias")).toEqual({
			kind: "alias",
			target: "Target",
			query: "alias",
		});
		expect(parseWikiCompletionQuery("Target|")).toEqual({
			kind: "alias",
			target: "Target",
			query: "",
		});
	});

	it("writes an alias as display text around a canonical target", () => {
		expect(
			wikiCompletionInsert({
				kind: "file",
				path: "notes/Canonical.md",
				insertText: "notes/Canonical",
				label: "Short name",
				alias: "Short name",
			}),
		).toEqual({
			target: "notes/Canonical",
			alias: "Short name",
		});
		expect(
			wikiCompletionInsert({
				kind: "block",
				path: "notes/Canonical.md",
				insertText: "notes/Canonical#^summary",
				label: "^summary",
			}),
		).toEqual({ target: "notes/Canonical", heading: "^summary" });
		expect(sameWikiPath("notes\\Canonical.md", "notes/canonical.md")).toBe(
			true,
		);
	});

	it("keeps an explicitly typed target when completing a heading or block", () => {
		const heading = wikiCompletionInsert(
			{
				kind: "heading",
				path: "AGENTS.md",
				insertText: "AGENTS.md#Paper reading order",
				label: "Paper reading order",
				fragment: {
					kind: "heading",
					path: ["AGENTS.md", "Paper reading order"],
				},
			},
			{ kind: "heading", target: "AGENTS", query: "" },
		);
		expect(heading).toEqual({
			target: "AGENTS",
			heading: "Paper reading order",
		});
		expect(
			wikiLinkToMarkdown({ value: heading.target, heading: heading.heading }),
		).toBe("[[AGENTS#Paper reading order]]");

		expect(
			wikiCompletionInsert(
				{
					kind: "block",
					path: "AGENTS.md",
					insertText: "AGENTS.md#^reading-order",
					label: "^reading-order",
					fragment: { kind: "block", id: "reading-order" },
				},
				{ kind: "block", target: "AGENTS", query: "" },
			),
		).toEqual({ target: "AGENTS", heading: "^reading-order" });
	});

	it("turns a local alias candidate into portable display text", () => {
		const completion = wikiCompletionInsert(
			{
				kind: "alias",
				path: "PAL#Overview",
				insertText: "PAL#Overview",
				label: "name",
				detail: "PAL#Overview",
				alias: "name",
			},
			{ kind: "alias", target: "PAL#Overview", query: "name" },
		);

		expect(completion).toEqual({
			target: "PAL",
			heading: "Overview",
			alias: "name",
		});
		expect(
			wikiLinkToMarkdown({
				value: completion.target,
				heading: completion.heading,
				alias: completion.alias,
			}),
		).toBe("[[PAL#Overview|name]]");
	});

	it("keeps the most recently selected candidates unique and bounded", () => {
		const first = {
			kind: "file" as const,
			path: "notes/First.md",
			insertText: "notes/First",
			label: "First",
		};
		const second = {
			kind: "file" as const,
			path: "notes/Second.md",
			insertText: "notes/Second",
			label: "Second",
		};
		const recent = addRecentWikiCandidate([first], second, 2);
		expect(recent).toEqual([second, first]);
		expect(addRecentWikiCandidate(recent, first, 2)).toEqual([first, second]);
	});

	it("serializes a completion node back to a portable Wikilink", () => {
		const completion = wikiCompletionInsert({
			kind: "heading",
			path: "notes/Canonical.md",
			insertText: "notes/Canonical#Overview",
			label: "Overview",
		});
		const serialized = wikiLinkRules.wikiLink.serialize({
			type: "wikiLink",
			value: completion.target,
			heading: completion.heading,
			alias: "Short name",
			children: [{ text: "" }],
		});
		expect(serialized).toEqual({
			type: "wikiLink",
			value: "notes/Canonical#Overview",
			data: { alias: "Short name" },
		});
	});

	it("round-trips an editable Wikilink draft without losing its fragment", () => {
		const raw = wikiLinkToMarkdown({
			value: "notes/Canonical",
			heading: "^summary",
			alias: "Short name",
		});
		expect(raw).toBe("[[notes/Canonical#^summary|Short name]]");
		expect(parseWikiLinkMarkdown(raw)).toEqual({
			type: "wikiLink",
			value: "notes/Canonical",
			heading: "^summary",
			alias: "Short name",
			embed: false,
			children: [{ text: "" }],
		});
	});

	it("preserves an embed token while its content is projected read-only", () => {
		const raw = wikiLinkToMarkdown({
			value: "notes/Canonical",
			heading: "Overview",
			embed: true,
		});
		expect(raw).toBe("![[notes/Canonical#Overview]]");
		expect(parseWikiLinkMarkdown(raw)).toMatchObject({
			type: "wikiLink",
			value: "notes/Canonical",
			heading: "Overview",
			embed: true,
		});
		expect(
			wikiLinkRules.wikiLink.serialize({
				type: "wikiLink",
				value: "notes/Canonical",
				heading: "Overview",
				embed: true,
				children: [{ text: "" }],
			}),
		).toEqual({
			type: "embed",
			value: "notes/Canonical#Overview",
			data: {},
		});
	});

	it("preserves an escaped pipe in an editable alias", () => {
		const raw = wikiLinkToMarkdown({
			value: "notes/Canonical",
			alias: "This | that",
		});
		expect(raw).toBe("[[notes/Canonical|This \\| that]]");
		expect(parseWikiLinkMarkdown(raw)?.alias).toBe("This | that");
	});

	it("keeps incomplete or malformed drafts as ordinary text", () => {
		expect(parseWikiLinkMarkdown("[[notes/Canonical")).toBeNull();
		expect(parseWikiLinkMarkdown("[[]]")).toBeNull();
		expect(parseWikiLinkMarkdown("[[notes/Canonical#]]")).toBeNull();
		expect(parseWikiLinkMarkdown("[[notes/Canonical|]]")).toBeNull();
		expect(parseWikiLinkMarkdown("text [[notes/Canonical]]")).toBeNull();
	});

	it("uses Tab as the same explicit completion action as Enter", () => {
		expect(isWikiCompletionSubmitKey("Enter")).toBe(true);
		expect(isWikiCompletionSubmitKey("Tab")).toBe(true);
		expect(isWikiCompletionSubmitKey(" ")).toBe(false);
	});

	it("reserves modified arrows for selection and native navigation", () => {
		const arrow = (
			key: string,
			modifiers: Partial<{
				altKey: boolean;
				ctrlKey: boolean;
				metaKey: boolean;
				shiftKey: boolean;
			}> = {},
		) => ({
			key,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			...modifiers,
		});

		expect(isPlainWikiLinkArrowKey(arrow("ArrowLeft"))).toBe(true);
		expect(isPlainWikiLinkArrowKey(arrow("ArrowRight"))).toBe(true);
		expect(isPlainWikiLinkArrowKey(arrow("ArrowUp"))).toBe(true);
		expect(isPlainWikiLinkArrowKey(arrow("ArrowDown"))).toBe(true);
		expect(wikiLinkArrowDirection(arrow("ArrowUp"))).toBe("backward");
		expect(wikiLinkArrowDirection(arrow("ArrowDown"))).toBe("forward");
		expect(
			isPlainWikiLinkArrowKey(
				arrow("ArrowLeft", { metaKey: true, shiftKey: true }),
			),
		).toBe(false);
		expect(
			isPlainWikiLinkArrowKey(arrow("ArrowLeft", { shiftKey: true })),
		).toBe(false);
		expect(isPlainWikiLinkArrowKey(arrow("ArrowLeft", { altKey: true }))).toBe(
			false,
		);
		expect(isPlainWikiLinkArrowKey(arrow("ArrowLeft", { ctrlKey: true }))).toBe(
			false,
		);
		expect(isPlainWikiLinkArrowKey(arrow("ArrowUp", { shiftKey: true }))).toBe(
			false,
		);
		expect(isPlainWikiLinkArrowKey(arrow("Enter"))).toBe(false);
	});

	it("replaces a completed Tab draft including its existing closing brackets", () => {
		expect(findWikiCompletionMatch("[[AGENTS#]]", 9, "AGENTS#")).toEqual({
			start: 0,
			end: 11,
			raw: "AGENTS#",
		});
		expect(findWikiCompletionMatch("prefix [[AGENTS#", 16, "AGENTS#")).toEqual({
			start: 7,
			end: 16,
			raw: "AGENTS#",
		});
		expect(findWikiCompletionMatch("[[PAL|name]]", 10, "PAL|name")).toEqual({
			start: 0,
			end: 12,
			raw: "PAL|name",
		});
	});

	it("treats the bang as part of an embed completion token", () => {
		expect(findWikiCompletionTrigger("before ![[Target#", 17)).toEqual({
			start: 7,
			raw: "Target#",
			embed: true,
		});
		expect(findWikiCompletionMatch("![[Target]]", 9, "Target", true)).toEqual({
			start: 0,
			end: 11,
			raw: "Target",
		});
		expect(findWikiCompletionMatch("![[Target]]", 9, "Target")).toBeNull();
	});

	it("creates an embed node for Enter and preserves embed syntax for Tab", () => {
		const completion = wikiCompletionInsert(
			{
				kind: "heading",
				path: "notes/Target.md",
				insertText: "notes/Target#Overview",
				label: "Overview",
				fragment: { kind: "heading", path: ["Overview"] },
			},
			{ kind: "heading", target: "Target", query: "" },
		);
		const markdown = wikiLinkToMarkdown({
			value: completion.target,
			heading: completion.heading,
			embed: true,
		});
		expect(markdown).toBe("![[Target#Overview]]");
		expect(parseWikiLinkMarkdown(markdown)).toMatchObject({
			type: "wikiLink",
			value: "Target",
			heading: "Overview",
			embed: true,
		});
		const bounds = wikiLinkDraftEditableBounds(markdown);
		expect(markdown.slice(bounds.start, bounds.end)).toBe("Target#Overview");
	});

	it("replaces the complete embed draft without leaving a detached bang", () => {
		const initial = "![[Target";
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [{ type: "p", children: [{ text: initial }] }],
		});
		editor.tf.select({
			anchor: { path: [0, 0], offset: initial.length },
			focus: { path: [0, 0], offset: initial.length },
		});
		const trigger = findWikiCompletionTrigger(initial, initial.length);
		expect(trigger?.embed).toBe(true);
		const match = findWikiCompletionMatch(
			initial,
			initial.length,
			trigger?.raw ?? "",
			trigger?.embed,
		);
		expect(match).toEqual({
			start: 0,
			end: initial.length,
			raw: "Target",
		});
		if (!match) throw new Error("expected an embed completion match");
		const parsed = parseWikiLinkMarkdown("![[Target]]");
		if (!parsed) throw new Error("expected a parsed embed");
		editor.tf.delete({
			at: {
				anchor: { path: [0, 0], offset: match.start },
				focus: { path: [0, 0], offset: match.end },
			},
		});
		editor.tf.insertNodes([parsed, { text: "" }]);
		expect(editor.children).toEqual([
			{
				type: "p",
				children: [
					{ text: "" },
					{
						type: "wikiLink",
						value: "Target",
						heading: undefined,
						alias: null,
						embed: true,
						children: [{ text: "" }],
					},
					{ text: "" },
				],
			},
		]);
	});

	it("does not leave closing brackets after confirming a heading draft", () => {
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [
				{
					type: "p",
					children: [{ text: "[[AGENTS#]]", wikiLinkDraft: true }],
				},
			],
		});
		editor.tf.select({
			anchor: { path: [0, 0], offset: 9 },
			focus: { path: [0, 0], offset: 9 },
		});
		const match = findWikiCompletionMatch("[[AGENTS#]]", 9, "AGENTS#");
		expect(match).not.toBeNull();
		if (!match) throw new Error("expected a completion match");
		editor.tf.delete({
			at: {
				anchor: { path: [0, 0], offset: match.start },
				focus: { path: [0, 0], offset: match.end },
			},
		});
		editor.tf.unsetNodes("wikiLinkDraft", { at: [0, 0] });
		editor.tf.insertNodes([
			{
				type: "wikiLink",
				value: "AGENTS",
				heading: "Paper reading order",
				children: [{ text: "" }],
			},
			{ text: "" },
		]);
		expect(editor.children).toEqual([
			{
				type: "p",
				children: [
					{ text: "" },
					{
						type: "wikiLink",
						value: "AGENTS",
						heading: "Paper reading order",
						children: [{ text: "" }],
					},
					{ text: "" },
				],
			},
		]);
	});

	it("narrows a Tab-completed file target while preserving duplicate names", () => {
		const candidates = [
			{
				kind: "file" as const,
				path: "notes/Fara-1.5.md",
				insertText: "Fara-1.5",
				label: "Fara-1.5",
			},
			{
				kind: "file" as const,
				path: "notes/Fara-1.5-notes.md",
				insertText: "Fara-1.5-notes",
				label: "Fara-1.5-notes",
			},
		];
		expect(narrowExactWikiFileCandidates(candidates, "Fara-1.5")).toEqual([
			candidates[0],
		]);

		const duplicates = [
			{
				kind: "file" as const,
				path: "notes/Target.md",
				insertText: "notes/Target",
				label: "Target",
			},
			{
				kind: "file" as const,
				path: "references/Target.md",
				insertText: "references/Target",
				label: "Target",
			},
		];
		expect(narrowExactWikiFileCandidates(duplicates, "Target")).toEqual(
			duplicates,
		);
	});

	it("places a Tab completion immediately before the closing brackets", () => {
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [{ type: "p", children: [{ text: "[[2026-W30" }] }],
		});
		editor.tf.select({
			anchor: { path: [0, 0], offset: 10 },
			focus: { path: [0, 0], offset: 10 },
		});
		editor.tf.delete({
			at: {
				anchor: { path: [0, 0], offset: 0 },
				focus: editor.selection?.anchor,
			},
		});
		editor.tf.insertNodes({ text: "[[2026-W30]]", wikiLinkDraft: true });
		editor.tf.move({ distance: 2, reverse: true });
		expect(editor.selection).toEqual({
			anchor: { path: [0, 0], offset: 10 },
			focus: { path: [0, 0], offset: 10 },
		});
	});

	it("places an Enter completion in text immediately after the link", () => {
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [{ type: "p", children: [{ text: "[[2026-W30" }] }],
		});
		editor.tf.select({
			anchor: { path: [0, 0], offset: 10 },
			focus: { path: [0, 0], offset: 10 },
		});
		editor.tf.delete({
			at: {
				anchor: { path: [0, 0], offset: 0 },
				focus: editor.selection?.anchor,
			},
		});
		editor.tf.insertNodes([
			{
				type: "wikiLink",
				value: "2026-W30",
				children: [{ text: "" }],
			},
			{ text: "" },
		]);
		expect(editor.selection).toEqual({
			anchor: { path: [0, 2], offset: 0 },
			focus: { path: [0, 2], offset: 0 },
		});
	});

	it("keeps Tab completion's caret within the editable target", () => {
		const raw = "[[2026-W30]]";
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [{ type: "p", children: [{ text: raw, wikiLinkDraft: true }] }],
		});
		editor.tf.select({
			anchor: { path: [0, 0], offset: raw.length - 2 },
			focus: { path: [0, 0], offset: raw.length - 2 },
		});
		expect(wikiLinkDraftEditableBounds(raw)).toEqual({
			start: 2,
			end: raw.length - 2,
		});
		const parsed = parseWikiLinkMarkdown(raw);
		expect(parsed).not.toBeNull();
		if (!parsed) throw new Error("expected the completed Wikilink to parse");
		let linkPath: number[] | null = null;
		const linkRefs: { unref: () => number[] | null }[] = [];
		editor.tf.withoutNormalizing(() => {
			editor.tf.removeNodes({ at: [0, 0] });
			editor.tf.insertNodes(parsed, { at: [0, 0] });
			linkRefs.push(editor.api.pathRef([0, 0], { affinity: "forward" }));
		});
		linkPath = linkRefs[0]?.unref() ?? null;
		expect(linkPath).toEqual([0, 1]);
		if (!linkPath) throw new Error("expected the inserted link path");
		const after = editor.api.after(linkPath);
		expect(after).toBeDefined();
		if (after) editor.tf.select(after);
		editor.tf.insertBreak();
		expect(editor.children).toEqual([
			{
				type: "p",
				children: [
					{ text: "" },
					{
						type: "wikiLink",
						value: "2026-W30",
						heading: undefined,
						embed: false,
						alias: null,
						children: [{ text: "" }],
					},
					{ text: "" },
				],
			},
			{ type: "p", children: [{ text: "" }] },
		]);
	});

	it("excludes both delimiters from an editable draft", () => {
		expect(wikiLinkDraftEditableBounds("[[AGENTS]]")).toEqual({
			start: 2,
			end: 8,
		});
		expect(wikiLinkDraftEditableBounds("![[figure.png]]")).toEqual({
			start: 3,
			end: 13,
		});
	});

	it("projects a complete draft as soon as the caret leaves its source range", () => {
		const raw = "![[验收说明#3. 编辑器补全与序列化]]";
		expect(isWikiLinkDraftEditingOffset(raw, 0)).toBe(false);
		expect(isWikiLinkDraftEditingOffset(raw, 1)).toBe(true);
		expect(isWikiLinkDraftEditingOffset(raw, raw.length - 1)).toBe(true);
		expect(isWikiLinkDraftEditingOffset(raw, raw.length)).toBe(false);
		expect(wikiLinkDraftExteriorPlacement(raw, 0)).toBe("before");
		expect(wikiLinkDraftExteriorPlacement(raw, raw.length)).toBe("after");

		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [{ type: "p", children: [{ text: raw, wikiLinkDraft: true }] }],
		});
		editor.tf.select({
			anchor: { path: [0, 0], offset: raw.length },
			focus: { path: [0, 0], offset: raw.length },
		});
		if (!editor.selection) throw new Error("expected an exterior selection");
		const parsed = parseWikiLinkMarkdown(raw);
		if (!parsed) throw new Error("expected a parsed embed");
		const linkRefs: { unref: () => number[] | null }[] = [];
		editor.tf.withoutNormalizing(() => {
			editor.tf.removeNodes({ at: [0, 0] });
			editor.tf.insertNodes(parsed, { at: [0, 0] });
			linkRefs.push(editor.api.pathRef([0, 0], { affinity: "forward" }));
		});
		const linkPath = linkRefs[0]?.unref() ?? null;
		if (!linkPath) throw new Error("expected the rendered embed path");
		const after = editor.api.after(linkPath);
		if (!after) throw new Error("expected a point after the rendered embed");
		editor.tf.select(after);
		expect(editor.children).toEqual([
			{
				type: "p",
				children: [{ text: "" }, parsed, { text: "" }],
			},
		]);
		expect(editor.selection?.anchor).toEqual({
			path: [0, 2],
			offset: 0,
		});
	});

	it("moves through both closing and opening delimiters without skipping them", () => {
		const raw = "![[验收说明#4. Agentero 内改名]]";
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [
				{ type: "p", children: [{ text: raw, wikiLinkDraft: true }] },
				{ type: "p", children: [{ text: "next" }] },
			],
		});
		const { start, end } = wikiLinkDraftEditableBounds(raw);

		editor.tf.select({
			anchor: { path: [0, 0], offset: end },
			focus: { path: [0, 0], offset: end },
		});
		editor.tf.move({ distance: 1 });
		expect(editor.selection?.anchor).toEqual({
			path: [0, 0],
			offset: end + 1,
		});
		editor.tf.move({ distance: 1 });
		expect(editor.selection?.anchor).toEqual({
			path: [0, 0],
			offset: raw.length,
		});
		editor.tf.move({ distance: 1 });
		expect(editor.selection?.anchor).toEqual({
			path: [1, 0],
			offset: 0,
		});

		editor.tf.select({
			anchor: { path: [0, 0], offset: start },
			focus: { path: [0, 0], offset: start },
		});
		editor.tf.move({ distance: 1, reverse: true });
		expect(editor.selection?.anchor).toEqual({
			path: [0, 0],
			offset: start - 1,
		});
		editor.tf.move({ distance: 1, reverse: true });
		expect(editor.selection?.anchor).toEqual({
			path: [0, 0],
			offset: start - 2,
		});
	});

	it("places text typed at the exterior boundary after the rendered embed", () => {
		const raw = "![[验收说明#4. Agentero 内改名]]";
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [
				{
					type: "p",
					children: [{ text: "12 " }, { text: raw, wikiLinkDraft: true }],
				},
			],
		});
		editor.tf.select({
			anchor: { path: [0, 1], offset: raw.length },
			focus: { path: [0, 1], offset: raw.length },
		});
		const parsed = parseWikiLinkMarkdown(raw);
		if (!parsed) throw new Error("expected a parsed embed");
		const linkRefs: { unref: () => number[] | null }[] = [];
		editor.tf.withoutNormalizing(() => {
			editor.tf.removeNodes({ at: [0, 1] });
			editor.tf.insertNodes(parsed, { at: [0, 1] });
			linkRefs.push(editor.api.pathRef([0, 1], { affinity: "forward" }));
		});
		const linkPath = linkRefs[0]?.unref() ?? null;
		if (!linkPath) throw new Error("expected an inserted embed path");
		const after = editor.api.after(linkPath);
		if (!after) throw new Error("expected a point after the embed");
		editor.tf.select(after);
		editor.tf.insertBreak();
		editor.tf.insertText("x");

		expect(editor.children).toEqual([
			{
				type: "p",
				children: [
					{ text: "12 " },
					{
						type: "wikiLink",
						value: "验收说明",
						heading: "4. Agentero 内改名",
						alias: null,
						embed: true,
						children: [{ text: "" }],
					},
					{ text: "" },
				],
			},
			{ type: "p", children: [{ text: "x" }] },
		]);
	});

	it("expands a rendered embed before deleting its final bracket", () => {
		const raw = "![[2026-W29#今日计划]]";
		const parsed = parseWikiLinkMarkdown(raw);
		if (!parsed) throw new Error("expected a parsed embed");
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [
				{
					type: "p",
					children: [{ text: "12 " }, parsed, { text: "" }],
				},
			],
		});
		editor.tf.select({
			anchor: { path: [0, 2], offset: 0 },
			focus: { path: [0, 2], offset: 0 },
		});
		editor.tf.withoutNormalizing(() => {
			editor.tf.removeNodes({ at: [0, 1] });
			editor.tf.insertNodes({ text: raw, wikiLinkDraft: true }, { at: [0, 1] });
			editor.tf.select({
				anchor: { path: [0, 1], offset: raw.length },
				focus: { path: [0, 1], offset: raw.length },
			});
		});
		editor.tf.delete({
			at: {
				anchor: { path: [0, 1], offset: raw.length - 1 },
				focus: { path: [0, 1], offset: raw.length },
			},
		});

		expect(editor.children).toEqual([
			{
				type: "p",
				children: [
					{ text: "12 " },
					{ text: raw.slice(0, -1), wikiLinkDraft: true },
				],
			},
		]);
		expect(editor.selection?.anchor).toEqual({
			path: [0, 1],
			offset: raw.length - 1,
		});
	});

	it("keeps text typed after a rendered ordinary Wikilink inline", () => {
		const raw = "[[验收说明#4. Agentero 内改名]]";
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [
				{
					type: "p",
					children: [{ text: "12 " }, { text: raw, wikiLinkDraft: true }],
				},
			],
		});
		const parsed = parseWikiLinkMarkdown(raw);
		if (!parsed) throw new Error("expected a parsed Wikilink");
		const linkRefs: { unref: () => number[] | null }[] = [];
		editor.tf.withoutNormalizing(() => {
			editor.tf.removeNodes({ at: [0, 1] });
			editor.tf.insertNodes(parsed, { at: [0, 1] });
			linkRefs.push(editor.api.pathRef([0, 1], { affinity: "forward" }));
		});
		const linkPath = linkRefs[0]?.unref() ?? null;
		if (!linkPath) throw new Error("expected an inserted Wikilink path");
		const after = editor.api.after(linkPath);
		if (!after) throw new Error("expected a point after the Wikilink");
		editor.tf.select(after);
		editor.tf.insertText("x");

		expect(editor.children).toEqual([
			{
				type: "p",
				children: [
					{ text: "12 " },
					{
						type: "wikiLink",
						value: "验收说明",
						heading: "4. Agentero 内改名",
						alias: null,
						embed: false,
						children: [{ text: "" }],
					},
					{ text: "x" },
				],
			},
		]);
	});

	it("preserves an external selection while a complete draft is reified", () => {
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [
				{
					type: "p",
					children: [{ text: "[[AGENTS]]", wikiLinkDraft: true }],
				},
				{ type: "p", children: [{ text: "next" }] },
			],
		});
		editor.tf.select({
			anchor: { path: [1, 0], offset: 2 },
			focus: { path: [1, 0], offset: 2 },
		});
		if (!editor.selection) throw new Error("expected an external selection");
		const selectionRef = editor.api.rangeRef(editor.selection, {
			affinity: "forward",
		});
		const parsed = parseWikiLinkMarkdown("[[AGENTS]]");
		expect(parsed).not.toBeNull();
		if (!parsed) throw new Error("expected the completed Wikilink to parse");
		editor.tf.withoutNormalizing(() => {
			editor.tf.removeNodes({ at: [0, 0] });
			editor.tf.insertNodes(parsed, { at: [0, 0] });
		});
		expect(selectionRef.unref()).toEqual({
			anchor: { path: [1, 0], offset: 2 },
			focus: { path: [1, 0], offset: 2 },
		});
	});

	it("tracks later drafts when an earlier draft is reified", () => {
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [
				{
					type: "p",
					children: [
						{ text: "[[First]]", wikiLinkDraft: true },
						{ text: " " },
						{ text: "[[Second]]", wikiLinkDraft: true },
					],
				},
			],
		});
		const firstRef = editor.api.pathRef([0, 0], { affinity: "forward" });
		const secondRef = editor.api.pathRef([0, 2], { affinity: "forward" });
		const firstPath = firstRef.unref();
		expect(firstPath).toEqual([0, 0]);
		const first = parseWikiLinkMarkdown("[[First]]");
		expect(first).not.toBeNull();
		if (!first || !firstPath) throw new Error("expected the first link draft");
		editor.tf.withoutNormalizing(() => {
			editor.tf.removeNodes({ at: firstPath });
			editor.tf.insertNodes(first, { at: firstPath });
		});
		const secondPath = secondRef.unref();
		expect(secondPath).not.toBeNull();
		if (!secondPath) throw new Error("expected the tracked second draft");
		expect(editor.api.node(secondPath)?.[0]).toMatchObject({
			text: "[[Second]]",
			wikiLinkDraft: true,
		});
	});
});
