/**
 * Optional per-paper reading meta (PDF page count) for heatmap extent.
 * Path: `{paper}/reading-meta.json` — projection only, not catalog.
 */
import { isTauri } from "@/lib/core/tauri";
import { joinVaultPath, readVaultFile, writeVaultFile } from "@/lib/vault";

export type ReadingMeta = {
	version: 1;
	pageCount: number;
	updatedAt: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function metaPath(paperAbsPath: string): string {
	return joinVaultPath(paperAbsPath, "reading-meta.json");
}

export function parseReadingMeta(raw: unknown): ReadingMeta | null {
	if (!isRecord(raw)) return null;
	if (raw.version !== 1) return null;
	if (typeof raw.pageCount !== "number" || !Number.isFinite(raw.pageCount)) {
		return null;
	}
	if (typeof raw.updatedAt !== "string") return null;
	const pageCount = Math.max(1, Math.floor(raw.pageCount));
	return { version: 1, pageCount, updatedAt: raw.updatedAt };
}

export async function readReadingMeta(
	paperAbsPath: string,
): Promise<ReadingMeta | null> {
	if (!paperAbsPath) return null;
	try {
		const raw = await readVaultFile(metaPath(paperAbsPath));
		return parseReadingMeta(JSON.parse(raw) as unknown);
	} catch {
		return null;
	}
}

/** Persist PDF page count when known (idempotent if unchanged). */
export async function writeReadingMetaPageCount(
	paperAbsPath: string,
	pageCount: number,
): Promise<void> {
	if (!paperAbsPath || pageCount < 1) return;
	const next: ReadingMeta = {
		version: 1,
		pageCount: Math.floor(pageCount),
		updatedAt: new Date().toISOString(),
	};

	if (!isTauri()) {
		// Browser dev: skip disk; heatmap falls back to max activity page.
		return;
	}

	try {
		const prev = await readReadingMeta(paperAbsPath);
		if (prev && prev.pageCount === next.pageCount) return;
	} catch {
		// write anyway
	}

	await writeVaultFile(
		metaPath(paperAbsPath),
		`${JSON.stringify(next, null, 2)}\n`,
	);
}
