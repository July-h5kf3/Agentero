"use client";

import { ExternalLink } from "lucide-react";
import { PlateElement, type PlateElementProps } from "platejs/react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useMarkdownDoc } from "@/components/editor/markdown-doc-context";
import {
	MAX_WIKI_EMBED_DEPTH,
	useWikiEmbedAncestry,
	WikiEmbedAncestryProvider,
} from "@/components/editor/wiki-embed-context";
import type { WikiLinkEl } from "@/components/editor/wikilink-node";
import { cn } from "@/lib/utils";
import { joinVaultPath } from "@/lib/vault";
import {
	type ResolvedLink,
	readWikiEmbed,
	type WikiEmbedResponse,
} from "@/lib/wiki";
import { useWikiNav } from "@/lib/wiki-nav-context";

const EmbeddedMarkdownProjection = lazy(async () => {
	const module = await import(
		"@/components/editor/embedded-markdown-projection"
	);
	return { default: module.EmbeddedMarkdownProjection };
});

const WikiAttachmentEmbed = lazy(async () => {
	const module = await import("@/components/editor/wiki-attachment-embed");
	return { default: module.WikiAttachmentEmbed };
});

type EmbedLoadState =
	| { kind: "loading" }
	| { kind: "ready"; response: WikiEmbedResponse; key: string }
	| {
			kind:
				| "missing"
				| "ambiguous"
				| "invalidFragment"
				| "unsupported"
				| "error";
			response?: WikiEmbedResponse;
			detail?: string;
	  };

function fragmentKey(link: ResolvedLink): string {
	const fragment = link.occurrence.fragment;
	if (!fragment) return "";
	return fragment.kind === "block"
		? `#^${fragment.id}`
		: `#${fragment.path.join("#")}`;
}

function embedKey(link: ResolvedLink): string {
	return `${link.targetPath ?? link.occurrence.targetRaw}${fragmentKey(link)}`;
}

function stateFromResponse(response: WikiEmbedResponse): EmbedLoadState {
	if (response.link.status !== "resolved") {
		return { kind: response.link.status, response };
	}
	switch (response.contentKind) {
		case "markdown":
			return typeof response.content === "string"
				? { kind: "ready", response, key: embedKey(response.link) }
				: { kind: "unsupported", response };
		case "image":
		case "pdf":
			return { kind: "ready", response, key: embedKey(response.link) };
		default:
			return { kind: "unsupported", response };
	}
}

function EmbedStatus({ message }: { message: string }) {
	return (
		<span className="block px-4 py-3 text-muted-foreground text-sm">
			{message}
		</span>
	);
}

