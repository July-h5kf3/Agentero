"use client";

import { createPlatePlugin } from "platejs/react";
import { WikiLinkElement } from "@/components/editor/wikilink-node";

/**
 * Stable inline `[[wikilink]]` / `![[embed]]` node.
 *
 * Its text child owns the portable source syntax. Selection only changes how
 * the component projects that child; it must never replace the element merely
 * to enter or leave Live Preview editing.
 */
export const WikiLinkPlugin = createPlatePlugin({
	key: "wikiLink",
	node: { isElement: true, isInline: true },
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

export type WikiSlateNode = {
	type: "wikiLink";
	value: string;
	heading?: string | null;
	alias?: string | null;
	embed?: boolean;
	children: { text: string }[];
};

export type WikiLinkDraftText = {
	text: string;
	wikiLinkDraft: true;
};

export function splitWikiLinkTarget(raw: string): {
	target: string;
	heading: string;
} {
	const h = raw.indexOf("#");
	return h >= 0
		? { target: raw.slice(0, h), heading: raw.slice(h + 1) }
		: { target: raw, heading: "" };
}

function findWikiLinkAliasSeparator(raw: string): number {
	for (let index = 0; index < raw.length; index += 1) {
		if (raw[index] !== "|" || raw[index - 1] === "\\") continue;
		return index;
	}
	return -1;
}

/** Convert the structured display node into the portable text a user edits. */
export function wikiLinkToMarkdown(node: {
	value: string;
	heading?: string | null;
	alias?: string | null;
	embed?: boolean;
}): string {
	const target = node.heading ? `${node.value}#${node.heading}` : node.value;
	const alias = node.alias ? `|${node.alias.replaceAll("|", "\\|")}` : "";
	return `${node.embed ? "!" : ""}[[${target}${alias}]]`;
}

/**
 * Parse only a complete inline Wikilink. Partial or malformed edit text must
 * remain ordinary Markdown text, so users never lose an in-progress edit.
 */
export function parseWikiLinkMarkdown(raw: string): WikiSlateNode | null {
	const match = raw.match(/^(!?)\[\[([^\]\n]+)\]\]$/);
	if (!match) return null;
	const [, embedMarker, body] = match;
	const pipe = findWikiLinkAliasSeparator(body);
	const targetWithHeading = pipe < 0 ? body : body.slice(0, pipe);
	const aliasText =
		pipe < 0 ? null : body.slice(pipe + 1).replaceAll("\\|", "|");
	if (targetWithHeading.endsWith("#") || aliasText === "") return null;
	const { target, heading } = splitWikiLinkTarget(targetWithHeading);
	if (!target && !heading) return null;
	const parsed: Omit<WikiSlateNode, "children"> = {
		type: "wikiLink",
		value: target,
		heading: heading || undefined,
		alias: aliasText,
		embed: embedMarker === "!",
	};
	return {
		...parsed,
		children: [{ text: wikiLinkToMarkdown(parsed) }],
	};
}

export function isWikiLinkDraftText(node: unknown): node is WikiLinkDraftText {
	return (
		typeof node === "object" &&
		node !== null &&
		"text" in node &&
		"wikiLinkDraft" in node &&
		(node as { wikiLinkDraft?: unknown }).wikiLinkDraft === true
	);
}

/** The editable target range, excluding the `[[` / `]]` delimiters. */
export function wikiLinkDraftEditableBounds(raw: string): {
	start: number;
	end: number;
} {
	return {
		start: raw.startsWith("![[") ? 3 : 2,
		end: Math.max(raw.length - 2, 0),
	};
}

/**
 * Source syntax stays visible only while the caret is on one of its characters.
 * Offsets 0 and `raw.length` are outside the source and must project immediately.
 */
export function isWikiLinkDraftEditingOffset(
	raw: string,
	offset: number,
): boolean {
	return offset > 0 && offset < raw.length;
}

export function wikiLinkDraftExteriorPlacement(
	raw: string,
	offset: number,
): "before" | "after" | null {
	if (offset === 0) return "before";
	if (offset === raw.length) return "after";
	return null;
}

export function isWikiLinkNode(node: unknown): node is WikiSlateNode {
	return (
		typeof node === "object" &&
		node !== null &&
		(node as { type?: unknown }).type === "wikiLink" &&
		typeof (node as { value?: unknown }).value === "string"
	);
}

/** Return the editable Markdown source retained by a stable Wikilink node. */
export function wikiLinkNodeSource(node: WikiSlateNode): string {
	return node.children
		.map((child) => (typeof child.text === "string" ? child.text : ""))
		.join("");
}

/** Whether cached navigation attributes already match the editable source. */
export function wikiLinkNodeMatchesSource(
	node: WikiSlateNode,
	parsed: WikiSlateNode,
): boolean {
	return (
		node.value === parsed.value &&
		(node.heading ?? undefined) === (parsed.heading ?? undefined) &&
		(node.alias ?? null) === (parsed.alias ?? null) &&
		(node.embed === true) === (parsed.embed === true)
	);
}

function toSlate(node: MdWikiLink, embed: boolean): WikiSlateNode {
	const raw = node.value ?? "";
	const { target, heading } = splitWikiLinkTarget(raw);
	let alias = node.data?.alias ?? null;
	if (embed) {
		// Image/media embeds encode dimensions as data-fs-width/height, not alias.
		const w = node.data?.hProperties?.["data-fs-width"];
		const h = node.data?.hProperties?.["data-fs-height"];
		if (w || h) alias = w && h ? `${w}x${h}` : String(w || h);
	}
	const parsed: Omit<WikiSlateNode, "children"> = {
		type: "wikiLink",
		value: target,
		heading: heading || undefined,
		alias,
		embed,
	};
	return {
		...parsed,
		children: [{ text: wikiLinkToMarkdown(parsed) }],
	};
}

function serializeWikiLinkNode(node: {
	value: string;
	heading?: string | null;
	alias?: string | null;
	embed?: boolean;
}) {
	const value = node.heading ? `${node.value}#${node.heading}` : node.value;
	const data: { alias?: string } = {};
	if (node.alias) data.alias = node.alias;
	return { type: node.embed ? "embed" : "wikiLink", value, data };
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
			const raw = wikiLinkNodeSource(node) || wikiLinkToMarkdown(node);
			const parsed = parseWikiLinkMarkdown(raw);
			return parsed
				? serializeWikiLinkNode(parsed)
				: { type: "text", value: raw };
		},
	},
	embed: {
		deserialize: (node: MdWikiLink) => toSlate(node, true),
	},
	wikiLinkDraft: {
		mark: true,
		serialize: (node: WikiLinkDraftText) => {
			const parsed = parseWikiLinkMarkdown(node.text);
			return parsed
				? serializeWikiLinkNode(parsed)
				: { type: "text", value: node.text };
		},
	},
};
