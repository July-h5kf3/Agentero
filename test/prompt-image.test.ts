import type { FileUIPart } from "ai";
import { describe, expect, it } from "vitest";

import {
	dataUrlToPromptImage,
	fileUiPartsToPromptImages,
	isImageFile,
} from "@/lib/agent/prompt-image";
import {
	dataTransferLooksLikeImages,
	fileMatchesAccept,
} from "@/lib/core/file-accept";

function fakeFile(name: string, type: string): File {
	return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("dataUrlToPromptImage", () => {
	it("parses a PNG data URL into raw base64 + mime", () => {
		const img = dataUrlToPromptImage("data:image/png;base64,YWJj");
		expect(img).toEqual({ data: "YWJj", mimeType: "image/png" });
	});

	it("rejects non-image mime types", () => {
		expect(dataUrlToPromptImage("data:text/plain;base64,YWJj")).toBeNull();
	});

	it("rejects bare base64 without data: prefix", () => {
		expect(dataUrlToPromptImage("YWJj")).toBeNull();
	});

	it("prefers the data URL mime over a hint", () => {
		const img = dataUrlToPromptImage(
			"data:image/webp;base64,YWJj",
			"image/jpeg",
		);
		expect(img).toEqual({ data: "YWJj", mimeType: "image/webp" });
	});
});

describe("fileUiPartsToPromptImages", () => {
	it("converts image FileUIParts and skips non-images", () => {
		const files: FileUIPart[] = [
			{
				type: "file",
				mediaType: "image/png",
				filename: "a.png",
				url: "data:image/png;base64,YWJj",
			},
			{
				type: "file",
				mediaType: "application/pdf",
				filename: "b.pdf",
				url: "data:application/pdf;base64,eHl6",
			},
			{
				type: "file",
				mediaType: "image/jpeg",
				filename: "c.jpg",
				url: "data:image/jpeg;base64,ZGVm",
			},
		];
		expect(fileUiPartsToPromptImages(files)).toEqual([
			{ data: "YWJj", mimeType: "image/png" },
			{ data: "ZGVm", mimeType: "image/jpeg" },
		]);
	});

	it("returns empty for missing or empty input", () => {
		expect(fileUiPartsToPromptImages(undefined)).toEqual([]);
		expect(fileUiPartsToPromptImages([])).toEqual([]);
	});
});

describe("isImageFile / fileMatchesAccept", () => {
	const accept = "image/*,image/png,image/jpeg,.png,.jpg,.jpeg,.webp,.gif,.bmp";

	it("accepts image MIME types", () => {
		expect(isImageFile(fakeFile("a.png", "image/png"))).toBe(true);
		expect(fileMatchesAccept(fakeFile("a.png", "image/png"), accept)).toBe(
			true,
		);
	});

	it("rejects PDF and other non-images", () => {
		const pdf = fakeFile("paper.pdf", "application/pdf");
		expect(isImageFile(pdf)).toBe(false);
		expect(fileMatchesAccept(pdf, accept)).toBe(false);
	});

	it("accepts known image extensions when MIME is empty", () => {
		const bare = fakeFile("shot.WEBP", "");
		expect(isImageFile(bare)).toBe(true);
		expect(fileMatchesAccept(bare, accept)).toBe(true);
	});

	it("rejects non-image extensions even with empty MIME", () => {
		const bare = fakeFile("notes.pdf", "");
		expect(isImageFile(bare)).toBe(false);
		expect(fileMatchesAccept(bare, accept)).toBe(false);
	});
});

describe("dataTransferLooksLikeImages", () => {
	function fakeDt(opts: {
		items?: Array<{ kind: string; type: string }>;
		files?: Array<{ name: string; type?: string }>;
		uriList?: string;
	}): DataTransfer {
		const files = (opts.files ?? []).map(
			(f) =>
				({
					name: f.name,
					type: f.type ?? "",
				}) as File,
		);
		return {
			types: opts.uriList ? ["Files", "text/uri-list"] : ["Files"],
			items: (opts.items ?? []) as unknown as DataTransferItemList,
			files: files as unknown as FileList,
			getData: (type: string) =>
				type === "text/uri-list" ? (opts.uriList ?? "") : "",
		} as DataTransfer;
	}

	it("returns false without Files type", () => {
		const dt = { types: ["text/plain"], items: [] } as unknown as DataTransfer;
		expect(dataTransferLooksLikeImages(dt)).toBe(false);
	});

	it("returns false when MIME/names are unknown (avoid false positive on .md)", () => {
		expect(
			dataTransferLooksLikeImages(
				fakeDt({ items: [{ kind: "file", type: "" }] }),
			),
		).toBe(false);
	});

	it("returns true for image MIME items", () => {
		expect(
			dataTransferLooksLikeImages(
				fakeDt({ items: [{ kind: "file", type: "image/png" }] }),
			),
		).toBe(true);
	});

	it("returns false when only non-image MIME is present", () => {
		expect(
			dataTransferLooksLikeImages(
				fakeDt({ items: [{ kind: "file", type: "application/pdf" }] }),
			),
		).toBe(false);
	});

	it("returns false for README.md via file name", () => {
		expect(
			dataTransferLooksLikeImages(
				fakeDt({
					items: [{ kind: "file", type: "" }],
					files: [{ name: "README.en.md" }],
				}),
			),
		).toBe(false);
	});

	it("returns false for path in text/uri-list with non-image extension", () => {
		expect(
			dataTransferLooksLikeImages(
				fakeDt({
					uriList: "file:///Users/me/docs/README.en.md",
				}),
			),
		).toBe(false);
	});

	it("returns true for png via file name when MIME empty", () => {
		expect(
			dataTransferLooksLikeImages(
				fakeDt({
					items: [{ kind: "file", type: "" }],
					files: [{ name: "shot.png" }],
				}),
			),
		).toBe(true);
	});

	it("returns true for mixed image + non-image", () => {
		expect(
			dataTransferLooksLikeImages(
				fakeDt({
					items: [
						{ kind: "file", type: "image/png" },
						{ kind: "file", type: "application/pdf" },
					],
				}),
			),
		).toBe(true);
	});
});
