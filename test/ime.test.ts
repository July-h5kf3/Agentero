import { describe, expect, it } from "vitest";
import {
	IME_COMPOSITION_END_GRACE_MS,
	IME_KEY_CODE,
	isImeKeyboardEvent,
} from "@/lib/core/ime";

describe("isImeKeyboardEvent", () => {
	it("detects React nativeEvent.isComposing", () => {
		expect(
			isImeKeyboardEvent({
				nativeEvent: { isComposing: true },
			}),
		).toBe(true);
	});

	it("detects top-level isComposing", () => {
		expect(isImeKeyboardEvent({ isComposing: true })).toBe(true);
	});

	it("detects legacy keyCode 229 (IME processing)", () => {
		expect(isImeKeyboardEvent({ keyCode: IME_KEY_CODE })).toBe(true);
		expect(
			isImeKeyboardEvent({
				nativeEvent: { keyCode: IME_KEY_CODE },
			}),
		).toBe(true);
	});

	it("returns false for normal Enter after composition", () => {
		expect(
			isImeKeyboardEvent({
				keyCode: 13,
				nativeEvent: { isComposing: false, keyCode: 13 },
			}),
		).toBe(false);
	});
});

describe("IME_COMPOSITION_END_GRACE_MS", () => {
	it("is a short grace window after compositionend", () => {
		expect(IME_COMPOSITION_END_GRACE_MS).toBeGreaterThanOrEqual(50);
		expect(IME_COMPOSITION_END_GRACE_MS).toBeLessThanOrEqual(200);
	});
});
