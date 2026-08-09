import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bindWheelZoomGesture,
	createWheelZoomCoalescer,
} from "@/lib/pdf/wheel-zoom";

function frameHarness() {
	let callback: FrameRequestCallback | null = null;
	return {
		requestFrame: vi.fn((next: FrameRequestCallback) => {
			callback = next;
			return 7;
		}),
		cancelFrame: vi.fn(() => {
			callback = null;
		}),
		flush: () => {
			const next = callback;
			callback = null;
			next?.(0);
		},
		hasPending: () => callback !== null,
	};
}

describe("PDF wheel zoom coalescer", () => {
	it("coalesces deltas from multiple wheel events into one frame flush", () => {
		const frames = frameHarness();
		const onZoomIn = vi.fn();
		const onZoomOut = vi.fn();
		const coalescer = createWheelZoomCoalescer({
			onZoomIn,
			onZoomOut,
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame,
		});

		coalescer.addDelta(-60);
		coalescer.addDelta(-60);
		coalescer.addDelta(-60);
		expect(frames.requestFrame).toHaveBeenCalledTimes(1);
		expect(onZoomIn).not.toHaveBeenCalled();

		frames.flush();
		// -180 accumulated → one zoom-in step, -80 remainder kept.
		expect(onZoomIn).toHaveBeenCalledTimes(1);
		expect(onZoomOut).not.toHaveBeenCalled();
	});

	it("applies multiple steps in one batch and keeps the remainder", () => {
		const frames = frameHarness();
		const onZoomIn = vi.fn();
		const onZoomOut = vi.fn();
		const coalescer = createWheelZoomCoalescer({
			onZoomIn,
			onZoomOut,
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame,
		});

		coalescer.addDelta(350);
		frames.flush();
		expect(onZoomOut).toHaveBeenCalledTimes(3);
		expect(onZoomIn).not.toHaveBeenCalled();

		// Remainder 50 carries into the next gesture window.
		coalescer.addDelta(50);
		frames.flush();
		expect(onZoomOut).toHaveBeenCalledTimes(4);
	});

	it("cancels opposite deltas within the same frame", () => {
		const frames = frameHarness();
		const onZoomIn = vi.fn();
		const onZoomOut = vi.fn();
		const coalescer = createWheelZoomCoalescer({
			onZoomIn,
			onZoomOut,
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame,
		});

		coalescer.addDelta(-150);
		coalescer.addDelta(120);
		frames.flush();
		// Net -30 → below threshold, no step.
		expect(onZoomIn).not.toHaveBeenCalled();
		expect(onZoomOut).not.toHaveBeenCalled();
	});

	it("reset drops pending accumulation before the frame fires", () => {
		const frames = frameHarness();
		const onZoomIn = vi.fn();
		const onZoomOut = vi.fn();
		const coalescer = createWheelZoomCoalescer({
			onZoomIn,
			onZoomOut,
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame,
		});

		coalescer.addDelta(-250);
		coalescer.reset();
		frames.flush();
		expect(onZoomIn).not.toHaveBeenCalled();
		expect(onZoomOut).not.toHaveBeenCalled();
	});

	it("dispose cancels the pending frame and ignores later deltas", () => {
		const frames = frameHarness();
		const onZoomIn = vi.fn();
		const onZoomOut = vi.fn();
		const coalescer = createWheelZoomCoalescer({
			onZoomIn,
			onZoomOut,
			requestFrame: frames.requestFrame,
			cancelFrame: frames.cancelFrame,
		});

		coalescer.addDelta(-250);
		expect(frames.hasPending()).toBe(true);
		coalescer.dispose();
		expect(frames.cancelFrame).toHaveBeenCalledWith(7);

		coalescer.addDelta(-250);
		expect(frames.requestFrame).toHaveBeenCalledTimes(1);
		frames.flush();
		expect(onZoomIn).not.toHaveBeenCalled();
	});
});

/** Records listener churn and dispatches to whichever listener is attached. */
function wheelTargetHarness() {
	let listener: ((event: WheelEvent) => void) | null = null;
	let attachedPassive: boolean | undefined;
	return {
		target: {
			addEventListener: vi.fn(
				(
					_type: string,
					next: (event: WheelEvent) => void,
					options?: AddEventListenerOptions,
				) => {
					listener = next;
					attachedPassive = options?.passive;
				},
			),
			removeEventListener: vi.fn((_type: string, prev: unknown) => {
				if (listener === prev) listener = null;
			}),
		} as unknown as HTMLElement,
		isPassive: () => attachedPassive,
		hasListener: () => listener !== null,
		dispatch: (init: { deltaY: number; ctrlKey?: boolean }) => {
			const preventDefault = vi.fn();
			listener?.({
				deltaY: init.deltaY,
				ctrlKey: init.ctrlKey ?? false,
				metaKey: false,
				cancelable: true,
				preventDefault,
			} as unknown as WheelEvent);
			return preventDefault;
		},
	};
}

describe("PDF wheel zoom gesture binding", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts non-passive so a cold pinch can cancel platform zoom", () => {
		const harness = wheelTargetHarness();
		const onZoomWheel = vi.fn();
		bindWheelZoomGesture({ target: harness.target, onZoomWheel });

		expect(harness.isPassive()).toBe(false);
		const preventDefault = harness.dispatch({ deltaY: -40, ctrlKey: true });
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(onZoomWheel).toHaveBeenCalledTimes(1);
		expect(harness.isPassive()).toBe(false);
	});

	it("goes passive for a plain scroll gesture and back after it idles", () => {
		const harness = wheelTargetHarness();
		const onZoomWheel = vi.fn();
		bindWheelZoomGesture({
			target: harness.target,
			onZoomWheel,
			scrollIdleMs: 200,
		});

		harness.dispatch({ deltaY: 30 });
		expect(harness.isPassive()).toBe(true);
		expect(onZoomWheel).not.toHaveBeenCalled();

		// Continued scrolling keeps the listener passive.
		vi.advanceTimersByTime(150);
		harness.dispatch({ deltaY: 30 });
		vi.advanceTimersByTime(150);
		expect(harness.isPassive()).toBe(true);

		vi.advanceTimersByTime(200);
		expect(harness.isPassive()).toBe(false);
	});

	it("still zooms when a pinch starts mid-scroll, without a passive preventDefault", () => {
		const harness = wheelTargetHarness();
		const onZoomWheel = vi.fn();
		bindWheelZoomGesture({ target: harness.target, onZoomWheel });

		harness.dispatch({ deltaY: 30 });
		expect(harness.isPassive()).toBe(true);

		const preventDefault = harness.dispatch({ deltaY: -40, ctrlKey: true });
		expect(preventDefault).not.toHaveBeenCalled();
		expect(onZoomWheel).toHaveBeenCalledTimes(1);
		// Next tick of the same pinch is cancelable again.
		expect(harness.isPassive()).toBe(false);
	});

	it("dispose detaches the listener and drops the idle timer", () => {
		const harness = wheelTargetHarness();
		const onZoomWheel = vi.fn();
		const binding = bindWheelZoomGesture({
			target: harness.target,
			onZoomWheel,
		});

		harness.dispatch({ deltaY: 30 });
		binding.dispose();
		expect(harness.hasListener()).toBe(false);
		vi.advanceTimersByTime(1000);
		expect(harness.target.addEventListener).toHaveBeenCalledTimes(2);
	});
});
