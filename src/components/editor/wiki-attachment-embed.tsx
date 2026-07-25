"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PdfViewer } from "@/components/viewer/embed/pdf-viewer";
import {
	localFileToArrayBuffer,
	localImageToViewerSource,
	revokePdfViewerSource,
} from "@/lib/paper-metadata";
import { imageMimeFromPath } from "@/lib/viewer";

type WikiAttachmentEmbedProps = {
	kind: "image" | "pdf";
	absoluteTarget: string;
	targetPath: string;
	revision: number;
	imageSize?: string | null;
};

type AttachmentState =
	| { kind: "loading" }
	| { kind: "error" }
	| { kind: "image"; source: string }
	| { kind: "pdf"; bytes: ArrayBuffer };

export type WikiImageEmbedDimensions = {
	width: number;
	height?: number;
};

/** Obsidian image aliases may encode a width (`100`) or size (`100x200`). */
export function parseWikiImageEmbedDimensions(
	value: string | null | undefined,
): WikiImageEmbedDimensions | null {
	const match = value?.trim().match(/^([1-9]\d*)(?:x([1-9]\d*))?$/i);
	if (!match) return null;
	const width = Number(match[1]);
	const height = match[2] ? Number(match[2]) : undefined;
	if (
		!Number.isSafeInteger(width) ||
		(height && !Number.isSafeInteger(height))
	) {
		return null;
	}
	return height ? { width, height } : { width };
}

export function WikiAttachmentEmbed({
	kind,
	absoluteTarget,
	targetPath,
	revision,
	imageSize,
}: WikiAttachmentEmbedProps) {
	const { t } = useTranslation("editor");
	const [state, setState] = useState<AttachmentState>({ kind: "loading" });
	const dimensions = parseWikiImageEmbedDimensions(imageSize);

	useEffect(() => {
		// Re-read attachment bytes after the Host rebuild invalidates projections.
		void revision;
		let cancelled = false;
		let imageSource: string | null = null;
		setState({ kind: "loading" });

		void (async () => {
			if (kind === "image") {
				const source = await localImageToViewerSource(
					absoluteTarget,
					imageMimeFromPath(targetPath),
				);
				if (cancelled) {
					revokePdfViewerSource(source);
					return;
				}
				if (!source) {
					setState({ kind: "error" });
					return;
				}
				imageSource = source;
				setState({ kind: "image", source });
				return;
			}

			const bytes = await localFileToArrayBuffer(absoluteTarget);
			if (cancelled) return;
			setState(bytes ? { kind: "pdf", bytes } : { kind: "error" });
		})();

		return () => {
			cancelled = true;
			revokePdfViewerSource(imageSource);
		};
	}, [absoluteTarget, kind, revision, targetPath]);

	if (state.kind === "loading") {
		return (
			<span className="block px-4 py-3 text-muted-foreground text-sm">
				{t("embed.loading")}
			</span>
		);
	}
	if (state.kind === "error") {
		return (
			<span className="block px-4 py-3 text-muted-foreground text-sm">
				{t("embed.error")}
			</span>
		);
	}
	if (state.kind === "image") {
		return (
			<span className="flex justify-center p-3">
				<img
					src={state.source}
					alt={targetPath}
					className="max-h-96 max-w-full rounded-sm object-contain"
					style={{
						width: dimensions?.width,
						height: dimensions?.height,
					}}
					loading="lazy"
					draggable={false}
				/>
			</span>
		);
	}
	return (
		<PdfViewer
			source={null}
			sourceBytes={state.bytes}
			docId={`wiki-embed:${targetPath}:${revision}`}
			className="h-96 w-full"
		/>
	);
}
