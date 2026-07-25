import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Dockview renderer overlay", () => {
	it("anchors an unmeasured hidden overlay without disabling keep-alive", () => {
		const css = readFileSync(
			new URL("../src/index.css", import.meta.url),
			"utf8",
		);
		const rule = css.match(
			/\.agentero-dockview \.dv-render-overlay\s*\{([^}]*)\}/,
		)?.[1];

		expect(rule).toContain("top: 0");
		expect(rule).toContain("left: 0");
		expect(rule).not.toContain("display: none");
	});
});
