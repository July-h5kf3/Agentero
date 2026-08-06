/**
 * Wheel-zoom coalescing for the PDF viewer.
 *
 * Trackpad pinch / Ctrl+wheel delivers many small wheel events per second.
 * Applying a zoom step per event re-rasterizes every visible page (main-thread
 * PDFium) once per event. This coalescer accumulates deltas and applies all
 * resulting steps in one synchronous batch per animation frame, so React and
 * EmbedPDF only re-render once per frame regardless of event rate.
 */

/** One discrete zoom step per this much accumulated wheel deltaY. */
export const WHEEL_ZOOM_STEP_DELTA = 100;

export type WheelZoomCoalescerOptions = {
	/** Wheel delta that produces one zoom step. */
	threshold?: number;
	onZoomIn: () => void;
	onZoomOut: () => void;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (handle: number) => void;
};

export type WheelZoomCoalescer = {
	/** Accumulate one wheel `deltaY`; steps flush at most once per frame. */
	addDelta(delta: number): void;
	/** Drop pending accumulation (a new gesture starts). */
	reset(): void;
	dispose(): void;
};

export function createWheelZoomCoalescer({
	threshold = WHEEL_ZOOM_STEP_DELTA,
	onZoomIn,
	onZoomOut,
	requestFrame = (callback) => requestAnimationFrame(callback),
	cancelFrame = (handle) => cancelAnimationFrame(handle),
}: WheelZoomCoalescerOptions): WheelZoomCoalescer {
	let accumulated = 0;
	let pendingFrame: number | null = null;
	let disposed = false;

	const flush = () => {
		pendingFrame = null;
		if (disposed) return;
		while (Math.abs(accumulated) >= threshold) {
			if (accumulated > 0) {
				onZoomOut();
				accumulated -= threshold;
			} else {
				onZoomIn();
				accumulated += threshold;
			}
		}
	};

	return {
		addDelta(delta: number) {
			if (disposed) return;
			accumulated += delta;
			if (pendingFrame === null) {
				pendingFrame = requestFrame(flush);
			}
		},
		reset() {
			accumulated = 0;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			accumulated = 0;
			if (pendingFrame !== null) {
				cancelFrame(pendingFrame);
				pendingFrame = null;
			}
		},
	};
}
