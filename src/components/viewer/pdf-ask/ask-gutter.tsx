import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { PdfAskThreadSummary } from "@/lib/pdf-ask/types";
import { cn } from "@/lib/utils";

type AskGutterProps = {
	/** Summaries for this page only */
	items: PdfAskThreadSummary[];
	activeId: string | null;
	/** Hover / click opens the dialog */
	onOpen: (id: string) => void;
	/** Leave pin — parent schedules delayed hide */
	onLeave?: () => void;
	/** Enter pin — cancel pending hide */
	onEnter?: () => void;
};

const PILL = 20;
const GAP = 4;

/**
 * Nudge overlapping pins so they stay clickable while staying near anchors.
 * Positions are page-normalized 0–1; page size used only for collision in px.
 */
function layoutPins(
	items: PdfAskThreadSummary[],
	pageW: number,
	pageH: number,
): Array<{ id: string; leftPct: number; topPct: number }> {
	const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
	const placed: Array<{ id: string; x: number; y: number }> = [];

	for (const it of sorted) {
		let x = it.x;
		let y = it.y;
		let guard = 0;
		while (guard < 12) {
			let hit = false;
			for (const p of placed) {
				const dx = (x - p.x) * pageW;
				const dy = (y - p.y) * pageH;
				if (Math.hypot(dx, dy) < PILL + GAP) {
					y += (PILL + GAP) / (pageH || 1);
					hit = true;
					break;
				}
			}
			if (!hit) break;
			guard += 1;
		}
		y = Math.min(0.98, Math.max(0.02, y));
		x = Math.min(0.98, Math.max(0.02, x));
		placed.push({ id: it.id, x, y });
	}

	return placed.map((p) => ({
		id: p.id,
		leftPct: p.x * 100,
		topPct: p.y * 100,
	}));
}

/**
 * Chat icons sit on the page near each selection.
 * Hover shows dialog; leave schedules delayed hide (parent).
 */
export function AskGutter({
	items,
	activeId,
	onOpen,
	onLeave,
	onEnter,
}: AskGutterProps) {
	const { t } = useTranslation("viewer");
	if (!items.length) return null;

	const pageW = 600;
	const pageH = 800;
	const laid = layoutPins(items, pageW, pageH);
	const byId = new Map(items.map((it) => [it.id, it]));

	return (
		<div
			className="pointer-events-none absolute inset-0 z-10"
			aria-hidden={false}
		>
			{laid.map((pos) => {
				const item = byId.get(pos.id);
				if (!item) return null;
				return (
					<button
						key={item.id}
						type="button"
						className={cn(
							"pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border shadow-sm transition-transform hover:scale-110",
							item.status === "ended"
								? "border-amber-600/35 bg-background text-amber-600 dark:text-amber-400"
								: "border-border/80 bg-background text-primary",
							activeId === item.id && "ring-2 ring-ring ring-offset-1",
						)}
						style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%` }}
						aria-label={t("pdfAsk.pillAria", { preview: item.preview })}
						onMouseEnter={() => {
							onEnter?.();
							onOpen(item.id);
						}}
						onMouseLeave={() => onLeave?.()}
						onFocus={() => {
							onEnter?.();
							onOpen(item.id);
						}}
						onClick={(e) => {
							e.stopPropagation();
							onEnter?.();
							onOpen(item.id);
						}}
					>
						<MessageSquare className="size-3.5" strokeWidth={2} />
					</button>
				);
			})}
		</div>
	);
}
