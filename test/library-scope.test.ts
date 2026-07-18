import { describe, expect, it } from "vitest";
import type { PaperMetadata } from "@/lib/paper-metadata";
import {
	filterPapersByScope,
	LIBRARY_VIRTUAL_PATH,
	normalizeLibraryScope,
	paperInLibraryScope,
} from "@/lib/papers-api";
import {
	createPlaceholderTab,
	ensureFullLibraryTab,
	removeTab,
} from "@/lib/tabs";

function paper(
	path: string,
	overrides: Partial<PaperMetadata> = {},
): PaperMetadata {
	return {
		id: path.split("/").pop() ?? path,
		path,
		type: "arxiv",
		title: path,
		authors: [],
		tags: [],
		status: "completed",
		added_at: "",
		updated_at: "",
		...overrides,
	};
}

describe("normalizeLibraryScope", () => {
	it("strips slashes and lowercases", () => {
		expect(normalizeLibraryScope("Papers/NLP/")).toBe("papers/nlp");
		expect(normalizeLibraryScope("\\papers\\nlp\\")).toBe("papers/nlp");
	});
});

describe("paperInLibraryScope", () => {
	it("matches recursive path prefixes", () => {
		expect(paperInLibraryScope("papers/nlp/1706.03762", "papers/nlp")).toBe(
			true,
		);
		expect(paperInLibraryScope("papers/nlp/transformers/x", "papers/nlp")).toBe(
			true,
		);
		expect(paperInLibraryScope("papers/cv/y", "papers/nlp")).toBe(false);
		expect(paperInLibraryScope("papers/nlp-extra/z", "papers/nlp")).toBe(false);
	});

	it("treats null/empty scope as full library", () => {
		expect(paperInLibraryScope("papers/a", null)).toBe(true);
		expect(paperInLibraryScope("papers/a", "")).toBe(true);
		expect(paperInLibraryScope(undefined, "papers")).toBe(false);
	});
});

describe("filterPapersByScope", () => {
	const rows = [
		paper("papers/1706.03762"),
		paper("papers/nlp/2010.11929"),
		paper("papers/nlp/transformers/bert"),
		paper("papers/cv/resnet"),
	];

	it("returns all papers for null scope", () => {
		expect(filterPapersByScope(rows, null)).toHaveLength(4);
	});

	it("filters papers/nlp recursively", () => {
		const hit = filterPapersByScope(rows, "papers/nlp");
		expect(hit.map((p) => p.path)).toEqual([
			"papers/nlp/2010.11929",
			"papers/nlp/transformers/bert",
		]);
	});

	it("filters papers root", () => {
		expect(filterPapersByScope(rows, "papers")).toHaveLength(4);
	});
});

describe("filterPapersByScope latency", () => {
	it("stays well under a frame budget across catalog sizes", () => {
		const sizes = [100, 1_000, 5_000, 10_000, 50_000] as const;
		const results: string[] = [];

		for (const n of sizes) {
			const rows: PaperMetadata[] = [];
			for (let i = 0; i < n; i++) {
				const org = i % 20 === 0 ? "nlp" : i % 20 === 1 ? "cv" : `org${i % 50}`;
				rows.push(paper(`papers/${org}/paper-${i}`));
			}
			filterPapersByScope(rows, "papers/nlp"); // warm-up
			const iterations = n >= 10_000 ? 30 : 100;
			const t0 = performance.now();
			let hits = 0;
			for (let i = 0; i < iterations; i++) {
				hits = filterPapersByScope(rows, "papers/nlp").length;
			}
			const avgMs = (performance.now() - t0) / iterations;
			results.push(
				`n=${String(n).padStart(5)} avg=${avgMs.toFixed(3)}ms hits=${hits}`,
			);
			// 16ms ≈ one frame; even 50k should be far below that.
			expect(avgMs).toBeLessThan(n >= 50_000 ? 20 : 5);
			expect(hits).toBeGreaterThan(0);
		}

		// eslint-disable-next-line no-console
		console.log(`[library-scope latency]\n  ${results.join("\n  ")}`);
	});
});

describe("ensureFullLibraryTab", () => {
	it("inserts full library when strip is empty", () => {
		const { tabs, activeId, inserted } = ensureFullLibraryTab([]);
		expect(inserted).toBe(true);
		expect(tabs).toHaveLength(1);
		expect(tabs[0]?.path).toBe(LIBRARY_VIRTUAL_PATH);
		expect(tabs[0]?.kind).toBe("library");
		expect(tabs[0]?.loaded).toBe(true);
		expect(activeId).toBe(LIBRARY_VIRTUAL_PATH);
	});

	it("reuses existing full library tab", () => {
		const start = [createPlaceholderTab(LIBRARY_VIRTUAL_PATH)];
		const { tabs, inserted } = ensureFullLibraryTab(start);
		expect(inserted).toBe(false);
		expect(tabs).toBe(start);
	});
});

describe("removeTab + ensureFullLibraryTab", () => {
	it("can rebuild library after the last document closes", () => {
		const doc = createPlaceholderTab("/vault/notes/a.md");
		const { tabs } = removeTab([doc], doc.id, doc.id);
		expect(tabs).toHaveLength(0);
		const ensured = ensureFullLibraryTab(tabs);
		expect(ensured.tabs[0]?.path).toBe(LIBRARY_VIRTUAL_PATH);
	});
});
