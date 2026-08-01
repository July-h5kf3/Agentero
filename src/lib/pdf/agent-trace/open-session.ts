/**
 * Build Agent panel history from a visual-trace mark.
 * Product session id is stable (trace.id); runtime ACP ids are not the key.
 */

import type {
	ChatLine,
	ChatSessionHistoryItem,
	ChatVisualAnnotation,
} from "@/lib/agent/chat-state";
import { nextLineId, nextPartId } from "@/lib/agent/chat-state";
import type {
	PdfVisualSessionTrace,
	PdfVisualTraceImage,
	PdfVisualTraceMessage,
} from "@/lib/pdf/agent-trace/types";

/** Stable Agent history id for one visual mark (not a runtime runOnce id). */
export function visualTraceHistoryId(traceId: string): string {
	return `visual-trace:${traceId}`;
}

export function isVisualTraceHistoryId(id: string): boolean {
	return id.startsWith("visual-trace:");
}

export type VisualTraceOpenPayload = {
	traceId: string;
	page: number;
	comment: string;
	paperPath?: string;
	image?: PdfVisualTraceImage;
	messages: PdfVisualTraceMessage[];
};

/** Convert mark transcript → chat lines; attach crop chip on the first user turn. */
export function buildChatLinesFromVisualTrace(
	payload: VisualTraceOpenPayload,
	opts?: { emptyFallback?: string },
): ChatLine[] {
	const lines: ChatLine[] = [];
	const messages = payload.messages;
	let attachedChip = false;

	const chip: ChatVisualAnnotation | null = payload.image?.data
		? {
				id: payload.traceId,
				page: payload.page,
				comment: payload.comment,
				paperPath: payload.paperPath,
				image: {
					data: payload.image.data,
					mimeType: payload.image.mimeType || "image/png",
				},
			}
		: null;

	for (const m of messages) {
		if (m.role === "user") {
			const line: ChatLine = {
				id: m.id || nextLineId("user"),
				kind: "user",
				text: m.content,
			};
			if (chip && !attachedChip) {
				line.visualAnnotations = [chip];
				attachedChip = true;
			}
			lines.push(line);
			continue;
		}
		const text = m.content.trim();
		if (!text) continue;
		lines.push({
			id: m.id || nextLineId("agent"),
			kind: "agent",
			parts: [
				{
					type: "text",
					id: nextPartId("text"),
					text: m.content,
				},
			],
			streaming: false,
		});
	}

	if (lines.length === 0) {
		const text =
			payload.comment.trim() || opts?.emptyFallback || "Visual annotation";
		const line: ChatLine = {
			id: nextLineId("user"),
			kind: "user",
			text,
		};
		if (chip) line.visualAnnotations = [chip];
		lines.push(line);
	}

	return lines;
}

/** Local history entry for Open in Agent (single logical session per mark). */
export function buildVisualTraceHistoryItem(input: {
	trace: Pick<
		PdfVisualSessionTrace,
		| "id"
		| "page"
		| "comment"
		| "paperPath"
		| "image"
		| "agentId"
		| "runtimeSessionId"
		| "providerSessionId"
		| "status"
		| "messages"
		| "answerSnapshot"
	>;
	messages: PdfVisualTraceMessage[];
	title: string;
	agentName: string;
	startedAt: string;
	emptyFallback?: string;
}): ChatSessionHistoryItem {
	const { trace } = input;
	const lines = buildChatLinesFromVisualTrace(
		{
			traceId: trace.id,
			page: trace.page,
			comment: trace.comment,
			paperPath: trace.paperPath,
			image: trace.image,
			messages: input.messages,
		},
		{ emptyFallback: input.emptyFallback },
	);
	// If transcript has no assistant yet but answerSnapshot exists, append it.
	const hasAssistant = lines.some((l) => l.kind === "agent");
	const snapshot = trace.answerSnapshot?.trim();
	if (!hasAssistant && snapshot) {
		lines.push({
			id: nextLineId("agent"),
			kind: "agent",
			parts: [{ type: "text", id: nextPartId("text"), text: snapshot }],
			streaming: false,
		});
	}
	const status: ChatSessionHistoryItem["status"] =
		trace.status === "running"
			? "running"
			: trace.status === "failed"
				? "failed"
				: "completed";
	return {
		id: visualTraceHistoryId(trace.id),
		agentId: trace.agentId,
		source: "local",
		title: input.title,
		agentName: input.agentName,
		startedAt: input.startedAt,
		lines,
		status,
		// Source ACP session — Host continues via resume or load (Grok: load).
		providerSessionId: trace.providerSessionId ?? null,
		resumeable: true,
	};
}
