import { listPdfAskThreads } from "@/lib/pdf-ask/io";
import { listPdfHighlights } from "@/lib/pdf-highlight/io";
import { listPdfTranslates } from "@/lib/pdf-translate/io";
import {
	aggregateReadingHeatmap,
	emptyHeatmap,
	meanRectY,
} from "@/lib/reading-heatmap/aggregate";
import { readReadingMeta } from "@/lib/reading-heatmap/meta";
import type {
	ReadingActivityPoint,
	ReadingHeatmap,
} from "@/lib/reading-heatmap/types";
import { joinVaultPath } from "@/lib/vault";

/** Collect activity points for one paper folder (absolute path). */
export async function loadReadingActivityPoints(
	paperAbsPath: string,
): Promise<{ points: ReadingActivityPoint[]; pageCount?: number }> {
	if (!paperAbsPath) return { points: [] };

	const [highlights, asks, translates, meta] = await Promise.all([
		listPdfHighlights(paperAbsPath).catch(() => []),
		listPdfAskThreads(paperAbsPath).catch(() => []),
		listPdfTranslates(paperAbsPath).catch(() => []),
		readReadingMeta(paperAbsPath).catch(() => null),
	]);

	const points: ReadingActivityPoint[] = [];

	for (const h of highlights) {
		points.push({
			kind: "highlight",
			page: h.page,
			y: meanRectY(h.rects),
			weight: 1,
		});
	}

	for (const t of asks) {
		// Dialogue intensity: at least 1; more turns → hotter at the same anchor.
		const turns = t.messages.filter((m) => m.role !== "system").length;
		points.push({
			kind: "ask",
			page: t.anchor.page,
			y: meanRectY(t.anchor.rects),
			weight: Math.max(1, turns),
		});
	}

	for (const tr of translates) {
		points.push({
			kind: "translate",
			page: tr.page,
			y: meanRectY(tr.rects),
			weight: 1,
		});
	}

	return {
		points,
		pageCount: meta?.pageCount,
	};
}

export async function loadReadingHeatmap(
	paperAbsPath: string,
): Promise<ReadingHeatmap> {
	const { points, pageCount } = await loadReadingActivityPoints(paperAbsPath);
	if (!points.length && !pageCount) return emptyHeatmap();
	return aggregateReadingHeatmap(points, { pageCount });
}

/**
 * Load heatmaps for many papers with bounded concurrency.
 * Keys are vault-relative paper paths (or id when path missing).
 */
export async function loadReadingHeatmaps(
	vaultPath: string,
	papers: ReadonlyArray<{ path?: string; id: string }>,
	opts?: { concurrency?: number },
): Promise<Map<string, ReadingHeatmap>> {
	const out = new Map<string, ReadingHeatmap>();
	if (!vaultPath || !papers.length) return out;

	const concurrency = Math.max(1, opts?.concurrency ?? 6);
	let i = 0;

	async function worker() {
		while (i < papers.length) {
			const idx = i++;
			const paper = papers[idx];
			const rel = paper.path?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
			const key = rel || paper.id;
			if (!rel) {
				out.set(key, emptyHeatmap());
				continue;
			}
			const abs = joinVaultPath(vaultPath, rel);
			try {
				out.set(key, await loadReadingHeatmap(abs));
			} catch {
				out.set(key, emptyHeatmap());
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(concurrency, papers.length) }, () =>
			worker(),
		),
	);
	return out;
}

export function heatmapCacheKey(paper: { path?: string; id: string }): string {
	const rel = paper.path?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	return rel || paper.id;
}
