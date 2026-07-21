import type {
	PdfAnnotationObject,
	PdfHighlightAnnoObject,
} from "@embedpdf/models";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import type { AnnotationTransferItem } from "@embedpdf/plugin-annotation/react";

import {
	type HighlightColor,
	highlightColorFromHex,
} from "@/lib/pdf-highlight/palette";
import type { PdfHighlight } from "@/lib/pdf-highlight/types";
import { isTauri } from "@/lib/tauri";
import { joinVaultPath, readVaultFile, writeVaultFile } from "@/lib/vault";

/**
 * Highlights/批注 are stored as EmbedPDF annotations (source of truth) in one
 * `papers/<id>/annotations.json` per paper — the `exportAnnotations()` /
 * `importAnnotations()` transfer format. Ask/Translate stay in `marks/*.json`.
 */
export const ANNOTATIONS_FILE = "annotations.json";

/** In-memory fallback when not running under Tauri (browser dev). */
const memoryStore = new Map<string, AnnotationTransferItem[]>();

function annotationsPath(paperAbsPath: string): string {
	return joinVaultPath(paperAbsPath, ANNOTATIONS_FILE);
}

export async function loadAnnotationItems(
	paperAbsPath: string,
): Promise<AnnotationTransferItem[]> {
	if (!paperAbsPath) return [];
	if (!isTauri()) return memoryStore.get(paperAbsPath) ?? [];
	try {
		const raw = await readVaultFile(annotationsPath(paperAbsPath));
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed) ? (parsed as AnnotationTransferItem[]) : [];
	} catch {
		return [];
	}
}

export async function saveAnnotationItems(
	paperAbsPath: string,
	items: AnnotationTransferItem[],
): Promise<void> {
	if (!paperAbsPath) return;
	if (!isTauri()) {
		memoryStore.set(paperAbsPath, items);
		return;
	}
	await writeVaultFile(
		annotationsPath(paperAbsPath),
		`${JSON.stringify(items, null, 2)}\n`,
	);
}

export async function hasAnnotationsFile(
	paperAbsPath: string,
): Promise<boolean> {
	if (!paperAbsPath) return false;
	if (!isTauri()) return memoryStore.has(paperAbsPath);
	try {
		await readVaultFile(annotationsPath(paperAbsPath));
		return true;
	} catch {
		return false;
	}
}

export function isHighlightObject(
	obj: PdfAnnotationObject,
): obj is PdfHighlightAnnoObject {
	return obj.type === PdfAnnotationSubtype.HIGHLIGHT;
}

/** App-specific metadata round-tripped through the annotation `custom` field. */
export type HighlightCustom = {
	app?: string;
	paletteKey?: HighlightColor;
	quote?: string;
};

export function highlightColorOf(obj: PdfHighlightAnnoObject): HighlightColor {
	const custom = (obj.custom ?? {}) as HighlightCustom;
	if (custom.paletteKey) return custom.paletteKey;
	return highlightColorFromHex(obj.strokeColor ?? obj.color);
}

export function highlightQuoteOf(obj: PdfHighlightAnnoObject): string {
	const custom = (obj.custom ?? {}) as HighlightCustom;
	return custom.quote?.trim() ?? "";
}

/** Build the PdfHighlight view model that the annotations panel + handle use. */
export function highlightViewFromObject(
	obj: PdfHighlightAnnoObject,
	paperPath: string,
): PdfHighlight {
	const iso = (d?: Date) =>
		d instanceof Date ? d.toISOString() : new Date().toISOString();
	const comment = obj.contents?.trim();
	const view: PdfHighlight = {
		version: 1,
		kind: "highlight",
		id: obj.id,
		paperPath,
		createdAt: iso(obj.created),
		updatedAt: iso(obj.modified ?? obj.created),
		page: obj.pageIndex + 1,
		rects: [],
		quote: highlightQuoteOf(obj),
		color: highlightColorOf(obj),
	};
	if (comment) view.comment = comment;
	return view;
}
