"use client";

import { PlateElement, type PlateElementProps } from "platejs/react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMarkdownDoc } from "@/components/editor/markdown-doc-context";
import { WikiEmbedElement } from "@/components/editor/wiki-embed-node";
import { cn } from "@/lib/utils";
import {
	type LinkFragment,
	resolveWikiReference,
	resolveWikiTarget,
} from "@/lib/wiki";
import { useWikiNav } from "@/lib/wiki-nav-context";

export type WikiLinkEl = {
	value: string;
	heading?: string;
	alias?: string | null;
	embed?: boolean;
};

export function WikiLinkElement(props: PlateElementProps) {
	const element = props.element as unknown as WikiLinkEl;
	return element.embed ? (
		<WikiEmbedElement {...props} />
	) : (
		<WikiLinkNavigationElement {...props} />
	);
}

function WikiLinkNavigationElement(props: PlateElementProps) {
	const { t } = useTranslation("editor");
	const el = props.element as unknown as WikiLinkEl;
	const wikiNav = useWikiNav();
	const markdownDoc = useMarkdownDoc();

	const target = el.value ?? "";
	const path = resolveWikiTarget(target, wikiNav?.mdFiles ?? []);
	const fragment: LinkFragment | undefined = el.heading
		? el.heading.startsWith("^")
			? { kind: "block", id: el.heading.slice(1) }
			: { kind: "heading", path: el.heading.split("#").filter(Boolean) }
		: undefined;
	const fallbackStatus = path || (!target && fragment) ? "resolved" : "missing";
	const withHeading = el.heading ? `${target}#${el.heading}` : target;
	const label = el.alias || withHeading;

	const navigate = async (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (wikiNav?.vaultPath && markdownDoc.filePath) {
			try {
				const resolved = await resolveWikiReference(
					wikiNav.vaultPath,
					markdownDoc.filePath,
					withHeading,
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
				// Demo/offline fallback remains deliberately file-only.
			}
		}
		wikiNav?.onWikiNavigate({
			targetRaw: target,
			path,
			status: fallbackStatus,
			fragment,
		});
	};

	return (
		<PlateElement
			{...props}
			as="span"
			className={cn(
				"cursor-pointer font-medium underline-offset-2 transition-colors",
				fallbackStatus === "resolved"
					? "text-primary underline decoration-primary/40 hover:decoration-primary"
					: "text-muted-foreground underline decoration-dashed decoration-muted-foreground/60 hover:text-foreground",
			)}
			attributes={{
				...props.attributes,
				title:
					fallbackStatus === "resolved"
						? (path ?? target)
						: t("missingLink", { target }),
				"data-wiki": fallbackStatus === "resolved" ? "ok" : "missing",
				onClick: navigate,
			}}
		>
			<span contentEditable={false}>{label}</span>
			{props.children}
		</PlateElement>
	);
}
