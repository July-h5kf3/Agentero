import { nanoid } from "nanoid";

import { parsePdfVisualSessionTrace } from "@/lib/pdf/agent-trace/schema";
import type {
	PdfVisualNormalizedRect,
	PdfVisualSessionTrace,
	PdfVisualTraceAnnotation,
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

export function newAnnotationId(): string {
	return nanoid(10);
}

export type CreateRunningTraceInput = {
	paperPath: string;
	annotations: Array<{
		id?: string;
		page: number;
		rects: PdfVisualNormalizedRect[];
		comment: string;
	}>;
	agentId: string;
	runtimeSessionId: string;
	messageId: string;
	id?: string;
	createdAt?: string;
};

/** Create a running trace after runOnce is accepted. */
export function createRunningTrace(
	input: CreateRunningTraceInput,
): PdfVisualSessionTrace {
	const now = input.createdAt ?? new Date().toISOString();
	const annotations: PdfVisualTraceAnnotation[] = input.annotations.map(
		(item, offset) => ({
			id: item.id ?? newAnnotationId(),
			index: offset + 1,
			page: Math.max(1, Math.floor(item.page)),
			rects: item.rects,
			comment: item.comment.trim(),
		}),
	);
	if (!annotations.length) {
		throw new Error("createRunningTrace requires at least one annotation");
	}
	return {
		version: 1,
		kind: "agent-trace",
		id: input.id ?? newTraceId(),
		paperPath: input.paperPath,
		annotations,
		agentId: input.agentId,
		runtimeSessionId: input.runtimeSessionId,
		messageId: input.messageId,
		status: "running",
		createdAt: now,
		updatedAt: now,
	};
}

export type CompleteTraceInput = {
	providerSessionId?: string;
	answerSnapshot?: string;
	sources?: string[];
	updatedAt?: string;
};

/** Mark a running trace completed and attach answer snapshot. */
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
	delete next.error;
	return next;
}

export type FailTraceInput = {
	error: string;
	answerSnapshot?: string;
	updatedAt?: string;
};

/** Mark a running trace failed. */
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
	return next;
}

export const listPdfVisualTraces = store.list;
export const readPdfVisualTrace = store.read;
export const writePdfVisualTrace = store.write;
export const deletePdfVisualTrace = store.remove;
