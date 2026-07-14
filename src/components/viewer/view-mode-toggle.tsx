import { FileCode2, FileText, FileType2 } from "lucide-react";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CenterViewMode } from "@/lib/viewer";

const MODES: {
	id: CenterViewMode;
	label: string;
	icon: typeof FileText;
}[] = [
	{ id: "markdown", label: "Markdown", icon: FileText },
	{ id: "pdf", label: "PDF", icon: FileType2 },
	{ id: "html", label: "HTML", icon: FileCode2 },
];

/** size-6 = 24px, gap-0.5 = 2px — keep in sync with class names below */
const CELL = 24;
const GAP = 2;

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
	const activeIndex = Math.max(
		0,
		MODES.findIndex((m) => m.id === value),
	);
	const thumbX = activeIndex * (CELL + GAP);

	return (
		<TooltipProvider delayDuration={250}>
			<div
				className="relative inline-flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-border/80 bg-muted/50 p-0.5 dark:bg-muted/30"
				role="tablist"
				aria-label="Center pane view"
			>
				{/* Sliding pill — fixed cell size, left-aligned then translateX */}
				<span
					aria-hidden
					className={cn(
						"pointer-events-none absolute top-0.5 left-0.5 z-0 h-6 w-6 rounded-md",
						"bg-background shadow-sm",
						"dark:bg-foreground/10 dark:shadow-none dark:ring-1 dark:ring-white/10",
						"transition-transform duration-200 ease-out will-change-transform",
					)}
					style={{
						transform: `translate3d(${thumbX}px, 0, 0)`,
					}}
				/>

				{MODES.map(({ id, label, icon: Icon }) => {
					const enabled = available[id];
					const active = value === id;
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
								{enabled ? label : `${label} unavailable`}
							</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
		</TooltipProvider>
	);
}
