"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/core/utils";
import { visualTraceImageAssetRelPath } from "@/lib/pdf/agent-trace/image";
import {
	type AnnotationRef,
	annotationAnchorY,
	lookupAnnotationRef,
	paperAbsFromWikiTarget,
} from "@/lib/pdf/annotation-ref";
import {
	type HighlightColor,
	swatchBorderClass,
	swatchColorClass,
} from "@/lib/pdf/highlight/palette";
import {
	getPaperOutline,
	outlineLocationLabelForPaper,
	subscribePaperOutline,
} from "@/lib/pdf/outline-location";
import { ANNOTATIONS_JSON, MARKS_FOLDER } from "@/lib/pdf/selection/marks-io";
import { joinVaultPath } from "@/lib/vault";
import { subscribeWikiEmbedTarget } from "@/lib/wiki-embed-refresh";

const ANNOTATION_REF_CACHE_LIMIT = 64;

type WikiAnnotationEmbedProps = {
	vaultPath: string;
	/** Vault-relative wiki target path (NOTES / pdf / paper). */
	targetPath: string;
	annotationId: string;
	/** Notify parent so shared header can pick highlight vs visual icon. */
	onResolvedKind?: (kind: AnnotationRef["kind"]) => void;
	className?: string;
};

type AnnotationLoadState =
	| { kind: "loading" }
	| { kind: "missing" }
	| { kind: "ready"; ref: AnnotationRef };

const annotationRefCache = new Map<string, AnnotationLoadState>();
const annotationRequestCache = new Map<string, Promise<AnnotationLoadState>>();

function annotationCacheKey(
	vaultPath: string,
	targetPath: string,
	annotationId: string,
	revision: number,
): string {
	return JSON.stringify([vaultPath, targetPath, annotationId, revision]);
}

function cachedAnnotationState(key: string): AnnotationLoadState | undefined {
	return annotationRefCache.get(key);
}

function retainAnnotationState(key: string, state: AnnotationLoadState): void {
	if (state.kind === "loading") return;
	annotationRefCache.delete(key);
	annotationRefCache.set(key, state);
	while (annotationRefCache.size > ANNOTATION_REF_CACHE_LIMIT) {
		const oldest = annotationRefCache.keys().next().value;
		if (typeof oldest !== "string") break;
		annotationRefCache.delete(oldest);
	}
}

function loadAnnotationState(
	key: string,
	vaultPath: string,
	targetPath: string,
	annotationId: string,
): Promise<AnnotationLoadState> {
	const cached = cachedAnnotationState(key);
	if (cached && cached.kind !== "loading") return Promise.resolve(cached);
	const pending = annotationRequestCache.get(key);
	if (pending) return pending;

	const paperAbs = paperAbsFromWikiTarget(vaultPath, targetPath);
	const request = lookupAnnotationRef(paperAbs, annotationId, {
		includeImage: true,
	})
		.then(
			(ref): AnnotationLoadState =>
				ref ? { kind: "ready", ref } : { kind: "missing" },
		)
		.then((state) => {
			retainAnnotationState(key, state);
			return state;
		})
		.finally(() => {
			annotationRequestCache.delete(key);
		});
	annotationRequestCache.set(key, request);
	return request;
}

/**
 * Absolute mark files that back one annotation embed. Subscribe to these — not
 * NOTES.md — so editing the hosting note never invalidates the projection.
 */
export function annotationEmbedWatchPaths(
	vaultPath: string,
	targetPath: string,
	annotationId: string,
): string[] {
	const paperAbs = paperAbsFromWikiTarget(vaultPath, targetPath);
	if (!paperAbs || !annotationId) return [];
	return [
		joinVaultPath(joinVaultPath(paperAbs, MARKS_FOLDER), ANNOTATIONS_JSON),
		joinVaultPath(
			joinVaultPath(paperAbs, MARKS_FOLDER),
			`${annotationId}.json`,
		),
		joinVaultPath(
			joinVaultPath(paperAbs, MARKS_FOLDER),
			visualTraceImageAssetRelPath(annotationId, "image/png"),
		),
	];
}

