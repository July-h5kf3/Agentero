/**
 * Shared paper tag chip (Library table + Paper Info panel).
 * Renders name + optional color swatch; optional remove / click handlers.
 */
import { X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { type PaperTag, tagChipStyle, tagSwatchStyle } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

type PaperTagChipProps = {
	tag: PaperTag;
	className?: string;
	/** `xs` matches library cells; `sm` matches Paper Info. */
	size?: "xs" | "sm";
	/** When set, chip is a button (e.g. copy-on-click in Library). */
	onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
	title?: string;
	"aria-label"?: string;
	/** Optional trailing control (e.g. remove). */
	trailing?: ReactNode;
};

const SIZE_CLASS = {
	xs: "text-[0.625rem] leading-none",
	sm: "text-[10px]",
} as const;

export function PaperTagChip({
	tag,
	className,
	size = "sm",
	onClick,
	title,
	"aria-label": ariaLabel,
	trailing,
}: PaperTagChipProps) {
	const colored = tagChipStyle(tag.color);
	const body = (
		<>
			{tag.color ? (
				<span
					className="size-1.5 shrink-0 rounded-full ring-1 ring-black/10"
					style={tagSwatchStyle(tag.color)}
					aria-hidden
				/>
			) : null}
			{tag.name}
			{trailing}
		</>
	);
	const baseClass = cn(
		"inline-flex items-center gap-1 rounded px-1.5 py-0.5",
		SIZE_CLASS[size],
		colored ? "font-medium" : "bg-muted text-muted-foreground",
		onClick &&
			"cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
		onClick &&
			(colored
				? "hover:opacity-90"
				: "hover:bg-muted-foreground/20 hover:text-foreground"),
		className,
	);

	if (onClick) {
		return (
			<button
				type="button"
				className={baseClass}
				style={colored}
				title={title}
				aria-label={ariaLabel}
				onClick={onClick}
			>
				{body}
			</button>
		);
	}

	return (
		<span className={baseClass} style={colored} title={title}>
			{body}
		</span>
	);
}

type PaperTagRemoveButtonProps = {
	tagName: string;
	label: string;
	disabled?: boolean;
	onRemove: (name: string) => void;
};

export function PaperTagRemoveButton({
	tagName,
	label,
	disabled,
	onRemove,
}: PaperTagRemoveButtonProps) {
	return (
		<button
			type="button"
			className={cn(
				"rounded p-0.5 opacity-70 transition-colors",
				"hover:bg-background/60 hover:opacity-100",
				"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				"disabled:pointer-events-none disabled:opacity-50",
			)}
			aria-label={label}
			disabled={disabled}
			onClick={() => onRemove(tagName)}
		>
			<X className="size-2.5" aria-hidden />
		</button>
	);
}
