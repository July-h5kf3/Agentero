import { FileCode2, FileType2 } from "lucide-react";
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

/** Tailwind rem sizes: size-6 = 1.5rem, gap-0.5 = 0.125rem */
const CELL = 1.5;
const GAP = 0.125;

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
	const activeIndex = MODES.findIndex((m) => m.id === value);
	const showThumb = activeIndex >= 0;
	const thumbX = Math.max(0, activeIndex) * (CELL + GAP);

	// Nothing to switch if neither paper view exists
	if (!available.pdf && !available.html) {
		return null;
	}

	return (
		<TooltipProvider delayDuration={250}>
			<div
				className="relative inline-flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-border/80 bg-muted/50 p-0.5 dark:bg-muted/30"
				role="tablist"
				aria-label={t("centerPaneView")}
			>
				{showThumb ? (
					<span
						aria-hidden
						className={cn(
							"pointer-events-none absolute top-0.5 left-0.5 z-0 h-6 w-6 rounded-md",
							"bg-background shadow-sm",
							"dark:bg-foreground/10 dark:shadow-none dark:ring-1 dark:ring-white/10",
							"transition-transform duration-200 ease-out will-change-transform",
						)}
						style={{
							transform: `translate3d(${thumbX}rem, 0, 0)`,
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
