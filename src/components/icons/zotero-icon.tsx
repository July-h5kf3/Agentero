import type { SVGProps } from "react";

/** Zotero brand mark — a red tile with a white "Z". Decorative (label on the button). */
export function ZoteroIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			{...props}
		>
			<rect width="24" height="24" rx="5" fill="#CC2936" />
			<path
				d="M7 6.5 h10 v2.2 l-6.1 6.6 H17 v2.2 H7 v-2.2 l6.1 -6.6 H7 z"
				fill="#fff"
			/>
		</svg>
	);
}
