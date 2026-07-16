import { describe, expect, it } from "vitest";
import {
	isRemoteOrInlineImageUrl,
	joinFilePath,
	parentDir,
	parseImagePayload,
	resolveMarkdownImageAbs,
	sanitizeAssetFileName,
} from "@/lib/markdown-image";

describe("markdown-image path helpers", () => {
	it("parentDir handles posix and windows separators", () => {
		expect(parentDir("/vault/papers/x/NOTES.md")).toBe("/vault/papers/x");
		expect(parentDir("C:\\vault\\papers\\x\\NOTES.md")).toBe(
			"C:\\vault\\papers\\x",
		);
	});

	it("joinFilePath preserves separator style", () => {
		expect(joinFilePath("/vault/papers/x", "assets")).toBe(
			"/vault/papers/x/assets",
		);
		expect(joinFilePath("C:\\vault\\papers\\x", "assets")).toBe(
			"C:\\vault\\papers\\x\\assets",
		);
	});

	it("resolveMarkdownImageAbs maps ./assets/ relative to the md file", () => {
		expect(
			resolveMarkdownImageAbs(
				"/vault/papers/1706.03762/NOTES.md",
				"./assets/figure.png",
			),
		).toBe("/vault/papers/1706.03762/assets/figure.png");

		expect(
			resolveMarkdownImageAbs(
				"/vault/papers/1706.03762/NOTES.md",
				"assets/figure.png",
			),
		).toBe("/vault/papers/1706.03762/assets/figure.png");

		expect(
			resolveMarkdownImageAbs(
				"C:\\vault\\papers\\x\\NOTES.md",
				"./assets/a.jpg",
			),
		).toBe("C:\\vault\\papers\\x\\assets\\a.jpg");
	});

	it("resolveMarkdownImageAbs rejects traversal and remote urls", () => {
		expect(
			resolveMarkdownImageAbs("/vault/a.md", "./assets/../../secret.png"),
		).toBeNull();
		expect(
			resolveMarkdownImageAbs("/vault/a.md", "https://x/y.png"),
		).toBeNull();
		expect(
			resolveMarkdownImageAbs("/vault/a.md", "data:image/png;base64,aa"),
		).toBe(null);
		expect(resolveMarkdownImageAbs("/vault/a.md", "blob:http://x")).toBeNull();
	});

	it("isRemoteOrInlineImageUrl", () => {
		expect(isRemoteOrInlineImageUrl("https://a/b.png")).toBe(true);
		expect(isRemoteOrInlineImageUrl("./assets/x.png")).toBe(false);
	});

	it("sanitizeAssetFileName strips path segments", () => {
		expect(sanitizeAssetFileName("../evil.png")).toBe("evil.png");
		expect(sanitizeAssetFileName("foo/bar.png")).toBe("bar.png");
		expect(sanitizeAssetFileName("")).toBe("image");
	});
});

describe("parseImagePayload", () => {
	it("decodes a minimal data URL", () => {
		// "hi" as base64
		const data = "data:image/png;base64,aGk=";
		const parsed = parseImagePayload(data);
		expect(parsed.ext).toBe("png");
		expect(parsed.mime).toBe("image/png");
		expect(Array.from(parsed.bytes)).toEqual([104, 105]);
	});

	it("defaults ArrayBuffer to png", () => {
		const buf = new Uint8Array([1, 2, 3]).buffer;
		const parsed = parseImagePayload(buf);
		expect(parsed.ext).toBe("png");
		expect(parsed.bytes.length).toBe(3);
	});
});
