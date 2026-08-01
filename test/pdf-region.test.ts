import { describe, expect, it } from "vitest";

import {
	expandNormalizedRegion,
	normalizedRegionFromPoints,
	normalizedRegionToPdfRect,
	unionNormalizedRegions,
} from "@/lib/pdf/region";

describe("PDF visual regions", () => {
	it("normalizes a drag in either direction", () => {
		const region = normalizedRegionFromPoints(
			{ x: 0.8, y: 0.7 },
			{ x: 0.2, y: 0.1 },
		);
		expect(region?.x).toBeCloseTo(0.2);
		expect(region?.y).toBeCloseTo(0.1);
		expect(region?.w).toBeCloseTo(0.6);
		expect(region?.h).toBeCloseTo(0.6);
	});

	it("ignores click-sized regions", () => {
		expect(
			normalizedRegionFromPoints({ x: 0.4, y: 0.4 }, { x: 0.401, y: 0.401 }),
		).toBeNull();
	});

	it("unions multi-line formula selections", () => {
		const region = unionNormalizedRegions([
			{ x: 0.2, y: 0.3, w: 0.25, h: 0.04 },
			{ x: 0.18, y: 0.36, w: 0.42, h: 0.04 },
		]);
		expect(region?.x).toBeCloseTo(0.18);
		expect(region?.y).toBeCloseTo(0.3);
		expect(region?.w).toBeCloseTo(0.42);
		expect(region?.h).toBeCloseTo(0.1);
	});

	it("pads and clamps a crop at page edges", () => {
		const region = expandNormalizedRegion(
			{ x: 0.98, y: 0.01, w: 0.05, h: 0.08 },
			0.02,
		);
		expect(region.x).toBeCloseTo(0.96);
		expect(region.y).toBe(0);
		expect(region.w).toBeCloseTo(0.04);
		expect(region.h).toBeCloseTo(0.11);
	});

	it("maps normalized coordinates into PDF points", () => {
		const rect = normalizedRegionToPdfRect(
			{ x: 0.25, y: 0.1, w: 0.5, h: 0.2 },
			{ width: 600, height: 800 },
		);
		expect(rect?.origin.x).toBeCloseTo(150);
		expect(rect?.origin.y).toBeCloseTo(80);
		expect(rect?.size.width).toBeCloseTo(300);
		expect(rect?.size.height).toBeCloseTo(160);
	});
});
