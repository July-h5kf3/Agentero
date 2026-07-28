import { createSlateEditor } from "platejs";
import { describe, expect, it } from "vitest";

import { WikiLinkPlugin } from "@/components/editor/plugins/wikilink-plugin";
import {
	editorContextMenuCapabilities,
	editorLinkTemplate,
	insertEditorLinkTemplate,
} from "@/lib/markdown/editor-context-menu";

describe("Markdown editor context menu", () => {
	it("places an empty internal-link caret between the brackets", () => {
		expect(editorLinkTemplate("wiki")).toEqual({
			text: "[[]]",
			selectionStart: 2,
			selectionEnd: 2,
			wikiLinkDraft: true,
		});
	});

	it("places an empty external-link caret in its label", () => {
		expect(editorLinkTemplate("external")).toEqual({
			text: "[]()",
			selectionStart: 1,
			selectionEnd: 1,
			wikiLinkDraft: false,
		});
	});

	it("preserves selected text and selects it inside each link", () => {
		expect(editorLinkTemplate("wiki", "Target")).toEqual({
			text: "[[Target]]",
			selectionStart: 2,
			selectionEnd: 8,
			wikiLinkDraft: true,
		});
		expect(editorLinkTemplate("external", "Label")).toEqual({
			text: "[Label]()",
			selectionStart: 1,
			selectionEnd: 6,
			wikiLinkDraft: false,
		});
	});

	it("inserts a wiki draft with the caret before its closing brackets", () => {
		const editor = createSlateEditor({
			plugins: [WikiLinkPlugin],
			value: [{ type: "p", children: [{ text: "Before after" }] }],
		});
		const selection = {
			anchor: { path: [0, 0], offset: 7 },
			focus: { path: [0, 0], offset: 7 },
		};

		insertEditorLinkTemplate(editor, "wiki", selection);

		expect(editor.api.string([])).toBe("Before [[]]after");
		expect(editor.selection).toEqual({
			anchor: { path: [0, 1], offset: 2 },
			focus: { path: [0, 1], offset: 2 },
		});
		expect(editor.api.node([0, 1])?.[0]).toMatchObject({
			text: "[[]]",
			wikiLinkDraft: true,
		});
	});

	it("wraps and reselects text in an external link", () => {
		const editor = createSlateEditor({
			value: [{ type: "p", children: [{ text: "Before label after" }] }],
		});
		const selection = {
			anchor: { path: [0, 0], offset: 7 },
			focus: { path: [0, 0], offset: 12 },
		};

		insertEditorLinkTemplate(editor, "external", selection);

		expect(editor.api.string([])).toBe("Before [label]() after");
		expect(editor.api.string(editor.selection ?? undefined)).toBe("label");
	});

	it("keeps copy available in read-only notes and blocks mutations", () => {
		expect(
			editorContextMenuCapabilities({
				headingRenameAvailable: false,
				readOnly: true,
				selectionExpanded: true,
			}),
		).toEqual({
			copy: true,
			cut: false,
			formatMarkdown: false,
			insertLink: false,
			paste: false,
			renameHeading: false,
		});
	});

	it("enables editing actions while keeping heading rename contextual", () => {
		expect(
			editorContextMenuCapabilities({
				headingRenameAvailable: true,
				readOnly: false,
				selectionExpanded: false,
			}),
		).toEqual({
			copy: false,
			cut: false,
			formatMarkdown: true,
			insertLink: true,
			paste: true,
			renameHeading: true,
		});
	});
});
