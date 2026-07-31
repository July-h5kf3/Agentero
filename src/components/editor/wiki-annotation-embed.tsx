"use client";

import { ChevronDown, ChevronUp, ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";
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

const COMMENT_COLLAPSE_CHARS = 120;

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

/**
 * Read-only projection of a PDF highlight or visual-trace for `![[target@id]]`.
 * Quote/comment body is never editable here — source of truth stays in marks/.
 */
export function WikiAnnotationEmbed({
	vaultPath,
	targetPath,
	annotationId,
	alias,
	onOpen,
	className,
}: WikiAnnotationEmbedProps) {
	const { t } = useTranslation("editor");
	const [state, setState] = useState<
		| { kind: "loading" }
		| { kind: "missing" }
		| { kind: "ready"; ref: AnnotationRef }
	>({ kind: "loading" });
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const paperAbs = paperAbsFromWikiTarget(vaultPath, targetPath);
		void lookupAnnotationRef(paperAbs, annotationId).then((ref) => {
			if (cancelled) return;
			setState(ref ? { kind: "ready", ref } : { kind: "missing" });
		});
		return () => {
			cancelled = true;
		};
	}, [vaultPath, targetPath, annotationId]);

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
}
