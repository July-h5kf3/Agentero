import {
	Highlighter,
	Languages,
	MessageSquare,
	NotebookPen,
} from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SelectionMenuProps = {
	/** Screen point near the end of the selection */
	screen: { x: number; y: number };
	onHighlight: () => void;
	onNote: () => void;
	onAsk: () => void;
	onTranslate: () => void;
	/** Dismiss the menu without acting */
	onClose: () => void;
};

const BAR_W = 176;
const BAR_H = 40;

/**
 * Floating action bar shown next to a text selection.
 * Highlight / Note / Ask / Translate. Note shows a brief inline confirmation.
 */
export function SelectionMenu({
	screen,
	onHighlight,
	onNote,
	onAsk,
	onTranslate,
	onClose,
}: SelectionMenuProps) {
	const { t } = useTranslation("viewer");

	const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
	const vh = typeof window !== "undefined" ? window.innerHeight : 800;
	let left = screen.x - BAR_W / 2;
	left = Math.min(Math.max(12, left), vw - BAR_W - 12);
	// Prefer just above the selection; flip below if near the top edge
	let top = screen.y - BAR_H - 10;
	if (top < 12) top = Math.min(vh - BAR_H - 12, screen.y + 18);

	const handleNote = useCallback(() => {
		onNote();
		onClose();
	}, [onNote, onClose]);

	return (
		<div
			className={cn(
				"fixed z-50 flex h-10 items-center gap-0.5 rounded-xl border border-border/80 bg-background px-1 shadow-2xl ring-1 ring-black/5 dark:ring-white/10",
			)}
			style={{ left, top }}
			role="toolbar"
			aria-label={t("selection.menuLabel")}
			onMouseDown={(e) => e.stopPropagation()}
		>
			<TooltipProvider delayDuration={200}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t("selection.highlight")}
							onClick={onHighlight}
						>
							<Highlighter className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">{t("selection.highlight")}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t("selection.note")}
							onClick={handleNote}
						>
							<NotebookPen className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">{t("selection.note")}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t("selection.ask")}
							onClick={onAsk}
						>
							<MessageSquare className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">{t("selection.ask")}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t("selection.translate")}
							onClick={onTranslate}
						>
							<Languages className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">{t("selection.translate")}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	);
}
