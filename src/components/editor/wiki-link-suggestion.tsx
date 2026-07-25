"use client";

import { FileText, Hash, TextQuote } from "lucide-react";
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
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useMarkdownDoc } from "@/components/editor/markdown-doc-context";
import {
	isWikiLinkDraftText,
	wikiLinkToMarkdown,
} from "@/components/editor/plugins/wikilink-plugin";
import {
	resolveWikiReference,
	searchWikiLinks,
	type WikiSearchCandidate,
} from "@/lib/wiki";
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
import { useWikiNav } from "@/lib/wiki-nav-context";

export type WikiCompletionDraft = {
	raw: string;
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
 * Suggestions are deliberately Host-backed. The editor only recognizes the
 * local `[[` trigger and inserts the canonical candidate returned by the
 * resolver; it never derives a target from an unqualified label.
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

	useEffect(() => {
		setSelectedIndex(0);
		const vaultPath = wikiNav?.vaultPath;
		if (!request || !vaultPath || !filePath) {
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
				const targetText = `${request.target}#${
					request.kind === "block" ? "^" : ""
				}${request.query}`;
				const resolved = await resolveWikiReference(
					vaultPath,
					filePath,
					targetText,
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
			controllerRef.current = null;
			editor.tf.delete({ at: { anchor: start, focus: end } });
			const remainder = editor.api.node(start.path);
			if (remainder && isWikiLinkDraftText(remainder[0])) {
				editor.tf.unsetNodes("wikiLinkDraft", { at: remainder[1] });
			}
			if (submitKey === "Tab") {
				const raw = wikiLinkToMarkdown({
					value: insert.target,
					heading: insert.heading,
					alias: insert.alias,
				});
				editor.tf.insertNodes({ text: raw, wikiLinkDraft: true });
				editor.tf.move({ distance: 2, reverse: true });
				const nextRaw = raw.slice(2, -2);
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
				editor.tf.insertNodes([
					{
						type: "wikiLink",
						value: insert.target,
						heading: insert.heading,
						alias: insert.alias ?? null,
						children: [{ text: "" }],
					},
					{ text: "" },
				]);
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
			}
			return false;
		},
		[candidates, draft, onClose, selectCandidate, selectedIndex],
	);

	useLayoutEffect(() => {
		controllerRef.current = { handleKeyDown };
		return () => {
			controllerRef.current = null;
		};
	}, [controllerRef, handleKeyDown]);

	if (!draft || !request) return null;
	return (
		<div
			className="absolute z-50 max-h-56 w-80 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
			style={{ left: draft.left, top: draft.top }}
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
			{candidates.map((candidate, index) => (
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
						<span className="block truncate font-medium">
							{candidate.label}
						</span>
						<span className="block truncate text-muted-foreground">
							{candidate.path}
						</span>
					</span>
				</button>
			))}
		</div>
	);
}
