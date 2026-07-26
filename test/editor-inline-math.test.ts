import { MarkdownPlugin } from "@platejs/markdown";
import { createSlateEditor, createSlatePlugin, KEYS } from "platejs";
import { describe, expect, it } from "vitest";

import { inlineMathInputRule } from "@/components/editor/plugins/inline-math-input-rule";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";

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

function typeInlineMath(text: string) {
	const editor = createInlineMathEditor("");
	for (const character of text) editor.tf.insertText(character);
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

	it("keeps escaped dollar delimiters as ordinary text", () => {
		const editor = typeInlineMath("\\$xxca\\$");

		expect(editor.children).toEqual([
			{ type: "p", children: [{ text: "$xxca$" }] },
		]);
	});

	it("treats an even backslash run before the opening dollar as unescaped", () => {
		const editor = createInlineMathEditor("\\\\$c");

		editor.tf.insertText("$");

		expect(editor.children).toMatchObject([
			{
				type: "p",
				children: [
					{ text: "\\\\" },
					{ type: "inline_equation", texExpression: "c" },
					{ text: "" },
				],
			},
		]);
	});

	it("serializes literal dollar text with Markdown escapes", () => {
		const editor = createSlateEditor({
			plugins: [TestParagraphPlugin, ...MarkdownKit],
			value: [{ type: "p", children: [{ text: "$a$" }] }],
		});

		expect(editor.getApi(MarkdownPlugin).markdown.serialize().trimEnd()).toBe(
			"\\$a\\$",
		);
	});

	it("round-trips escaped dollar text without showing backslashes", () => {
		const editor = createSlateEditor({
			plugins: [TestParagraphPlugin, ...MarkdownKit],
			value: [{ type: "p", children: [{ text: "" }] }],
		});

		editor.children = editor
			.getApi(MarkdownPlugin)
			.markdown.deserialize("\\$a\\$");

		expect(editor.children).toMatchObject([
			{ type: "p", children: [{ text: "$a$" }] },
		]);
		expect(editor.getApi(MarkdownPlugin).markdown.serialize().trimEnd()).toBe(
			"\\$a\\$",
		);
	});
});
