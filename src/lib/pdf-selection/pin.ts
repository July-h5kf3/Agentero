/** Shared pin geometry for ask / annotate / translate anchors. */

export type NormalizedRect = {
	x: number;
	y: number;
	w: number;
	h: number;
};

/** Pin near the end of the selection (right-center of union rects). */
export function pinFromRects(rects: NormalizedRect[]): {
	x: number;
	y: number;
} {
	if (!rects.length) return { x: 0.5, y: 0.12 };
	let minY = 1;
	let maxX = 0;
	let maxY = 0;
	for (const r of rects) {
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.w);
		maxY = Math.max(maxY, r.y + r.h);
	}
	const x = Math.min(0.98, Math.max(0.02, maxX + 0.008));
	const y = Math.min(0.98, Math.max(0.02, (minY + maxY) / 2));
	return { x, y };
}
