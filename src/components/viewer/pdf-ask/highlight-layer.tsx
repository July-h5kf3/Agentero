import { highlightFillClass } from "@/lib/pdf-highlight/palette";
import type { PdfHighlight } from "@/lib/pdf-highlight/types";
import { cn } from "@/lib/utils";

type HighlightLayerProps = {
	/** Highlights for this page only */
	items: PdfHighlight[];
	/** Currently focused highlight id (shown slightly stronger) */
	activeId?: string | null;
};

/**
 * Persisted highlight overlays for a single page.
 * Purely visual (pointer-events-none) so text selection over a highlight
 * keeps working; removal is handled by a hit-test click in the viewer.
 */
export function HighlightLayer({ items, activeId }: HighlightLayerProps) {
	if (!items.length) return null;

	return (
		<div className="pointer-events-none absolute inset-0 z-[6]">
			{items.map((h) => {
				const isActive = activeId === h.id;
				const fill = highlightFillClass(h.color, isActive);
				return h.rects.map((r) => (
					<div
						key={`${h.id}-${r.x}-${r.y}-${r.w}-${r.h}`}
						className={cn("absolute rounded-[2px]", fill)}
						style={{
							left: `${r.x * 100}%`,
							top: `${r.y * 100}%`,
							width: `${r.w * 100}%`,
							height: `${r.h * 100}%`,
						}}
					/>
				));
			})}
		</div>
	);
}
