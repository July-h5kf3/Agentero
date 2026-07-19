import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SelectionCardAction = {
	label: string;
	onClick: () => void;
	icon: ReactNode;
	/** Destructive styling for the header icon button */
	destructive?: boolean;
};

export type PlaceSelectionCardOptions = {
	/** Preferred card width used for edge-flip (px). */
	width: number;
	/** Approximate height budget for vertical clamp (px). */
	height?: number;
	/** Open to the right of the anchor when there is room (default true). */
	preferRight?: boolean;
	/** Gap from the anchor point (default 6). */
	gap?: number;
};

/**
 * Shared viewport placement for PDF selection popovers
 * (ask / translate / annotate).
 */
export function placeSelectionCard(
	screen: { x: number; y: number },
	opts: PlaceSelectionCardOptions,
): { left: number; top: number } {
	const width = opts.width;
	const height = opts.height ?? 220;
	const gap = opts.gap ?? 6;
	const preferRight = opts.preferRight ?? true;
	const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
	const vh = typeof window !== "undefined" ? window.innerHeight : 800;

	let left = preferRight ? screen.x + gap : screen.x;
	if (preferRight && left + width > vw - 12) {
		left = Math.max(12, screen.x - width - gap);
	}
	left = Math.min(Math.max(12, left), vw - width - 12);
	const top = Math.min(Math.max(12, screen.y - 12), vh - height - 12);
	return { left, top };
}

export type SelectionCardProps = {
	screen: { x: number; y: number };
	/** Visual width class / clamp target (px number for placement). */
	width?: number;
	/** Approximate height for placement clamp. */
	height?: number;
	preferRight?: boolean;
	title: string;
	icon: LucideIcon;
	/** Header trailing icon buttons (close / hide / delete …). */
	actions?: SelectionCardAction[];
	/** Accessible name; defaults to title. */
	ariaLabel?: string;
	/** Announce body updates (e.g. streaming translation). */
	ariaLive?: "polite" | "off";
	onPointerEnter?: () => void;
	onPointerLeave?: () => void;
	/** Optional footer strip (prompt input, save/cancel). */
	footer?: ReactNode;
	className?: string;
	bodyClassName?: string;
	children: ReactNode;
};

/**
 * Shared floating card chrome for PDF selection workflows:
 * Ask / Translate / Annotate. Same shell, different body/footer.
 */
export function SelectionCard({
	screen,
	width = 320,
	height = 280,
	preferRight = true,
	title,
	icon: Icon,
	actions,
	ariaLabel,
	ariaLive = "off",
	onPointerEnter,
	onPointerLeave,
	footer,
	className,
	bodyClassName,
	children,
}: SelectionCardProps) {
	const { left, top } = placeSelectionCard(screen, {
		width,
		height,
		preferRight,
	});

	return (
		<div
			className={cn(
				"fixed z-50 flex max-h-[min(420px,calc(100vh-24px))] flex-col overflow-hidden",
				"rounded-xl border border-border/80 bg-background text-foreground shadow-2xl ring-1 ring-black/5 dark:ring-white/10",
				className,
			)}
			style={{
				left,
				top,
				width: `min(${width}px, calc(100vw - 24px))`,
			}}
			role="dialog"
			aria-label={ariaLabel ?? title}
			aria-modal="false"
			onMouseDown={(e) => e.stopPropagation()}
			onMouseEnter={onPointerEnter}
			onMouseLeave={onPointerLeave}
		>
			<header className="flex shrink-0 items-center gap-2 border-border/60 border-b px-3 py-2">
				<Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
				<span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
					{title}
				</span>
				{actions && actions.length > 0 ? (
					<TooltipProvider delayDuration={200}>
						<div className="flex items-center gap-0.5">
							{actions.map((a) => (
								<Tooltip key={a.label}>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											aria-label={a.label}
											className={cn(
												a.destructive &&
													"text-muted-foreground hover:text-destructive",
											)}
											onClick={a.onClick}
										>
											{a.icon}
										</Button>
									</TooltipTrigger>
									<TooltipContent side="bottom">{a.label}</TooltipContent>
								</Tooltip>
							))}
						</div>
					</TooltipProvider>
				) : null}
			</header>

			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col overflow-y-auto",
					bodyClassName,
				)}
				aria-live={ariaLive === "off" ? undefined : ariaLive}
			>
				{children}
			</div>

			{footer ? (
				<div className="shrink-0 border-border/60 border-t p-2">{footer}</div>
			) : null}
		</div>
	);
}
