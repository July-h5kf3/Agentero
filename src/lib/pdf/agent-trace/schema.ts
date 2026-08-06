import { normalizeVisualTraceImagePath } from "@/lib/pdf/agent-trace/image";
import type {
	PdfVisualNormalizedRect,
	PdfVisualSessionTrace,
	PdfVisualTraceImage,
	PdfVisualTraceMessage,
	PdfVisualTraceStatus,
} from "@/lib/pdf/agent-trace/types";
import { isRecord, isRect } from "@/lib/pdf/marks/schema";
import { pinFromRects } from "@/lib/pdf/selection/pin";

function isStatus(v: unknown): v is PdfVisualTraceStatus {
	return v === "running" || v === "completed" || v === "failed";
}

function parseImage(v: unknown): PdfVisualTraceImage | undefined {
	if (!isRecord(v)) return undefined;
	const path = normalizeVisualTraceImagePath(v.path);
	if (!path) return undefined;
	const mimeType =
		typeof v.mimeType === "string" && v.mimeType.trim()
			? v.mimeType.trim()
			: "image/png";
	return { path, mimeType };
}

function parseMessages(v: unknown): PdfVisualTraceMessage[] | undefined {
	if (!Array.isArray(v) || v.length === 0) return undefined;
	const out: PdfVisualTraceMessage[] = [];
	for (const item of v) {
		if (!isRecord(item)) continue;
		if (typeof item.id !== "string" || !item.id) continue;
		if (item.role !== "user" && item.role !== "assistant") continue;
		if (typeof item.content !== "string") continue;
		if (typeof item.createdAt !== "string" || !item.createdAt) continue;
		const msg: PdfVisualTraceMessage = {
			id: item.id,
			role: item.role,
			content: item.content,
			createdAt: item.createdAt,
		};
		if (typeof item.agentSessionId === "string" && item.agentSessionId) {
			msg.agentSessionId = item.agentSessionId;
		}
		out.push(msg);
	}
	return out.length ? out : undefined;
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
	const messages = parseMessages(raw.messages);
	if (messages) trace.messages = messages;
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

/**
 * Messages for hover chat UI. Prefer stored transcript; otherwise synthesize
 * from comment + answerSnapshot so legacy marks still show a message list.
 */
export function traceMessages(
	trace: PdfVisualSessionTrace,
): PdfVisualTraceMessage[] {
	if (trace.messages?.length) return trace.messages;
	const synthesized: PdfVisualTraceMessage[] = [];
	const comment = trace.comment.trim();
	if (comment) {
		synthesized.push({
			id: `${trace.id}-user`,
			role: "user",
			content: comment,
			createdAt: trace.createdAt,
		});
	}
	const answer = trace.answerSnapshot?.trim();
	if (answer) {
		synthesized.push({
			id: `${trace.id}-assistant`,
			role: "assistant",
			content: answer,
			createdAt: trace.updatedAt,
			agentSessionId: trace.runtimeSessionId,
		});
	} else if (trace.status === "failed" && trace.error?.trim()) {
		synthesized.push({
			id: `${trace.id}-error`,
			role: "assistant",
			content: trace.error.trim(),
			createdAt: trace.updatedAt,
		});
	}
	return synthesized;
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

/** Pin geometry for a mark (prefer right side of the crop). */
export function tracePin(trace: PdfVisualSessionTrace) {
	return pinFromRects(trace.rects);
}
