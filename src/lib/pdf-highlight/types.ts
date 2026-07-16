/** PDF highlight annotation model. See docs/development/pdf-ask.md */

export type PdfHighlightRect = {
	/** 0–1 relative to page box */
	x: number;
	y: number;
	w: number;
	h: number;
};

export type PdfHighlight = {
	version: 1;
	id: string;
	/** Vault-relative paper folder when known; else absolute hint */
	paperPath: string;
	createdAt: string;
	updatedAt: string;
	/** 1-based page number */
	page: number;
	/** Normalized rects covering the highlighted text */
	rects: PdfHighlightRect[];
	/** Highlighted source text */
	quote: string;
	/** Reserved for future color palette; defaults to amber when absent */
	color?: string;
};
