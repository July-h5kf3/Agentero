import {
	aggregateReadingHeatmap,
	emptyHeatmap,
	meanRectY,
} from "@/lib/paper/reading-heatmap/aggregate";
import type {
	ReadingActivityPoint,
	ReadingHeatmap,
} from "@/lib/paper/reading-heatmap/types";
import { listPdfAskThreads } from "@/lib/pdf/ask/io";
import { listPdfHighlights } from "@/lib/pdf/highlight/io";
import { getPdfPageCount } from "@/lib/pdf/page-count";
import { listPdfTranslates } from "@/lib/pdf/translate/io";
import { joinVaultPath } from "@/lib/vault";

/** Collect activity points for one paper folder (absolute path). */
export async function loadReadingActivityPoints(
	paperAbsPath: string,
	cachedPageCount?: number,
): Promise<{ points: ReadingActivityPoint[]; pageCount?: number }> {
	if (!paperAbsPath) return { points: [] };

	const [highlights, asks, translates, pageCount] = await Promise.all([
		listPdfHighlights(paperAbsPath).catch(() => []),
		listPdfAskThreads(paperAbsPath).catch(() => []),
		listPdfTranslates(paperAbsPath).catch(() => []),
		// Opening the whole PDF just to count pages is the expensive part —
		// a persisted count (catalog `pdf_page_counts`) skips it entirely.
		cachedPageCount != null && cachedPageCount > 0
			? Promise.resolve(cachedPageCount)
			: getPdfPageCount(paperAbsPath),
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
		pageCount: pageCount ?? undefined,
	};
}

export async function loadReadingHeatmap(
	paperAbsPath: string,
	cachedPageCount?: number,
): Promise<{ heatmap: ReadingHeatmap; discoveredPageCount?: number }> {
	const { points, pageCount } = await loadReadingActivityPoints(
		paperAbsPath,
		cachedPageCount,
	);
	const heatmap =
		!points.length && !pageCount
			? emptyHeatmap()
			: aggregateReadingHeatmap(points, { pageCount });
	// Only report counts freshly read from the PDF (not cache echoes).
	const discoveredPageCount =
		cachedPageCount == null && pageCount != null ? pageCount : undefined;
	return { heatmap, discoveredPageCount };
}

export type ReadingHeatmapBatch = {
	heatmaps: Map<string, ReadingHeatmap>;
	/** Page counts freshly read from PDFs — persist to the catalog cache. */
	discoveredPageCounts: Map<string, number>;
};

/**
 * Load heatmaps for many papers with bounded concurrency.
 * Keys are vault-relative paper paths (or id when path missing).
 * `opts.pageCounts` (same keys) skips the per-paper full-PDF page read.
 */
export async function loadReadingHeatmaps(
	vaultPath: string,
	papers: ReadonlyArray<{ path?: string; id: string }>,
	opts?: {
		concurrency?: number;
		pageCounts?: ReadonlyMap<string, number>;
	},
): Promise<ReadingHeatmapBatch> {
	const out = new Map<string, ReadingHeatmap>();
	const discovered = new Map<string, number>();
	if (!vaultPath || !papers.length)
		return { heatmaps: out, discoveredPageCounts: discovered };

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
				const { heatmap, discoveredPageCount } = await loadReadingHeatmap(
					abs,
					opts?.pageCounts?.get(key),
				);
				out.set(key, heatmap);
				if (discoveredPageCount != null) {
					discovered.set(key, discoveredPageCount);
				}
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
	return { heatmaps: out, discoveredPageCounts: discovered };
}

export function heatmapCacheKey(paper: { path?: string; id: string }): string {
	const rel = paper.path?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	return rel || paper.id;
}
