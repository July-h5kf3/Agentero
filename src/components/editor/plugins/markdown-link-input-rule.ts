import {
	defineInputRule,
	KEYS,
	type Point,
	type Range,
	type SlateEditor,
} from "platejs";

/**
 * Match a complete Markdown link ending at the caret (closing `)` not yet typed).
 * Label may contain nested balanced brackets rarely; keep the common case simple:
 * `[label](url` with no `]` / `)` inside url, and non-empty label/url.
 */
const MARKDOWN_LINK_BEFORE_CLOSE_RE = /\[([^\]]+)\]\(([^)\s]+)$/;

function isLinkInputBlocked(editor: SlateEditor) {
	return editor.api.some({
		match: {
			type: [
				editor.getType(KEYS.codeBlock),
				editor.getType(KEYS.code),
				editor.getType(KEYS.a),
			],
		},
	});
}

function rangeFromEnd(
	editor: SlateEditor,
	end: Point,
	charCount: number,
): Range | null {
	const start = editor.api.before(end, {
		distance: charCount,
		unit: "character",
	});
	if (!start) return null;
	return { anchor: start, focus: end };
}

/**
 * On typing `)`, convert a trailing `[label](url` sequence into an inline
 * link element. Paste already works via Markdown deserialize; this covers
 * hand-typed external (and relative) Markdown links.
 */
export const markdownLinkInputRule = defineInputRule({
	target: "insertText",
	enabled: ({ editor }) => !isLinkInputBlocked(editor),
	priority: 90,
	trigger: ")",
	resolve: (context) => {
		if (context.text !== ")" || context.options?.at) return;
		const editor = context.editor;
		if (!editor.selection || !editor.api.isCollapsed()) return;

		const end = editor.selection.anchor;
		// Look back far enough for a typical typed link without scanning the whole doc.
		const lookback = 512;
		const start = editor.api.before(end, {
			distance: lookback,
			unit: "character",
		});
		const prefix = editor.api.string({
			anchor: start ?? { path: end.path, offset: 0 },
			focus: end,
		});
		const match = MARKDOWN_LINK_BEFORE_CLOSE_RE.exec(prefix);
		if (!match) return;

		const full = match[0];
		const label = match[1] ?? "";
		const url = match[2] ?? "";
		if (!label || !url) return;

		const deleteRange = rangeFromEnd(editor, end, full.length);
		if (!deleteRange) return;

		return { deleteRange, label, url };
	},
	apply: ({ editor }, match) => {
		editor.tf.delete({ at: match.deleteRange });
		editor.tf.select(match.deleteRange.anchor);
		editor.tf.insertNodes({
			type: editor.getType(KEYS.a),
			url: match.url,
			children: [{ text: match.label }],
		});

		const linkEntry = editor.api.above({
			match: { type: editor.getType(KEYS.a) },
		});
		const afterLink = linkEntry ? editor.api.after(linkEntry[1]) : undefined;
		if (afterLink) editor.tf.select(afterLink);

		return true;
	},
});
