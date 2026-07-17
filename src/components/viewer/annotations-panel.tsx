import { MessageSquareText, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	type HighlightColor,
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
 * Each card shows a color accent, the highlighted quote, and the note (when
 * present); click to jump, hover to edit the note or delete.
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
			<header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
				<MessageSquareText
					className="size-4 text-muted-foreground"
					aria-hidden
				/>
				<span className="font-medium text-foreground text-sm">
					{t("annotations.title")}
				</span>
				{items.length > 0 ? (
					<span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-medium text-[11px] text-muted-foreground tabular-nums">
						{items.length}
					</span>
				) : null}
			</header>

			{items.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
					<div className="flex size-11 items-center justify-center rounded-full bg-muted/60">
						<MessageSquareText
							className="size-5 text-muted-foreground"
							aria-hidden
						/>
					</div>
					<p className="text-muted-foreground text-xs leading-relaxed">
						{t("annotations.empty")}
					</p>
				</div>
			) : (
				<ul className="agentero-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
					{items.map((a) => (
						<li key={a.id}>
							<div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card transition-all hover:border-border hover:shadow-sm">
								<span
									className={cn(
										"absolute inset-y-0 left-0 w-1",
										swatchColorClass(a.color),
									)}
									aria-hidden
								/>
								{/* biome-ignore lint/a11y/useSemanticElements: a native <button> cannot wrap the blockquote/p flow content, so a div with role/button semantics is used */}
								<div
									role="button"
									tabIndex={0}
									className="block w-full cursor-pointer rounded-xl py-2 pr-2 pl-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
									onClick={() => onJump(a.id)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											onJump(a.id);
										}
									}}
								>
									<span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tabular-nums tracking-wide">
										p.{a.page}
									</span>
									<p className="mt-1.5 line-clamp-2 text-muted-foreground text-xs italic leading-snug">
										{a.quote}
									</p>
									{a.comment ? (
										<p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] text-foreground leading-snug">
											{a.comment}
										</p>
									) : null}
								</div>
								<div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/90 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
