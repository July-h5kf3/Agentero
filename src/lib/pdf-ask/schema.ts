import type {
	PdfAskAnchor,
	PdfAskImage,
	PdfAskMessage,
	PdfAskNormalizedRect,
	PdfAskThread,
	PdfAskTrigger,
} from "@/lib/pdf-ask/types";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRect(v: unknown): v is PdfAskNormalizedRect {
	if (!isRecord(v)) return false;
	return (
		typeof v.x === "number" &&
		typeof v.y === "number" &&
		typeof v.w === "number" &&
		typeof v.h === "number"
	);
}

function isTrigger(v: unknown): v is PdfAskTrigger {
	return (
		v === "selection" || v === "dblclick" || v === "dwell" || v === "marquee"
	);
}

function parseImage(v: unknown): PdfAskImage | undefined {
	if (!isRecord(v)) return undefined;
	if (typeof v.mimeType !== "string" || typeof v.dataUrl !== "string") {
		return undefined;
	}
	if (!v.dataUrl.startsWith("data:")) return undefined;
	return { mimeType: v.mimeType, dataUrl: v.dataUrl };
}

function parseMessage(v: unknown): PdfAskMessage | null {
	if (!isRecord(v)) return null;
	if (typeof v.id !== "string" || typeof v.content !== "string") return null;
	if (v.role !== "user" && v.role !== "assistant" && v.role !== "system") {
		return null;
	}
	if (typeof v.createdAt !== "string") return null;
	const msg: PdfAskMessage = {
		id: v.id,
		role: v.role,
		content: v.content,
		createdAt: v.createdAt,
	};
	if (typeof v.agentSessionId === "string") {
		msg.agentSessionId = v.agentSessionId;
	}
	if (Array.isArray(v.sources)) {
		msg.sources = v.sources.filter(isRecord).map((s) => ({
			title: typeof s.title === "string" ? s.title : undefined,
			uri: typeof s.uri === "string" ? s.uri : undefined,
		}));
	}
	const image = parseImage(v.image);
	if (image) msg.image = image;
	return msg;
}

function parseAnchor(v: unknown): PdfAskAnchor | null {
	if (!isRecord(v)) return null;
	if (typeof v.page !== "number" || !Number.isFinite(v.page)) return null;
	if (!Array.isArray(v.rects) || !v.rects.every(isRect)) return null;
	if (!isTrigger(v.trigger)) return null;
	const anchor: PdfAskAnchor = {
		page: Math.max(1, Math.floor(v.page)),
		rects: v.rects as PdfAskNormalizedRect[],
		trigger: v.trigger,
	};
	if (typeof v.quote === "string") anchor.quote = v.quote;
	return anchor;
}

/** Validate and normalize a thread JSON payload. Returns null if invalid. */
export function parsePdfAskThread(raw: unknown): PdfAskThread | null {
	if (!isRecord(raw)) return null;
	if (raw.version !== 1) return null;
	if (typeof raw.id !== "string" || !raw.id) return null;
	if (typeof raw.paperPath !== "string") return null;
	if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") {
		return null;
	}
	if (raw.status !== "open" && raw.status !== "ended") return null;
	const anchor = parseAnchor(raw.anchor);
	if (!anchor) return null;
	if (!Array.isArray(raw.messages)) return null;
	const messages: PdfAskMessage[] = [];
	for (const m of raw.messages) {
		const parsed = parseMessage(m);
		if (!parsed) return null;
		messages.push(parsed);
	}
	const thread: PdfAskThread = {
		version: 1,
		id: raw.id,
		paperPath: raw.paperPath,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
		status: raw.status,
		anchor,
		messages,
	};
	const pending = parseImage(raw.pendingImage);
	if (pending) thread.pendingImage = pending;
	return thread;
}

function shorten(text: string, max: number): string {
	const t = text.trim().replace(/\s+/g, " ");
	if (!t) return "";
	return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t;
}

/** Longer preview for tooltips / gutter aria. */
export function threadPreview(thread: PdfAskThread): string {
	const firstUser = thread.messages.find((m) => m.role === "user");
	if (firstUser?.content.trim()) {
		return shorten(firstUser.content, 80) || thread.id;
	}
	if (firstUser?.image || thread.pendingImage) return "🖼";
	const q = thread.anchor.quote?.trim() ?? "";
	if (q) return shorten(q, 80);
	if (thread.anchor.trigger === "marquee") return "🖼";
	return thread.id;
}

/** Shortest conversation summary for dialog header. */
export function threadTitle(
	thread: PdfAskThread,
	emptyFallback: string,
	imageFallback?: string,
): string {
	const firstUser = thread.messages.find((m) => m.role === "user");
	if (firstUser?.content.trim()) {
		return shorten(firstUser.content, 28) || emptyFallback;
	}
	if (firstUser?.image || thread.pendingImage) {
		return imageFallback ?? emptyFallback;
	}
	const firstAssistant = thread.messages.find((m) => m.role === "assistant");
	if (firstAssistant?.content.trim()) {
		return shorten(firstAssistant.content, 28) || emptyFallback;
	}
	return emptyFallback;
}

/** True once the user has sent at least one turn (question / image ask). */
export function threadHasUserQuestion(thread: PdfAskThread): boolean {
	return thread.messages.some((m) => m.role === "user");
}

/** Pin near the end of the selection (right-center of union rects). */
export function threadPin(thread: PdfAskThread): { x: number; y: number } {
	const rects = thread.anchor.rects;
	if (!rects.length) return { x: 0.5, y: 0.12 };
	let minX = 1;
	let minY = 1;
	let maxX = 0;
	let maxY = 0;
	for (const r of rects) {
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.w);
		maxY = Math.max(maxY, r.y + r.h);
	}
	// Sit just past the selection’s right edge, vertically centered
	const x = Math.min(0.98, Math.max(0.02, maxX + 0.008));
	const y = Math.min(0.98, Math.max(0.02, (minY + maxY) / 2));
	return { x, y };
}

/** @deprecated use threadPin().y */
export function threadY(thread: PdfAskThread): number {
	return threadPin(thread).y;
}
