import { createSlateEditor, createSlatePlugin, KEYS } from "platejs";
import { describe, expect, it } from "vitest";

import { inlineMathInputRule } from "@/components/editor/plugins/inline-math-input-rule";

const TestParagraphPlugin = createSlatePlugin({
	key: KEYS.p,
	node: { isElement: true },
});

const TestInlineEquationPlugin = createSlatePlugin({
	key: KEYS.inlineEquation,
	node: {
		isElement: true,
		isInline: true,
		isVoid: true,
	},
});

function createInlineMathEditor(text: string) {
	const editor = createSlateEditor({
		plugins: [
			TestParagraphPlugin,
			TestInlineEquationPlugin.configure({
				inputRules: [inlineMathInputRule],
			}),
		],
		value: [{ type: "p", children: [{ text }] }],
	});
	editor.tf.select({
		anchor: { path: [0, 0], offset: text.length },
		focus: { path: [0, 0], offset: text.length },
	});
	return editor;
}

describe("Markdown inline math input", () => {
	it("recognizes inline math next to ordinary text", () => {
		const editor = createInlineMathEditor("ab$c");

		editor.tf.insertText("$");

		expect(editor.children).toMatchObject([
			{
				type: "p",
				children: [
					{ text: "ab" },
					{
						type: "inline_equation",
						texExpression: "c",
						children: [{ text: "" }],
					},
					{ text: "" },
				],
			},
		]);
	});

	it("leaves the caret after a rendered inline equation", () => {
		const editor = createInlineMathEditor("$c");

		editor.tf.insertText("$");

		expect(editor.selection).toEqual({
			anchor: { path: [0, 2], offset: 0 },
			focus: { path: [0, 2], offset: 0 },
		});
		editor.tf.insertText("d");
		expect(editor.children).toMatchObject([
			{
				type: "p",
				children: [
					{ text: "" },
					{ type: "inline_equation", texExpression: "c" },
					{ text: "d" },
				],
			},
		]);
	});
});
