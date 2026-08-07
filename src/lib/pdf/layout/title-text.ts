import type { PdfTextRun } from "@embedpdf/models";

import type { PdfAskNormalizedRect } from "@/lib/pdf/ask/types";
import {
	isCaptionLayoutKind,
	isFormulaLayoutKind,
	isFormulaNumberLayoutKind,
	isLayoutBodyTextKind,
} from "@/lib/pdf/layout/labels";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";

/** Semantic role of a caption box (from PDF text, not model label alone). */
export type CaptionRole =
	| "figure_main"
	| "table_main"
	| "algorithm_main"
	| "subpanel"
	| "other";

function runCenterInBbox(
	run: PdfTextRun,
	bbox: PdfAskNormalizedRect,
	pageWidth: number,
	pageHeight: number,
): boolean {
	if (pageWidth <= 0 || pageHeight <= 0) return false;
	const cx = (run.rect.origin.x + run.rect.size.width / 2) / pageWidth;
	const cy = (run.rect.origin.y + run.rect.size.height / 2) / pageHeight;
	return (
		cx >= bbox.x &&
		cx <= bbox.x + bbox.w &&
		cy >= bbox.y &&
		cy <= bbox.y + bbox.h
	);
}

/**
 * Collect PDF text runs whose centers fall inside a normalized caption box.
 */
export function textFromRunsInBbox(
	runs: PdfTextRun[],
	bbox: PdfAskNormalizedRect,
	pageWidth: number,
	pageHeight: number,
): string {
	const parts: string[] = [];
	for (const run of runs) {
		const t = run.text?.replace(/\s+/g, " ").trim();
		if (!t) continue;
		if (!runCenterInBbox(run, bbox, pageWidth, pageHeight)) continue;
		parts.push(t);
	}
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Classify caption text: main Figure/Table/Algorithm vs (a)(b) subpanel titles.
 */
export function captionRoleFromText(text: string): CaptionRole {
	const t = text.trim();
	if (!t) return "other";
	// (a) Concentration — panel subtitle, not the whole-figure caption.
	if (/^\(\s*[a-z]\s*\)/i.test(t)) return "subpanel";
	if (/^[a-z]\s*[).:]\s+\S/i.test(t) && t.length < 80) return "subpanel";
	if (/^table\s*\d/i.test(t) || /^tab\.\s*\d/i.test(t)) return "table_main";
	if (/^algorithm\s*\d/i.test(t) || /^alg\.\s*\d/i.test(t))
		return "algorithm_main";
	if (/^fig(?:ure)?\.?\s*\d/i.test(t)) return "figure_main";
	if (/^table\b/i.test(t)) return "table_main";
	if (/^algorithm\b/i.test(t)) return "algorithm_main";
	if (/^fig(?:ure)?\b/i.test(t)) return "figure_main";
	return "other";
}

/**
 * Geometry fallback when text is missing: short narrow boxes under panels
 * are subpanel titles; wide boxes are main captions.
 */
export function captionRoleFromGeometry(
	region: PdfLayoutRegion,
): CaptionRole | null {
	if (!isCaptionLayoutKind(region.kind)) return null;
	// Wide caption bar → likely main figure/table title.
	if (region.bbox.w >= 0.45 && region.bbox.h <= 0.2) {
		return region.kind === "figure_title" ? "figure_main" : "other";
	}
	// Narrow short box → (a)(b) style subpanel label.
	if (region.bbox.w <= 0.4 && region.bbox.h <= 0.1) {
		return "subpanel";
	}
	return null;
}

export function resolveCaptionRole(region: PdfLayoutRegion): CaptionRole {
	if (region.captionRole) return region.captionRole;
	const fromText = region.title ? captionRoleFromText(region.title) : "other";
	if (fromText !== "other") return fromText;
	return captionRoleFromGeometry(region) ?? "other";
}

/** Digit-bearing equation id body: 1, 12a, 1.2, A1, A.1 */
const FORMULA_NUM_ID = String.raw`[A-Za-z]?\d+(?:\.\d+)?[a-z]?|[A-Za-z]\.\d+[a-z]?`;

/**
 * Equation number labels: "(1)", "(12a)", "(A.1)", "[2]".
 * Rejects subpanel-style "(a)" (letter-only).
 */
