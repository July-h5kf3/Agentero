import { createSlateEditor } from "platejs";
import { describe, expect, it } from "vitest";

import {
	parseWikiLinkMarkdown,
	WikiLinkPlugin,
	wikiLinkDraftEditableBounds,
	wikiLinkRules,
	wikiLinkToMarkdown,
} from "@/components/editor/plugins/wikilink-plugin";
import {
	addRecentWikiCandidate,
	isWikiCompletionSubmitKey,
	parseWikiCompletionQuery,
	sameWikiPath,
	wikiCompletionInsert,
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
		expect(parseWikiCompletionQuery("Target|alias")).toBeNull();
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
});
