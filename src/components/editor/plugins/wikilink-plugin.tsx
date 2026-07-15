"use client";

import { createPlatePlugin } from "platejs/react";
import { WikiLinkElement } from "@/components/editor/wikilink-node";

/** Inline atomic `[[wikilink]]` / `![[embed]]` node. */
export const WikiLinkPlugin = createPlatePlugin({
	key: "wikiLink",
	node: { isElement: true, isInline: true, isVoid: true },
}).withComponent(WikiLinkElement);

/** mdast node produced by `@flowershow/remark-wiki-link`. */
type MdWikiLink = {
	type: string;
	value?: string;
	data?: {
		alias?: string;
		hProperties?: Record<string, unknown>;
	};
};

type WikiSlateNode = {
	type: "wikiLink";
	value: string;
	heading?: string;
	alias?: string | null;
	embed?: boolean;
	children: { text: string }[];
};

function splitTarget(raw: string): { target: string; heading: string } {
	const h = raw.indexOf("#");
	return h >= 0
		? { target: raw.slice(0, h), heading: raw.slice(h + 1) }
		: { target: raw, heading: "" };
}

function toSlate(node: MdWikiLink, embed: boolean): WikiSlateNode {
	const raw = node.value ?? "";
	const { target, heading } = splitTarget(raw);
	let alias = node.data?.alias ?? null;
	if (embed) {
		// Image/media embeds encode dimensions as data-fs-width/height, not alias.
		const w = node.data?.hProperties?.["data-fs-width"];
		const h = node.data?.hProperties?.["data-fs-height"];
		if (w || h) alias = w && h ? `${w}x${h}` : String(w || h);
	}
	return {
		type: "wikiLink",
		value: target,
		heading,
		alias,
		embed,
		children: [{ text: "" }],
	};
}

/**
 * Round-trip rules for `@flowershow/remark-wiki-link`:
 * - mdast `wikiLink`/`embed` -> Plate `wikiLink` node (deserialize)
 * - Plate `wikiLink` node -> mdast `wikiLink`/`embed` (serialize; the plugin's
 *   toMarkdown handler stringifies back to `[[...]]` / `![[...]]`).
 */
export const wikiLinkRules = {
	wikiLink: {
		deserialize: (node: MdWikiLink) => toSlate(node, false),
		serialize: (node: WikiSlateNode) => {
			const value = node.heading ? `${node.value}#${node.heading}` : node.value;
			const data: { alias?: string } = {};
			if (node.alias) data.alias = node.alias;
			return { type: node.embed ? "embed" : "wikiLink", value, data };
		},
	},
	embed: {
		deserialize: (node: MdWikiLink) => toSlate(node, true),
	},
};
