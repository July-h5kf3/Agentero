/**
 * PDF visual-region mark → Agent session.
 * One mark file per crop: papers/<id>/marks/<trace-id>.json (kind "agent-trace").
 */

export type PdfVisualNormalizedRect = {
	/** 0–1 relative to page box */
	x: number;
	y: number;
	w: number;
	h: number;
};

export type PdfVisualTraceStatus = "running" | "completed" | "failed";

/** Crop snapshot for hover/list preview (base64, no data: prefix). */
export type PdfVisualTraceImage = {
	data: string;
	mimeType: string;
};

/**
 * One visual pin on a paper (one crop + comment). Marks submitted in the same
 * Agent turn share runtimeSessionId / messageId.
 */
export type PdfVisualSessionTrace = {
	version: 1;
	kind: "agent-trace";
	id: string;
	/** Vault-relative paper folder when known; else absolute hint. */
	paperPath: string;
	/** 1-based order within the submitted batch (matches prompt Annotation N). */
	index: number;
	/** 1-based PDF page number. */
	page: number;
	rects: PdfVisualNormalizedRect[];
	comment: string;
	/** Crop image for pin hover preview. */
	image?: PdfVisualTraceImage;
	agentId: string;
	/** Agentero runtime/event session id from runOnce. */
	runtimeSessionId: string;
	messageId: string;
	/** ACP provider session id when available after completion. */
	providerSessionId?: string;
	status: PdfVisualTraceStatus;
	/** Local answer text when provider history is unavailable. */
	answerSnapshot?: string;
	sources?: string[];
	error?: string;
	createdAt: string;
	updatedAt: string;
};
