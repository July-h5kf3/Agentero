import {
	Check,
	Copy,
	Languages,
	MessageSquare,
	NotebookPen,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	HIGHLIGHT_COLORS,
	type HighlightColor,
	swatchColorClass,
} from "@/lib/pdf-highlight/palette";
import { cn } from "@/lib/utils";

type SelectionMenuProps = {
	/** Screen point near the top-center of the selection (toolbar anchor) */
	screen: { x: number; y: number };
	/** Bottom-right of the selection (for the “copied” chip) */
	selectionEnd: { x: number; y: number };
	/** Create a highlight in the chosen color */
	onHighlight: (color: HighlightColor) => void;
	/** Copy the selected text to the clipboard */
	onCopy: () => void;
	/** Annotate: create a highlight and open its inline note editor */
	onNote: () => void;
	onAsk: () => void;
	onTranslate: () => void;
	/** Dismiss the menu without acting */
	onClose: () => void;
};

const BAR_W = 300;
const BAR_H = 40;
const CHIP_W = 72;
const CHIP_H = 28;

/**
 * Floating action bar shown next to a text selection: a row of color swatches
 * (highlight), then Copy / Annotate / Ask / Translate. Copy shows a brief
 * neutral chip at the selection’s bottom-right.
 */
export function SelectionMenu({
	screen,
	selectionEnd,
	onHighlight,
	onCopy,
	onNote,
	onAsk,
	onTranslate,
	onClose,
}: SelectionMenuProps) {
	const { t } = useTranslation("viewer");
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
	const vh = typeof window !== "undefined" ? window.innerHeight : 800;

	let left = screen.x - BAR_W / 2;
	left = Math.min(Math.max(12, left), vw - BAR_W - 12);
	// Prefer just above the selection; flip below if near the top edge
	let top = screen.y - BAR_H - 10;
	if (top < 12) top = Math.min(vh - BAR_H - 12, screen.y + 18);

	// Chip sits just below and left-aligned to the selection’s bottom-right corner
	let chipLeft = selectionEnd.x - CHIP_W;
	chipLeft = Math.min(Math.max(12, chipLeft), vw - CHIP_W - 12);
	let chipTop = selectionEnd.y + 6;
	if (chipTop + CHIP_H > vh - 12) {
		chipTop = Math.max(12, selectionEnd.y - CHIP_H - 6);
	}

	const flashCopied = useCallback(() => {
		setCopied(true);
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			setCopied(false);
			onClose();
		}, 1000);
	}, [onClose]);

	const handleCopy = useCallback(() => {
		onCopy();
		flashCopied();
	}, [onCopy, flashCopied]);

	// Annotate opens the inline note editor in the viewer, so just close the menu.
	const handleNote = useCallback(() => {
		onNote();
		onClose();
	}, [onNote, onClose]);

	const colorLabel = (c: HighlightColor): string => {
		switch (c) {
			case "yellow":
				return t("selection.color.yellow");
			case "green":
				return t("selection.color.green");
			case "blue":
				return t("selection.color.blue");
			case "pink":
				return t("selection.color.pink");
			default:
				return t("selection.color.purple");
		}
	};

	if (copied) {
		return (
			<div
				className={cn(
					"fixed z-50 flex h-7 items-center gap-1 rounded-md border border-border/80 bg-background px-2 text-foreground text-xs shadow-md ring-1 ring-black/5 dark:ring-white/10",
				)}
				style={{ left: chipLeft, top: chipTop }}
				role="status"
				aria-live="polite"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<Check className="size-3.5 text-muted-foreground" aria-hidden />
				<span>{t("selection.copied")}</span>
			</div>
		);
	}

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
				{HIGHLIGHT_COLORS.map((c) => (
					<Tooltip key={c}>
						<TooltipTrigger asChild>
							<button
								type="button"
								aria-label={colorLabel(c)}
								className={cn(
									"mx-0.5 size-4 shrink-0 rounded-full ring-1 ring-black/15 transition hover:scale-110 dark:ring-white/25",
									swatchColorClass(c),
								)}
								onClick={() => onHighlight(c)}
							/>
						</TooltipTrigger>
						<TooltipContent side="top">{colorLabel(c)}</TooltipContent>
					</Tooltip>
				))}
				<div className="mx-1 h-5 w-px shrink-0 bg-border" />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t("selection.copy")}
							onClick={handleCopy}
						>
							<Copy className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">{t("selection.copy")}</TooltipContent>
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
