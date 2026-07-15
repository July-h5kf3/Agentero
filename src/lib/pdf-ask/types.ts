/** PDF selection-ask thread model. See docs/development/pdf-ask.md */

export type PdfAskTrigger = "selection" | "dblclick" | "dwell" | "marquee";

export type PdfAskStatus = "open" | "ended";

export type PdfAskMessageRole = "user" | "assistant" | "system";

export type PdfAskNormalizedRect = {
	/** 0–1 relative to page box */
	x: number;
	y: number;
	w: number;
	h: number;
};

export type PdfAskImage = {
	mimeType: string;
	/** data:image/...;base64,... for display / agent */
	dataUrl: string;
};

export type PdfAskAnchor = {
	page: number;
	rects: PdfAskNormalizedRect[];
	quote?: string;
	trigger: PdfAskTrigger;
};

export type PdfAskMessage = {
	id: string;
	role: PdfAskMessageRole;
	content: string;
	createdAt: string;
	agentSessionId?: string;
	sources?: { title?: string; uri?: string }[];
	/** Optional screenshot / figure crop attached to this turn */
	image?: PdfAskImage;
};

export type PdfAskThread = {
	version: 1;
	id: string;
	/** Vault-relative paper folder when known; else absolute hint */
	paperPath: string;
	createdAt: string;
	updatedAt: string;
	status: PdfAskStatus;
	anchor: PdfAskAnchor;
	messages: PdfAskMessage[];
	/**
	 * Draft crop attached before the first send (marquee).
	 * Cleared when folded into a user message.
	 */
	pendingImage?: PdfAskImage;
};

export type PdfAskThreadSummary = {
	id: string;
	page: number;
	/**
	 * Pin position on the page (0–1), near the selection / marquee —
	 * typically the right-middle of the anchor rects, not forced to page margin.
	 */
	x: number;
	y: number;
	preview: string;
	updatedAt: string;
	status: PdfAskStatus;
};
