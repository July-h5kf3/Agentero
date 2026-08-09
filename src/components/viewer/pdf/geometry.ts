import type { Rect } from "@embedpdf/models";

/** Marks a rendered page wrapper so overlays/menus can map page↔screen coords. */
export const EMBED_PAGE_ATTR = "data-embed-pdf-page";

export function pageElByIndex(
	host: HTMLElement | null,
	pageIndex: number,
): HTMLElement | null {
	if (!host) return null;
	return host.querySelector<HTMLElement>(`[${EMBED_PAGE_ATTR}="${pageIndex}"]`);
}

/**
 * Map a page-coordinate rect (PDF points) to a screen point. The rendered page
 * element is `points * zoom` CSS px, so a point offset maps to `offset * zoom`
 * px within the element's client box.
 */
export function rectTopCenterScreen(
	pageEl: HTMLElement,
	rect: Rect,
	zoom: number,
): { x: number; y: number } {
	const box = pageEl.getBoundingClientRect();
	return {
		x: box.left + (rect.origin.x + rect.size.width / 2) * zoom,
		y: box.top + rect.origin.y * zoom,
	};
}

export function rectRightScreen(
	pageEl: HTMLElement,
	rect: Rect,
	zoom: number,
): { x: number; y: number } {
	const box = pageEl.getBoundingClientRect();
	return {
		x: box.left + (rect.origin.x + rect.size.width) * zoom + 8,
		y: box.top + rect.origin.y * zoom,
	};
}
