"use client";

import { cn } from "@/lib/core/utils";

/**
 * Inline placeholder shared by every embed kind for loading / missing / error.
 * Rendered as a `span` because embeds live inside inline Plate nodes.
 */
export function EmbedStatus({
	message,
	/** Annotation embeds sit in a tighter card and use reduced padding. */
	compact,
	className,
}: {
	message: string;
	compact?: boolean;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"block text-muted-foreground text-sm",
				compact ? "px-3 py-2" : "px-4 py-3",
				className,
			)}
		>
			{message}
		</span>
	);
}
