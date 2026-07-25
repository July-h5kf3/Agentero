import { Languages, MessageSquare, MessageSquareText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/core/utils";
import type { SelectionPin } from "@/lib/pdf/selection";

type SelectionGutterProps = {
	/** Pins for this page only (ask + annotate + translate) */
	items: SelectionPin[];
	activeId: string | null;
	onOpen: (pin: SelectionPin) => void;
	/** Leave pin — parent may schedule delayed hide (ask hover UX) */
	onLeave?: (pin: SelectionPin) => void;
	/** Enter pin — cancel pending hide */
	onEnter?: (pin: SelectionPin) => void;
};

const PILL = 20;
const GAP = 4;

/**
 * Nudge overlapping pins so they stay clickable while staying near anchors.
 * Positions are page-normalized 0–1; page size used only for collision in px.
 */
function layoutPins(
	items: SelectionPin[],
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

function pinIcon(kind: SelectionPin["kind"]) {
	switch (kind) {
		case "ask":
			return MessageSquare;
		case "annotate":
			return MessageSquareText;
		case "translate":
			return Languages;
	}
}

/**
 * Unified page pins for selection workflows: ask / annotate / translate.
 * Hover opens ask (parent decides); click opens any kind.
 */
export function SelectionGutter({
	items,
	activeId,
	onOpen,
	onLeave,
	onEnter,
}: SelectionGutterProps) {
	const { t } = useTranslation("viewer");
	if (!items.length) return null;

	const laid = layoutPins(items, 600, 800);
	const byId = new Map(items.map((it) => [it.id, it]));

	return (
		<div
			className="pointer-events-none absolute inset-0 z-10"
			aria-hidden={false}
		>
			{laid.map((pos) => {
				const item = byId.get(pos.id);
				if (!item) return null;
				const Icon = pinIcon(item.kind);
				const aria =
					item.kind === "ask"
						? t("pdfAsk.pillAria", { preview: item.preview })
						: item.kind === "annotate"
							? t("annotations.pinAria", { preview: item.preview })
							: t("selection.translatePinAria", { preview: item.preview });

				return (
					<button
						key={`${item.kind}-${item.id}`}
						type="button"
						className={cn(
							"pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border shadow-sm transition-transform hover:scale-110",
							item.kind === "ask" && item.ended
								? "border-amber-600/35 bg-background text-amber-600 dark:text-amber-400"
								: item.kind === "translate"
									? "border-sky-600/35 bg-background text-sky-700 dark:text-sky-400"
									: "border-border/80 bg-background text-muted-foreground",
							activeId === item.id && "ring-2 ring-ring ring-offset-1",
						)}
						style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%` }}
						aria-label={aria}
						onMouseEnter={() => {
							onEnter?.(item);
							onOpen(item);
						}}
						onMouseLeave={() => onLeave?.(item)}
						onFocus={() => {
							onEnter?.(item);
							onOpen(item);
						}}
						onClick={(e) => {
							e.stopPropagation();
							onEnter?.(item);
							onOpen(item);
						}}
					>
						<Icon className="size-3.5" strokeWidth={2} />
					</button>
				);
			})}
		</div>
	);
}
