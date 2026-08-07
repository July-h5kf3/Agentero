import { LAYOUT_SIDEBAR_MIN_SCORE } from "@/lib/pdf/layout/constants";
import { dedupeLayoutRegions } from "@/lib/pdf/layout/dedupe";
import { isSidebarLayoutKind } from "@/lib/pdf/layout/labels";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";

export function bboxArea(bbox: PdfLayoutRegion["bbox"]): number {
	return Math.max(0, bbox.w) * Math.max(0, bbox.h);
}

/**
 * Same region set as the figures rail: sidebar kinds, min-score + NMS dedupe.
 */
export function hoverableLayoutRegions(
	regions: readonly PdfLayoutRegion[],
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): PdfLayoutRegion[] {
	const sidebarOnly = regions.filter((r) => isSidebarLayoutKind(r.kind));
	return dedupeLayoutRegions(sidebarOnly, { minScore });
}

/** Regions for one page, largest first (paint order: smaller boxes later so they win hits). */
export function hoverableLayoutRegionsOnPage(
	regions: readonly PdfLayoutRegion[],
	pageIndex: number,
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): PdfLayoutRegion[] {
	return hoverableLayoutRegions(regions, minScore)
		.filter((r) => r.pageIndex === pageIndex)
		.sort((a, b) => bboxArea(b.bbox) - bboxArea(a.bbox));
}

/**
 * Debug overlay: pre-merge detections on a page (all kinds, no NMS).
 * Drops boxes below minScore (default 0.3). Largest first so smaller paint on top.
 */
export function rawLayoutRegionsOnPage(
	regions: readonly PdfLayoutRegion[],
	pageIndex: number,
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): PdfLayoutRegion[] {
	return regions
		.filter(
			(r) =>
				r.pageIndex === pageIndex &&
				r.bbox.w > 0 &&
				r.bbox.h > 0 &&
				r.score >= minScore,
		)
		.sort((a, b) => bboxArea(b.bbox) - bboxArea(a.bbox));
}

export function pointInBbox(
	x: number,
	y: number,
	bbox: PdfLayoutRegion["bbox"],
): boolean {
	return (
		x >= bbox.x && y >= bbox.y && x <= bbox.x + bbox.w && y <= bbox.y + bbox.h
	);
}

/**
 * Pick the best region under a normalized page point.
 * Prefers the smallest-area hit (most specific); ties break by higher score.
 */
export function pickLayoutRegionAtPoint(
	regions: readonly PdfLayoutRegion[],
	pageIndex: number,
	x: number,
	y: number,
	minScore: number = LAYOUT_SIDEBAR_MIN_SCORE,
): PdfLayoutRegion | null {
	const hits = hoverableLayoutRegions(regions, minScore).filter(
		(r) => r.pageIndex === pageIndex && pointInBbox(x, y, r.bbox),
	);
	if (hits.length === 0) return null;
	hits.sort((a, b) => {
		const areaDiff = bboxArea(a.bbox) - bboxArea(b.bbox);
		if (Math.abs(areaDiff) > 1e-12) return areaDiff;
		return b.score - a.score;
	});
	return hits[0] ?? null;
}