export function WikiEmbedElement(props: PlateElementProps) {
	const { t } = useTranslation("editor");
	const element = props.element as unknown as WikiLinkEl;
	const wikiNav = useWikiNav();
	const markdownDoc = useMarkdownDoc();
	const ancestry = useWikiEmbedAncestry();
	const [state, setState] = useState<EmbedLoadState>({ kind: "loading" });

	const target = element.value ?? "";
	const targetWithFragment = element.heading
		? `${target}#${element.heading}`
		: target;
	const refreshRevision = wikiNav?.revision;

	useEffect(() => {
		// The revision is intentionally consumed as an invalidation token after
		// the Host rebuilds the source-backed Wiki index.
		void refreshRevision;
		const vaultPath = wikiNav?.vaultPath;
		const sourcePath = markdownDoc.filePath;
		if (!vaultPath || !sourcePath) {
			setState({ kind: "error" });
			return;
		}

		let cancelled = false;
		setState({ kind: "loading" });
		void readWikiEmbed(vaultPath, sourcePath, targetWithFragment)
			.then((response) => {
				if (!cancelled) setState(stateFromResponse(response));
			})
			.catch((error) => {
				if (cancelled) return;
				setState({
					kind: "error",
					detail: error instanceof Error ? error.message : String(error),
				});
			});
		return () => {
			cancelled = true;
		};
	}, [
		markdownDoc.filePath,
		refreshRevision,
		targetWithFragment,
		wikiNav?.vaultPath,
	]);

	const resolvedLink = "response" in state ? state.response?.link : undefined;
	const navigate = useCallback(() => {
		if (resolvedLink?.status !== "resolved" || !resolvedLink.targetPath) {
			return;
		}
		wikiNav?.onWikiNavigate({
			targetRaw: resolvedLink.occurrence.targetRaw,
			path: resolvedLink.targetPath,
			status: resolvedLink.status,
			fragment: resolvedLink.occurrence.fragment,
		});
	}, [resolvedLink, wikiNav]);

	const presentation = useMemo(() => {
		if (state.kind !== "ready") return state;
		if (ancestry.includes(state.key)) {
			return { kind: "cycle" as const };
		}
		if (ancestry.length >= MAX_WIKI_EMBED_DEPTH) {
			return { kind: "depth" as const };
		}
		return state;
	}, [ancestry, state]);

	const imageSizeAlias =
		state.kind === "ready" &&
		state.response.contentKind === "image" &&
		/^([1-9]\d*)(?:x([1-9]\d*))?$/i.test(element.alias?.trim() ?? "");
	const sourceLabel =
		(imageSizeAlias ? "" : element.alias) ||
		targetWithFragment ||
		resolvedLink?.targetPath ||
		"";
	const absoluteTarget =
		state.kind === "ready" &&
		wikiNav?.vaultPath &&
		state.response.link.targetPath
			? joinVaultPath(wikiNav.vaultPath, state.response.link.targetPath)
			: "";

	return (
		<PlateElement
			{...props}
			as="span"
			className="my-2 block w-full max-w-full align-top"
			attributes={{
				...props.attributes,
				"data-wiki-embed": presentation.kind,
			}}
		>
			<span
				contentEditable={false}
				className={cn(
					"group/embed block max-h-96 overflow-auto rounded-md border border-border bg-muted/20 shadow-sm",
					presentation.kind !== "ready" && "border-dashed",
				)}
			>
				<span className="sticky top-0 z-10 flex items-center justify-between gap-3 border-border border-b bg-background/95 px-3 py-1.5 backdrop-blur">
					<span className="min-w-0 truncate text-muted-foreground text-xs">
						{sourceLabel}
					</span>
					{resolvedLink?.status === "resolved" ? (
						<button
							type="button"
							className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-label={t("embed.openSource", { target: sourceLabel })}
							title={t("embed.openSource", { target: sourceLabel })}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								navigate();
							}}
						>
							<ExternalLink className="size-3.5" aria-hidden />
						</button>
					) : null}
				</span>

				{presentation.kind === "loading" ? (
					<EmbedStatus message={t("embed.loading")} />
				) : presentation.kind === "ready" ? (
					<Suspense fallback={<EmbedStatus message={t("embed.loading")} />}>
						{presentation.response.contentKind === "markdown" ? (
							<WikiEmbedAncestryProvider
								ancestry={[...ancestry, presentation.key]}
							>
								<EmbeddedMarkdownProjection
									key={`${presentation.key}:${wikiNav?.revision ?? 0}`}
									markdown={presentation.response.content ?? ""}
									filePath={absoluteTarget}
								/>
							</WikiEmbedAncestryProvider>
						) : presentation.response.contentKind === "image" ||
							presentation.response.contentKind === "pdf" ? (
							<WikiAttachmentEmbed
								kind={presentation.response.contentKind}
								absoluteTarget={absoluteTarget}
								targetPath={presentation.response.link.targetPath ?? target}
								revision={wikiNav?.revision ?? 0}
								imageSize={element.alias}
							/>
						) : (
							<EmbedStatus message={t("embed.unsupported")} />
						)}
					</Suspense>
				) : (
					<EmbedStatus
						message={t(
							presentation.kind === "invalidFragment"
								? "embed.invalidFragment"
								: `embed.${presentation.kind}`,
						)}
					/>
				)}
			</span>
			{props.children}
		</PlateElement>
	);
}
