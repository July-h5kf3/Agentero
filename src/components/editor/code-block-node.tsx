"use client";

import type { TCodeBlockElement, TCodeSyntaxLeaf } from "platejs";
import {
	PlateElement,
	type PlateElementProps,
	PlateLeaf,
	type PlateLeafProps,
} from "platejs/react";

export function CodeBlockElement(props: PlateElementProps<TCodeBlockElement>) {
	return (
		<PlateElement className="py-1" {...props}>
			<div className="rounded-md bg-muted/50">
				<pre className="agentero-scroll-both overflow-x-auto p-4 font-mono text-sm leading-[normal] [tab-size:2]">
					<code>{props.children}</code>
				</pre>
			</div>
		</PlateElement>
	);
}

export function CodeLineElement(props: PlateElementProps) {
	return <PlateElement {...props} />;
}

export function CodeSyntaxLeaf(props: PlateLeafProps<TCodeSyntaxLeaf>) {
	const tokenClassName = props.leaf.className as string;

	return <PlateLeaf className={tokenClassName} {...props} />;
}
