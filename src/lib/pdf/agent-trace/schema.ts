import type {
	PdfVisualNormalizedRect,
	PdfVisualSessionTrace,
	PdfVisualTraceAnnotation,
	PdfVisualTracePin,
	PdfVisualTraceStatus,
} from "@/lib/pdf/agent-trace/types";
import { isRecord, isRect } from "@/lib/pdf/marks/schema";
import { pinFromRects } from "@/lib/pdf/selection/pin";

function isStatus(v: unknown): v is PdfVisualTraceStatus {
	return v === "running" || v === "completed" || v === "failed";
}

function parseAnnotation(v: unknown): PdfVisualTraceAnnotation | null {
	if (!isRecord(v)) return null;
	if (typeof v.id !== "string" || !v.id) return null;
	if (typeof v.index !== "number" || !Number.isFinite(v.index)) return null;
	if (typeof v.page !== "number" || !Number.isFinite(v.page)) return null;
	if (!Array.isArray(v.rects) || !v.rects.every(isRect)) return null;
	if (typeof v.comment !== "string") return null;
	return {
		id: v.id,
		index: Math.max(1, Math.floor(v.index)),
		page: Math.max(1, Math.floor(v.page)),
		rects: v.rects as PdfVisualNormalizedRect[],
		comment: v.comment,
	};
}

/** Validate and normalize a visual session-trace JSON payload. */
export function parsePdfVisualSessionTrace(
	raw: unknown,
): PdfVisualSessionTrace | null {
	if (!isRecord(raw)) return null;
	if (raw.version !== 1) return null;
	if (raw.kind !== "agent-trace") return null;
	if (typeof raw.id !== "string" || !raw.id) return null;
	if (typeof raw.paperPath !== "string") return null;
	if (typeof raw.agentId !== "string" || !raw.agentId) return null;
	if (typeof raw.runtimeSessionId !== "string" || !raw.runtimeSessionId) {
		return null;
	}
	if (typeof raw.messageId !== "string" || !raw.messageId) return null;
	if (!isStatus(raw.status)) return null;
	if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") {
		return null;
	}
	if (!Array.isArray(raw.annotations) || raw.annotations.length === 0) {
		return null;
	}
	const annotations: PdfVisualTraceAnnotation[] = [];
	for (const item of raw.annotations) {
		const parsed = parseAnnotation(item);
		if (!parsed) return null;
		annotations.push(parsed);
	}
	const trace: PdfVisualSessionTrace = {
		version: 1,
		kind: "agent-trace",
		id: raw.id,
		paperPath: raw.paperPath,
		annotations,
		agentId: raw.agentId,
		runtimeSessionId: raw.runtimeSessionId,
		messageId: raw.messageId,
		status: raw.status,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
	};
	if (typeof raw.providerSessionId === "string" && raw.providerSessionId) {
		trace.providerSessionId = raw.providerSessionId;
	}
	if (typeof raw.answerSnapshot === "string") {
		trace.answerSnapshot = raw.answerSnapshot;
	}
	if (Array.isArray(raw.sources)) {
		trace.sources = raw.sources.filter(
			(s): s is string => typeof s === "string",
		);
	}
	if (typeof raw.error === "string") {
		trace.error = raw.error;
	}
	return trace;
}

function shorten(text: string, max: number): string {
	const t = text.trim().replace(/\s+/g, " ");
	if (!t) return "";
	return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t;
}

/** Tooltip / gutter preview for one annotation. */
export function annotationPreview(
	annotation: PdfVisualTraceAnnotation,
	fallback = "Visual annotation",
): string {
	const comment = annotation.comment.trim();
	if (comment) return shorten(comment, 80) || fallback;
	return `${fallback} ${annotation.index}`;
}

/** Pin geometry for a single annotation region. */
export function annotationPin(annotation: PdfVisualTraceAnnotation): {
	x: number;
	y: number;
} {
	return pinFromRects(annotation.rects);
}

/** One pin per annotation so multi-region traces light up every crop. */
export function tracePins(trace: PdfVisualSessionTrace): PdfVisualTracePin[] {
	return trace.annotations.map((annotation) => {
		const pin = annotationPin(annotation);
		return {
			id: `${trace.id}:${annotation.id}`,
			traceId: trace.id,
			annotationId: annotation.id,
			page: annotation.page,
			x: pin.x,
			y: pin.y,
			preview: annotationPreview(annotation),
			status: trace.status,
		};
	});
}
