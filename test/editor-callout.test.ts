import wikiLink from "@flowershow/remark-wiki-link";
import { BaseListPlugin } from "@platejs/list";
import { MarkdownPlugin } from "@platejs/markdown";
import { createSlateEditor, createSlatePlugin, KEYS } from "platejs";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { describe, expect, it } from "vitest";

import {
	obsidianCalloutRules,
	parseCalloutMarker,
	remarkObsidianCallout,
} from "@/components/editor/plugins/callout-model";
import {
	WikiLinkPlugin,
	wikiLinkRules,
} from "@/components/editor/plugins/wikilink-plugin";

const TestParagraphPlugin = createSlatePlugin({
	key: KEYS.p,
	node: { isElement: true },
});
const TestBlockquotePlugin = createSlatePlugin({
	key: KEYS.blockquote,
	node: { isElement: true },
});
const TestCalloutPlugin = createSlatePlugin({
	key: KEYS.callout,
	node: { isElement: true },
});
const TestInlineEquationPlugin = createSlatePlugin({
	key: KEYS.inlineEquation,
	node: { isElement: true, isInline: true, isVoid: true },
});
const TestMarkdownPlugin = MarkdownPlugin.configure({
	options: {
		remarkPlugins: [
			remarkMath,
			remarkGfm,
			[wikiLink, { aliasDivider: "|" }],
			remarkObsidianCallout,
		],
		rules: { ...wikiLinkRules, ...obsidianCalloutRules },
	},
});

function createCalloutEditor(markdown: string) {
	return createSlateEditor({
		plugins: [
			TestParagraphPlugin,
			TestBlockquotePlugin,
			TestCalloutPlugin,
			TestInlineEquationPlugin,
			BaseListPlugin,
			WikiLinkPlugin,
			TestMarkdownPlugin,
		],
		value: (editor) =>
			editor.getApi(MarkdownPlugin).markdown.deserialize(markdown),
	});
}

describe("Obsidian callout Markdown model", () => {
	it("parses known and custom markers without accepting fold syntax", () => {
		expect(parseCalloutMarker("[!important] Custom title")).toEqual({
			type: "important",
			typeRaw: "important",
			title: "Custom title",
		});
		expect(parseCalloutMarker("[!My-Type]")).toEqual({
			type: "my-type",
			typeRaw: "My-Type",
		});
		expect(parseCalloutMarker("[!important]- Folded")).toBeNull();
		expect(parseCalloutMarker("important")).toBeNull();
	});

	it("round-trips a titled multi-paragraph callout", () => {
		const editor = createCalloutEditor(
			"> [!important] Read this\n>\n> First paragraph.\n>\n> Second paragraph.",
		);

		expect(editor.children).toMatchObject([
			{
				type: "callout",
				calloutType: "important",
				calloutTypeRaw: "important",
				title: "Read this",
				children: [
					{ type: "p", children: [{ text: "First paragraph." }] },
					{ type: "p", children: [{ text: "Second paragraph." }] },
				],
			},
		]);
		expect(editor.getApi(MarkdownPlugin).markdown.serialize()).toBe(
			"> [!important] Read this\n>\n> First paragraph.\n>\n> Second paragraph.\n",
		);
	});

	it("keeps ordinary and unsupported folded blockquotes unchanged", () => {
		const editor = createCalloutEditor(
			"> Ordinary quote\n\n> [!important]- Folded title",
		);

		expect(editor.children).toMatchObject([
			{ type: "blockquote" },
			{ type: "blockquote" },
		]);
	});

	it("supports a body on the line immediately after the marker", () => {
		const editor = createCalloutEditor(
			"> [!warning]\n> Body without a blank quote line.",
		);

		expect(editor.children).toMatchObject([
			{
				type: "callout",
				calloutType: "warning",
				children: [
					{
						type: "p",
						children: [{ text: "Body without a blank quote line." }],
					},
				],
			},
		]);
	});

	it("retains lists, math, and wikilinks inside the callout body", () => {
		const editor = createCalloutEditor(
			"> [!important] Mixed body\n>\n> See [[Other]] and $a$.\n>\n> - one\n> - two",
		);

		expect(editor.children).toMatchObject([
			{
				type: "callout",
				children: [
					{
						type: "p",
						children: [
							{ text: "See " },
							{ type: "wikiLink", value: "Other" },
							{ text: " and " },
							{ type: "inline_equation", texExpression: "a" },
							{ text: "." },
						],
					},
					{ type: "p", listStyleType: "disc", children: [{ text: "one" }] },
					{ type: "p", listStyleType: "disc", children: [{ text: "two" }] },
				],
			},
		]);
		const serialized = editor.getApi(MarkdownPlugin).markdown.serialize();
		expect(serialized).toContain("> See [[Other]] and $a$.");
		expect(serialized).toContain("> * one\n> * two");
	});
});
