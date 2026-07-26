import {
	defineInputRule,
	KEYS,
	matchDelimitedInline,
	type SlateEditor,
} from "platejs";

const INLINE_FOLLOW_RE = /[\s)\]}:;,.!?'"`]/;

function isEquationInputBlocked(editor: SlateEditor) {
	return editor.api.some({
		match: {
			type: [
				editor.getType(KEYS.codeBlock),
				editor.getType(KEYS.equation),
				editor.getType(KEYS.inlineEquation),
			],
		},
	});
}

/**
 * Converts `$expression$` while allowing the opening delimiter next to text.
 * Keep the caret in the following text node so typing can continue immediately.
 */
export const inlineMathInputRule = defineInputRule({
	target: "insertText",
	enabled: ({ editor }) => !isEquationInputBlocked(editor),
	priority: 100,
	trigger: "$",
	resolve: (context) => {
		if (context.text !== "$" || context.options?.at) return;

		return matchDelimitedInline(context, {
			followRe: INLINE_FOLLOW_RE,
			open: "$",
			requireClosingDelimiter: false,
			trim: "reject",
		});
	},
	apply: ({ editor }, match) => {
		editor.tf.delete({ at: match.deleteRange });
		editor.tf.select(match.deleteRange.anchor);
		editor.tf.insertNodes({
			children: [{ text: "" }],
			texExpression: match.content,
			type: editor.getType(KEYS.inlineEquation),
		});

		const equationEntry = editor.api.above({
			match: { type: editor.getType(KEYS.inlineEquation) },
		});
		const afterEquation = equationEntry
			? editor.api.after(equationEntry[1])
			: undefined;
		if (afterEquation) editor.tf.select(afterEquation);

		return true;
	},
});
