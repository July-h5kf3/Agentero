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
import type { WikiSlateNode } from "@/components/editor/plugins/wikilink-model";
import {
	MAX_WIKI_EMBED_DEPTH,
	useWikiEmbedAncestry,
	WikiEmbedAncestryProvider,
} from "@/components/editor/wiki-embed-context";
import { useWikiEmbedProjection } from "@/components/editor/wiki-embed-projection-context";
import { cn } from "@/lib/core/utils";
import { joinVaultPath } from "@/lib/vault";
import {
	type ResolvedLink,
	readWikiEmbed,
	type WikiEmbedResponse,
} from "@/lib/wiki";
import { useWikiNav } from "@/lib/wiki/nav-context";
import { subscribeWikiEmbedTarget } from "@/lib/wiki-embed-refresh";

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

type CachedEmbedLoad = {
	requestKey: string | null;
	state: EmbedLoadState;
};

const EMBED_CACHE_LIMIT = 128;
const embedStateCache = new Map<string, EmbedLoadState>();
const embedRequestCache = new Map<string, Promise<EmbedLoadState>>();

function embedRequestKey(
	vaultPath: string | null | undefined,
	sourcePath: string | null,
	target: string,
	targetRevision: number,
): string | null {
	if (!vaultPath || !sourcePath) return null;
	return JSON.stringify([vaultPath, sourcePath, target, targetRevision]);
}

function cachedEmbedState(key: string): EmbedLoadState | undefined {
	return embedStateCache.get(key);
}

function retainEmbedState(key: string, state: EmbedLoadState): void {
	if (state.kind === "error" || state.kind === "loading") return;
	embedStateCache.delete(key);
	embedStateCache.set(key, state);
	while (embedStateCache.size > EMBED_CACHE_LIMIT) {
		const oldest = embedStateCache.keys().next().value;
		if (typeof oldest !== "string") break;
		embedStateCache.delete(oldest);
	}
}

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

function loadEmbedState(
	key: string,
	vaultPath: string,
	sourcePath: string,
	target: string,
): Promise<EmbedLoadState> {
	const cached = cachedEmbedState(key);
	if (cached) return Promise.resolve(cached);
	const pending = embedRequestCache.get(key);
	if (pending) return pending;

	const request = readWikiEmbed(vaultPath, sourcePath, target)
		.then((response) => stateFromResponse(response))
		.catch(
			(error): EmbedLoadState => ({
				kind: "error",
				detail: error instanceof Error ? error.message : String(error),
			}),
		)
		.then((state) => {
			retainEmbedState(key, state);
			return state;
		})
		.finally(() => {
			embedRequestCache.delete(key);
		});
	embedRequestCache.set(key, request);
	return request;
}

function EmbedStatus({ message }: { message: string }) {
	return (
		<span className="block px-4 py-3 text-muted-foreground text-sm">
			{message}
		</span>
	);
}

export function WikiEmbedElement({
	editing,
	...props
}: PlateElementProps & { editing: boolean }) {
	const { t } = useTranslation("editor");
	const element = props.element as unknown as WikiSlateNode;
	const wikiNav = useWikiNav();
	const markdownDoc = useMarkdownDoc();
	const ancestry = useWikiEmbedAncestry();
	const EmbeddedMarkdownProjection = useWikiEmbedProjection();

	const target = element.value ?? "";
	const targetWithFragment = element.heading
		? `${target}#${element.heading}`
		: target;
	const [targetRevision, setTargetRevision] = useState(0);
	const requestKey = embedRequestKey(
		wikiNav?.vaultPath,
		markdownDoc.filePath,
		targetWithFragment,
		targetRevision,
	);
	const [load, setLoad] = useState<CachedEmbedLoad>(() => ({
		requestKey,
		state: requestKey
			? (cachedEmbedState(requestKey) ?? { kind: "loading" })
			: {
					kind: "error",
				},
	}));
	const fallbackState =
		load.requestKey === requestKey || !requestKey
			? undefined
			: cachedEmbedState(requestKey);
	const state =
		load.requestKey === requestKey
			? load.state
			: requestKey
				? (fallbackState ?? { kind: "loading" })
				: { kind: "error" as const };

	useEffect(() => {
		const vaultPath = wikiNav?.vaultPath;
		const sourcePath = markdownDoc.filePath;
		if (!vaultPath || !sourcePath || !requestKey) {
			setLoad({ requestKey: null, state: { kind: "error" } });
			return;
		}

		const cached = cachedEmbedState(requestKey);
		if (cached) {
			setLoad((previous) =>
				previous.requestKey === requestKey && previous.state === cached
					? previous
					: { requestKey, state: cached },
			);
			return;
		}

		let cancelled = false;
		setLoad({ requestKey, state: { kind: "loading" } });
		void loadEmbedState(
			requestKey,
			vaultPath,
			sourcePath,
			targetWithFragment,
		).then((nextState) => {
			if (!cancelled) setLoad({ requestKey, state: nextState });
		});
		return () => {
			cancelled = true;
		};
	}, [
		markdownDoc.filePath,
		requestKey,
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

	useEffect(() => {
		if (!absoluteTarget) return;
		return subscribeWikiEmbedTarget(absoluteTarget, () => {
			setTargetRevision((revision) => revision + 1);
		});
	}, [absoluteTarget]);

	return (
		<PlateElement
			{...props}
			as="span"
			className={cn(
				"relative max-w-full align-top",
				editing ? "inline text-foreground" : "my-2 block w-full",
			)}
			attributes={{
				...props.attributes,
				"data-wiki-embed": presentation.kind,
				"data-wiki-source": editing ? "embed" : undefined,
			}}
		>
			<span
				contentEditable={false}
				className={cn(
					"group/embed block max-h-96 overflow-auto rounded-md border border-border bg-muted/20 shadow-sm",
					presentation.kind !== "ready" && "border-dashed",
					editing && "hidden",
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
						{presentation.response.contentKind === "markdown" &&
						EmbeddedMarkdownProjection ? (
							<WikiEmbedAncestryProvider
								ancestry={[...ancestry, presentation.key]}
							>
								<EmbeddedMarkdownProjection
									key={`${presentation.key}:${targetRevision}`}
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
								revision={targetRevision}
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
			<span
				aria-hidden={editing ? undefined : true}
				className={
					editing
						? undefined
						: "pointer-events-none absolute size-px overflow-hidden opacity-0"
				}
			>
				{props.children}
			</span>
		</PlateElement>
	);
}
