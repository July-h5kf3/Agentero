import { useTranslation } from "react-i18next";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PdfAskThreadSummary } from "@/lib/pdf-ask/types";
import { cn } from "@/lib/utils";

type AskGutterProps = {
	/** Summaries for this page only */
	items: PdfAskThreadSummary[];
	/** Page pixel height for y mapping */
	pageHeight: number;
	activeId: string | null;
	onOpen: (id: string) => void;
};

/** De-overlap pills vertically on one page. */
function layoutTops(
	items: PdfAskThreadSummary[],
	pageHeight: number,
	pill = 18,
	gap = 4,
): number[] {
	const sorted = items
		.map((it, i) => ({ i, y: it.y * pageHeight }))
		.sort((a, b) => a.y - b.y);
	const tops = new Array<number>(items.length).fill(0);
	let lastBottom = -Infinity;
	for (const { i, y } of sorted) {
		let top = Math.max(0, y - pill / 2);
		if (top < lastBottom + gap) top = lastBottom + gap;
		tops[i] = top;
		lastBottom = top + pill;
	}
	return tops;
}

export function AskGutter({
	items,
	pageHeight,
	activeId,
	onOpen,
}: AskGutterProps) {
	const { t } = useTranslation("viewer");
	if (!items.length || pageHeight <= 0) return null;

	const tops = layoutTops(items, pageHeight);

	return (
		<TooltipProvider delayDuration={200}>
			<div
				className="pointer-events-none absolute top-0 right-0 z-10 h-full w-5 translate-x-full"
				aria-hidden={false}
			>
				{items.map((item, idx) => (
					<Tooltip key={item.id}>
						<TooltipTrigger asChild>
							<button
								type="button"
								className={cn(
									"pointer-events-auto absolute right-1 size-3.5 rounded-full border shadow-sm transition-transform hover:scale-110",
									item.status === "ended"
										? "border-amber-600/40 bg-amber-400/90 dark:bg-amber-500/80"
										: "border-primary/40 bg-primary/80",
									activeId === item.id && "ring-2 ring-ring ring-offset-1",
								)}
								style={{ top: tops[idx] }}
								aria-label={t("pdfAsk.pillAria", { preview: item.preview })}
								onClick={(e) => {
									e.stopPropagation();
									onOpen(item.id);
								}}
							/>
						</TooltipTrigger>
						<TooltipContent side="left" className="max-w-56 text-xs">
							{item.preview || t("pdfAsk.pillFallback")}
						</TooltipContent>
					</Tooltip>
				))}
			</div>
		</TooltipProvider>
	);
}
