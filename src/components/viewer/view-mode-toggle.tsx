import { FileCode2, FileType2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CenterViewMode } from "@/lib/viewer";

/** Center paper view: PDF / HTML only (Notes is the side editor, not a center mode card). */
const MODES: {
	id: Extract<CenterViewMode, "pdf" | "html">;
	labelKey: "mode.pdf" | "mode.html";
	icon: typeof FileType2;
}[] = [
	{ id: "pdf", labelKey: "mode.pdf", icon: FileType2 },
	{ id: "html", labelKey: "mode.html", icon: FileCode2 },
];

type ViewModeToggleProps = {
	value: CenterViewMode;
	onChange: (mode: CenterViewMode) => void;
	available: Record<CenterViewMode, boolean>;
};

export function ViewModeToggle({
	value,
	onChange,
	available,
}: ViewModeToggleProps) {
	const { t } = useTranslation("viewer");
	const containerRef = useRef<HTMLDivElement>(null);
	const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
	const [thumb, setThumb] = useState<{
		left: number;
		top: number;
		width: number;
		height: number;
	} | null>(null);

	const activeMode = MODES.find((m) => m.id === value);

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const measure = () => {
			const activeButton = activeMode?.id
				? buttonRefs.current.get(activeMode.id)
				: null;
			if (!activeButton) {
				setThumb(null);
				return;
			}
			setThumb({
				left: activeButton.offsetLeft,
				top: activeButton.offsetTop,
				width: activeButton.offsetWidth,
				height: activeButton.offsetHeight,
			});
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(container);
		return () => ro.disconnect();
	}, [activeMode?.id]);

	// Nothing to switch if neither paper view exists
	if (!available.pdf && !available.html) {
		return null;
	}

	return (
		<TooltipProvider delayDuration={250}>
			<div
				ref={containerRef}
				className="relative inline-flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-border/80 bg-muted/50 p-0.5 dark:bg-muted/30"
				role="tablist"
				aria-label={t("centerPaneView")}
			>
				{thumb ? (
					<span
						aria-hidden
						className={cn(
							"pointer-events-none absolute z-0 rounded-md",
							"bg-background shadow-sm",
							"dark:bg-foreground/10 dark:shadow-none dark:ring-1 dark:ring-white/10",
							"transition-all duration-200 ease-out will-change-[left,width]",
						)}
						style={{
							left: thumb.left,
							top: thumb.top,
							width: thumb.width,
							height: thumb.height,
						}}
					/>
				) : null}

				{MODES.map(({ id, labelKey, icon: Icon }) => {
					const enabled = available[id];
					const active = value === id;
					const label = t(labelKey);
					return (
						<Tooltip key={id}>
							<TooltipTrigger asChild>
								<button
									type="button"
									role="tab"
									aria-selected={active}
									aria-label={label}
									disabled={!enabled}
									ref={(el) => {
										if (el) buttonRefs.current.set(id, el);
										else buttonRefs.current.delete(id);
									}}
									className={cn(
										"relative z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-md",
										"text-muted-foreground outline-none transition-colors duration-150",
										"hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
										"disabled:pointer-events-none disabled:opacity-30",
										active && "text-foreground",
									)}
									onClick={() => onChange(id)}
								>
									<Icon
										className="size-3.5"
										strokeWidth={active ? 2.25 : 1.75}
									/>
								</button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{enabled ? label : t("unavailable", { label })}
							</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
		</TooltipProvider>
	);
}
