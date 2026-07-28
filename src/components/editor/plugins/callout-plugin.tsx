"use client";

import { KEYS, RangeApi, type SlateEditor } from "platejs";
import { createPlatePlugin } from "platejs/react";
import { CalloutElement } from "@/components/editor/callout-node";
import { parseCalloutMarker } from "@/components/editor/plugins/callout-model";

export const CalloutPlugin = createPlatePlugin({
	key: KEYS.callout,
	node: { isElement: true },
}).withComponent(CalloutElement);

/**
 * Convert a complete marker in the current blockquote into a callout body.
 * The marker becomes element metadata and the selection moves into a fresh
 * paragraph, so the same Enter keystroke continues the user's flow.
 */
export function convertBlockquoteMarkerToCallout(editor: SlateEditor): boolean {
	const selection = editor.selection;
	if (!selection || !RangeApi.isCollapsed(selection)) return false;
	const block = editor.api.block();
	if (!block || block[0].type !== editor.getType(KEYS.blockquote)) return false;
	if (!editor.api.isEnd(selection.anchor, block[1])) return false;

	const marker = parseCalloutMarker(editor.api.string(block[1]));
	if (!marker) return false;
	const bodyPoint = { path: [...block[1], 0, 0], offset: 0 };
	editor.tf.withoutNormalizing(() => {
		editor.tf.replaceNodes(
			{
				type: editor.getType(KEYS.callout),
				calloutType: marker.type,
				calloutTypeRaw: marker.typeRaw,
				...(marker.title ? { title: marker.title } : {}),
				children: [
					{
						type: editor.getType(KEYS.p),
						children: [{ text: "" }],
					},
				],
			},
			{ at: block[1] },
		);
		editor.tf.select({ anchor: bodyPoint, focus: bodyPoint });
	});
	return true;
}
