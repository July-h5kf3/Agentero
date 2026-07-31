/**
 * Resolve a paper-local annotation / visual-trace id for wiki `[[target@id]]`
 * links and `![[…]]` embeds.
 *
 * Sources (MVP):
 * - highlights / text notes: `marks/annotations.json` (EmbedPDF transfer)
 * - visual agent-traces: `marks/<id>.json` with `kind: "agent-trace"`
 */

import { parsePdfVisualSessionTrace } from "@/lib/pdf/agent-trace/schema";
import type { PdfVisualTraceImage } from "@/lib/pdf/agent-trace/types";
import {
	highlightColorOf,
	highlightQuoteOf,
	isHighlightObject,
	loadAnnotationItems,
} from "@/lib/pdf/highlight/annotation-store";
import type { HighlightColor } from "@/lib/pdf/highlight/palette";
import { readMarkRaw } from "@/lib/pdf/selection/marks-io";
import { formatWikiLinkBody } from "@/lib/wiki/api";

export type AnnotationRefKind = "highlight" | "agent-trace";

export type AnnotationRef = {
	kind: AnnotationRefKind;
	id: string;
	/** Absolute paper directory when known. */
	paperAbsPath: string;
	/** 1-based page. */
	page: number;
	/** Highlighted quote (highlights) or empty. */
	quote: string;
	/** User comment / visual-trace comment. */
	comment: string;
	color?: HighlightColor;
	/** Optional crop preview for visual traces. */
	image?: PdfVisualTraceImage;
};

function transferItemId(item: unknown): string | null {
	if (!item || typeof item !== "object") return null;
	const annotation = (item as { annotation?: unknown }).annotation;
	if (annotation && typeof annotation === "object") {
		const id = (annotation as { id?: unknown }).id;
		if (typeof id === "string" && id) return id;
	}
	const id = (item as { id?: unknown }).id;
	return typeof id === "string" && id ? id : null;
}

/** Look up one id under a paper folder (highlight or visual-trace). */
export async function lookupAnnotationRef(
	paperAbsPath: string,
	id: string,
): Promise<AnnotationRef | null> {
	if (!paperAbsPath || !id) return null;

	const items = await loadAnnotationItems(paperAbsPath);
	for (const item of items) {
		const annotation = (item as { annotation?: unknown }).annotation;
		if (!annotation || typeof annotation !== "object") continue;
		const obj = annotation as {
			id?: string;
			pageIndex?: number;
			contents?: string;
		};
		if (obj.id !== id) continue;
		if (isHighlightObject(annotation as never)) {
			const hl = annotation as Parameters<typeof highlightQuoteOf>[0];
			const comment = obj.contents?.trim() ?? "";
			return {
				kind: "highlight",
				id,
				paperAbsPath,
				page: (obj.pageIndex ?? 0) + 1,
				quote: highlightQuoteOf(hl),
				comment,
				color: highlightColorOf(hl),
			};
		}
		// Non-highlight annotation objects still jump by id if present.
		return {
			kind: "highlight",
			id,
			paperAbsPath,
			page: (obj.pageIndex ?? 0) + 1,
			quote: "",
			comment: obj.contents?.trim() ?? "",
		};
	}

	const raw = await readMarkRaw(paperAbsPath, id);
	const trace = parsePdfVisualSessionTrace(raw);
	if (trace && trace.id === id) {
		return {
			kind: "agent-trace",
			id,
			paperAbsPath,
			page: trace.page,
			quote: "",
			comment: trace.comment,
			image: trace.image,
		};
	}

	// Id present in transfer under a different shape (id at top-level only).
	if (items.some((item) => transferItemId(item) === id)) {
		return {
			kind: "highlight",
			id,
			paperAbsPath,
			page: 1,
			quote: "",
			comment: "",
		};
	}

	return null;
}

/** Whether the paper marks store currently has this id. */
export async function annotationRefExists(
	paperAbsPath: string,
	id: string,
): Promise<boolean> {
	return (await lookupAnnotationRef(paperAbsPath, id)) !== null;
}

/**
 * Resolvable wiki target for a paper unit — never the display title alone.
 *
 * Prefer vault-relative `…/NOTES` (indexed Markdown). Fallbacks: paper folder
 * basename (stem match against NOTES/PDF) or a PDF path when known.
 */
export function wikiTargetForPaper(
	paperAbsPath: string,
	paperRelPath?: string | null,
): string {
	const rel = (paperRelPath ?? paperAbsPath)
		.replace(/\\/g, "/")
		.replace(/\/+$/, "");
	const parts = rel.split("/").filter(Boolean);
	const last = parts[parts.length - 1] ?? rel;
	if (last.toLowerCase() === "notes.md") {
		// papers/foo/NOTES.md → papers/foo/NOTES (extension optional for resolve)
		const without = rel.replace(/\/NOTES\.md$/i, "/NOTES");
		return without.replace(/^\//, "");
	}
	if (/\.pdf$/i.test(last)) {
		return rel.replace(/^\//, "");
	}
	// Paper folder vault-rel → NOTES target (most stable across renames of PDF name)
	if (parts[0]?.toLowerCase() === "papers" || rel.includes("/papers/")) {
		return `${rel.replace(/^\//, "")}/NOTES`;
	}
	return last.replace(/\.(md|mdx|markdown|pdf)$/i, "") || last;
}

/**
 * Prefer a target that wiki resolve can open; optional alias is display-only
 * (paper title). Same-note form is `[[@id]]` when `sameNote` is true.
 */
export function annotationWikilinkMarkdown(input: {
	target: string;
	id: string;
	embed?: boolean;
	alias?: string;
	/** When true, omit target → `[[@id]]` (current NOTES / paper). */
	sameNote?: boolean;
}): string {
	const body = formatWikiLinkBody(
		input.sameNote ? "" : input.target,
		{ kind: "annotation", id: input.id },
		input.alias,
	);
	return `${input.embed ? "!" : ""}[[${body}]]`;
}

/**
 * Derive paper absolute dir from a resolved vault-relative wiki target path
 * (NOTES.md, PDF, or paper folder path).
 */
export function paperAbsFromWikiTarget(
	vaultPath: string,
	targetPath: string,
): string {
	const root = vaultPath.replace(/[\\/]+$/, "");
	const rel = targetPath.replace(/\\/g, "/").replace(/^\/+/, "");
	const full = `${root}/${rel}`.replace(/\\/g, "/");
	if (/\/NOTES\.md$/i.test(full)) {
		return full.replace(/\/NOTES\.md$/i, "");
	}
	if (/\.pdf$/i.test(full)) {
		const idx = full.lastIndexOf("/");
		return idx >= 0 ? full.slice(0, idx) : full;
	}
	return full.replace(/\/+$/, "");
}
