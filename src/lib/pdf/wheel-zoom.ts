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
const WHEEL_ZOOM_STEP_DELTA = 100;

type WheelZoomCoalescerOptions = {
	/** Wheel delta that produces one zoom step. */
	threshold?: number;
	onZoomIn: () => void;
	onZoomOut: () => void;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (handle: number) => void;
};

type WheelZoomCoalescer = {
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

/** Wheel stream must be silent this long before a scroll gesture is over. */
const WHEEL_SCROLL_IDLE_MS = 200;

type WheelZoomGestureOptions = {
	target: Pick<HTMLElement, "addEventListener" | "removeEventListener">;
	/** Ctrl/Cmd+wheel or trackpad pinch tick, already default-prevented when possible. */
	onZoomWheel: (event: WheelEvent) => void;
	/** Wheel-idle delay before plain scrolling is assumed finished. */
	scrollIdleMs?: number;
};

/**
 * Bind wheel-zoom without keeping the container permanently non-passive.
 *
 * A non-passive wheel listener forces every tick through the main thread before
 * the container may scroll, which shows up as scroll jank whenever the viewer is
 * busy. Zoom still needs `preventDefault` (platform pinch zoom would otherwise
 * scale the whole app), so the non-passive listener stays attached until a plain
 * scroll gesture starts and comes back once the wheel stream goes idle. A pinch
 * that begins mid-scroll still zooms; only that first tick keeps its default.
 */
export function bindWheelZoomGesture({
	target,
	onZoomWheel,
	scrollIdleMs = WHEEL_SCROLL_IDLE_MS,
}: WheelZoomGestureOptions): { dispose(): void } {
	let passive = false;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	const clearIdleTimer = () => {
		if (idleTimer === null) return;
		clearTimeout(idleTimer);
		idleTimer = null;
	};

	const setPassive = (next: boolean) => {
		if (passive === next) return;
		target.removeEventListener(
			"wheel",
			passive ? passiveListener : activeListener,
		);
		passive = next;
		target.addEventListener("wheel", next ? passiveListener : activeListener, {
			passive: next,
		});
	};

	const handleWheel = (event: WheelEvent, canPreventDefault: boolean) => {
		if (disposed) return;
		if (event.ctrlKey || event.metaKey) {
			if (canPreventDefault && event.cancelable) event.preventDefault();
			clearIdleTimer();
			setPassive(false);
			onZoomWheel(event);
			return;
		}
		setPassive(true);
		clearIdleTimer();
		idleTimer = setTimeout(() => {
			idleTimer = null;
			setPassive(false);
		}, scrollIdleMs);
	};

	function activeListener(event: WheelEvent) {
		handleWheel(event, true);
	}
	function passiveListener(event: WheelEvent) {
		handleWheel(event, false);
	}

	target.addEventListener("wheel", activeListener, { passive: false });

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			clearIdleTimer();
			target.removeEventListener(
				"wheel",
				passive ? passiveListener : activeListener,
			);
		},
	};
}
