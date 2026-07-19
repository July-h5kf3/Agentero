/**
 * Compact document-spine reading heatmap for the papers library.
 * Intensity maps PDF highlight / ask / translate activity along page order.
 */
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { isEmptyHeatmap, type ReadingHeatmap } from "@/lib/reading-heatmap";
import { cn } from "@/lib/utils";

export type ReadingHeatmapBarProps = {
	heatmap: ReadingHeatmap | null | undefined;
	className?: string;
	/** Wider bar for dense tables */
	size?: "sm" | "md";
};

/**
 * Theme-aligned heat: track = muted, cells use primary via color-mix so
 * light/dark and custom themes stay consistent without hard-coded hues.
 */
function binStyle(intensity: number): CSSProperties {
	if (intensity <= 0) {
		return { backgroundColor: "transparent" };
	}
	// Soft floor so sparse activity is still visible; peak → solid primary.
	const pct = Math.round(18 + intensity * 82);
	return {
		backgroundColor: `color-mix(in oklch, var(--primary) ${pct}%, transparent)`,
	};
}

export function ReadingHeatmapBar({
	heatmap,
	className,
	size = "sm",
}: ReadingHeatmapBarProps) {
	const { t } = useTranslation("sidebar");
	const empty = isEmptyHeatmap(heatmap);
	const bins = heatmap?.bins ?? [];
	const by = heatmap?.byKind;

	const label = empty
		? t("papersLibrary.heatmapEmpty")
		: t("papersLibrary.heatmapTooltip", {
				total: Math.round(heatmap?.total ?? 0),
				highlights: Math.round(by?.highlight ?? 0),
				asks: Math.round(by?.ask ?? 0),
				translates: Math.round(by?.translate ?? 0),
			});

	const bar = (
		<div
			role="img"
			aria-label={label}
			className={cn(
				"flex overflow-hidden rounded-sm bg-muted/70 ring-1 ring-border/60",
				size === "sm" ? "h-2 w-[4.5rem]" : "h-2.5 w-[5.5rem]",
				className,
			)}
		>
			{bins.map((intensity, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length bin strip
					key={i}
					className="h-full min-w-0 flex-1"
					style={binStyle(intensity)}
				/>
			))}
		</div>
	);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex">{bar}</span>
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-xs text-xs">
				{label}
			</TooltipContent>
		</Tooltip>
	);
}
