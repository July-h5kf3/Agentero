import type {
	PdfAskAnchor,
	PdfAskNormalizedRect,
	PdfAskTrigger,
} from "@/lib/pdf/ask/types";

export const PDF_PAGE_ATTR = "data-agentero-pdf-page";

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

/** Map a client point to the page under it, returning normalized coords. */
export function clientPointInPage(
	clientX: number,
	clientY: number,
	host: HTMLElement,
): { page: number; x: number; y: number } | null {
	const target = document.elementFromPoint(clientX, clientY);
	const pageEl = findPageElement(target, host);
	if (!pageEl || !host.contains(pageEl)) return null;
	const box = pageEl.getBoundingClientRect();
	const pw = box.width || 1;
	const ph = box.height || 1;
	return {
		page: pageNumberOf(pageEl),
		x: clamp01((clientX - box.left) / pw),
		y: clamp01((clientY - box.top) / ph),
	};
}

export type PopoverScreenPoint = {
	x: number;
	y: number;
	/**
	 * Open the card on this side of the anchor. Matches the gutter pin so a
	 * left-side pin does not open a dialog on the far right of the selection.
	 */
	preferRight: boolean;
};

/**
 * Screen point next to the gutter pin for dialog placement.
 * Prefer the same side as the pin (right pin → open right; left → open left)
 * so the card sits close to the pin rather than the opposite edge of the rects.
 */
export function popoverScreenPoint(
	pageEl: HTMLElement | null,
	rects: PdfAskNormalizedRect[],
	pin?: { x: number; y: number; side?: "left" | "right" } | null,
): PopoverScreenPoint | null {
	if (!pageEl) return null;
	const box = pageEl.getBoundingClientRect();
	if (pin) {
		const preferRight = pin.side !== "left";
		// Small outward nudge so the card edge clears the pin pill.
		const nudge = preferRight ? 4 : -4;
		return {
			x: box.left + pin.x * box.width + nudge,
			y: box.top + pin.y * box.height - 8,
			preferRight,
		};
	}
	if (!rects.length) return null;
	let maxX = 0;
	let minY = 1;
	let maxY = 0;
	for (const r of rects) {
		maxX = Math.max(maxX, r.x + r.w);
		minY = Math.min(minY, r.y);
		maxY = Math.max(maxY, r.y + r.h);
	}
	return {
		x: box.left + Math.min(0.98, maxX + 0.008) * box.width + 4,
		y: box.top + ((minY + maxY) / 2) * box.height - 8,
		preferRight: true,
	};
}

export function findPageElByNumber(
	host: HTMLElement,
	page: number,
): HTMLElement | null {
	return host.querySelector(`[${PDF_PAGE_ATTR}="${page}"]`);
}
