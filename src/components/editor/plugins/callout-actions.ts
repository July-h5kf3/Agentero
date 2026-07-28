import type { SlateEditor, TElement } from "platejs";
import { parseCalloutMarker } from "@/components/editor/plugins/callout-model";

export function updateCalloutMetadata(
	editor: SlateEditor,
	element: TElement,
	metadata: { title: string; typeRaw: string },
): boolean {
	const marker = parseCalloutMarker(`[!${metadata.typeRaw.trim()}]`);
	const path = editor.api.findPath(element);
	if (!marker || !path) return false;

	editor.tf.setNodes(
		{
			calloutType: marker.type,
			calloutTypeRaw: marker.typeRaw,
			title: metadata.title.trim() || undefined,
		},
		{ at: path },
	);
	return true;
}
