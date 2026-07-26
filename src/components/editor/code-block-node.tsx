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
		// Constrain width so long lines overflow inside <pre> (scroll), not the editor.
		// Use agentero-scroll-both: agentero-scroll sets overflow-x:hidden (unlayered CSS
		// beats Tailwind overflow-x-auto). The x-only modifier lets vertical wheel
		// input continue to the document scroller. whitespace-pre overrides editor
		// break-spaces.
		<PlateElement className="max-w-full min-w-0 py-1" {...props}>
			<div className="max-w-full min-w-0 overflow-hidden rounded-md bg-muted/50">
				<pre className="agentero-scroll-both agentero-scroll-x-only max-w-full overflow-x-auto p-4 font-mono text-sm leading-[normal] whitespace-pre [tab-size:2]">
					<code className="block w-max min-w-full">{props.children}</code>
				</pre>
			</div>
		</PlateElement>
	);
}

export function CodeLineElement(props: PlateElementProps) {
	return <PlateElement className="block whitespace-pre" {...props} />;
}

export function CodeSyntaxLeaf(props: PlateLeafProps<TCodeSyntaxLeaf>) {
	const tokenClassName = props.leaf.className as string;

	return <PlateLeaf className={tokenClassName} {...props} />;
}
