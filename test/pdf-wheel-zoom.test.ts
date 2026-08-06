import { describe, expect, it, vi } from "vitest";
import { createWheelZoomCoalescer } from "@/lib/pdf/wheel-zoom";

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
