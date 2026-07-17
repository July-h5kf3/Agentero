import {
	highlightFillClass,
	underlineColorClass,
} from "@/lib/pdf-highlight/palette";
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
				const underline = h.kind === "underline";
				const className = underline
					? cn(
							"absolute rounded-full",
							underlineColorClass(h.color),
							isActive ? "opacity-100" : "opacity-90",
						)
					: cn("absolute rounded-[2px]", highlightFillClass(h.color, isActive));
				return h.rects.map((r) => (
					<div
						key={`${h.id}-${r.x}-${r.y}-${r.w}-${r.h}`}
						className={className}
						style={
							underline
								? {
										left: `${r.x * 100}%`,
										top: `${(r.y + r.h) * 100}%`,
										width: `${r.w * 100}%`,
										height: "2px",
										transform: "translateY(-2px)",
									}
								: {
										left: `${r.x * 100}%`,
										top: `${r.y * 100}%`,
										width: `${r.w * 100}%`,
										height: `${r.h * 100}%`,
									}
						}
					/>
				));
			})}
		</div>
	);
}
