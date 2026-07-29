"use client";

import { CornerDownLeft, FileText, Hash, TextQuote } from "lucide-react";
import { useEditorRef } from "platejs/react";
import type {
	MutableRefObject,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useMarkdownDoc } from "@/components/editor/markdown-doc-context";
import {
	isWikiLinkDraftText,
	isWikiLinkNode,
	parseWikiLinkMarkdown,
	wikiLinkDraftEditableBounds,
	wikiLinkToMarkdown,
} from "@/components/editor/plugins/wikilink-plugin";
import { ViewportFloating } from "@/components/ui/viewport-floating";
import {
	resolveWikiReference,
	searchWikiLinks,
	type WikiSearchCandidate,
} from "@/lib/wiki";
import { useWikiNav } from "@/lib/wiki/nav-context";
import {
	addRecentWikiCandidate,
	findWikiCompletionMatch,
	isWikiCompletionSubmitKey,
	narrowExactWikiFileCandidates,
	parseWikiCompletionQuery,
	sameWikiPath,
	wikiCompletionCandidateKey,
	wikiCompletionInsert,
} from "@/lib/wiki-completion";

export type WikiCompletionDraft = {
	raw: string;
	embed: boolean;
	left: number;
	top: number;
};

export type WikiCompletionController = {
	handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
};

type WikiLinkSuggestionProps = {
	draft: WikiCompletionDraft | null;
	onClose: () => void;
	onContinue: (raw: string) => void;
	controllerRef: MutableRefObject<WikiCompletionController | null>;
};

type CandidateState = {
	requestKey: string | null;
	items: WikiSearchCandidate[];
};

function completionRequestKey(
	request: ReturnType<typeof parseWikiCompletionQuery>,
): string | null {
	if (!request) return null;
	return request.kind === "file"
		? `file\u0000${request.query}`
		: `${request.kind}\u0000${request.target}\u0000${request.query}`;
}

function CandidateIcon({ kind }: { kind: WikiSearchCandidate["kind"] }) {
	if (kind === "alias") return null;
	const Icon =
		kind === "file" ? FileText : kind === "heading" ? Hash : TextQuote;
	return (
		<Icon
			className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
			aria-hidden
		/>
	);
}

/**
 * File and anchor suggestions are Host-backed. Alias completion is local
 * because it only wraps the already selected target with user-authored text.
 */
