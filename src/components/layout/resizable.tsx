import type { ComponentProps } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

export { Group as ResizableGroup, Panel as ResizablePanel };

export function ResizableHandle({
	className,
	...props
}: ComponentProps<typeof Separator>) {
	return (
		<Separator
			className={cn(
				"relative flex w-1.5 items-center justify-center bg-border outline-none transition-colors",
				"hover:bg-ring/40 data-[separator=active]:bg-ring/50",
				"after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2",
				className,
			)}
			{...props}
		/>
	);
}
