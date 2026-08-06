import type { PdfAskNormalizedRect } from "@/lib/pdf/ask/types";

/**
 * Layout kinds we may store from PP-DocLayoutV3.
 * Sidebar surfaces image/chart/table/algorithm/formula (numbered only);
 * figure_title/header/formula_number are intermediate and merged away.
 */
export type PdfLayoutKind =
	| "image"
	| "table"
	| "algorithm"
	| "formula"
	| "formula_number"
	| "chart"
	| "figure_title"
	| "header"
	/** Paragraph / body text — blocker for formula merge, never sidebar. */
	| "text";

/**
 * One detected region after layout analysis.
 * `rect` is in PDF page points; `bbox` is normalized 0–1 (same convention as
 * selection / visual annotations).
 * `score` is model confidence 0–1 (UI may show as percent).
 * After caption merge, figure regions may include `title` from nearby
 * figure_title / caption-like header + PDF text runs.
 * Numbered formulas store the equation id (e.g. "(3)") in `title`.
 */
export type PdfLayoutRegion = {
	id: string;
	/** 0-based page index (EmbedPDF). */
	pageIndex: number;
	kind: PdfLayoutKind;
	/** Raw model label (e.g. `image`, `table`, `algorithm`). */
	label: string;
	/** Model confidence in [0, 1]. */
	score: number;
	readingOrder: number;
	/** PDF page coordinates in points. */
	rect: { x: number; y: number; w: number; h: number };
	/** Normalized 0–1 relative to page size. */
	bbox: PdfAskNormalizedRect;
	/**
	 * Caption / figure title text (from PDF text layer over the caption box).
	 * For formulas: equation number label such as "(1)" or "(A.2)".
	 * Set after merge + text enrichment.
	 */
	title?: string;
	/** Normalized caption box (before union into bbox), if a title was attached. */
	titleBbox?: PdfAskNormalizedRect;
	/**
	 * Semantic role of a caption box (from text / geometry).
	 * Used so "Table 2: …" mislabeled as figure_title still binds to tables,
	 * and "(a) …" subpanel titles are not used as whole-figure anchors.
	 */
	captionRole?:
		| "figure_main"
		| "table_main"
		| "algorithm_main"
		| "subpanel"
		| "other";
};

export type PdfLayoutDocumentResult = {
	documentId: string;
	/** Wall time of last successful analysis. */
	updatedAt: number;
	regions: PdfLayoutRegion[];
	/** Per-kind counts for quick UI summary (post caption-merge). */
	counts: Record<PdfLayoutKind, number>;
};

export type LayoutAnalysisUiStatus =
	| { stage: "idle" }
	| { stage: "running"; message: string }
	| { stage: "done"; message: string; total: number }
	| { stage: "error"; message: string }
	| { stage: "cancelled" };
