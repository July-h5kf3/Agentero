import { MessageSquareText, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AnnotationRow = {
	id: string;
	page: number;
	quote: string;
	comment: string;
};

type AnnotationsPanelProps = {
	items: AnnotationRow[];
	onJump: (id: string) => void;
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
	className?: string;
};

/** Right-sidebar list of the active paper's annotations. */
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
			className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}
			aria-label={t("annotations.panelAria")}
		>
			<div className="flex items-center gap-2 border-b px-3 py-2 text-muted-foreground text-xs">
				<MessageSquareText className="size-3.5" aria-hidden />
				{t("annotations.title")}
			</div>
			{items.length === 0 ? (
				<p className="px-3 py-6 text-center text-muted-foreground text-xs">
					{t("annotations.empty")}
				</p>
			) : (
				<ul className="min-h-0 flex-1 overflow-y-auto p-2">
					{items.map((a) => (
						<li key={a.id} className="mb-2">
							<div className="group rounded-lg border border-border/70 p-2 hover:border-border">
								{/* biome-ignore lint/a11y/useSemanticElements: a native <button> cannot wrap the blockquote/p flow content, so a div with role/button semantics is used */}
								<div
									role="button"
									tabIndex={0}
									className="block w-full cursor-pointer text-left"
									onClick={() => onJump(a.id)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											onJump(a.id);
										}
									}}
								>
									<span className="text-[10px] text-muted-foreground uppercase">
										p.{a.page}
									</span>
									<blockquote className="mt-0.5 line-clamp-2 border-amber-400 border-l-2 pl-2 text-muted-foreground text-xs">
										{a.quote}
									</blockquote>
									<p className="mt-1 whitespace-pre-wrap text-foreground text-sm">
										{a.comment}
									</p>
								</div>
								<div className="mt-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={t("selection.editComment")}
										onClick={() => onEdit(a.id)}
									>
										<Pencil className="size-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
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
