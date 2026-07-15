"use client";

import { PlateElement, type PlateElementProps } from "platejs/react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { resolveWikiTarget } from "@/lib/wiki";
import { useWikiNav } from "@/lib/wiki-nav-context";

export type WikiLinkEl = {
	value: string;
	heading?: string;
	alias?: string | null;
	embed?: boolean;
};

export function WikiLinkElement(props: PlateElementProps) {
	const { t } = useTranslation("editor");
	const el = props.element as unknown as WikiLinkEl;
	const wikiNav = useWikiNav();

	const target = el.value ?? "";
	const path = resolveWikiTarget(target, wikiNav?.mdFiles ?? []);
	const exists = Boolean(path);
	const withHeading = el.heading ? `${target}#${el.heading}` : target;
	const label = el.alias || withHeading;

	const navigate = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		wikiNav?.onWikiNavigate({
			targetRaw: target,
			path,
			exists,
			heading: el.heading || undefined,
		});
	};

	return (
		<PlateElement
			{...props}
			as="span"
			className={cn(
				"cursor-pointer font-medium underline-offset-2 transition-colors",
				exists
					? "text-primary underline decoration-primary/40 hover:decoration-primary"
					: "text-muted-foreground underline decoration-dashed decoration-muted-foreground/60 hover:text-foreground",
			)}
			attributes={{
				...props.attributes,
				title: exists ? (path ?? target) : t("missingLink", { target }),
				"data-wiki": exists ? "ok" : "missing",
				onClick: navigate,
			}}
		>
			<span contentEditable={false}>{el.embed ? `!${label}` : label}</span>
			{props.children}
		</PlateElement>
	);
}
