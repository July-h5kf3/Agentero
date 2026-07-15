import {
	clientRectsToNormalized,
	findPageElement,
	PDF_PAGE_ATTR,
	pageNumberOf,
} from "@/lib/pdf-ask/geometry";
import type { PdfAskNormalizedRect } from "@/lib/pdf-ask/types";

export type MarqueeCapture = {
	page: number;
	rects: PdfAskNormalizedRect[];
	/** Full data URL e.g. data:image/png;base64,... */
	dataUrl: string;
	mimeType: string;
};

function normalizeBox(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): { x: number; y: number; w: number; h: number } {
	const left = Math.min(x0, x1);
	const top = Math.min(y0, y1);
	const w = Math.abs(x1 - x0);
	const h = Math.abs(y1 - y0);
	return { x: left, y: top, w, h };
}

/** Client-space box → normalized page rects (single rect). */
export function clientBoxToNormalized(
	pageEl: HTMLElement,
	box: { x: number; y: number; w: number; h: number },
): PdfAskNormalizedRect[] {
	const fake = {
		left: box.x,
		top: box.y,
		width: box.w,
		height: box.h,
		right: box.x + box.w,
		bottom: box.y + box.h,
		x: box.x,
		y: box.y,
		toJSON: () => ({}),
	} as DOMRect;
	return clientRectsToNormalized(pageEl, [fake]);
}

/**
 * Capture a crop of the rendered PDF page canvas for a client-space rectangle.
 * Prefers the page's canvas; falls back to html2canvas-style draw from the page root.
 */
export function capturePageRegion(
	pageEl: HTMLElement,
	clientBox: { x: number; y: number; w: number; h: number },
): MarqueeCapture | null {
	if (clientBox.w < 8 || clientBox.h < 8) return null;

	const pageBox = pageEl.getBoundingClientRect();
	const canvas =
		pageEl.querySelector<HTMLCanvasElement>("canvas.react-pdf__Page__canvas") ??
		pageEl.querySelector<HTMLCanvasElement>("canvas");
	if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;

	const scaleX = canvas.width / (pageBox.width || 1);
	const scaleY = canvas.height / (pageBox.height || 1);

	const sx = Math.max(0, (clientBox.x - pageBox.left) * scaleX);
	const sy = Math.max(0, (clientBox.y - pageBox.top) * scaleY);
	const sw = Math.min(canvas.width - sx, clientBox.w * scaleX);
	const sh = Math.min(canvas.height - sy, clientBox.h * scaleY);
	if (sw < 2 || sh < 2) return null;

	const out = document.createElement("canvas");
	out.width = Math.max(1, Math.round(sw));
	out.height = Math.max(1, Math.round(sh));
	const ctx = out.getContext("2d");
	if (!ctx) return null;
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, out.width, out.height);
	try {
		ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
	} catch {
		return null;
	}

	const mimeType = "image/png";
	const dataUrl = out.toDataURL(mimeType);
	const rects = clientBoxToNormalized(pageEl, clientBox);
	return {
		page: pageNumberOf(pageEl),
		rects,
		dataUrl,
		mimeType,
	};
}

export function dataUrlToBase64(dataUrl: string): string {
	const i = dataUrl.indexOf(",");
	return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export function clientBoxFromPoints(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): { x: number; y: number; w: number; h: number } {
	return normalizeBox(x0, y0, x1, y1);
}

export function pageElFromPoint(
	clientX: number,
	clientY: number,
	host: HTMLElement,
): HTMLElement | null {
	const el = document.elementFromPoint(clientX, clientY);
	return findPageElement(el, host);
}

export function pageElByNumber(
	host: HTMLElement,
	page: number,
): HTMLElement | null {
	return host.querySelector(`[${PDF_PAGE_ATTR}="${page}"]`);
}

/** Re-capture using normalized rect on a page element. */
export function captureNormalizedRegion(
	pageEl: HTMLElement,
	rect: PdfAskNormalizedRect,
): MarqueeCapture | null {
	const box = pageEl.getBoundingClientRect();
	const clientBox = {
		x: box.left + rect.x * box.width,
		y: box.top + rect.y * box.height,
		w: rect.w * box.width,
		h: rect.h * box.height,
	};
	return capturePageRegion(pageEl, clientBox);
}
