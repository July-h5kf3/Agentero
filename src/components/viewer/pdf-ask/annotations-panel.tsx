import { NotebookPen, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	HIGHLIGHT_COLORS,
	type HighlightColor,
	normalizeHighlightColor,
	swatchColorClass,
} from "@/lib/pdf-highlight/palette";
import type { PdfHighlight } from "@/lib/pdf-highlight/types";
import { cn } from "@/lib/utils";

type PdfAnnotationsPanelProps = {
	highlights: PdfHighlight[];
	/** Highlight currently flashed (e.g. just jumped to). */
	activeId?: string | null;
	onJump: (h: PdfHighlight) => void;
	onRecolor: (id: string, color: HighlightColor) => void;
	onDelete: (id: string) => void;
	/** Append every highlight quote to the paper's NOTES.md. */
	onExport: () => void;
	onClose: () => void;
};

/**
 * Right-side flyout listing every highlight of the open paper (reading order).
 * Click to jump, hover to recolor / delete, header to export all to NOTES.md.
 */
export function PdfAnnotationsPanel({
	highlights,
	activeId,
	onJump,
	onRecolor,
	onDelete,
	onExport,
	onClose,
}: PdfAnnotationsPanelProps) {
	const { t } = useTranslation("viewer");
	const sorted = [...highlights].sort(
		(a, b) => a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0),
	);

	return (
		<aside className="absolute inset-y-0 right-0 z-20 flex w-72 flex-col border-l bg-background/95 pt-11 backdrop-blur-sm">
			<div className="flex shrink-0 items-center justify-between gap-1 border-b px-2 py-1.5">
				<span className="font-medium text-xs">
					{t("annotations.title")} ({highlights.length})
				</span>
				<div className="flex items-center gap-0.5">
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						aria-label={t("annotations.export")}
						disabled={highlights.length === 0}
						onClick={onExport}
					>
						<NotebookPen className="size-3.5" />
					</Button>
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						aria-label={t("annotations.close")}
						onClick={onClose}
					>
						<X className="size-3.5" />
					</Button>
				</div>
			</div>
			{highlights.length === 0 ? (
				<div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-muted-foreground text-xs">
					{t("annotations.empty")}
				</div>
			) : (
				<ul className="agentero-scroll min-h-0 flex-1 divide-y overflow-y-auto">
					{sorted.map((h) => {
						const color = normalizeHighlightColor(h.color);
						return (
							<li
								key={h.id}
								className={cn(
									"group px-2 py-2",
									activeId === h.id ? "bg-muted/60" : "hover:bg-muted/40",
								)}
							>
								<button
									type="button"
									className="block w-full text-left"
									onClick={() => onJump(h)}
								>
									<span className="flex items-start gap-2">
										<span
											className={cn(
												"mt-1 size-2.5 shrink-0 rounded-full",
												swatchColorClass(color),
											)}
										/>
										<span className="min-w-0 flex-1">
											<span className="line-clamp-2 text-foreground text-xs">
												{h.quote}
											</span>
											<span className="mt-0.5 block text-[10px] text-muted-foreground">
												p.{h.page}
											</span>
										</span>
									</span>
								</button>
								<div className="mt-1.5 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
									{HIGHLIGHT_COLORS.map((c) => (
										<button
											key={c}
											type="button"
											aria-label={c}
											className={cn(
												"size-3.5 rounded-full ring-1 ring-black/15 dark:ring-white/25",
												swatchColorClass(c),
												c === color && "ring-2 ring-foreground/60",
											)}
											onClick={() => onRecolor(h.id, c)}
										/>
									))}
									<Button
										type="button"
										size="icon-xs"
										variant="ghost"
										className="ml-auto size-6 text-destructive"
										aria-label={t("annotations.delete")}
										onClick={() => onDelete(h.id)}
									>
										<Trash2 className="size-3.5" />
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</aside>
	);
}
