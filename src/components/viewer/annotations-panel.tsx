import {
	ChevronDown,
	ChevronUp,
	MessageCircle,
	MessageSquareText,
	Pencil,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PaneHeader } from "@/components/layout/shell/pane-header";
import { Button } from "@/components/ui/button";
import {
	type HighlightColor,
	swatchBorderClass,
	swatchColorClass,
} from "@/lib/pdf-highlight/palette";
import { cn } from "@/lib/utils";

export type AnnotationRow = {
	id: string;
	page: number;
	quote: string;
	comment: string;
	color: HighlightColor;
};

/** PDF selection-ask conversation for the annotations sidebar. */
export type AskRow = {
	id: string;
	page: number;
	/** First user question summary (梗概). */
	preview: string;
	messageCount: number;
};

type AnnotationsPanelProps = {
	items: AnnotationRow[];
	/** PDF ask threads with at least one user message. */
	asks?: AskRow[];
	onJump: (id: string) => void;
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
	onJumpAsk?: (id: string) => void;
	onDeleteAsk?: (id: string) => void;
	/** Collapse the right sidebar (close the panel). */
	onClose?: () => void;
	className?: string;
};

/** Character threshold: longer notes get clamp + expand control. */
const COMMENT_COLLAPSE_CHARS = 120;
const COMMENT_CLAMP_CLASS = "line-clamp-3";

/**
 * Right-sidebar overview of highlights/annotations **and** PDF ask threads
 * on the active paper. Click to jump; long notes clamp with an expand control.
 */
export function AnnotationsPanel({
	items,
	asks = [],
	onJump,
	onEdit,
	onDelete,
	onJumpAsk,
	onDeleteAsk,
	onClose,
	className,
}: AnnotationsPanelProps) {
	const { t } = useTranslation("viewer");
	const total = items.length + asks.length;

	return (
		<section
			className={cn(
				"flex h-full min-h-0 flex-col overflow-hidden bg-background",
				className,
			)}
			aria-label={t("annotations.panelAria")}
		>
			<PaneHeader
				trailing={
					<>
						{total > 0 ? (
							<span className="min-w-5 rounded-full bg-muted px-1.5 py-0.5 text-center font-medium text-[11px] text-muted-foreground tabular-nums">
								{total}
							</span>
						) : null}
						{onClose ? (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="size-6 text-muted-foreground hover:text-foreground"
								aria-label={t("annotations.close")}
								onClick={onClose}
							>
								<X className="size-4" />
							</Button>
						) : null}
					</>
				}
			>
				<MessageSquareText
					className="size-4 text-muted-foreground"
					aria-hidden
				/>
				<span className="font-medium text-sm">{t("annotations.title")}</span>
			</PaneHeader>

			{total === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
					<div className="flex size-12 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground">
						<MessageSquareText className="size-5" aria-hidden />
					</div>
					<p className="max-w-[15rem] text-muted-foreground text-xs leading-relaxed">
						{t("annotations.empty")}
					</p>
				</div>
			) : (
				<div className="agentero-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
					{items.length > 0 ? (
						<section aria-label={t("annotations.sectionHighlights")}>
							{asks.length > 0 ? (
								<h3 className="mb-1.5 px-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
									{t("annotations.sectionHighlights")}
								</h3>
							) : null}
							<ul className="space-y-1">
								{items.map((a) => (
									<li key={a.id}>
										<AnnotationCard
											item={a}
											onJump={onJump}
											onEdit={onEdit}
											onDelete={onDelete}
										/>
									</li>
								))}
							</ul>
						</section>
					) : null}

					{asks.length > 0 ? (
						<section aria-label={t("annotations.sectionAsks")}>
							{items.length > 0 ? (
								<h3 className="mb-1.5 px-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
									{t("annotations.sectionAsks")}
								</h3>
							) : null}
							<ul className="space-y-1">
								{asks.map((ask) => (
									<li key={ask.id}>
										<AskCard
											item={ask}
											onJump={onJumpAsk}
											onDelete={onDeleteAsk}
										/>
									</li>
								))}
							</ul>
						</section>
					) : null}
				</div>
			)}
		</section>
	);
}

