import { createSlateEditor, createSlatePlugin, KEYS } from "platejs";
import { describe, expect, it } from "vitest";

import { markdownLinkInputRule } from "@/components/editor/plugins/markdown-link-input-rule";

const TestParagraphPlugin = createSlatePlugin({
	key: KEYS.p,
	node: { isElement: true },
});

const TestLinkPlugin = createSlatePlugin({
	key: KEYS.a,
	node: {
		isElement: true,
		isInline: true,
	},
}).configure({
	inputRules: [markdownLinkInputRule],
});

const TestCodeBlockPlugin = createSlatePlugin({
	key: KEYS.codeBlock,
	node: { isElement: true },
});

const TestCodeLinePlugin = createSlatePlugin({
	key: KEYS.codeLine,
	node: { isElement: true },
});

function createLinkEditor(text: string) {
	const editor = createSlateEditor({
		plugins: [TestParagraphPlugin, TestLinkPlugin],
		value: [{ type: "p", children: [{ text }] }],
	});
	editor.tf.select({
		anchor: { path: [0, 0], offset: text.length },
		focus: { path: [0, 0], offset: text.length },
	});
	return editor;
}

function typeLink(text: string) {
	const editor = createLinkEditor("");
	for (const character of text) editor.tf.insertText(character);
	return editor;
}

describe("Markdown link input rule", () => {
	it("converts [label](url) when typing the closing parenthesis", () => {
		const editor = createLinkEditor("[docs](https://example.com");

		editor.tf.insertText(")");

		const children = (
			editor.children[0] as { children: Array<Record<string, unknown>> }
		).children;
		const link = children.find((c) => c.type === KEYS.a);
		expect(link).toMatchObject({
			type: KEYS.a,
			url: "https://example.com",
			children: [{ text: "docs" }],
		});
		// Closing `)` must not remain as plain text after conversion.
		expect(JSON.stringify(editor.children)).not.toContain(
			"[docs](https://example.com)",
		);
	});

	it("converts while typing the full sequence character by character", () => {
		const editor = typeLink("[hello](https://example.org)");

		const children = (
			editor.children[0] as { children: Array<Record<string, unknown>> }
		).children;
		const link = children.find((c) => c.type === KEYS.a);
		expect(link).toMatchObject({
			type: KEYS.a,
			url: "https://example.org",
			children: [{ text: "hello" }],
		});
	});

	it("leaves incomplete or bare parentheses alone", () => {
		const incomplete = createLinkEditor("[label](not-closed");
		incomplete.tf.insertText("x");
		expect(incomplete.children).toMatchObject([
			{ type: "p", children: [{ text: "[label](not-closedx" }] },
		]);

		const bare = createLinkEditor("foo(");
		bare.tf.insertText(")");
		expect(bare.children).toMatchObject([
			{ type: "p", children: [{ text: "foo()" }] },
		]);
	});

	it("does not convert inside a code block", () => {
		const editor = createSlateEditor({
			plugins: [
				TestParagraphPlugin,
				TestLinkPlugin,
				TestCodeBlockPlugin,
				TestCodeLinePlugin,
			],
			value: [
				{
					type: KEYS.codeBlock,
					children: [
						{
							type: KEYS.codeLine,
							children: [{ text: "[a](https://example.com" }],
						},
					],
				},
			],
		});
		editor.tf.select({
			anchor: { path: [0, 0, 0], offset: "[a](https://example.com".length },
			focus: { path: [0, 0, 0], offset: "[a](https://example.com".length },
		});

		editor.tf.insertText(")");

		expect(editor.children).toMatchObject([
			{
				type: KEYS.codeBlock,
				children: [
					{
						type: KEYS.codeLine,
						children: [{ text: "[a](https://example.com)" }],
					},
				],
			},
		]);
	});
});
