import { RangeApi, type TRange } from "platejs";
import type { PlateEditor } from "platejs/react";

export type EditorLinkTemplateKind = "wiki" | "external";

export type EditorLinkTemplate = {
	text: string;
	selectionStart: number;
	selectionEnd: number;
	wikiLinkDraft: boolean;
};

export type EditorContextMenuCapabilities = {
	copy: boolean;
	cut: boolean;
	formatMarkdown: boolean;
	insertLink: boolean;
	paste: boolean;
	renameHeading: boolean;
};

export function editorContextMenuCapabilities({
	headingRenameAvailable,
	readOnly,
	selectionExpanded,
}: {
	headingRenameAvailable: boolean;
	readOnly: boolean;
	selectionExpanded: boolean;
}): EditorContextMenuCapabilities {
	return {
		copy: selectionExpanded,
		cut: !readOnly && selectionExpanded,
		formatMarkdown: !readOnly,
		insertLink: !readOnly,
		paste: !readOnly,
		renameHeading: headingRenameAvailable,
	};
}

/**
 * Build the literal Markdown inserted by the editor context menu.
 *
 * A selected single-line label is preserved and remains selected after the
 * insertion. With a collapsed caret, the selection lands in the empty target
 * (`[[|]]`) or label (`[|]()`), ready for typing.
 */
export function editorLinkTemplate(
	kind: EditorLinkTemplateKind,
	selectedText = "",
): EditorLinkTemplate {
	if (kind === "wiki") {
		return {
			text: `[[${selectedText}]]`,
			selectionStart: 2,
			selectionEnd: 2 + selectedText.length,
			wikiLinkDraft: true,
		};
	}
	return {
		text: `[${selectedText}]()`,
		selectionStart: 1,
		selectionEnd: 1 + selectedText.length,
		wikiLinkDraft: false,
	};
}

/**
 * Replace the supplied editor selection with a Markdown link template and
 * leave the resulting selection inside its editable target/label.
 */
export function insertEditorLinkTemplate(
	editor: Pick<PlateEditor, "api" | "selection" | "tf">,
	kind: EditorLinkTemplateKind,
	selection: TRange,
): EditorLinkTemplate {
	const selectedText = RangeApi.isCollapsed(selection)
		? ""
		: editor.api.string(selection);
	const template = editorLinkTemplate(kind, selectedText);
	editor.tf.select(selection);
	editor.tf.withoutNormalizing(() => {
		if (!RangeApi.isCollapsed(selection)) {
			editor.tf.deleteFragment();
		}
		if (template.wikiLinkDraft) {
			editor.tf.insertNodes({
				text: template.text,
				wikiLinkDraft: true,
			});
		} else {
			editor.tf.insertText(template.text);
		}
		const suffixLength = template.text.length - template.selectionEnd;
		if (suffixLength > 0) {
			editor.tf.move({ distance: suffixLength, reverse: true });
		}
		const selectedLength = template.selectionEnd - template.selectionStart;
		const focus = editor.selection?.anchor;
		const anchor =
			focus && selectedLength > 0
				? editor.api.before(focus, {
						distance: selectedLength,
						unit: "character",
					})
				: null;
		if (anchor && focus) {
			editor.tf.select({ anchor, focus });
		}
	});
	return template;
}
