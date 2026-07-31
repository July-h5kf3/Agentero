/** Unified PDF selection overlay (ask / annotate / translate / agent-trace). */

export type SelectionOverlayKind =
	| "ask"
	| "annotate"
	| "translate"
	| "agent-trace";

/**
 * Which selection dialog is open. Anchor geometry lives on the kind-specific
 * record (ask thread / highlight / translate); screen coords are derived.
 * agent-trace opens the Agent panel session instead of a local card.
 */
export type ActiveSelectionCard = {
	kind: Exclude<SelectionOverlayKind, "agent-trace">;
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
	/** Parent agent-trace id when kind is agent-trace. */
	traceId?: string;
};
