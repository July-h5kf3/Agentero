import { describe, expect, it } from "vitest";

import {
	mergeCaptionsIntoHosts,
	mergeFormulasByNumber,
	selectFormulasForNumber,
} from "@/lib/pdf/layout/merge-captions";
import type { PdfLayoutRegion } from "@/lib/pdf/layout/types";

function region(
	partial: Partial<PdfLayoutRegion> &
		Pick<PdfLayoutRegion, "id" | "kind" | "score" | "bbox">,
): PdfLayoutRegion {
	return {
		pageIndex: 0,
		label: partial.kind,
		readingOrder: 0,
		rect: {
			x: partial.bbox.x * 100,
			y: partial.bbox.y * 100,
			w: partial.bbox.w * 100,
			h: partial.bbox.h * 100,
		},
		...partial,
	};
}

describe("selectFormulasForNumber", () => {
	it("picks left-side formula bodies in the number band", () => {
		const num = region({
			id: "n1",
			kind: "formula_number",
			score: 0.9,
			bbox: { x: 0.85, y: 0.4, w: 0.08, h: 0.04 },
		});
		const body = region({
			id: "f1",
			kind: "formula",
			score: 0.95,
			bbox: { x: 0.2, y: 0.39, w: 0.55, h: 0.05 },
		});
		const other = region({
			id: "f2",
			kind: "formula",
			score: 0.9,
			bbox: { x: 0.2, y: 0.7, w: 0.55, h: 0.05 },
		});
		const picked = selectFormulasForNumber(num, [body, other]);
		expect(picked.map((p) => p.id)).toEqual(["f1"]);
	});

	it("grows multi-line formula stacks next to one number", () => {
		const num = region({
			id: "n1",
			kind: "formula_number",
			score: 0.9,
			bbox: { x: 0.88, y: 0.42, w: 0.06, h: 0.08 },
		});
		const line1 = region({
			id: "f1",
			kind: "formula",
			score: 0.9,
			bbox: { x: 0.15, y: 0.4, w: 0.65, h: 0.04 },
		});
		const line2 = region({
			id: "f2",
			kind: "formula",
			score: 0.9,
			bbox: { x: 0.15, y: 0.45, w: 0.65, h: 0.04 },
		});
		const far = region({
			id: "f3",
			kind: "formula",
			score: 0.9,
			bbox: { x: 0.15, y: 0.75, w: 0.65, h: 0.04 },
		});
		const picked = selectFormulasForNumber(num, [line1, line2, far]);
		expect(picked.map((p) => p.id).sort()).toEqual(["f1", "f2"]);
	});

	it("rejects formula bodies that substantially overlap text", () => {
		const num = region({
			id: "n1",
			kind: "formula_number",
			score: 0.9,
			bbox: { x: 0.85, y: 0.4, w: 0.08, h: 0.04 },
		});
		const inline = region({
			id: "f-inline",
			kind: "formula",
			score: 0.8,
			// Nested inside a paragraph text box.
			bbox: { x: 0.25, y: 0.4, w: 0.3, h: 0.04 },
		});
		const display = region({
			id: "f-display",
			kind: "formula",
			score: 0.95,
			bbox: { x: 0.2, y: 0.39, w: 0.55, h: 0.05 },
		});
		const text = region({
			id: "t1",
			kind: "text",
			score: 0.99,
			bbox: { x: 0.1, y: 0.35, w: 0.55, h: 0.15 },
		});
		const picked = selectFormulasForNumber(num, [inline, display], [text]);
		// display mostly outside text? display x=0.2 w=0.55 covers a lot of text
		// recalculate: display and text overlap heavily → both might reject.
		// Use a clean display formula away from text.
		const clean = region({
			id: "f-clean",
			kind: "formula",
			score: 0.95,
			bbox: { x: 0.2, y: 0.2, w: 0.55, h: 0.05 },
		});
		const num2 = region({
			id: "n2",
			kind: "formula_number",
			score: 0.9,
			bbox: { x: 0.85, y: 0.21, w: 0.08, h: 0.04 },
		});
		const textLow = region({
			id: "t-low",
			kind: "text",
			score: 0.99,
			bbox: { x: 0.1, y: 0.5, w: 0.7, h: 0.2 },
		});
		const pickedClean = selectFormulasForNumber(
			num2,
			[clean, inline],
			[textLow],
		);
		expect(pickedClean.map((p) => p.id)).toEqual(["f-clean"]);
		expect(picked.map((p) => p.id)).not.toContain("f-inline");
	});
});

