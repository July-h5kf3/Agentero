/**
 * Vault path citations — typically placed in MessageFooter.
 * @see https://ui.shadcn.com/docs/components/base/message
 */
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type SourcesProps = ComponentProps<"div"> & {
	/** Vault-relative paths or labels */
	items: string[];
	label?: string;
};

export function Sources({
	className,
	items,
	label = "Sources",
	...props
}: SourcesProps) {
	if (items.length === 0) return null;
	return (
		<div
			data-slot="sources"
			className={cn(
				"w-full min-w-0 text-[11px] text-muted-foreground",
				className,
			)}
			{...props}
		>
			<p className="mb-1 font-medium">{label}</p>
			<ul className="space-y-0.5">
				{items.map((item) => (
					<li key={item} className="truncate font-mono" title={item}>
						{item}
					</li>
				))}
			</ul>
		</div>
	);
}

export type SourceProps = ComponentProps<"div"> & {
	title: string;
};

export function Source({ className, title, ...props }: SourceProps) {
	return (
		<div
			data-slot="source"
			className={cn("truncate font-mono text-[11px]", className)}
			title={title}
			{...props}
		>
			{title}
		</div>
	);
}
