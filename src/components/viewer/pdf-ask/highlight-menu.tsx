import { Copy, MessageSquare, NotebookPen, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type HighlightMenuProps = {
	screen: { x: number; y: number };
	onCopy: () => void;
	onNote: () => void;
	onAsk: () => void;
	onDelete: () => void;
};

const BAR_W = 124;
const BAR_H = 28;

/**
 * Compact floating toolbar when clicking an existing highlight:
 * Copy / Annotate / Ask + delete (icon-only).
 */
export function HighlightMenu({
	screen,
	onCopy,
	onNote,
	onAsk,
	onDelete,
}: HighlightMenuProps) {
	const { t } = useTranslation("viewer");

	const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
	const vh = typeof window !== "undefined" ? window.innerHeight : 800;
	let left = screen.x - BAR_W / 2;
	left = Math.min(Math.max(12, left), vw - BAR_W - 12);
	let top = screen.y + 10;
	if (top + BAR_H > vh - 12) {
		top = Math.max(12, screen.y - BAR_H - 8);
	}

	const iconBtn = "size-6 shrink-0 text-muted-foreground hover:text-foreground";

	return (
		<div
			className={cn(
				"fixed z-50 flex h-7 items-center gap-px rounded-lg border border-border/80 bg-background px-0.5 shadow-lg ring-1 ring-black/5 dark:ring-white/10",
			)}
			style={{ left, top }}
			role="toolbar"
			aria-label={t("selection.highlightMenuLabel")}
			onMouseDown={(e) => e.stopPropagation()}
		>
			<TooltipProvider delayDuration={200}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className={iconBtn}
							aria-label={t("selection.copy")}
							onClick={onCopy}
						>
							<Copy className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">{t("selection.copy")}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className={iconBtn}
							aria-label={t("selection.note")}
							onClick={onNote}
						>
							<NotebookPen className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">{t("selection.note")}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className={iconBtn}
							aria-label={t("selection.ask")}
							onClick={onAsk}
						>
							<MessageSquare className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">{t("selection.ask")}</TooltipContent>
				</Tooltip>
				<div className="mx-px h-3.5 w-px shrink-0 bg-border" />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
							aria-label={t("selection.removeHighlight")}
							onClick={onDelete}
						>
							<Trash2 className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">
						{t("selection.removeHighlight")}
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	);
}
