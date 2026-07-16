"use client";

import type { TImageElement } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";
import { useEffect, useState } from "react";

import { useMarkdownDoc } from "@/components/editor/markdown-doc-context";
import {
	isRemoteOrInlineImageUrl,
	resolveMarkdownImageAbs,
} from "@/lib/markdown-image";
import {
	localImageToViewerSource,
	revokePdfViewerSource,
} from "@/lib/paper-metadata";
import { imageMimeFromPath } from "@/lib/viewer";

export function ImageElement(props: PlateElementProps<TImageElement>) {
	const url = props.element.url ?? "";
	const alt = (props.element as { alt?: string }).alt ?? "";
	const { filePath } = useMarkdownDoc();
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

	return (
		<PlateElement {...props} className="py-2">
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
			{props.children}
		</PlateElement>
	);
}
