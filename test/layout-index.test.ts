import { describe, expect, it } from "vitest";

import {
	buildLayoutIndexItems,
	parseLayoutIndexSidecar,
	slugFromTitle,
} from "@/lib/pdf/layout/layout-index";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";

function region(
	partial: Partial<PdfLayoutRegion> &
		Pick<PdfLayoutRegion, "id" | "pageIndex" | "kind">,
): PdfLayoutRegion {
	return {
		label: partial.kind,
		score: 0.9,
		readingOrder: 0,
		rect: { x: 0, y: 0, w: 100, h: 100 },
		bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
		...partial,
	};
}

describe("slugFromTitle", () => {
	it("parses figure / table / algorithm numbers", () => {
		expect(slugFromTitle("Figure 3: Attention", "figure")).toBe("figure-3");
		expect(slugFromTitle("Fig. 2", "figure")).toBe("figure-2");
		expect(slugFromTitle("Table 1: Results", "table")).toBe("table-1");
		expect(slugFromTitle("Algorithm 4", "algorithm")).toBe("algorithm-4");
	});
});

describe("buildLayoutIndexItems", () => {
	it("keeps sidebar kinds and assigns CLI ids", () => {
		const items = buildLayoutIndexItems([
			region({
				id: "r1",
				pageIndex: 1,
				kind: "image",
				title: "Figure 3: Heads",
				score: 0.95,
				readingOrder: 2,
			}),
			region({
				id: "r2",
				pageIndex: 0,
				kind: "table",
				title: "Table 1: Metrics",
				score: 0.88,
				readingOrder: 1,
			}),
			region({
				id: "r3",
				pageIndex: 2,
				kind: "formula",
				score: 0.8,
				readingOrder: 5,
				titleBbox: { x: 0.8, y: 0.4, w: 0.05, h: 0.02 },
			}),
			region({
				id: "noise",
				pageIndex: 0,
				kind: "text",
				score: 0.99,
			}),
			region({
				id: "low",
				pageIndex: 0,
				kind: "image",
				score: 0.1,
			}),
		]);

		expect(items.map((i) => i.id)).toEqual([
			"figure-3",
			"table-1",
			expect.stringMatching(/^formula-p3-/),
		]);
		expect(items[0]?.page).toBe(2);
		expect(items[0]?.section).toBe("figure");
		expect(items[1]?.page).toBe(1);
		expect(items[1]?.section).toBe("table");
		expect(items[2]?.page).toBe(3);
		expect(items[2]?.section).toBe("formula");
		expect(items.every((i) => i.bbox.w > 0)).toBe(true);
	});

	it("round-trips through parseLayoutIndexSidecar", () => {
		const items = buildLayoutIndexItems([
			region({
				id: "a1",
				pageIndex: 0,
				kind: "algorithm",
				title: "Algorithm 2: Train",
				score: 0.91,
			}),
		]);
		const sidecar = {
			schemaVersion: 1 as const,
			source: {
				mode: "sidebar" as const,
				from: "layout.json" as const,
				generatedAt: "2026-01-01T00:00:00.000Z",
				minScore: 0.3,
			},
			items,
		};
		const parsed = parseLayoutIndexSidecar(sidecar);
		expect(parsed?.items).toHaveLength(1);
		expect(parsed?.items[0]?.id).toBe("algorithm-2");
	});
});
