import { MessageSquareText, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

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

type AnnotationsPanelProps = {
	items: AnnotationRow[];
	onJump: (id: string) => void;
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
	className?: string;
};

/**
 * Right-sidebar overview of every highlight/annotation on the active paper.
 * Each card ties the highlight color to the quoted text (a colored rule); the
 * note (when present) reads as the primary line. Click to jump, hover to edit
 * the note or delete.
 */
export function AnnotationsPanel({
	items,
	onJump,
	onEdit,
	onDelete,
	className,
}: AnnotationsPanelProps) {
	const { t } = useTranslation("viewer");

	return (
		<section
			className={cn(
				"flex h-full min-h-0 flex-col overflow-hidden bg-background",
				className,
			)}
			aria-label={t("annotations.panelAria")}
		>
			<header className="flex shrink-0 items-center gap-2 border-b px-3.5 py-3">
				<MessageSquareText
					className="size-4 text-muted-foreground"
					aria-hidden
				/>
				<span className="font-semibold text-foreground text-sm tracking-tight">
					{t("annotations.title")}
				</span>
				{items.length > 0 ? (
					<span className="ml-auto min-w-5 rounded-full bg-muted px-1.5 py-0.5 text-center font-medium text-[11px] text-muted-foreground tabular-nums">
						{items.length}
					</span>
				) : null}
			</header>

			{items.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
					<div className="flex size-12 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground">
						<MessageSquareText className="size-5" aria-hidden />
					</div>
					<p className="max-w-[15rem] text-muted-foreground text-xs leading-relaxed">
						{t("annotations.empty")}
					</p>
				</div>
			) : (
				<ul className="agentero-scroll min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
					{items.map((a) => (
						<li key={a.id}>
							<div className="group relative rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border/60 hover:bg-muted/40">
								{/* biome-ignore lint/a11y/useSemanticElements: a native <button> cannot wrap the blockquote/p flow content, so a div with role/button semantics is used */}
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
											a.comment
												? "text-muted-foreground"
												: "text-foreground/90",
										)}
									>
										{a.quote}
									</blockquote>
									{a.comment ? (
										<p className="mt-2 whitespace-pre-wrap break-words text-[13px] text-foreground leading-relaxed">
											{a.comment}
										</p>
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
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
