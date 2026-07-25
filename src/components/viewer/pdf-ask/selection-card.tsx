import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/core/utils";

/** Minimum inset from the viewport edges (px). */
export const SELECTION_CARD_EDGE = 12;
/** Default preferred max height when callers omit `height` (px). */
export const SELECTION_CARD_DEFAULT_MAX_HEIGHT = 420;
/** Floor so a clipped card remains usable on short viewports (px). */
const SELECTION_CARD_MIN_HEIGHT = 120;

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
	/** Preferred max height; clamped to remaining viewport (px). */
	height?: number;
	/** Open to the right of the anchor when there is room (default true). */
	preferRight?: boolean;
	/** Gap from the anchor point (default 6). */
	gap?: number;
};

export type PlaceSelectionCardResult = {
	left: number;
	top: number;
	/** Dynamic max height so the card never extends past the viewport. */
	maxHeight: number;
};

/**
 * Shared viewport placement for PDF selection popovers
 * (ask / translate / annotate).
 *
 * Clamps left/top and returns a `maxHeight` that fits within the viewport
 * from the chosen top — callers must apply it so tall content scrolls
 * instead of overflowing the window.
 */
export function placeSelectionCard(
	screen: { x: number; y: number },
	opts: PlaceSelectionCardOptions,
): PlaceSelectionCardResult {
	const preferredWidth = opts.width;
	const preferredMaxH = opts.height ?? SELECTION_CARD_DEFAULT_MAX_HEIGHT;
	const gap = opts.gap ?? 6;
	const preferRight = opts.preferRight ?? true;
	const edge = SELECTION_CARD_EDGE;
	const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
	const vh = typeof window !== "undefined" ? window.innerHeight : 800;

	const width = Math.min(preferredWidth, Math.max(0, vw - edge * 2));

	let left = preferRight ? screen.x + gap : screen.x;
	if (preferRight && left + width > vw - edge) {
		left = Math.max(edge, screen.x - width - gap);
	}
	left = Math.min(Math.max(edge, left), Math.max(edge, vw - width - edge));

	const viewportCap = Math.max(SELECTION_CARD_MIN_HEIGHT, vh - edge * 2);
	let maxHeight = Math.min(preferredMaxH, viewportCap);

	// Prefer slightly above the anchor; then pull up if the card would clip.
	let top = screen.y - 12;
	if (top + maxHeight > vh - edge) {
		top = vh - edge - maxHeight;
	}
	if (top < edge) {
		top = edge;
	}

	// Remaining space from the final top — this is the hard cap (no overflow).
	maxHeight = Math.min(maxHeight, vh - edge - top);
	if (
		maxHeight < SELECTION_CARD_MIN_HEIGHT &&
		vh - edge * 2 >= SELECTION_CARD_MIN_HEIGHT
	) {
		// Prefer min usable height by sliding further up when possible.
		maxHeight = SELECTION_CARD_MIN_HEIGHT;
		top = Math.max(edge, vh - edge - maxHeight);
		maxHeight = Math.min(maxHeight, vh - edge - top);
	}
	maxHeight = Math.max(0, maxHeight);

	return { left, top, maxHeight };
}

export type SelectionCardProps = {
	screen: { x: number; y: number };
	/** Visual width class / clamp target (px number for placement). */
	width?: number;
	/** Preferred max height; actual height is min(this, viewport remainder). */
	height?: number;
	/**
	 * Pin the card to the computed max height (not content-sized).
	 * Needed when the body hosts StickToBottom / `height: 100%` scrollers
	 * (e.g. PDF Ask conversation) so the scrollbar has a definite viewport.
	 */
	lockHeight?: boolean;
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
 *
 * Always viewport-bounded: `maxHeight` from placement + body scroll
 * (or nested scroller when `lockHeight` + `overflow-hidden` body).
 */
export function SelectionCard({
	screen,
	width = 320,
	height = SELECTION_CARD_DEFAULT_MAX_HEIGHT,
	lockHeight = false,
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
	const { left, top, maxHeight } = placeSelectionCard(screen, {
		width,
		height,
		preferRight,
	});

	return (
		<div
			className={cn(
				"fixed z-50 flex flex-col overflow-hidden",
				"rounded-xl border border-border/80 bg-background text-foreground shadow-2xl ring-1 ring-black/5 dark:ring-white/10",
				className,
			)}
			style={{
				left,
				top,
				width: `min(${width}px, calc(100vw - ${SELECTION_CARD_EDGE * 2}px))`,
				maxHeight,
				// Definite height so flex-1 + nested height:100% scroll areas work.
				...(lockHeight ? { height: maxHeight } : null),
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
					"agentero-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
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
