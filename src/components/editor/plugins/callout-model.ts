import {
	convertChildrenDeserialize,
	convertNodesSerialize,
	type MdRules,
} from "@platejs/markdown";

export type CalloutSlateNode = {
	type: "callout";
	calloutType: string;
	calloutTypeRaw: string;
	title?: string;
	children: unknown[];
};

type MdNode = {
	type: string;
	value?: string;
	children?: MdNode[];
	calloutType?: string;
	calloutTypeRaw?: string;
	title?: string;
};

export type CalloutMarker = {
	type: string;
	typeRaw: string;
	title?: string;
};

const CALLOUT_MARKER_RE = /^\[!([A-Za-z0-9_-]+)\](?:[ \t]+(.*?))?[ \t]*$/;

export function parseCalloutMarker(line: string): CalloutMarker | null {
	const match = line.match(CALLOUT_MARKER_RE);
	if (!match) return null;
	const typeRaw = match[1];
	const title = match[2]?.trim();
	return {
		type: typeRaw.toLocaleLowerCase(),
		typeRaw,
		...(title ? { title } : {}),
	};
}

function calloutFromBlockquote(node: MdNode): MdNode | null {
	if (node.type !== "blockquote") return null;
	const firstParagraph = node.children?.[0];
	const firstText = firstParagraph?.children?.[0];
	if (
		firstParagraph?.type !== "paragraph" ||
		firstText?.type !== "text" ||
		typeof firstText.value !== "string"
	) {
		return null;
	}

	const newline = firstText.value.indexOf("\n");
	const header =
		newline < 0 ? firstText.value : firstText.value.slice(0, newline);
	const marker = parseCalloutMarker(header);
	if (!marker) return null;
	if (newline < 0 && (firstParagraph.children?.length ?? 0) > 1) {
		return null;
	}

	const body = [...(node.children ?? [])];
	if (newline < 0) {
		body.shift();
	} else {
		const bodyPrefix = firstText.value.slice(newline + 1);
		const paragraphChildren = [...(firstParagraph.children ?? [])];
		if (bodyPrefix) {
			paragraphChildren[0] = { ...firstText, value: bodyPrefix };
		} else {
			paragraphChildren.shift();
		}
		if (paragraphChildren.length) {
			body[0] = { ...firstParagraph, children: paragraphChildren };
		} else {
			body.shift();
		}
	}

	return {
		type: "callout",
		calloutType: marker.type,
		calloutTypeRaw: marker.typeRaw,
		...(marker.title ? { title: marker.title } : {}),
		children: body,
	};
}

function transformTree(
	node: MdNode,
	transform: (child: MdNode) => MdNode | null,
): void {
	if (!node.children) return;
	node.children = node.children.map((child) => {
		const replacement = transform(child);
		if (replacement) return replacement;
		transformTree(child, transform);
		return child;
	});
}

/**
 * Translate Obsidian blockquote markers into a portable mdast callout.
 * Serialization emits blockquote mdast directly from the callout rule below.
 */
export function remarkObsidianCallout() {
	return (tree: MdNode) => {
		transformTree(tree, calloutFromBlockquote);
	};
}

export const obsidianCalloutRules = {
	callout: {
		deserialize: (node, deco, options) => {
			const children = convertChildrenDeserialize(
				node.children ?? [],
				deco,
				options,
			);
			return {
				type: "callout",
				calloutType: node.calloutType,
				calloutTypeRaw: node.calloutTypeRaw,
				title: node.title,
				children: children.length
					? children
					: [{ type: "p", children: [{ text: "" }] }],
			};
		},
		serialize: (node, options) => {
			const typeRaw = node.calloutTypeRaw || node.calloutType || "note";
			const title = node.title ? ` ${node.title}` : "";
			return {
				type: "blockquote",
				children: [
					{
						type: "paragraph",
						children: [{ type: "html", value: `[!${typeRaw}]${title}` }],
					},
					...convertNodesSerialize(node.children, options),
				],
			};
		},
	},
} satisfies MdRules;
