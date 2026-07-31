/**
 * PDF visual-region → Agent session trace.
 * Persisted under papers/<id>/marks/<trace-id>.json with kind "agent-trace".
 */

export type PdfVisualNormalizedRect = {
	/** 0–1 relative to page box */
	x: number;
	y: number;
	w: number;
	h: number;
};

export type PdfVisualTraceStatus = "running" | "completed" | "failed";

export type PdfVisualTraceAnnotation = {
	id: string;
	/** 1-based order within this trace (matches prompt headings). */
	index: number;
	/** 1-based PDF page number. */
	page: number;
	rects: PdfVisualNormalizedRect[];
	comment: string;
};

/**
 * One submitted visual batch for a single paper.
 * Multiple annotations share one Agent runtime session / turn.
 */
export type PdfVisualSessionTrace = {
	version: 1;
	kind: "agent-trace";
	id: string;
	/** Vault-relative paper folder when known; else absolute hint. */
	paperPath: string;
	annotations: PdfVisualTraceAnnotation[];
	agentId: string;
	/** Agentero runtime/event session id from runOnce. */
	runtimeSessionId: string;
	messageId: string;
	/** ACP provider session id when available after completion. */
	providerSessionId?: string;
	status: PdfVisualTraceStatus;
	/** Local answer text for fallback when provider history is unavailable. */
	answerSnapshot?: string;
	sources?: string[];
	error?: string;
	createdAt: string;
	updatedAt: string;
};

export type PdfVisualTracePin = {
	id: string;
	traceId: string;
	annotationId: string;
	page: number;
	x: number;
	y: number;
	preview: string;
	status: PdfVisualTraceStatus;
};