describe("mergeFormulasByNumber", () => {
	it("aggregates by formula_number geometry and drops unnumbered formulas", () => {
		const numberedBody = region({
			id: "f1",
			kind: "formula",
			score: 0.95,
			bbox: { x: 0.15, y: 0.3, w: 0.6, h: 0.05 },
		});
		const number = region({
			id: "n1",
			kind: "formula_number",
			score: 0.9,
			bbox: { x: 0.85, y: 0.31, w: 0.08, h: 0.04 },
		});
		const unnumbered = region({
			id: "f2",
			kind: "formula",
			score: 0.9,
			bbox: { x: 0.15, y: 0.6, w: 0.5, h: 0.04 },
		});
		const out = mergeFormulasByNumber([numberedBody, number, unnumbered]);
		expect(out).toHaveLength(1);
		expect(out[0]?.kind).toBe("formula");
		// No equation-id text parse onto title.
		expect(out[0]?.title).toBeUndefined();
		expect(out[0]?.titleBbox).toEqual(number.bbox);
		// Body ∪ number
		expect(out[0]!.bbox.x).toBeLessThanOrEqual(numberedBody.bbox.x + 1e-9);
		expect(out[0]!.bbox.x + out[0]!.bbox.w).toBeGreaterThanOrEqual(
			number.bbox.x + number.bbox.w - 1e-9,
		);
	});

	it("drops bare formulas without a model formula_number box", () => {
		const f = region({
			id: "f1",
			kind: "formula",
			score: 0.9,
			bbox: { x: 0.2, y: 0.4, w: 0.5, h: 0.05 },
		});
		const out = mergeFormulasByNumber([f]);
		expect(out).toHaveLength(0);
	});

	it("drops numbered formulas that sit inside text blocks", () => {
		const body = region({
			id: "f1",
			kind: "formula",
			score: 0.9,
			bbox: { x: 0.2, y: 0.4, w: 0.4, h: 0.04 },
		});
		const num = region({
			id: "n1",
			kind: "formula_number",
			score: 0.85,
			bbox: { x: 0.85, y: 0.4, w: 0.08, h: 0.04 },
		});
		const text = region({
			id: "t1",
			kind: "text",
			score: 0.99,
			bbox: { x: 0.1, y: 0.35, w: 0.75, h: 0.15 },
		});
		const out = mergeFormulasByNumber([body, num, text]);
		expect(out.filter((r) => r.kind === "formula")).toHaveLength(0);
		expect(out.some((r) => r.kind === "text")).toBe(false);
	});
});

describe("mergeCaptionsIntoHosts + formulas", () => {
	it("places merged formulas in final hosts and drops unnumbered", () => {
		const image = region({
			id: "img",
			kind: "image",
			score: 0.95,
			bbox: { x: 0.1, y: 0.05, w: 0.7, h: 0.2 },
		});
		const figTitle = region({
			id: "ft",
			kind: "figure_title",
			score: 0.9,
			bbox: { x: 0.1, y: 0.26, w: 0.7, h: 0.04 },
			title: "Figure 1: Overview.",
			captionRole: "figure_main",
		});
		const formula = region({
			id: "f1",
			kind: "formula",
			score: 0.92,
			bbox: { x: 0.2, y: 0.5, w: 0.55, h: 0.05 },
		});
		const num = region({
			id: "n1",
			kind: "formula_number",
			score: 0.88,
			bbox: { x: 0.85, y: 0.51, w: 0.08, h: 0.04 },
		});
		const bare = region({
			id: "f2",
			kind: "formula",
			score: 0.9,
			bbox: { x: 0.2, y: 0.7, w: 0.4, h: 0.04 },
		});

		const out = mergeCaptionsIntoHosts([image, figTitle, formula, num, bare]);
		const formulas = out.filter((r) => r.kind === "formula");
		expect(formulas).toHaveLength(1);
		expect(formulas[0]?.title).toBeUndefined();
		expect(formulas[0]?.titleBbox).toEqual(num.bbox);
		expect(out.some((r) => r.kind === "image" || r.kind === "chart")).toBe(
			true,
		);
		expect(out.some((r) => r.kind === "formula_number")).toBe(false);
	});
});