function locationLabelForRef(ref: AnnotationRef): string | null {
	const y = annotationAnchorY(ref.rects);
	const keys = [ref.paperAbsPath];
	for (const key of keys) {
		const label = outlineLocationLabelForPaper(key, {
			page: ref.page,
			...(y != null ? { y } : {}),
		});
		if (label) return label;
	}
	return null;
}

/**
 * Body-only projection of a PDF highlight / visual-trace for `![[target@id]]`.
 * Title + type icon live in the shared embed chrome (wiki-embed-node).
 * Long content scrolls via the outer embed shell (`max-h-96 overflow-auto`).
 */
export const WikiAnnotationEmbed = memo(function WikiAnnotationEmbed({
	vaultPath,
	targetPath,
	annotationId,
	onResolvedKind,
	className,
}: WikiAnnotationEmbedProps) {
	const { t } = useTranslation("editor");
	const [marksRevision, setMarksRevision] = useState(0);
	/** Bumped when PDF viewer fills outline cache — forces location re-read. */
	const [outlineTick, setOutlineTick] = useState(0);
	const requestKey = annotationCacheKey(
		vaultPath,
		targetPath,
		annotationId,
		marksRevision,
	);
	const [load, setLoad] = useState<{
		requestKey: string;
		state: AnnotationLoadState;
	}>(() => ({
		requestKey,
		state: cachedAnnotationState(requestKey) ?? { kind: "loading" },
	}));
	const fallback =
		load.requestKey === requestKey
			? undefined
			: cachedAnnotationState(requestKey);
	const state: AnnotationLoadState =
		load.requestKey === requestKey
			? load.state
			: (fallback ??
				(load.state.kind === "ready" ? load.state : { kind: "loading" }));

	const paperAbs = useMemo(
		() => paperAbsFromWikiTarget(vaultPath, targetPath),
		[vaultPath, targetPath],
	);

	useEffect(() => {
		const paths = annotationEmbedWatchPaths(
			vaultPath,
			targetPath,
			annotationId,
		);
		if (!paths.length) return;
		const unsubs = paths.map((path) =>
			subscribeWikiEmbedTarget(path, () => {
				setMarksRevision((revision) => revision + 1);
			}),
		);
		return () => {
			for (const unsub of unsubs) unsub();
		};
	}, [vaultPath, targetPath, annotationId]);

	useEffect(() => {
		if (!paperAbs) return;
		// Re-render location label when PdfViewer fills the outline cache.
		if (getPaperOutline(paperAbs)?.length) {
			setOutlineTick((n) => n + 1);
		}
		return subscribePaperOutline(paperAbs, () => {
			setOutlineTick((n) => n + 1);
		});
	}, [paperAbs]);

	useEffect(() => {
		const cached = cachedAnnotationState(requestKey);
		if (cached && cached.kind !== "loading") {
			setLoad((previous) =>
				previous.requestKey === requestKey && previous.state === cached
					? previous
					: { requestKey, state: cached },
			);
			return;
		}

		let cancelled = false;
		void loadAnnotationState(
			requestKey,
			vaultPath,
			targetPath,
			annotationId,
		).then((nextState) => {
			if (!cancelled) setLoad({ requestKey, state: nextState });
		});
		return () => {
			cancelled = true;
		};
	}, [requestKey, vaultPath, targetPath, annotationId]);

	const resolvedKind = state.kind === "ready" ? state.ref.kind : null;
	useEffect(() => {
		if (resolvedKind) onResolvedKind?.(resolvedKind);
	}, [resolvedKind, onResolvedKind]);

	// Read outline cache each render; outlineTick invalidates after PDF open.
	void outlineTick;
	const locationLabel =
		state.kind === "ready"
			? locationLabelForRef(state.ref) ||
				t("embed.annotationPage", { page: state.ref.page })
			: null;

	if (state.kind === "loading") {
		return (
			<span
				className={cn(
					"block px-3 py-2 text-muted-foreground text-sm",
					className,
				)}
			>
				{t("embed.loading")}
			</span>
		);
	}

	if (state.kind === "missing") {
		return (
			<span
				className={cn(
					"block px-3 py-2 text-muted-foreground text-sm",
					className,
				)}
			>
				{t("embed.invalidFragment")}
			</span>
		);
	}

	const { ref } = state;
	const color: HighlightColor = ref.color ?? "yellow";
	const hasQuote = Boolean(ref.quote?.trim());
	const hasComment = Boolean(ref.comment?.trim());
	const hasImage = Boolean(ref.kind === "agent-trace" && ref.image?.data);
	const messages = ref.kind === "agent-trace" ? (ref.messages ?? []) : [];

	// Body is not a jump target — open via shared chrome ExternalLink only
	// (same as markdown / attachment embeds) so selection & scroll stay usable.
	return (
		<div className={cn("block w-full px-3 py-2 text-left", className)}>
			{/* Location: outline breadcrumb or page fallback */}
			<div className="flex items-center gap-1.5">
				{ref.kind === "agent-trace" ? null : (
					<span
						className={cn(
							"size-2 shrink-0 rounded-full",
							swatchColorClass(color),
						)}
						aria-hidden
					/>
				)}
				<span
					className="min-w-0 truncate font-medium text-[10px] text-muted-foreground tracking-wide"
					title={locationLabel ?? undefined}
				>
					{locationLabel}
				</span>
			</div>

			{hasQuote ? (
				<blockquote
					className={cn(
						"mt-1.5 border-l-2 pl-2.5 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words",
						swatchBorderClass(color),
					)}
				>
					{ref.quote}
				</blockquote>
			) : null}

			{/* Visual crop — capped so conversation can still scroll below */}
			{hasImage ? (
				<img
					src={`data:${ref.image?.mimeType || "image/png"};base64,${ref.image?.data}`}
					alt=""
					className={cn(
						"max-h-40 w-full rounded border border-border/60 object-contain",
						hasQuote ? "mt-2" : "mt-1.5",
					)}
				/>
			) : null}

			{/* Highlight note: markdown when present, outer embed scrolls */}
			{ref.kind === "highlight" && hasComment ? (
				<div
					className={cn(
						"min-w-0 text-[13px] text-foreground/85 leading-relaxed",
						hasQuote || hasImage ? "mt-2" : "mt-1.5",
					)}
				>
					<MessageResponse className="text-[13px] leading-relaxed">
						{ref.comment}
					</MessageResponse>
				</div>
			) : null}

			{/* Visual: read-only agent transcript with md (no composer) */}
			{ref.kind === "agent-trace" ? (
				<div
					className={cn(
						"space-y-2",
						hasQuote || hasImage || hasComment ? "mt-2" : "mt-1.5",
					)}
				>
					{hasComment && !messages.some((m) => m.content === ref.comment) ? (
						<div className="min-w-0 text-[13px] text-foreground/85 leading-relaxed">
							<MessageResponse className="text-[13px] leading-relaxed">
								{ref.comment}
							</MessageResponse>
						</div>
					) : null}
					{messages.length === 0 ? (
						<p className="text-muted-foreground text-xs">
							{t("embed.annotationNoTranscript")}
						</p>
					) : (
						messages.map((m) => (
							<div
								key={m.id}
								className={cn(
									"min-w-0 rounded-md px-2.5 py-1.5 text-[13px] leading-relaxed",
									m.role === "user"
										? "bg-primary/10 text-foreground/90"
										: "bg-muted/70 text-foreground/85",
								)}
							>
								<div className="mb-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
									{m.role === "user"
										? t("embed.annotationRoleUser")
										: t("embed.annotationRoleAssistant")}
								</div>
								<MessageResponse className="text-[13px] leading-relaxed">
									{m.content}
								</MessageResponse>
							</div>
						))
					)}
				</div>
			) : null}
		</div>
	);
});
