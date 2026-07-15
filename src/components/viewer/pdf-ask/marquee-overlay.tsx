import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import type { PdfAskNormalizedRect } from "@/lib/pdf-ask/types";
import { cn } from "@/lib/utils";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function handleStyle(h: Handle): CSSProperties {
	const base: React.CSSProperties = {
		position: "absolute",
		width: 8,
		height: 8,
		background: "var(--background)",
		border: "1.5px solid var(--primary)",
		borderRadius: 1,
		zIndex: 3,
	};
	const half = -4;
	switch (h) {
		case "nw":
			return { ...base, left: half, top: half, cursor: "nwse-resize" };
		case "n":
			return {
				...base,
				left: "50%",
				top: half,
				marginLeft: half,
				cursor: "ns-resize",
			};
		case "ne":
			return { ...base, right: half, top: half, cursor: "nesw-resize" };
		case "e":
			return {
				...base,
				right: half,
				top: "50%",
				marginTop: half,
				cursor: "ew-resize",
			};
		case "se":
			return { ...base, right: half, bottom: half, cursor: "nwse-resize" };
		case "s":
			return {
				...base,
				left: "50%",
				bottom: half,
				marginLeft: half,
				cursor: "ns-resize",
			};
		case "sw":
			return { ...base, left: half, bottom: half, cursor: "nesw-resize" };
		case "w":
			return {
				...base,
				left: half,
				top: "50%",
				marginTop: half,
				cursor: "ew-resize",
			};
	}
}

export type MarqueeOverlayProps = {
	/** Live drag box in page-normalized coords, or committed selection */
	rect: PdfAskNormalizedRect | null;
	/** Draft while dragging (client %, no handles) */
	draft?: boolean;
	active?: boolean;
	onResizeStart?: (handle: Handle, e: ReactPointerEvent) => void;
};

export function MarqueeOverlay({
	rect,
	draft = false,
	active = false,
	onResizeStart,
}: MarqueeOverlayProps) {
	if (!rect || rect.w <= 0 || rect.h <= 0) return null;

	return (
		<div
			className={cn(
				"pointer-events-none absolute z-[2] box-border border border-primary/80 bg-primary/10",
				active && !draft && "shadow-[0_0_0_1px_rgba(0,0,0,0.04)]",
			)}
			style={{
				left: `${rect.x * 100}%`,
				top: `${rect.y * 100}%`,
				width: `${rect.w * 100}%`,
				height: `${rect.h * 100}%`,
			}}
		>
			{!draft && active
				? HANDLES.map((h) => (
						<span
							key={h}
							data-pdf-ask-ui=""
							className="pointer-events-auto"
							style={handleStyle(h)}
							onPointerDown={(e) => {
								e.preventDefault();
								e.stopPropagation();
								onResizeStart?.(h, e);
							}}
						/>
					))
				: null}
		</div>
	);
}

export type { Handle as MarqueeHandle };

/** Apply resize handle delta in normalized page space. */
export function applyMarqueeResize(
	rect: PdfAskNormalizedRect,
	handle: Handle,
	dx: number,
	dy: number,
): PdfAskNormalizedRect {
	let { x, y, w, h } = rect;
	const min = 0.02;
	switch (handle) {
		case "e":
			w = Math.max(min, w + dx);
			break;
		case "w": {
			const nx = Math.min(x + w - min, x + dx);
			w = w + (x - nx);
			x = nx;
			break;
		}
		case "s":
			h = Math.max(min, h + dy);
			break;
		case "n": {
			const ny = Math.min(y + h - min, y + dy);
			h = h + (y - ny);
			y = ny;
			break;
		}
		case "se":
			w = Math.max(min, w + dx);
			h = Math.max(min, h + dy);
			break;
		case "sw": {
			const nx = Math.min(x + w - min, x + dx);
			w = w + (x - nx);
			x = nx;
			h = Math.max(min, h + dy);
			break;
		}
		case "ne":
			w = Math.max(min, w + dx);
			{
				const ny = Math.min(y + h - min, y + dy);
				h = h + (y - ny);
				y = ny;
			}
			break;
		case "nw": {
			const nx = Math.min(x + w - min, x + dx);
			const ny = Math.min(y + h - min, y + dy);
			w = w + (x - nx);
			h = h + (y - ny);
			x = nx;
			y = ny;
			break;
		}
	}
	x = Math.min(1 - min, Math.max(0, x));
	y = Math.min(1 - min, Math.max(0, y));
	w = Math.min(1 - x, Math.max(min, w));
	h = Math.min(1 - y, Math.max(min, h));
	return { x, y, w, h };
}