export function extractFormulaNumberLabel(text: string): string | null {
	const t = text.replace(/\s+/g, " ").trim();
	if (!t || t.length > 24) return null;
	// Prefer parenthesized forms that contain a digit.
	const paren = t.match(new RegExp(String.raw`\(\s*(${FORMULA_NUM_ID})\s*\)`));
	if (paren?.[1]) return `(${paren[1]})`;
	const bracket = t.match(/\[\s*(\d+[a-z]?)\s*\]/);
	if (bracket?.[1]) return `(${bracket[1]})`;
	// Bare "1" / "1a" / "A.1" only when the whole string is just the number.
	const bare = t.match(new RegExp(String.raw`^(${FORMULA_NUM_ID})$`));
	if (bare?.[1] && /\d/.test(bare[1])) return `(${bare[1]})`;
	// "Eq. (3)" / "Equation 3"
	const eq = t.match(
		new RegExp(
			String.raw`^(?:eq(?:uation)?\.?\s*)\(?\s*(${FORMULA_NUM_ID})\s*\)?$`,
			"i",
		),
	);
	if (eq?.[1]) return `(${eq[1]})`;
	return null;
}

export function looksLikeFormulaNumber(text: string): boolean {
	return extractFormulaNumberLabel(text) !== null;
}

/**
 * Write extracted text + role onto caption-like regions (figure_title / header)
 * and formula_number boxes; body text/abstract into `text`. Also try to
 * recover equation ids on formula hosts from text inside / just to the right.
 */
export function enrichCaptionRegionsWithText(
	regions: PdfLayoutRegion[],
	pageIndex: number,
	runs: PdfTextRun[],
	pageSize: { width: number; height: number },
): PdfLayoutRegion[] {
	return regions.map((region) => {
		if (region.pageIndex !== pageIndex) return region;

		if (isCaptionLayoutKind(region.kind)) {
			const title = textFromRunsInBbox(
				runs,
				region.bbox,
				pageSize.width,
				pageSize.height,
			);
			const text = title || region.title || "";
			const role = text
				? captionRoleFromText(text)
				: (captionRoleFromGeometry(region) ?? "other");
			// Model often labels "Table N: …" as figure_title — keep kind for
			// geometry but role drives merge (table_main → attach to table).
			// Mirror extract into `text` so bulk translate can pick it up.
			return {
				...region,
				title: text || region.title,
				text: text || region.text,
				captionRole: role,
			};
		}

		if (isLayoutBodyTextKind(region.kind) && region.kind !== "header") {
			// text / abstract — full body extract for debug + bulk translate.
			const body = textFromRunsInBbox(
				runs,
				region.bbox,
				pageSize.width,
				pageSize.height,
			);
			if (!body) return region;
			return { ...region, text: body };
		}

		if (isFormulaNumberLayoutKind(region.kind)) {
			const raw = textFromRunsInBbox(
				runs,
				region.bbox,
				pageSize.width,
				pageSize.height,
			);
			const text = raw || region.title || "";
			const label = text ? extractFormulaNumberLabel(text) : null;
			return {
				...region,
				title: label || text || region.title,
			};
		}

		if (isFormulaLayoutKind(region.kind) && !region.title?.trim()) {
			// Number is often on the right margin of the formula line.
			const rightStrip: PdfAskNormalizedRect = {
				x: Math.min(0.95, region.bbox.x + region.bbox.w * 0.65),
				y: Math.max(0, region.bbox.y - 0.01),
				w: Math.max(
					0.02,
					Math.min(0.2, 1 - (region.bbox.x + region.bbox.w * 0.65)),
				),
				h: region.bbox.h + 0.02,
			};
			const fromRight = textFromRunsInBbox(
				runs,
				rightStrip,
				pageSize.width,
				pageSize.height,
			);
			const fromBody = textFromRunsInBbox(
				runs,
				region.bbox,
				pageSize.width,
				pageSize.height,
			);
			const label =
				extractFormulaNumberLabel(fromRight) ||
				extractFormulaNumberLabel(fromBody);
			if (label) return { ...region, title: label };
		}

		return region;
	});
}

/**
 * Attach caption strings onto host regions that already have `titleBbox`.
 */
export function attachTitlesFromTextRuns(
	regions: PdfLayoutRegion[],
	pageIndex: number,
	runs: PdfTextRun[],
	pageSize: { width: number; height: number },
): PdfLayoutRegion[] {
	return regions.map((region) => {
		if (region.pageIndex !== pageIndex || !region.titleBbox) return region;
		const title = textFromRunsInBbox(
			runs,
			region.titleBbox,
			pageSize.width,
			pageSize.height,
		);
		if (!title) return region;
		return { ...region, title };
	});
}

/** @deprecated use captionRoleFromText */
export function looksLikeFigureCaption(text: string): boolean {
	const role = captionRoleFromText(text);
	return (
		role === "figure_main" || role === "table_main" || role === "algorithm_main"
	);
}
