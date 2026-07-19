import { describe, expect, it } from "vitest";

import {
	SELECTION_CARD_EDGE as EDGE,
	placeSelectionCard,
} from "@/components/viewer/pdf-ask/selection-card";

/**
 * placeSelectionCard falls back to 1200×800 when `window` is missing
 * (Node / vitest without happy-dom). Tests use the same defaults.
 */
const VW = 1200;
const VH = 800;

describe("placeSelectionCard", () => {
	it("keeps the card fully inside the viewport near the bottom-right", () => {
		const width = 360;
		const preferredH = 420;

		const { left, top, maxHeight } = placeSelectionCard(
			{ x: VW - 20, y: VH - 10 },
			{ width, height: preferredH },
		);

		expect(left).toBeGreaterThanOrEqual(EDGE);
		expect(left + Math.min(width, VW - EDGE * 2)).toBeLessThanOrEqual(
			VW - EDGE + 0.5,
		);
		expect(top).toBeGreaterThanOrEqual(EDGE);
		expect(top + maxHeight).toBeLessThanOrEqual(VH - EDGE + 0.5);
		expect(maxHeight).toBeGreaterThan(0);
		expect(maxHeight).toBeLessThanOrEqual(preferredH);
	});

	it("keeps the card fully inside the viewport near the top-left", () => {
		const width = 320;
		const preferredH = 360;

		const { left, top, maxHeight } = placeSelectionCard(
			{ x: 4, y: 4 },
			{ width, height: preferredH, preferRight: true },
		);

		expect(left).toBeGreaterThanOrEqual(EDGE);
		expect(top).toBeGreaterThanOrEqual(EDGE);
		expect(top + maxHeight).toBeLessThanOrEqual(VH - EDGE + 0.5);
		expect(left + Math.min(width, VW - EDGE * 2)).toBeLessThanOrEqual(
			VW - EDGE + 0.5,
		);
	});

	it("shrinks maxHeight when the preferred height exceeds the viewport", () => {
		const { top, maxHeight } = placeSelectionCard(
			{ x: 100, y: 100 },
			{ width: 280, height: 10_000 },
		);

		expect(maxHeight).toBeLessThanOrEqual(VH - EDGE * 2);
		expect(top + maxHeight).toBeLessThanOrEqual(VH - EDGE + 0.5);
	});

	it("flips to the left when there is no room on the right", () => {
		const width = 360;
		const screenX = VW - 30;

		const { left } = placeSelectionCard(
			{ x: screenX, y: 200 },
			{ width, height: 220, preferRight: true },
		);

		// Prefer left of anchor when right side would overflow.
		expect(left + width).toBeLessThanOrEqual(screenX + 1);
	});
});
