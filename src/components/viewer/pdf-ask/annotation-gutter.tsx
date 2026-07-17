import { MessageSquareText } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export type AnnotationPin = {
	id: string;
	/** 0–1 page-normalized anchor (top-right of the highlight) */
	x: number;
	y: number;
	preview: string;
};

type AnnotationGutterProps = {
	/** Pins for this page only */
	items: AnnotationPin[];
	activeId: string | null;
	onOpen: (id: string) => void;
};

const PILL = 20;
const GAP = 4;

function layoutPins(
	items: AnnotationPin[],
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

/** Note icons next to annotated highlights; click opens the note editor. */
export function AnnotationGutter({
	items,
	activeId,
	onOpen,
}: AnnotationGutterProps) {
	const { t } = useTranslation("viewer");
	if (!items.length) return null;
	const laid = layoutPins(items, 600, 800);
	const byId = new Map(items.map((it) => [it.id, it]));

	return (
		<div
			className="pointer-events-none absolute inset-0 z-[9]"
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
							"pointer-events-auto absolute flex size-6 -translate-y-1/2 items-center justify-center rounded-md border border-amber-600/40 bg-background text-amber-600 shadow-sm transition-transform hover:scale-110 dark:text-amber-400",
							activeId === item.id && "ring-2 ring-ring ring-offset-1",
						)}
						style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%` }}
						aria-label={t("annotations.pinAria", { preview: item.preview })}
						onClick={(e) => {
							e.stopPropagation();
							onOpen(item.id);
						}}
					>
						<MessageSquareText className="size-3.5" strokeWidth={2} />
					</button>
				);
			})}
		</div>
	);
}
