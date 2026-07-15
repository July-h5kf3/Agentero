"use client";

import {
	BlockquoteRules,
	BoldRules,
	CodeRules,
	HeadingRules,
	HighlightRules,
	HorizontalRuleRules,
	ItalicRules,
	MarkComboRules,
	StrikethroughRules,
	SubscriptRules,
	SuperscriptRules,
	UnderlineRules,
} from "@platejs/basic-nodes";
import {
	BlockquotePlugin,
	BoldPlugin,
	CodePlugin,
	H1Plugin,
	H2Plugin,
	H3Plugin,
	H4Plugin,
	H5Plugin,
	H6Plugin,
	HighlightPlugin,
	HorizontalRulePlugin,
	ItalicPlugin,
	KbdPlugin,
	StrikethroughPlugin,
	SubscriptPlugin,
	SuperscriptPlugin,
	UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { CodeBlockRules } from "@platejs/code-block";
import {
	CodeBlockPlugin,
	CodeLinePlugin,
	CodeSyntaxPlugin,
} from "@platejs/code-block/react";
import { IndentPlugin } from "@platejs/indent/react";
import {
	BulletedListRules,
	OrderedListRules,
	TaskListRules,
} from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";
import { MathRules } from "@platejs/math";
import { EquationPlugin, InlineEquationPlugin } from "@platejs/math/react";
import { ImagePlugin } from "@platejs/media/react";
import { MentionPlugin } from "@platejs/mention/react";
import {
	TableCellHeaderPlugin,
	TableCellPlugin,
	TablePlugin,
	TableRowPlugin,
} from "@platejs/table/react";
import { common, createLowlight } from "lowlight";
import { KEYS } from "platejs";
import { ParagraphPlugin } from "platejs/react";
import { BlockList } from "@/components/editor/block-list";
import { BlockquoteElement } from "@/components/editor/blockquote-node";
import {
	CodeBlockElement,
	CodeLineElement,
	CodeSyntaxLeaf,
} from "@/components/editor/code-block-node";
import { CodeLeaf } from "@/components/editor/code-leaf";
import {
	EquationElement,
	InlineEquationElement,
} from "@/components/editor/equation-node";
import {
	H1Element,
	H2Element,
	H3Element,
	H4Element,
	H5Element,
	H6Element,
} from "@/components/editor/heading-node";
import { HighlightLeaf } from "@/components/editor/highlight-leaf";
import { HrElement } from "@/components/editor/hr-node";
import { ImageElement } from "@/components/editor/image-node";
import { KbdLeaf } from "@/components/editor/kbd-leaf";
import { MentionElement } from "@/components/editor/mention-node";
import { ParagraphElement } from "@/components/editor/paragraph-node";
import { LinkPlugin } from "@/components/editor/plugins/link-plugin";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import { WikiLinkPlugin } from "@/components/editor/plugins/wikilink-plugin";
import {
	TableCellElement,
	TableCellHeaderElement,
	TableElement,
	TableRowElement,
} from "@/components/editor/table-node";

const lowlight = createLowlight(common);

const listTargets = [
	...KEYS.heading,
	KEYS.p,
	KEYS.blockquote,
	KEYS.codeBlock,
	KEYS.toggle,
	KEYS.img,
];

const headingBreak = { break: { empty: "reset" } } as const;

/** Full Plate kit for editing Markdown as WYSIWYG rich text. */
export const MarkdownEditorKit = [
	// Blocks
	ParagraphPlugin.withComponent(ParagraphElement),
	H1Plugin.configure({
		inputRules: [HeadingRules.markdown()],
		node: { component: H1Element },
		rules: headingBreak,
	}),
	H2Plugin.configure({
		inputRules: [HeadingRules.markdown()],
		node: { component: H2Element },
		rules: headingBreak,
	}),
	H3Plugin.configure({
		inputRules: [HeadingRules.markdown()],
		node: { component: H3Element },
		rules: headingBreak,
	}),
	H4Plugin.configure({
		inputRules: [HeadingRules.markdown()],
		node: { component: H4Element },
		rules: headingBreak,
	}),
	H5Plugin.configure({
		inputRules: [HeadingRules.markdown()],
		node: { component: H5Element },
		rules: headingBreak,
	}),
	H6Plugin.configure({
		inputRules: [HeadingRules.markdown()],
		node: { component: H6Element },
		rules: headingBreak,
	}),
	BlockquotePlugin.configure({
		inputRules: [BlockquoteRules.markdown()],
		node: { component: BlockquoteElement },
	}),
	HorizontalRulePlugin.configure({
		inputRules: [
			HorizontalRuleRules.markdown({ variant: "-" }),
			HorizontalRuleRules.markdown({ variant: "_" }),
		],
		node: { component: HrElement },
	}),

	// Marks
	BoldPlugin.configure({
		inputRules: [
			BoldRules.markdown({ variant: "*" }),
			BoldRules.markdown({ variant: "_" }),
			MarkComboRules.markdown({ variant: "boldItalic" }),
		],
	}),
	ItalicPlugin.configure({
		inputRules: [
			ItalicRules.markdown({ variant: "*" }),
			ItalicRules.markdown({ variant: "_" }),
		],
	}),
	UnderlinePlugin.configure({ inputRules: [UnderlineRules.markdown()] }),
	StrikethroughPlugin.configure({
		inputRules: [StrikethroughRules.markdown()],
	}),
	CodePlugin.configure({
		inputRules: [CodeRules.markdown()],
		node: { component: CodeLeaf },
	}),
	SubscriptPlugin.configure({ inputRules: [SubscriptRules.markdown()] }),
	SuperscriptPlugin.configure({ inputRules: [SuperscriptRules.markdown()] }),
	HighlightPlugin.configure({
		inputRules: [HighlightRules.markdown({ variant: "==" })],
		node: { component: HighlightLeaf },
	}),
	KbdPlugin.withComponent(KbdLeaf),

	// Indentation + lists
	IndentPlugin.configure({
		inject: { targetPlugins: listTargets },
		options: { offset: 24 },
	}),
	ListPlugin.configure({
		inputRules: [
			BulletedListRules.markdown({ variant: "-" }),
			BulletedListRules.markdown({ variant: "*" }),
			OrderedListRules.markdown({ variant: "." }),
			OrderedListRules.markdown({ variant: ")" }),
			TaskListRules.markdown({ checked: false }),
			TaskListRules.markdown({ checked: true }),
		],
		// Markers come from BlockList's <ul>/<ol>/<li> only.
		// Do not also inject display:list-item on the block — that paints a second bullet.
		inject: {
			targetPlugins: listTargets,
		},
		render: { belowNodes: BlockList },
	}),

	// Code blocks
	CodeBlockPlugin.configure({
		inputRules: [CodeBlockRules.markdown({ on: "match" })],
		node: { component: CodeBlockElement },
		options: { lowlight },
	}),
	CodeLinePlugin.withComponent(CodeLineElement),
	CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),

	// Tables
	TablePlugin.withComponent(TableElement),
	TableRowPlugin.withComponent(TableRowElement),
	TableCellPlugin.withComponent(TableCellElement),
	TableCellHeaderPlugin.withComponent(TableCellHeaderElement),

	// Math
	InlineEquationPlugin.configure({
		inputRules: [MathRules.markdown({ variant: "$" })],
		node: { component: InlineEquationElement },
	}),
	EquationPlugin.configure({
		inputRules: [MathRules.markdown({ on: "break", variant: "$$" })],
		node: { component: EquationElement },
	}),

	// Inline nodes
	ImagePlugin.withComponent(ImageElement),
	MentionPlugin.withComponent(MentionElement),
	WikiLinkPlugin,
	LinkPlugin,

	// Markdown serialization (MarkdownPlugin + footnotes + wikilink rules)
	...MarkdownKit,
];