function AnnotationCard({
	item: a,
	onJump,
	onEdit,
	onDelete,
}: {
	item: AnnotationRow;
	onJump: (id: string) => void;
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const { t } = useTranslation("viewer");

	return (
		<div className="group relative rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border/60 hover:bg-muted/40">
			{/* biome-ignore lint/a11y/useSemanticElements: a native <button> cannot wrap the blockquote/p flow content */}
			<div
				role="button"
				tabIndex={0}
				className="block w-full cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
				onClick={() => onJump(a.id)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onJump(a.id);
					}
				}}
			>
				<div className="flex items-center gap-1.5">
					<span
						className={cn(
							"size-2 shrink-0 rounded-full",
							swatchColorClass(a.color),
						)}
						aria-hidden
					/>
					<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider tabular-nums">
						{t("annotations.pageLabel", { page: a.page })}
					</span>
				</div>
				<blockquote
					className={cn(
						"mt-1.5 line-clamp-2 border-l-2 pl-2.5 text-xs leading-relaxed",
						swatchBorderClass(a.color),
						a.comment ? "text-muted-foreground/90" : "text-muted-foreground",
					)}
				>
					{a.quote}
				</blockquote>
				{a.comment ? (
					<div className="mt-2">
						<ExpandableText
							text={a.comment}
							className="whitespace-pre-wrap break-words text-[13px] text-foreground/80 leading-relaxed"
						/>
					</div>
				) : null}
			</div>
			<div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-lg bg-background/80 p-0.5 opacity-0 shadow-sm ring-1 ring-border/60 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-6 text-muted-foreground hover:text-foreground"
					aria-label={t("selection.editComment")}
					onClick={() => onEdit(a.id)}
				>
					<Pencil className="size-3.5" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-6 text-muted-foreground hover:text-destructive"
					aria-label={t("annotations.delete")}
					onClick={() => onDelete(a.id)}
				>
					<Trash2 className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}

function AskCard({
	item: ask,
	onJump,
	onDelete,
}: {
	item: AskRow;
	onJump?: (id: string) => void;
	onDelete?: (id: string) => void;
}) {
	const { t } = useTranslation("viewer");

	return (
		<div className="group relative rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border/60 hover:bg-muted/40">
			{/* biome-ignore lint/a11y/useSemanticElements: role=button wrapper for card jump */}
			<div
				role="button"
				tabIndex={0}
				className="block w-full cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
				onClick={() => onJump?.(ask.id)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onJump?.(ask.id);
					}
				}}
			>
				<div className="flex items-center gap-1.5">
					<MessageCircle
						className="size-3 shrink-0 text-muted-foreground"
						aria-hidden
					/>
					<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider tabular-nums">
						{t("annotations.pageLabel", { page: ask.page })}
					</span>
					{ask.messageCount > 0 ? (
						<span className="text-[10px] text-muted-foreground/80 tabular-nums">
							{t("annotations.askTurns", { count: ask.messageCount })}
						</span>
					) : null}
				</div>
				<p className="mt-1.5 line-clamp-2 text-[13px] text-foreground leading-relaxed">
					{ask.preview}
				</p>
			</div>
			{onDelete ? (
				<div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-lg bg-background/80 p-0.5 opacity-0 shadow-sm ring-1 ring-border/60 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="size-6 text-muted-foreground hover:text-destructive"
						aria-label={t("annotations.deleteAsk")}
						onClick={() => onDelete(ask.id)}
					>
						<Trash2 className="size-3.5" />
					</Button>
				</div>
			) : null}
		</div>
	);
}

/**
 * Clamp long text to a few lines; show a chevron control to expand/collapse.
 * Short notes render in full with no control.
 */
function ExpandableText({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	const { t } = useTranslation("viewer");
	const [expanded, setExpanded] = useState(false);
	const collapsible =
		text.length > COMMENT_COLLAPSE_CHARS || text.split("\n").length > 3;

	if (!collapsible) {
		return <p className={className}>{text}</p>;
	}

	return (
		<div className="relative">
			<p className={cn(className, !expanded && COMMENT_CLAMP_CLASS)}>{text}</p>
			<button
				type="button"
				className={cn(
					"mt-0.5 inline-flex size-6 items-center justify-center rounded-md",
					"text-muted-foreground transition-colors",
					"hover:bg-muted hover:text-foreground",
					"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				)}
				aria-expanded={expanded}
				aria-label={
					expanded ? t("annotations.collapseNote") : t("annotations.expandNote")
				}
				title={
					expanded ? t("annotations.collapseNote") : t("annotations.expandNote")
				}
				onClick={(e) => {
					e.stopPropagation();
					setExpanded((v) => !v);
				}}
			>
				{expanded ? (
					<ChevronUp className="size-3.5" aria-hidden />
				) : (
					<ChevronDown className="size-3.5" aria-hidden />
				)}
			</button>
		</div>
	);
}
