"use client";

import type { PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMarkdownDoc } from "@/components/editor/markdown-doc-context";
import { cn } from "@/lib/core/utils";
import {
	isVaultLocalMarkdownLink,
	parseWikiHref,
	resolveWikiReference,
	WIKI_HREF_PREFIX,
} from "@/lib/wiki";
import { useWikiNav } from "@/lib/wiki/nav-context";

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
	const markdownDoc = useMarkdownDoc();
	const localMarkdown = !wiki && isVaultLocalMarkdownLink(url);

	if (wiki) {
		return (
			<PlateElement
				{...props}
				as="a"
				className={cn(
					"cursor-pointer font-medium underline-offset-2 transition-colors",
					wiki.status === "resolved"
						? "text-primary underline decoration-primary/40 hover:decoration-primary"
						: "text-muted-foreground underline decoration-dashed decoration-muted-foreground/60 hover:text-foreground",
				)}
				attributes={{
					...props.attributes,
					href: url,
					title:
						wiki.status === "resolved"
							? (wiki.path ?? wiki.targetRaw)
							: t("missingLink", { target: wiki.targetRaw }),
					"data-wiki": wiki.status === "resolved" ? "ok" : "missing",
					onClick: async (event: MouseEvent) => {
						event.preventDefault();
						event.stopPropagation();
						if (wikiNav?.vaultPath && markdownDoc.filePath) {
							try {
								const fragment = wiki.fragment
									? wiki.fragment.kind === "block"
										? `#^${wiki.fragment.id}`
										: `#${wiki.fragment.path.join("#")}`
									: "";
								const resolved = await resolveWikiReference(
									wikiNav.vaultPath,
									markdownDoc.filePath,
									`${wiki.targetRaw}${fragment}`,
								);
								if (resolved) {
									wikiNav.onWikiNavigate({
										targetRaw: resolved.occurrence.targetRaw,
										path: resolved.targetPath ?? null,
										status: resolved.status,
										fragment: resolved.occurrence.fragment,
									});
									return;
								}
							} catch {
								// Browser preview has no Host resolver; keep its file-only fallback.
							}
						}
						wikiNav?.onWikiNavigate(wiki);
					},
				}}
			>
				{children}
			</PlateElement>
		);
	}

	if (localMarkdown) {
		return (
			<PlateElement
				{...props}
				as="a"
				className="cursor-pointer font-medium text-primary underline decoration-primary/40 underline-offset-2"
				attributes={{
					...props.attributes,
					href: url,
					onClick: async (event: MouseEvent) => {
						event.preventDefault();
						event.stopPropagation();
						if (!wikiNav?.vaultPath || !markdownDoc.filePath) return;
						try {
							const resolved = await resolveWikiReference(
								wikiNav.vaultPath,
								markdownDoc.filePath,
								url,
								"markdown",
							);
							if (!resolved) return;
							wikiNav.onWikiNavigate({
								targetRaw: resolved.occurrence.targetRaw,
								path: resolved.targetPath ?? null,
								status: resolved.status,
								fragment: resolved.occurrence.fragment,
							});
						} catch {
							// Keep the link inert when the Host cannot establish a local target.
						}
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
