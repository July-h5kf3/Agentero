import type {
	PdfVisualNormalizedRect,
	PdfVisualSessionTrace,
	PdfVisualTraceImage,
	PdfVisualTraceStatus,
} from "@/lib/pdf/agent-trace/types";
import { isRecord, isRect } from "@/lib/pdf/marks/schema";
import { pinFromRects } from "@/lib/pdf/selection/pin";

function isStatus(v: unknown): v is PdfVisualTraceStatus {
	return v === "running" || v === "completed" || v === "failed";
}

function parseImage(v: unknown): PdfVisualTraceImage | undefined {
	if (!isRecord(v)) return undefined;
	if (typeof v.data !== "string" || !v.data) return undefined;
	const mimeType =
		typeof v.mimeType === "string" && v.mimeType.trim()
			? v.mimeType.trim()
			: "image/png";
	return { data: v.data, mimeType };
}

/** Validate and normalize a visual mark JSON payload. */
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
	if (typeof raw.page !== "number" || !Number.isFinite(raw.page)) return null;
	if (
		!Array.isArray(raw.rects) ||
		raw.rects.length === 0 ||
		!raw.rects.every(isRect)
	) {
		return null;
	}
	if (typeof raw.comment !== "string") return null;
	const index =
		typeof raw.index === "number" && Number.isFinite(raw.index)
			? Math.max(1, Math.floor(raw.index))
			: 1;

	const trace: PdfVisualSessionTrace = {
		version: 1,
		kind: "agent-trace",
		id: raw.id,
		paperPath: raw.paperPath,
		index,
		page: Math.max(1, Math.floor(raw.page)),
		rects: raw.rects as PdfVisualNormalizedRect[],
		comment: raw.comment,
		agentId: raw.agentId,
		runtimeSessionId: raw.runtimeSessionId,
		messageId: raw.messageId,
		status: raw.status,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
	};
	const image = parseImage(raw.image);
	if (image) trace.image = image;
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

/** Tooltip / list preview for one mark. */
export function tracePreview(
	trace: PdfVisualSessionTrace,
	fallback = "Visual annotation",
	max = 80,
): string {
	const comment = trace.comment.trim();
	if (comment) return shorten(comment, max) || fallback;
	return `${fallback} ${trace.index}`;
}

/** Pin geometry for a mark. */
export function tracePin(trace: PdfVisualSessionTrace): {
	x: number;
	y: number;
} {
	return pinFromRects(trace.rects);
}
