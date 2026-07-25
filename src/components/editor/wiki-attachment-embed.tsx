"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PdfViewer } from "@/components/viewer/embed/pdf-viewer";
import { localFileToArrayBuffer } from "@/lib/paper-metadata";
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
	| { kind: "ready"; bytes: ArrayBuffer };

type CachedAttachmentLoad = {
	requestKey: string;
	state: AttachmentState;
};

const ATTACHMENT_CACHE_LIMIT = 32;
const attachmentBytesCache = new Map<string, ArrayBuffer>();
const attachmentRequestCache = new Map<string, Promise<ArrayBuffer | null>>();

function attachmentRequestKey(
	kind: "image" | "pdf",
	absoluteTarget: string,
	revision: number,
): string {
	return JSON.stringify([kind, absoluteTarget, revision]);
}

function cachedAttachmentBytes(key: string): ArrayBuffer | undefined {
	return attachmentBytesCache.get(key);
}

function loadAttachmentBytes(
	key: string,
	absoluteTarget: string,
): Promise<ArrayBuffer | null> {
	const cached = cachedAttachmentBytes(key);
	if (cached) return Promise.resolve(cached);
	const pending = attachmentRequestCache.get(key);
	if (pending) return pending;

	const request = localFileToArrayBuffer(absoluteTarget)
		.then((bytes) => {
			if (!bytes) return null;
			attachmentBytesCache.delete(key);
			attachmentBytesCache.set(key, bytes);
			while (attachmentBytesCache.size > ATTACHMENT_CACHE_LIMIT) {
				const oldest = attachmentBytesCache.keys().next().value;
				if (typeof oldest !== "string") break;
				attachmentBytesCache.delete(oldest);
			}
			return bytes;
		})
		.finally(() => {
			attachmentRequestCache.delete(key);
		});
	attachmentRequestCache.set(key, request);
	return request;
}

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
	const dimensions = parseWikiImageEmbedDimensions(imageSize);
	const requestKey = attachmentRequestKey(kind, absoluteTarget, revision);
	const [load, setLoad] = useState<CachedAttachmentLoad>(() => {
		const bytes = cachedAttachmentBytes(requestKey);
		return {
			requestKey,
			state: bytes ? { kind: "ready", bytes } : { kind: "loading" },
		};
	});
	const fallbackBytes =
		load.requestKey === requestKey
			? undefined
			: cachedAttachmentBytes(requestKey);
	const state =
		load.requestKey === requestKey
			? load.state
			: fallbackBytes
				? {
						kind: "ready" as const,
						bytes: fallbackBytes,
					}
				: { kind: "loading" as const };
	const attachmentBytes = state.kind === "ready" ? state.bytes : null;
	const imageSource = useMemo(() => {
		if (kind !== "image" || !attachmentBytes) return null;
		return URL.createObjectURL(
			new Blob([attachmentBytes], { type: imageMimeFromPath(targetPath) }),
		);
	}, [attachmentBytes, kind, targetPath]);

	useEffect(() => {
		let cancelled = false;
		const cached = cachedAttachmentBytes(requestKey);
		if (cached) {
			setLoad((previous) =>
				previous.requestKey === requestKey &&
				previous.state.kind === "ready" &&
				previous.state.bytes === cached
					? previous
					: { requestKey, state: { kind: "ready", bytes: cached } },
			);
			return;
		}
		setLoad({ requestKey, state: { kind: "loading" } });
		void loadAttachmentBytes(requestKey, absoluteTarget).then((bytes) => {
			if (cancelled) return;
			setLoad({
				requestKey,
				state: bytes ? { kind: "ready", bytes } : { kind: "error" },
			});
		});

		return () => {
			cancelled = true;
		};
	}, [absoluteTarget, requestKey]);

	useEffect(
		() => () => {
			if (imageSource) URL.revokeObjectURL(imageSource);
		},
		[imageSource],
	);

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
	if (kind === "image" && state.kind === "ready" && imageSource) {
		return (
			<span className="flex justify-center p-3">
				<img
					src={imageSource}
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
	if (state.kind !== "ready") return null;
	return (
		<PdfViewer
			source={null}
			sourceBytes={state.bytes}
			docId={`wiki-embed:${targetPath}:${revision}`}
			className="h-96 w-full"
		/>
	);
}
