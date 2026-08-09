"use client";

import type { PlateLeafProps } from "platejs/react";
import { PlateLeaf } from "platejs/react";

export function SearchHighlightLeaf(props: PlateLeafProps) {
	return (
		<PlateLeaf
			{...props}
			as="mark"
			className="rounded-[2px] bg-yellow-300/45 text-inherit dark:bg-yellow-400/30"
		>
			{props.children}
		</PlateLeaf>
	);
}

export function SearchHighlightActiveLeaf(props: PlateLeafProps) {
	return (
		<PlateLeaf
			{...props}
			as="mark"
			className="rounded-[2px] bg-orange-400/70 text-inherit ring-1 ring-orange-500/60 dark:bg-orange-400/50"
		>
			{props.children}
		</PlateLeaf>
	);
}
