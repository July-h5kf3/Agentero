import type { PdfLayoutKind } from "@/lib/pdf/layout/types";

/**
 * PP-DocLayoutV3 labels we map into our kinds.
 * Full map is in `@embedpdf/ai` LAYOUT_LABELS (abstract, text, header, …).
 */
const LABEL_TO_KIND: Record<string, PdfLayoutKind> = {
	image: "image",
	chart: "chart",
	table: "table",
	algorithm: "algorithm",
	formula: "formula",
	formula_number: "formula_number",
	figure_title: "figure_title",
	header: "header",
};

export function layoutLabelToKind(label: string): PdfLayoutKind | null {
	const key = label.trim().toLowerCase();
	return LABEL_TO_KIND[key] ?? null;
}

export function isTargetLayoutLabel(label: string): boolean {
	return layoutLabelToKind(label) !== null;
}

/** Sidebar “Figures” section: image + chart (same gallery group). */
export function isFigureLayoutKind(kind: PdfLayoutKind): boolean {
	return kind === "image" || kind === "chart";
}

/** Sidebar “Tables” section. */
export function isTableLayoutKind(kind: PdfLayoutKind): boolean {
	return kind === "table";
}

/** Sidebar “Algorithms” section. */
export function isAlgorithmLayoutKind(kind: PdfLayoutKind): boolean {
	return kind === "algorithm";
}

/** Sidebar “Formulas” section (numbered only after merge). */
export function isFormulaLayoutKind(kind: PdfLayoutKind): boolean {
	return kind === "formula";
}

/** Equation number boxes (e.g. "(1)") — merged into formula hosts, not listed alone. */
export function isFormulaNumberLayoutKind(kind: PdfLayoutKind): boolean {
	return kind === "formula_number";
}

/** Caption candidates merged into nearby figures/tables, not listed alone. */
export function isCaptionLayoutKind(kind: PdfLayoutKind): boolean {
	return kind === "figure_title" || kind === "header";
}

/**
 * Kinds shown in the Figures right-rail after merge.
 * image + chart share one section; table / algorithm / formula are separate.
 * Bare formula_number / captions are never sidebar kinds.
 */
export function isSidebarLayoutKind(
	kind: PdfLayoutKind,
): kind is "image" | "chart" | "table" | "algorithm" | "formula" {
	return (
		isFigureLayoutKind(kind) ||
		isTableLayoutKind(kind) ||
		isAlgorithmLayoutKind(kind) ||
		isFormulaLayoutKind(kind)
	);
}

/**
 * NMS group key: image and chart compete as one “figure” class so
 * overlapping image/chart boxes do not both appear.
 */
export function layoutDedupeGroup(kind: PdfLayoutKind): string {
	if (isFigureLayoutKind(kind)) return "figure";
	return kind;
}
