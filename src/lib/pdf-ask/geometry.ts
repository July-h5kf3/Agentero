import type {
	PdfAskAnchor,
	PdfAskNormalizedRect,
	PdfAskTrigger,
} from "@/lib/pdf-ask/types";

export const PDF_PAGE_ATTR = "data-motif-pdf-page";

export function findPageElement(
	node: Node | null,
	host: HTMLElement | null,
): HTMLElement | null {
	let el: Node | null = node;
	while (el && el !== host) {
		if (el instanceof HTMLElement && el.hasAttribute(PDF_PAGE_ATTR)) {
			return el;
		}
		el = el.parentNode;
	}
	return null;
}

export function pageNumberOf(pageEl: HTMLElement): number {
	const n = Number(pageEl.getAttribute(PDF_PAGE_ATTR));
	return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.min(1, Math.max(0, n));
}

/** Map absolute client rects into 0–1 coords relative to a page element. */
export function clientRectsToNormalized(
	pageEl: HTMLElement,
	clientRects: DOMRectList | DOMRect[],
): PdfAskNormalizedRect[] {
	const pageBox = pageEl.getBoundingClientRect();
	const pw = pageBox.width || 1;
	const ph = pageBox.height || 1;
	const out: PdfAskNormalizedRect[] = [];
	const list = Array.from(clientRects);
	for (const r of list) {
		if (r.width <= 0 && r.height <= 0) continue;
		out.push({
			x: clamp01((r.left - pageBox.left) / pw),
			y: clamp01((r.top - pageBox.top) / ph),
			w: clamp01(r.width / pw),
			h: clamp01(r.height / ph),
		});
	}
	return out;
}

/** Build anchor from a live Selection inside the PDF host. */
export function anchorFromSelection(
	selection: Selection,
	host: HTMLElement,
	trigger: PdfAskTrigger,
): PdfAskAnchor | null {
	if (selection.rangeCount === 0 || selection.isCollapsed) return null;
	const range = selection.getRangeAt(0);
	const text = selection.toString().replace(/\s+/g, " ").trim();
	if (!text) return null;

	const pageEl =
		findPageElement(range.commonAncestorContainer, host) ??
		findPageElement(range.startContainer, host);
	if (!pageEl || !host.contains(pageEl)) return null;

	const rects = clientRectsToNormalized(pageEl, range.getClientRects());
	if (!rects.length) {
		const br = range.getBoundingClientRect();
		const fallback = clientRectsToNormalized(pageEl, [br]);
		if (!fallback.length) return null;
		return {
			page: pageNumberOf(pageEl),
			rects: fallback,
			quote: text,
			trigger,
		};
	}

	return {
		page: pageNumberOf(pageEl),
		rects,
		quote: text,
		trigger,
	};
}

/** Anchor from a point inside a page (dwell / empty double-click). */
export function anchorFromPoint(
	clientX: number,
	clientY: number,
	host: HTMLElement,
	trigger: PdfAskTrigger,
	quote?: string,
): PdfAskAnchor | null {
	const target = document.elementFromPoint(clientX, clientY);
	const pageEl = findPageElement(target, host);
	if (!pageEl) return null;
	const pageBox = pageEl.getBoundingClientRect();
	const pw = pageBox.width || 1;
	const ph = pageBox.height || 1;
	const size = 0.02;
	const x = clamp01((clientX - pageBox.left) / pw - size / 2);
	const y = clamp01((clientY - pageBox.top) / ph - size / 2);
	return {
		page: pageNumberOf(pageEl),
		rects: [{ x, y, w: size, h: size }],
		quote: quote?.trim() || undefined,
		trigger,
	};
}

export function popoverScreenPoint(
	pageEl: HTMLElement | null,
	rects: PdfAskNormalizedRect[],
): { x: number; y: number } | null {
	if (!pageEl || !rects.length) return null;
	const box = pageEl.getBoundingClientRect();
	const r = rects[0];
	return {
		x: box.left + (r.x + r.w) * box.width,
		y: box.top + r.y * box.height,
	};
}

export function findPageElByNumber(
	host: HTMLElement,
	page: number,
): HTMLElement | null {
	return host.querySelector(`[${PDF_PAGE_ATTR}="${page}"]`);
}
