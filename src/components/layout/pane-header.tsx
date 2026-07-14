import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Shared pane title bar height — keep all three columns aligned. */
export const PANE_HEADER_CLASS =
	"flex h-10 shrink-0 items-center gap-2 border-b px-3";

type PaneHeaderProps = {
	children: ReactNode;
	className?: string;
	/** Secondary content (actions or title) */
	trailing?: ReactNode;
	/**
	 * Leading stays compact (e.g. icon toggle on the left);
	 * trailing fills remaining space and is right-aligned (e.g. paper title).
	 */
	leadingCompact?: boolean;
};

export function PaneHeader({
	children,
	className,
	trailing,
	leadingCompact = false,
}: PaneHeaderProps) {
	return (
		<div className={cn(PANE_HEADER_CLASS, className)}>
			<div
				className={cn(
					"flex items-center gap-2",
					leadingCompact ? "shrink-0" : "min-w-0 flex-1",
				)}
			>
				{children}
			</div>
			{trailing ? (
				<div
					className={cn(
						"flex items-center gap-1",
						leadingCompact ? "min-w-0 flex-1 justify-end" : "shrink-0",
					)}
				>
					{trailing}
				</div>
			) : null}
		</div>
	);
}
