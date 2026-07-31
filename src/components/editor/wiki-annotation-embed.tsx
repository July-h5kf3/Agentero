"use client";

import { ChevronDown, ChevronUp, ScanSearch } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/core/utils";
import {
	type AnnotationRef,
	lookupAnnotationRef,
	paperAbsFromWikiTarget,
} from "@/lib/pdf/annotation-ref";
import {
	type HighlightColor,
	swatchBorderClass,
	swatchColorClass,
} from "@/lib/pdf/highlight/palette";
import { ANNOTATIONS_JSON, MARKS_FOLDER } from "@/lib/pdf/selection/marks-io";
import { joinVaultPath } from "@/lib/vault";
import { subscribeWikiEmbedTarget } from "@/lib/wiki-embed-refresh";

const COMMENT_COLLAPSE_CHARS = 120;
const ANNOTATION_REF_CACHE_LIMIT = 64;

type WikiAnnotationEmbedProps = {
	vaultPath: string;
	/** Vault-relative wiki target path (NOTES / pdf / paper). */
	targetPath: string;
	annotationId: string;
	/** Display alias from `![[…|alias]]`. */
	alias?: string | null;
	onOpen: () => void;
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
	const request = lookupAnnotationRef(paperAbs, annotationId)
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
	];
}

/**
 * Read-only projection of a PDF highlight or visual-trace for `![[target@id]]`.
 * Uses a module-level cache so parent remounts / selection toggles do not flash
 * a loading state (same pattern as image/PDF attachment embeds).
 */
export const WikiAnnotationEmbed = memo(function WikiAnnotationEmbed({
	vaultPath,
	targetPath,
	annotationId,
	alias,
	onOpen,
	className,
}: WikiAnnotationEmbedProps) {
	const { t } = useTranslation("editor");
	const [marksRevision, setMarksRevision] = useState(0);
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
	// Prefer: exact key → cache for new key → previous ready card (SWR) → loading.
	const state: AnnotationLoadState =
		load.requestKey === requestKey
			? load.state
			: (fallback ??
				(load.state.kind === "ready" ? load.state : { kind: "loading" }));
	const [expanded, setExpanded] = useState(false);

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
		const cached = cachedAnnotationState(requestKey);
		if (cached && cached.kind !== "loading") {
			setLoad((previous) =>
				previous.requestKey === requestKey && previous.state === cached
					? previous
					: { requestKey, state: cached },
			);
			return;
		}

		// Stale-while-revalidate: keep the previous ready card visible while the
		// next revision loads so marks updates do not flash "loading".
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

	// Only the very first load (no cached/stale card) shows a loading label.
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
	const body = ref.comment || ref.quote;
	const long = body.length > COMMENT_COLLAPSE_CHARS;
	const title =
		alias?.trim() ||
		(ref.kind === "agent-trace"
			? t("embed.annotationVisual")
			: t("embed.annotationHighlight"));

	return (
		// biome-ignore lint/a11y/useSemanticElements: card wraps blockquote; native button cannot
		<div
			role="button"
			tabIndex={0}
			className={cn(
				"block w-full cursor-pointer rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
				className,
			)}
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onOpen();
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onOpen();
				}
			}}
		>
			<div className="flex items-center gap-1.5">
				{ref.kind === "agent-trace" ? (
					<ScanSearch
						className="size-3.5 shrink-0 text-muted-foreground"
						aria-hidden
					/>
				) : (
					<span
						className={cn(
							"size-2 shrink-0 rounded-full",
							swatchColorClass(color),
						)}
						aria-hidden
					/>
				)}
				<span className="min-w-0 truncate font-medium text-[11px] text-foreground/90">
					{title}
				</span>
				<span className="shrink-0 font-medium text-[10px] text-muted-foreground uppercase tracking-wider tabular-nums">
					{t("embed.annotationPage", { page: ref.page })}
				</span>
			</div>

			{ref.quote ? (
				<blockquote
					className={cn(
						"mt-1.5 line-clamp-3 border-l-2 pl-2.5 text-xs leading-relaxed text-muted-foreground",
						swatchBorderClass(color),
					)}
				>
					{ref.quote}
				</blockquote>
			) : null}

			{ref.comment ? (
				<div className="mt-2">
					<p
						className={cn(
							"whitespace-pre-wrap break-words text-[13px] text-foreground/85 leading-relaxed",
							long && !expanded && "line-clamp-3",
						)}
					>
						{ref.comment}
					</p>
					{long ? (
						<button
							type="button"
							className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								setExpanded((v) => !v);
							}}
						>
							{expanded ? (
								<>
									<ChevronUp className="size-3" aria-hidden />
									{t("embed.annotationCollapse")}
								</>
							) : (
								<>
									<ChevronDown className="size-3" aria-hidden />
									{t("embed.annotationExpand")}
								</>
							)}
						</button>
					) : null}
				</div>
			) : null}

			{ref.kind === "agent-trace" && ref.image?.data ? (
				<img
					src={`data:${ref.image.mimeType || "image/png"};base64,${ref.image.data}`}
					alt=""
					className="mt-2 max-h-28 rounded border border-border/60 object-contain"
				/>
			) : null}
		</div>
	);
});
