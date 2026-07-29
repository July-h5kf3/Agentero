/**
 * Per-page overlay for PDF Link annotations (in-text citations, figure/section
 * refs, external URLs). PDFium already parses each link's rect + target; this
 * layer makes them clickable and publishes hover anchor text for the
 * References sidebar. See docs/backend/citation-parsing.md (M3).
 */

import type {
	PdfAnnotationObject,
	PdfDocumentObject,
	PdfGlyphObject,
	PdfLinkAnnoObject,
} from "@embedpdf/models";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { useCallback, useRef } from "react";
import { usePdfEngineContext } from "@/components/viewer/embed/engine-provider";

export function isLinkObject(
	object: PdfAnnotationObject,
): object is PdfLinkAnnoObject {
	return object.type === PdfAnnotationSubtype.LINK;
}

/**
 * Text under a link rect, via one glyph hit-test per page (cached).
 * Best effort: returns null when the engine/document is unavailable.
 */
export function useLinkTextResolver(
	docId: string,
): (link: PdfLinkAnnoObject) => Promise<string | null> {
	const { engine } = usePdfEngineContext();
	const { provides: docCap } = useDocumentManagerCapability();
	const glyphCacheRef = useRef(new Map<number, Promise<PdfGlyphObject[]>>());
	const textCacheRef = useRef(new Map<string, string | null>());

	return useCallback(
		async (link) => {
			const cached = textCacheRef.current.get(link.id);
			if (cached !== undefined) return cached;
			const doc: PdfDocumentObject | undefined | null =
				docCap?.getDocument(docId);
			const page = doc?.pages[link.pageIndex];
			if (!engine || !doc || !page) return null;
			try {
				let glyphsPromise = glyphCacheRef.current.get(link.pageIndex);
				if (!glyphsPromise) {
					glyphsPromise = engine.getPageGlyphs(doc, page).toPromise();
					glyphCacheRef.current.set(link.pageIndex, glyphsPromise);
				}
				const glyphs = await glyphsPromise;
				const pad = 1;
				const x0 = link.rect.origin.x - pad;
				const y0 = link.rect.origin.y - pad;
				const x1 = link.rect.origin.x + link.rect.size.width + pad;
				const y1 = link.rect.origin.y + link.rect.size.height + pad;
				let start = -1;
				let end = -1;
				for (let i = 0; i < glyphs.length; i++) {
					const g = glyphs[i];
					const cx = g.origin.x + g.size.width / 2;
					const cy = g.origin.y + g.size.height / 2;
					if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
						if (start < 0) start = i;
						end = i;
					}
				}
				if (start < 0) {
					textCacheRef.current.set(link.id, null);
					return null;
				}
				const slices = await engine
					.getTextSlices(doc, [
						{
							pageIndex: link.pageIndex,
							charIndex: start,
							charCount: end - start + 1,
						},
					])
					.toPromise();
				const text = slices[0]?.trim() || null;
				textCacheRef.current.set(link.id, text);
				return text;
			} catch {
				return null;
			}
		},
		[engine, docCap, docId],
	);
}

/**
 * Transparent hit targets over each link rect. Positioned in page-percentage
 * units so they track zoom for free.
 */
export function CitationLinkLayer({
	links,
	pageWidthPt,
	pageHeightPt,
	label,
	onActivate,
	onHover,
}: {
	links: PdfLinkAnnoObject[];
	/** Page size in PDF points (CSS px ÷ zoom). */
	pageWidthPt: number;
	pageHeightPt: number;
	/** Accessible name for link hit targets. */
	label: string;
	onActivate: (link: PdfLinkAnnoObject) => void;
	onHover: (link: PdfLinkAnnoObject | null) => void;
}) {
	if (!links.length || pageWidthPt <= 0 || pageHeightPt <= 0) return null;
	return (
		<>
			{links.map((link) => (
				<button
					key={link.id}
					type="button"
					tabIndex={-1}
					aria-label={label}
					className="absolute z-[2] cursor-pointer rounded-[2px] border-0 bg-transparent p-0 hover:bg-primary/10"
					style={{
						left: `${(link.rect.origin.x / pageWidthPt) * 100}%`,
						top: `${(link.rect.origin.y / pageHeightPt) * 100}%`,
						width: `${(link.rect.size.width / pageWidthPt) * 100}%`,
						height: `${(link.rect.size.height / pageHeightPt) * 100}%`,
					}}
					onClick={(e) => {
						e.stopPropagation();
						onActivate(link);
					}}
					onMouseEnter={() => onHover(link)}
					onMouseLeave={() => onHover(null)}
				/>
			))}
		</>
	);
}
