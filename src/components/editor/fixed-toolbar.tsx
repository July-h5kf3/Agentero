"use client";

import { cn } from "@/lib/utils";

import { Toolbar } from "./toolbar";

export function FixedToolbar(props: React.ComponentProps<typeof Toolbar>) {
	return (
		<Toolbar
			{...props}
			className={cn(
				/* shrink-0 in flex editor column — avoid sticky+z-50 so the bar
				 * cannot paint over dockview tab chrome if content height overflows. */
				"scrollbar-hide h-10 w-full shrink-0 items-center justify-between overflow-x-auto rounded-none border-b border-b-border bg-background/95 p-1 backdrop-blur-sm supports-backdrop-blur:bg-background/60",
				props.className,
			)}
		/>
	);
}
