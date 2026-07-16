"use client";

import type { TImageElement } from "platejs";
import {
	PlateElement,
	type PlateElementProps,
	useFocused,
	useSelected,
} from "platejs/react";
import { useEffect, useState } from "react";

import { useMarkdownDoc } from "@/components/editor/markdown-doc-context";
import {
	formatMarkdownImageSyntax,
	isRemoteOrInlineImageUrl,
	resolveMarkdownImageAbs,
} from "@/lib/markdown-image";
import {
	localImageToViewerSource,
	revokePdfViewerSource,
} from "@/lib/paper-metadata";
import { cn } from "@/lib/utils";
import { imageMimeFromPath } from "@/lib/viewer";

export function ImageElement(props: PlateElementProps<TImageElement>) {
	const url = props.element.url ?? "";
	const alt = (props.element as { alt?: string }).alt ?? "";
	const { filePath } = useMarkdownDoc();
	const selected = useSelected();
	const focused = useFocused();
	/** Cursor / selection on this image → show Markdown source, not the bitmap. */
	const showSource = selected && focused;
	const [src, setSrc] = useState<string>(() =>
		url && isRemoteOrInlineImageUrl(url) ? url : "",
	);

	useEffect(() => {
		let cancelled = false;
		let blobUrl: string | null = null;

		async function load() {
			if (!url) {
				setSrc("");
				return;
			}
			if (isRemoteOrInlineImageUrl(url)) {
				setSrc(url);
				return;
			}
			if (!filePath) {
				setSrc("");
				return;
			}
			const abs = resolveMarkdownImageAbs(filePath, url);
			if (!abs) {
				setSrc("");
				return;
			}
			const mime = imageMimeFromPath(abs);
			const resolved = await localImageToViewerSource(abs, mime);
			if (cancelled) {
				if (resolved) revokePdfViewerSource(resolved);
				return;
			}
			blobUrl = resolved;
			setSrc(resolved ?? "");
		}

		void load();
		return () => {
			cancelled = true;
			if (blobUrl) revokePdfViewerSource(blobUrl);
		};
	}, [url, filePath]);

	const sourceText = formatMarkdownImageSyntax(alt, url);

	return (
		<PlateElement
			{...props}
			className={cn("py-2", showSource && "py-1")}
			data-selected={showSource ? "true" : undefined}
		>
			{showSource ? (
				<div
					className={cn(
						"m-0 rounded-sm border border-border bg-muted/40 px-2 py-1.5",
						"font-mono text-sm text-foreground break-all",
						"ring-1 ring-ring/40",
					)}
					contentEditable={false}
				>
					{sourceText}
				</div>
			) : (
				<figure className="m-0" contentEditable={false}>
					{src ? (
						<img
							src={src}
							alt={alt}
							className="max-w-full rounded-sm"
							loading="lazy"
							draggable={false}
						/>
					) : url ? (
						<div className="rounded-sm border border-dashed border-border px-3 py-6 text-center text-muted-foreground text-sm">
							{url}
						</div>
					) : null}
				</figure>
			)}
			{props.children}
		</PlateElement>
	);
}