export function WikiLinkSuggestion({
	draft,
	onClose,
	onContinue,
	controllerRef,
}: WikiLinkSuggestionProps) {
	const { t } = useTranslation("editor");
	const editor = useEditorRef();
	const { filePath } = useMarkdownDoc();
	const wikiNav = useWikiNav();
	const request = useMemo(
		() => (draft ? parseWikiCompletionQuery(draft.raw) : null),
		[draft],
	);
	const requestKey = completionRequestKey(request);
	const [candidateState, setCandidateState] = useState<CandidateState>({
		requestKey: null,
		items: [],
	});
	const candidates =
		candidateState.requestKey === requestKey ? candidateState.items : [];
	const [recentCandidates, setRecentCandidates] = useState<
		WikiSearchCandidate[]
	>([]);
	const [loading, setLoading] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!candidates[selectedIndex]) return;
		listRef.current
			?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [candidates, selectedIndex]);

	useEffect(() => {
		setSelectedIndex(0);
		if (!request) {
			setCandidateState({ requestKey: null, items: [] });
			setLoading(false);
			return;
		}
		if (request.kind === "alias") {
			setCandidateState({
				requestKey,
				items: [
					{
						kind: "alias",
						path: request.target,
						insertText: request.target,
						label: request.query,
						detail: request.target,
						alias: request.query || undefined,
					},
				],
			});
			setLoading(false);
			return;
		}
		const vaultPath = wikiNav?.vaultPath;
		if (!vaultPath || !filePath) {
			setCandidateState({ requestKey: null, items: [] });
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		void (async () => {
			try {
				if (request.kind === "file") {
					const results = await searchWikiLinks(vaultPath, request.query, {
						kind: "file",
					});
					if (!cancelled) {
						const matching = narrowExactWikiFileCandidates(
							results.filter((candidate) => candidate.kind === "file"),
							request.query,
						);
						if (!request.query) {
							const byKey = new Map(
								matching.map((candidate) => [
									wikiCompletionCandidateKey(candidate),
									candidate,
								]),
							);
							const recent = recentCandidates.flatMap((candidate) => {
								const current = byKey.get(
									wikiCompletionCandidateKey(candidate),
								);
								return current ? [current] : [];
							});
							setCandidateState({
								requestKey,
								items: recent.length ? recent : matching,
							});
							return;
						}
						setCandidateState({ requestKey, items: matching });
					}
					return;
				}
				// Resolve only the file portion before searching its anchors.
				// An empty target intentionally resolves to the source document, so
				// the initial `[[#` / `[[^` trigger can list every local anchor.
				const resolved = await resolveWikiReference(
					vaultPath,
					filePath,
					request.target,
				);
				if (
					cancelled ||
					!resolved?.targetPath ||
					resolved.status === "ambiguous"
				) {
					if (!cancelled) {
						setCandidateState({ requestKey, items: [] });
					}
					return;
				}
				const results = await searchWikiLinks(vaultPath, request.query, {
					path: resolved.targetPath,
					kind: request.kind,
				});
				if (!cancelled) {
					setCandidateState({
						requestKey,
						items: results.filter(
							(candidate) =>
								candidate.kind === request.kind &&
								sameWikiPath(candidate.path, resolved.targetPath ?? ""),
						),
					});
				}
			} catch {
				if (!cancelled) setCandidateState({ requestKey, items: [] });
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [filePath, recentCandidates, request, requestKey, wikiNav?.vaultPath]);

	const selectCandidate = useCallback(
		(candidate: WikiSearchCandidate, submitKey: "Enter" | "Tab" = "Enter") => {
			if (!draft || !request || candidate.kind !== request.kind) return false;
			if (request.kind === "alias" && !request.query) return false;
			const selection = editor.selection;
			if (
				!selection ||
				selection.anchor.path.join(",") !== selection.focus.path.join(",") ||
				selection.anchor.offset !== selection.focus.offset
			) {
				return false;
			}
			const entry = editor.api.node(selection.anchor.path);
			const leaf = entry?.[0];
			if (!leaf || typeof (leaf as { text?: unknown }).text !== "string") {
				return false;
			}
			const match = findWikiCompletionMatch(
				(leaf as { text: string }).text,
				selection.anchor.offset,
				draft.raw,
				draft.embed,
			);
			if (!match) return false;
			const start = {
				path: selection.anchor.path,
				offset: match.start,
			};
			const end = {
				path: selection.anchor.path,
				offset: match.end,
			};
			const insert = wikiCompletionInsert(candidate, request);
			const markdown = wikiLinkToMarkdown({
				value: insert.target,
				heading: insert.heading,
				alias: insert.alias,
				embed: draft.embed,
			});
			const link =
				submitKey === "Enter" ? parseWikiLinkMarkdown(markdown) : null;
			if (submitKey === "Enter" && !link) return false;
			const parentEntry = editor.api.parent(selection.anchor.path);
			const stableLinkPath =
				parentEntry && isWikiLinkNode(parentEntry[0]) ? parentEntry[1] : null;
			controllerRef.current = null;
			editor.tf.delete({ at: { anchor: start, focus: end } });
			if (stableLinkPath) {
				const parsed = parseWikiLinkMarkdown(markdown);
				if (!parsed) return false;
				editor.tf.withoutNormalizing(() => {
					editor.tf.insertText(markdown);
					editor.tf.setNodes(
						{
							value: parsed.value,
							heading: parsed.heading,
							alias: parsed.alias ?? undefined,
							embed: parsed.embed === true ? true : undefined,
						},
						{ at: stableLinkPath },
					);
				});
				if (submitKey === "Tab") {
					const point = {
						path: selection.anchor.path,
						offset: wikiLinkDraftEditableBounds(markdown).end,
					};
					editor.tf.select({ anchor: point, focus: point });
					const bounds = wikiLinkDraftEditableBounds(markdown);
					const nextRaw = markdown.slice(bounds.start, bounds.end);
					const nextRequest = parseWikiCompletionQuery(nextRaw);
					if (nextRequest && candidate.kind === nextRequest.kind) {
						setCandidateState({
							requestKey: completionRequestKey(nextRequest),
							items: [candidate],
						});
						setSelectedIndex(0);
						onContinue(nextRaw);
					} else {
						onClose();
					}
				} else {
					const after = editor.api.after(stableLinkPath);
					if (after) editor.tf.select(after);
					onClose();
				}
				setRecentCandidates((recent) =>
					addRecentWikiCandidate(recent, candidate),
				);
				return true;
			}
			const remainder = editor.api.node(start.path);
			if (remainder && isWikiLinkDraftText(remainder[0])) {
				editor.tf.unsetNodes("wikiLinkDraft", { at: remainder[1] });
			}
			if (submitKey === "Tab") {
				editor.tf.insertNodes({ text: markdown, wikiLinkDraft: true });
				editor.tf.move({ distance: 2, reverse: true });
				const bounds = wikiLinkDraftEditableBounds(markdown);
				const nextRaw = markdown.slice(bounds.start, bounds.end);
				const nextRequest = parseWikiCompletionQuery(nextRaw);
				if (nextRequest && candidate.kind === nextRequest.kind) {
					setCandidateState({
						requestKey: completionRequestKey(nextRequest),
						items: [candidate],
					});
					setSelectedIndex(0);
					onContinue(nextRaw);
				} else {
					onClose();
				}
			} else {
				if (!link) return false;
				editor.tf.insertNodes([link, { text: "" }]);
				onClose();
			}
			setRecentCandidates((recent) =>
				addRecentWikiCandidate(recent, candidate),
			);
			return true;
		},
		[controllerRef, draft, editor, onClose, onContinue, request],
	);

	const handleKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (!draft) return false;
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return true;
			}
			if (event.key === "ArrowDown" && candidates.length) {
				event.preventDefault();
				setSelectedIndex((index) => (index + 1) % candidates.length);
				return true;
			}
			if (event.key === "ArrowUp" && candidates.length) {
				event.preventDefault();
				setSelectedIndex(
					(index) => (index - 1 + candidates.length) % candidates.length,
				);
				return true;
			}
			if (isWikiCompletionSubmitKey(event.key) && candidates[selectedIndex]) {
				if (selectCandidate(candidates[selectedIndex], event.key)) {
					event.preventDefault();
					return true;
				}
				if (request?.kind === "alias" && !request.query) {
					event.preventDefault();
					return true;
				}
			}
			return false;
		},
		[candidates, draft, onClose, request, selectCandidate, selectedIndex],
	);

	useLayoutEffect(() => {
		controllerRef.current = { handleKeyDown };
		return () => {
			controllerRef.current = null;
		};
	}, [controllerRef, handleKeyDown]);

	if (!draft || !request) return null;
	return (
		<ViewportFloating
			point={{ x: draft.left, y: draft.top }}
			className="z-50 flex w-96 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
		>
			<div
				ref={listRef}
				className="max-h-56 overflow-y-auto p-1"
				role="listbox"
				aria-label={t("wikiCompletion.label")}
			>
				{loading ? (
					<p className="px-2 py-1.5 text-muted-foreground text-xs">
						{t("wikiCompletion.loading")}
					</p>
				) : null}
				{!loading && !candidates.length ? (
					<p className="px-2 py-1.5 text-muted-foreground text-xs">
						{t("wikiCompletion.empty")}
					</p>
				) : null}
				{candidates.map((candidate, index) => {
					const detail =
						candidate.kind === "file" ? candidate.path : candidate.detail;
					const isAliasPlaceholder =
						candidate.kind === "alias" && !candidate.label;
					return (
						<button
							key={`${candidate.kind}:${candidate.path}:${candidate.insertText}:${candidate.alias ?? ""}`}
							type="button"
							role="option"
							aria-selected={index === selectedIndex}
							className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs outline-none ${
								index === selectedIndex
									? "bg-accent text-accent-foreground"
									: "hover:bg-accent/60"
							}`}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => selectCandidate(candidate)}
						>
							<CandidateIcon kind={candidate.kind} />
							<span className="min-w-0 flex-1">
								<span
									className={`block truncate font-medium ${
										isAliasPlaceholder ? "text-muted-foreground" : ""
									}`}
								>
									{isAliasPlaceholder
										? t("wikiCompletion.displayName")
										: candidate.label}
								</span>
								{detail ? (
									<span className="block truncate text-muted-foreground">
										{detail}
									</span>
								) : null}
							</span>
							{candidate.kind === "alias" ? (
								<CornerDownLeft
									className="mt-2 size-4 shrink-0 text-muted-foreground"
									aria-hidden
								/>
							) : null}
						</button>
					);
				})}
			</div>
			<p className="shrink-0 border-t px-2 py-1.5 text-[11px] text-muted-foreground text-center leading-4">
				{t("wikiCompletion.syntaxHint")}
			</p>
		</ViewportFloating>
	);
}
