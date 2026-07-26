import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Markdown code block scrolling", () => {
	it("keeps horizontal overflow local without trapping vertical wheel input", () => {
		const component = readFileSync(
			new URL("../src/components/editor/code-block-node.tsx", import.meta.url),
			"utf8",
		);
		const css = readFileSync(
			new URL("../src/index.css", import.meta.url),
			"utf8",
		);
		const rule = css.match(
			/\.agentero-scroll-both\.agentero-scroll-x-only\s*\{([^}]*)\}/,
		)?.[1];

		expect(component).toContain("agentero-scroll-x-only");
		expect(rule).toContain("overflow-y: hidden");
		expect(rule).toContain("overscroll-behavior-x: contain");
		expect(rule).toContain("overscroll-behavior-y: auto");
	});
});
