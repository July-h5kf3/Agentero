"use client";

import type { PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { parseWikiHref, WIKI_HREF_PREFIX } from "@/lib/wiki";
import { useWikiNav } from "@/lib/wiki-nav-context";

type LinkEl = {
	url?: string;
	type: string;
	children: unknown[];
};

export function LinkElement(props: PlateElementProps) {
	const { t } = useTranslation("editor");
	const { children, element } = props;
	const url = (element as LinkEl).url ?? "";
	const wiki = url.startsWith(WIKI_HREF_PREFIX) ? parseWikiHref(url) : null;
	const wikiNav = useWikiNav();

	if (wiki) {
		return (
			<PlateElement
				{...props}
				as="a"
				className={cn(
					"cursor-pointer font-medium underline-offset-2 transition-colors",
					wiki.exists
						? "text-primary underline decoration-primary/40 hover:decoration-primary"
						: "text-muted-foreground underline decoration-dashed decoration-muted-foreground/60 hover:text-foreground",
				)}
				attributes={{
					...props.attributes,
					href: url,
					title: wiki.exists
						? (wiki.path ?? wiki.targetRaw)
						: t("missingLink", { target: wiki.targetRaw }),
					"data-wiki": wiki.exists ? "ok" : "missing",
					onClick: (event: MouseEvent) => {
						event.preventDefault();
						event.stopPropagation();
						wikiNav?.onWikiNavigate(wiki);
					},
				}}
			>
				{children}
			</PlateElement>
		);
	}

	return (
		<PlateElement
			{...props}
			as="a"
			className="font-medium text-primary underline decoration-primary/40 underline-offset-2"
			attributes={{
				...props.attributes,
				href: url,
				target: "_blank",
				rel: "noopener noreferrer",
				onClick: (event: MouseEvent) => {
					// External / normal links: still avoid bubbling to pane chat toggle
					event.stopPropagation();
				},
			}}
		>
			{children}
		</PlateElement>
	);
}
