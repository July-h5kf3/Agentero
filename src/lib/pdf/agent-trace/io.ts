import { nanoid } from "nanoid";

import { isVisualTraceSessionPending } from "@/lib/pdf/agent-trace/pending";
import { parsePdfVisualSessionTrace } from "@/lib/pdf/agent-trace/schema";
import type {
	PdfVisualNormalizedRect,
	PdfVisualSessionTrace,
	PdfVisualTraceImage,
	PdfVisualTraceMessage,
} from "@/lib/pdf/agent-trace/types";
import { createMarkStore } from "@/lib/pdf/marks/io";

const store = createMarkStore<PdfVisualSessionTrace>({
	parse: parsePdfVisualSessionTrace,
	sort: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
	prepareWrite: (trace) => ({
		...trace,
		kind: "agent-trace",
		updatedAt: new Date().toISOString(),
	}),
});

export function newTraceId(): string {
	return nanoid(10);
}

export function newTraceMessageId(): string {
	return nanoid(10);
}

export type CreateRunningTraceItemInput = {
	id?: string;
	page: number;
	rects: PdfVisualNormalizedRect[];
	comment: string;
	image?: PdfVisualTraceImage;
	/** Seed transcript (e.g. first user turn for Cmd+Enter). */
	messages?: PdfVisualTraceMessage[];
};

export type CreateRunningTracesInput = {
	paperPath: string;
	items: CreateRunningTraceItemInput[];
	agentId: string;
	runtimeSessionId: string;
	messageId: string;
	createdAt?: string;
};

/** One mark file per crop; shared session fields when submitted together. */
export function createRunningTraces(
	input: CreateRunningTracesInput,
): PdfVisualSessionTrace[] {
	const now = input.createdAt ?? new Date().toISOString();
	if (!input.items.length) {
		throw new Error("createRunningTraces requires at least one item");
	}
	return input.items.map((item, offset) => {
		const comment = item.comment.trim();
		const trace: PdfVisualSessionTrace = {
			version: 1,
			kind: "agent-trace",
			id: item.id ?? newTraceId(),
			paperPath: input.paperPath,
			index: offset + 1,
			page: Math.max(1, Math.floor(item.page)),
			rects: item.rects,
			comment,
			agentId: input.agentId,
			runtimeSessionId: input.runtimeSessionId,
			messageId: input.messageId,
			status: "running",
			createdAt: now,
			updatedAt: now,
		};
		if (item.image?.data) {
			trace.image = {
				data: item.image.data,
				mimeType: item.image.mimeType || "image/png",
			};
		}
		if (item.messages?.length) {
			trace.messages = item.messages.map((m) => ({ ...m }));
		} else if (comment) {
			// Composer-path marks get a seed user turn so pin hover shows a list.
			trace.messages = [
				{
					id: newTraceMessageId(),
					role: "user",
					content: comment,
					createdAt: now,
				},
			];
		}
		return trace;
	});
}

export type CompleteTraceInput = {
	providerSessionId?: string;
	answerSnapshot?: string;
	sources?: string[];
	updatedAt?: string;
	/** When set, replace or append the assistant message in the local transcript. */
	assistantMessageId?: string;
};

