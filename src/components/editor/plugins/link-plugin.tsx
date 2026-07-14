import { KEYS } from "platejs";
import { createPlatePlugin } from "platejs/react";

import { LinkElement } from "@/components/editor/link-node";

/** Inline link nodes produced by MarkdownPlugin (`type: a`). */
export const LinkPlugin = createPlatePlugin({
	key: KEYS.a,
	node: {
		isElement: true,
		isInline: true,
	},
}).withComponent(LinkElement);
