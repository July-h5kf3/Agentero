/** Lightweight PDF selection-translate record for reading heatmap. */

export type PdfTranslateRect = {
	/** 0–1 relative to page box */
	x: number;
	y: number;
	w: number;
	h: number;
};

export type PdfTranslateRecord = {
	version: 1;
	id: string;
	/** Vault-relative paper folder when known; else absolute hint */
	paperPath: string;
	createdAt: string;
	/** 1-based page number */
	page: number;
	rects: PdfTranslateRect[];
	/** Source text that was translated */
	quote?: string;
};