export function completeTrace(
	trace: PdfVisualSessionTrace,
	input: CompleteTraceInput = {},
): PdfVisualSessionTrace {
	const now = input.updatedAt ?? new Date().toISOString();
	const next: PdfVisualSessionTrace = {
		...trace,
		status: "completed",
		updatedAt: now,
	};
	if (input.providerSessionId?.trim()) {
		next.providerSessionId = input.providerSessionId.trim();
	}
	if (typeof input.answerSnapshot === "string") {
		next.answerSnapshot = input.answerSnapshot;
	}
	if (input.sources) {
		next.sources = [...input.sources];
	}
	if (typeof input.answerSnapshot === "string") {
		const content = input.answerSnapshot;
		const messages = [...(trace.messages ?? [])];
		const assistantId = input.assistantMessageId;
		const last = messages[messages.length - 1];
		if (assistantId && last?.id === assistantId && last.role === "assistant") {
			messages[messages.length - 1] = {
				...last,
				content,
				createdAt: now,
				agentSessionId: last.agentSessionId ?? trace.runtimeSessionId,
			};
			next.messages = messages;
		} else if (last?.role === "assistant" && !last.content.trim()) {
			messages[messages.length - 1] = {
				...last,
				content,
				createdAt: now,
				agentSessionId: last.agentSessionId ?? trace.runtimeSessionId,
			};
			next.messages = messages;
		} else if (content.trim()) {
			messages.push({
				id: assistantId ?? newTraceMessageId(),
				role: "assistant",
				content,
				createdAt: now,
				agentSessionId: trace.runtimeSessionId,
			});
			next.messages = messages;
		}
	}
	delete next.error;
	return next;
}

export type FailTraceInput = {
	error: string;
	answerSnapshot?: string;
	updatedAt?: string;
	assistantMessageId?: string;
};

export function failTrace(
	trace: PdfVisualSessionTrace,
	input: FailTraceInput,
): PdfVisualSessionTrace {
	const now = input.updatedAt ?? new Date().toISOString();
	const next: PdfVisualSessionTrace = {
		...trace,
		status: "failed",
		error: input.error.trim() || "Agent failed",
		updatedAt: now,
	};
	if (typeof input.answerSnapshot === "string") {
		next.answerSnapshot = input.answerSnapshot;
	}
	// Drop only an empty (or still-streaming) assistant bubble on failure.
	// Never drop user turns — multi-turn history must survive a failed continue.
	if (trace.messages?.length) {
		const messages = [...trace.messages];
		const last = messages[messages.length - 1];
		const dropId = input.assistantMessageId;
		const isTargetAssistant =
			last?.role === "assistant" &&
			(!dropId || last.id === dropId) &&
			!last.content.trim();
		if (isTargetAssistant) {
			messages.pop();
			next.messages = messages;
		} else {
			// Explicitly keep the full transcript (incl. the latest user turn).
			next.messages = messages;
		}
	}
	return next;
}

/**
 * Persist a failed outcome for running marks that no longer have an in-flight
 * Agent finalizer (app restart, dropped stream, panel unmount mid-run, …).
 * Skips sessions still in the pending map or within the post-take grace window
 * so list/refresh cannot race a normal complete/fail write.
 */
export async function reconcileOrphanRunningVisualTraces(
	paperAbsPath: string,
	traces: PdfVisualSessionTrace[],
	errorMessage = "Agent session interrupted",
): Promise<PdfVisualSessionTrace[]> {
	if (!paperAbsPath || !traces.length) return traces;
	const out: PdfVisualSessionTrace[] = [];
	for (const trace of traces) {
		if (trace.status !== "running") {
			out.push(trace);
			continue;
		}
		if (isVisualTraceSessionPending(trace.runtimeSessionId)) {
			out.push(trace);
			continue;
		}
		// Provisional in-memory pins use "pending" before a real session id exists;
		// they are not disk-backed long-term, but if one lands on disk, fail it too.
		const failed = failTrace(trace, { error: errorMessage });
		try {
			await store.write(paperAbsPath, failed);
		} catch {
			// Best-effort: still surface the reconciled status in memory.
		}
		out.push(failed);
	}
	return out;
}

/** List marks and fold orphaned `running` pins into `failed` when safe. */
export async function listPdfVisualTraces(
	paperAbsPath: string,
): Promise<PdfVisualSessionTrace[]> {
	const traces = await store.list(paperAbsPath);
	return reconcileOrphanRunningVisualTraces(paperAbsPath, traces);
}

export const readPdfVisualTrace = store.read;
export const writePdfVisualTrace = store.write;
export const deletePdfVisualTrace = store.remove;
