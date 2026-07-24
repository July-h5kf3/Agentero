import { describe, expect, it } from "vitest";
import {
	basenameOfPath,
	slugFromPdfPath,
	slugFromStem,
	stemFromPath,
	titleFromPdfPath,
	titleFromStem,
} from "@/lib/paper/local-pdf-meta";

describe("local-pdf-meta", () => {
	it("basename and stem", () => {
		expect(basenameOfPath("/Users/me/a.pdf")).toBe("a.pdf");
		expect(stemFromPath("/Users/me/a.pdf")).toBe("a");
		expect(stemFromPath("C:\\x\\vaswani_2017.pdf")).toBe("vaswani_2017");
	});

	it("title_from_stem mirrors host", () => {
		expect(titleFromStem("vaswani_2017_attention")).toBe(
			"vaswani 2017 attention",
		);
		expect(titleFromStem("  Hello   World  ")).toBe("Hello World");
		expect(titleFromStem("   ")).toBe("Untitled");
	});

	it("slug_from_stem mirrors host", () => {
		expect(slugFromStem("Hello World!")).toBe("Hello-World");
		expect(slugFromStem("...")).toBe("paper");
		expect(slugFromPdfPath("/tmp/My Paper (2020).pdf")).toBe("My-Paper-2020");
	});

	it("titleFromPdfPath", () => {
		expect(titleFromPdfPath("/x/foo_bar.pdf")).toBe("foo bar");
	});
});
