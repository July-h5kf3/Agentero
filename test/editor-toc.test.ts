import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeadingElement } from "@/components/editor/heading-node";

describe("Markdown table of contents", () => {
	it("mirrors each Plate heading node id to its DOM id for scroll tracking", () => {
		const headingId = "heading-node-id";
		const markup = renderToStaticMarkup(
			createElement(HeadingElement, {
				attributes: {},
				children: "Heading",
				editor: {
					api: {
						isBlock: () => true,
					},
				},
				element: {
					id: headingId,
					type: "h2",
					children: [{ text: "Heading" }],
				},
				variant: "h2",
			} as unknown as Parameters<typeof HeadingElement>[0]),
		);

		expect(markup).toContain(`id="${headingId}"`);
	});

	it("renders the observed heading with the active UI theme color", () => {
		const tocComponent = readFileSync(
			new URL("../src/components/editor/toc-sidebar.tsx", import.meta.url),
			"utf8",
		);

		expect(tocComponent).toContain(
			"const active = item.id === state.activeContentId",
		);
		expect(tocComponent).toContain(
			'aria-current={active ? "location" : undefined}',
		);
		expect(tocComponent).toContain(
			'active && "text-primary hover:text-primary"',
		);
		expect(tocComponent).toContain(
			"h-1 bg-primary ring-2 ring-primary/20 group-hover/item:bg-primary",
		);
		expect(tocComponent).not.toContain("text-brand");
		expect(tocComponent).not.toContain("bg-brand");
	});

	it("uses a compact quarter-height layout with visible heading depth", () => {
		const tocComponent = readFileSync(
			new URL("../src/components/editor/toc-sidebar.tsx", import.meta.url),
			"utf8",
		);

		expect(tocComponent).toContain("group/toc absolute top-1/4 right-2 z-20");
		expect(tocComponent).toContain(
			"group-hover/toc:h-6 group-focus-within/toc:h-6",
		);
		expect(tocComponent).toContain('1: "w-8"');
		expect(tocComponent).toContain('2: "w-6"');
		expect(tocComponent).toContain('3: "w-[18px]"');
		expect(tocComponent).not.toContain("h-1 w-6 bg-brand");
	});
});
