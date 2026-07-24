/** Unified PDF selection overlay (ask / annotate / translate). */

export type SelectionOverlayKind = "ask" | "annotate" | "translate";

/**
 * Which selection dialog is open. Anchor geometry lives on the kind-specific
 * record (ask thread / highlight / translate); screen coords are derived.
 */
export type ActiveSelectionCard = {
	kind: SelectionOverlayKind;
	id: string;
};

export type SelectionPin = {
	id: string;
	kind: SelectionOverlayKind;
	/** 0–1 page-normalized pin position */
	x: number;
	y: number;
	preview: string;
	/** Ask threads that were dismissed still show as “ended” pins */
	ended?: boolean;
};
