import type {
	PdfTranslateRecord,
	PdfTranslateRect,
} from "@/lib/pdf-translate/types";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRect(v: unknown): v is PdfTranslateRect {
	if (!isRecord(v)) return false;
	return (
		typeof v.x === "number" &&
		typeof v.y === "number" &&
		typeof v.w === "number" &&
		typeof v.h === "number"
	);
}

/** Validate and normalize a translate JSON payload. Returns null if invalid. */
export function parsePdfTranslateRecord(
	raw: unknown,
): PdfTranslateRecord | null {
	if (!isRecord(raw)) return null;
	if (raw.version !== 1) return null;
	if (raw.kind !== "translate") return null;
	if (typeof raw.id !== "string" || !raw.id) return null;
	if (typeof raw.paperPath !== "string") return null;
	if (typeof raw.createdAt !== "string") return null;
	if (typeof raw.page !== "number" || !Number.isFinite(raw.page)) return null;
	if (!Array.isArray(raw.rects) || !raw.rects.every(isRect)) return null;

	const rec: PdfTranslateRecord = {
		version: 1,
		kind: "translate",
		id: raw.id,
		paperPath: raw.paperPath,
		createdAt: raw.createdAt,
		page: Math.max(1, Math.floor(raw.page)),
		rects: raw.rects as PdfTranslateRect[],
	};
	if (typeof raw.quote === "string") rec.quote = raw.quote;
	if (typeof raw.updatedAt === "string") rec.updatedAt = raw.updatedAt;
	if (typeof raw.result === "string") rec.result = raw.result;
	if (typeof raw.error === "string") rec.error = raw.error;
	return rec;
}
