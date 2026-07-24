"use client";

import "katex/dist/katex.min.css";
import { MarkdownPlugin } from "@platejs/markdown";
import { ImagePlugin } from "@platejs/media/react";
import { Plate, usePlateEditor } from "platejs/react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Editor, EditorContainer } from "@/components/editor/editor";
import { MarkdownEditorToolbar } from "@/components/editor/editor-toolbar";
import { ImageElement } from "@/components/editor/image-node";
import { MarkdownDocProvider } from "@/components/editor/markdown-doc-context";
import { MarkdownEditorKit } from "@/components/editor/plugins/markdown-editor-kit";
import {
	isWikiLinkDraftText,
	isWikiLinkNode,
	parseWikiLinkMarkdown,
	wikiLinkToMarkdown,
} from "@/components/editor/plugins/wikilink-plugin";
import {
	type WikiCompletionController,
	type WikiCompletionDraft,
	WikiLinkSuggestion,
} from "@/components/editor/wiki-link-suggestion";
import i18n from "@/i18n";
import { joinFrontmatter, splitFrontmatter } from "@/lib/markdown-doc";
import {
	collectImageUrlCounts,
	createManagedAssetGc,
	saveImageToMarkdownAssets,
} from "@/lib/markdown-image";
import { errorMessage, notifyError } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { LinkFragment } from "@/lib/wiki";
import {
	findWikiHeadingIndex,
	hasWikiBlockAnchor,
} from "@/lib/wiki-navigation";

export type MarkdownEditorProps = {
	/** Initial Markdown content for the open file. The component reseeds on remount (key). */
	initialMarkdown: string;
	/**
	 * Absolute path this editor instance persists to. Captured for the lifetime of the
	 * instance (parent keys the editor per file), so autosave and unmount-flush always
	 * write to the correct file even when switching files quickly. Null disables saving.
	 */
	filePath?: string | null;
	readOnly?: boolean;
	placeholder?: string;
	className?: string;
	fontSize?: number | string;
	/** Show the WYSIWYG formatting toolbar above the editor. */
	showToolbar?: boolean;
	/**
	 * Persist serialized Markdown (frontmatter re-attached) to `path`.
	 * `lastSaved` is the content currently believed to be on disk (the previous
	 * persist / load seed) so the host can detect external modifications and avoid
	 * silently overwriting them.
	 */
	onPersist?: (path: string, markdown: string, lastSaved: string) => void;
	onDirtyChange?: (dirty: boolean) => void;
	/** After writing an image under `./assets/` (refresh file tree). */
	onAssetsChanged?: () => void;
	/** A one-shot request to scroll to a resolved internal-link anchor. */
	navigationIntent?: { id: number; fragment: LinkFragment };
};

const CHANGE_DEBOUNCE_MS = 500;

export function MarkdownEditor({
	initialMarkdown,
	filePath,
	readOnly,
	placeholder,
	className,
	fontSize,
	showToolbar,
	onPersist,
	onDirtyChange,
	onAssetsChanged,
	navigationIntent,
}: MarkdownEditorProps) {
	const frontmatterRef = useRef("");
	const savedRef = useRef(initialMarkdown);
	const readyRef = useRef(false);
	/**
	 * Tracks the dirty flag so `onDirtyChange` fires only on a real transition.
	 * Without this, every keystroke would call it and re-render the whole app
	 * (the tab-bar unsaved indicator), which made editing laggy on large notes.
	 */
	const dirtyRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const filePathRef = useRef(filePath ?? null);
	filePathRef.current = filePath ?? null;
	const onAssetsChangedRef = useRef(onAssetsChanged);
	onAssetsChangedRef.current = onAssetsChanged;
	/** Image URL ref-counts; used to GC `./assets/` when an image node is removed. */
	const imageCountsRef = useRef<Map<string, number> | null>(null);
	/**
	 * Debounced asset GC so cut → paste / undo still finds the file.
	 * Immediate delete used to leave a live `./assets/…` node with a missing file.
	 */
	const assetGcRef = useRef(
		createManagedAssetGc({
			onDeleted: () => {
				onAssetsChangedRef.current?.();
			},
		}),
	);
	const editorContainerRef = useRef<HTMLDivElement | null>(null);
	const completionControllerRef = useRef<WikiCompletionController | null>(null);
	const [wikiCompletionDraft, setWikiCompletionDraft] =
		useState<WikiCompletionDraft | null>(null);

	useEffect(() => {
		if (!navigationIntent) return;
		const root = editorContainerRef.current;
		if (!root) return;
		const fragment = navigationIntent.fragment;
		const headings = [
			...root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"),
		];
		const target =
			fragment.kind === "heading"
				? headings[
						findWikiHeadingIndex(
							headings.map((element) => ({
								level: Number(element.tagName.slice(1)),
								text: element.textContent ?? "",
							})),
							fragment.path,
						)
					]
				: [...root.querySelectorAll<HTMLElement>("p,li,blockquote,td")].find(
						(element) =>
							hasWikiBlockAnchor(element.textContent ?? "", fragment.id),
					);
		if (!target) return;
		target.dataset.navTarget = "true";
		target.scrollIntoView({ behavior: "smooth", block: "center" });
		const timeout = window.setTimeout(() => {
			delete target.dataset.navTarget;
		}, 1600);
		return () => window.clearTimeout(timeout);
	}, [navigationIntent]);

	/**
	 * ImagePlugin must declare `uploadImage` in its initial options store.
	 * Plate `setOption` only accepts keys already present — configure at plugin
	 * creation (refs keep the handler current without recreating the editor).
	 */
	const plugins = useMemo(
		() => [
			...MarkdownEditorKit,
			ImagePlugin.configure({
				options: {
					uploadImage: async (dataUrl: ArrayBuffer | string) => {
						const path = filePathRef.current;
						if (!path) {
							const err = new Error(i18n.t("editor:image.noFile"));
							notifyError(err.message);
							throw err;
						}
						try {
							const rel = await saveImageToMarkdownAssets(path, dataUrl);
							onAssetsChangedRef.current?.();
							return rel;
						} catch (e) {
							notifyError(errorMessage(e));
							throw e;
						}
					},
				},
			}).withComponent(ImageElement),
		],
		[],
	);

	const editor = usePlateEditor({
		plugins,
		value: (ed) => {
			const { frontmatter, body } = splitFrontmatter(initialMarkdown);
			frontmatterRef.current = frontmatter;
			return ed.getApi(MarkdownPlugin).markdown.deserialize(body || " ");
		},
	});

	/**
	 * The suggestion component owns Host queries; this editor-side probe only
	 * identifies a live `[[` inside an editable text leaf and anchors the menu.
	 * Checking the DOM code ancestor avoids turning code examples into links.
	 */
	const updateWikiCompletionDraft = useCallback(() => {
		const container = editorContainerRef.current;
		const nativeSelection = window.getSelection();
		const anchor = nativeSelection?.anchorNode;
		if (!container || !nativeSelection?.isCollapsed || !anchor) {
			setWikiCompletionDraft(null);
			return;
		}
		const anchorElement =
			anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : null;
		if (
			!anchorElement ||
			!container.contains(anchorElement) ||
			anchorElement.closest("code, pre")
		) {
			setWikiCompletionDraft(null);
			return;
		}
		const textBeforeCursor = (anchor.textContent ?? "").slice(
			0,
			nativeSelection.anchorOffset,
		);
		const triggerIndex = textBeforeCursor.lastIndexOf("[[");
		const raw = textBeforeCursor.slice(triggerIndex + 2);
		if (triggerIndex < 0 || /[\]\n|]/.test(raw)) {
			setWikiCompletionDraft(null);
			return;
		}
		if (!nativeSelection.rangeCount) {
			setWikiCompletionDraft(null);
			return;
		}
		const cursor = nativeSelection.getRangeAt(0).getBoundingClientRect();
		const bounds = container.getBoundingClientRect();
		setWikiCompletionDraft({
			raw,
			left: Math.max(8, cursor.left - bounds.left),
			top: cursor.bottom - bounds.top + container.scrollTop + 4,
		});
	}, []);

	const serialize = useCallback(() => {
		const body = editor.getApi(MarkdownPlugin).markdown.serialize();
		return joinFrontmatter(frontmatterRef.current, body);
	}, [editor]);

	const persist = useCallback(() => {
		if (readOnly) return;
		const md = serialize();
		if (md === savedRef.current) return;
		if (!md.trim() && savedRef.current.trim()) return;
		const lastSaved = savedRef.current;
		savedRef.current = md;
		if (dirtyRef.current) {
			dirtyRef.current = false;
			onDirtyChange?.(false);
		}
		if (filePath && onPersist) onPersist(filePath, md, lastSaved);
	}, [readOnly, serialize, filePath, onPersist, onDirtyChange]);

	// Latest persist closure, for the unmount flush (captures this file's path).
	const persistRef = useRef(persist);
	persistRef.current = persist;

	// Mark ready after the initial normalization pass so opening a file never saves.
	// Seed image URL counts so we only GC assets removed after open.
	// On unmount, flush pending edit + deferred asset GC for this file.
	useEffect(() => {
		readyRef.current = true;
		imageCountsRef.current = collectImageUrlCounts(editor.children);
		const assetGc = assetGcRef.current;
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
				persistRef.current();
			}
			void assetGc.flush();
		};
	}, [editor]);

	const handleChange = useCallback(() => {
		window.requestAnimationFrame(updateWikiCompletionDraft);
		if (readOnly || !readyRef.current) return;

		// Schedule (or cancel) managed asset GC from ref-count deltas.
		const nextCounts = collectImageUrlCounts(editor.children);
		const prevCounts = imageCountsRef.current;
		imageCountsRef.current = nextCounts;
		const mdPath = filePathRef.current;
		// Skip bookkeeping for image-free notes — the common case.
		if (mdPath && prevCounts && (prevCounts.size || nextCounts.size)) {
			assetGcRef.current.observe(mdPath, prevCounts, nextCounts);
		}

		// Mark dirty once (not on every keystroke) to avoid re-rendering the app.
		if (!dirtyRef.current) {
			dirtyRef.current = true;
			onDirtyChange?.(true);
		}
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			persistRef.current();
		}, CHANGE_DEBOUNCE_MS);
	}, [editor, readOnly, onDirtyChange, updateWikiCompletionDraft]);

	const expandWikiLinkAt = useCallback(
		(path: number[], cursorOffset: number) => {
			const entry = editor.api.node(path);
			if (!entry || !isWikiLinkNode(entry[0])) return false;
			const raw = wikiLinkToMarkdown(entry[0]);
			editor.tf.withoutNormalizing(() => {
				editor.tf.removeNodes({ at: path });
				editor.tf.insertNodes({ text: raw, wikiLinkDraft: true }, { at: path });
				editor.tf.select({
					anchor: { path, offset: cursorOffset },
					focus: { path, offset: cursorOffset },
				});
			});
			return true;
		},
		[editor],
	);

	const collapseWikiLinkDraftAt = useCallback(
		(path: number[], direction: "left" | "right") => {
			const entry = editor.api.node(path);
			if (!entry || !isWikiLinkDraftText(entry[0])) return false;
			const parsed = parseWikiLinkMarkdown(entry[0].text);
			if (!parsed) return false;
			const cursorPath =
				direction === "left"
					? path
					: [...path.slice(0, -1), path[path.length - 1] + 1];
			editor.tf.withoutNormalizing(() => {
				editor.tf.removeNodes({ at: path });
				editor.tf.insertNodes(
					direction === "left"
						? [{ text: "" }, parsed]
						: [parsed, { text: "" }],
					{ at: path },
				);
				editor.tf.select({
					anchor: { path: cursorPath, offset: 0 },
					focus: { path: cursorPath, offset: 0 },
				});
			});
			return true;
		},
		[editor],
	);

	const handleWikiLinkArrow = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
			const selection = editor.selection;
			if (
				!selection ||
				selection.anchor.offset !== selection.focus.offset ||
				selection.anchor.path.join(",") !== selection.focus.path.join(",")
			) {
				return false;
			}
			const entry = editor.api.node(selection.anchor.path);
			if (!entry || typeof (entry[0] as { text?: unknown }).text !== "string") {
				return false;
			}
			const [leaf, leafPath] = entry as [{ text: string }, number[]];
			if (isWikiLinkDraftText(leaf)) {
				const leavesDraft =
					(event.key === "ArrowLeft" && selection.anchor.offset === 0) ||
					(event.key === "ArrowRight" &&
						selection.anchor.offset === leaf.text.length);
				if (!leavesDraft) return false;
				const collapsed = collapseWikiLinkDraftAt(
					leafPath,
					event.key === "ArrowLeft" ? "left" : "right",
				);
				if (collapsed) event.preventDefault();
				return collapsed;
			}
			const parentEntry = editor.api.parent(leafPath);
			if (!parentEntry || leafPath.length !== parentEntry[1].length + 1) {
				return false;
			}
			const [parent, parentPath] = parentEntry as [
				{ children?: unknown[] },
				number[],
			];
			const index = leafPath[leafPath.length - 1];
			const adjacentIndex =
				event.key === "ArrowLeft" && selection.anchor.offset === 0
					? index - 1
					: event.key === "ArrowRight" &&
							selection.anchor.offset === leaf.text.length
						? index + 1
						: -1;
			const adjacent = parent.children?.[adjacentIndex];
			if (adjacentIndex < 0 || !isWikiLinkNode(adjacent)) return false;
			const raw = wikiLinkToMarkdown(adjacent);
			const expanded = expandWikiLinkAt(
				[...parentPath, adjacentIndex],
				event.key === "ArrowLeft" ? raw.length : 0,
			);
			if (expanded) event.preventDefault();
			return expanded;
		},
		[collapseWikiLinkDraftAt, editor, expandWikiLinkAt],
	);

	const expandWikiLinkAtSelectionBoundary = useCallback(() => {
		const selection = editor.selection;
		if (
			!selection ||
			selection.anchor.offset !== selection.focus.offset ||
			selection.anchor.path.join(",") !== selection.focus.path.join(",")
		) {
			return false;
		}
		const entry = editor.api.node(selection.anchor.path);
		if (!entry || typeof (entry[0] as { text?: unknown }).text !== "string") {
			return false;
		}
		const [leaf, leafPath] = entry as [{ text: string }, number[]];
		if (isWikiLinkDraftText(leaf)) return false;
		const parentEntry = editor.api.parent(leafPath);
		if (!parentEntry || leafPath.length !== parentEntry[1].length + 1) {
			return false;
		}
		const [parent, parentPath] = parentEntry as [
			{ children?: unknown[] },
			number[],
		];
		const index = leafPath[leafPath.length - 1];
		const previous = parent.children?.[index - 1];
		if (selection.anchor.offset === 0 && isWikiLinkNode(previous)) {
			return expandWikiLinkAt(
				[...parentPath, index - 1],
				wikiLinkToMarkdown(previous).length,
			);
		}
		const next = parent.children?.[index + 1];
		if (selection.anchor.offset === leaf.text.length && isWikiLinkNode(next)) {
			return expandWikiLinkAt([...parentPath, index + 1], 0);
		}
		return false;
	}, [editor, expandWikiLinkAt]);

	const handleWikiLinkBoundaryTextInput = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (
				event.key.length !== 1 ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			) {
				return false;
			}
			const selection = editor.selection;
			if (
				!selection ||
				selection.anchor.offset !== selection.focus.offset ||
				selection.anchor.path.join(",") !== selection.focus.path.join(",")
			) {
				return false;
			}
			const entry = editor.api.node(selection.anchor.path);
			if (!entry || !isWikiLinkDraftText(entry[0])) return false;
			const offset = selection.anchor.offset;
			if (offset !== 0 && offset !== entry[0].text.length) return false;
			return collapseWikiLinkDraftAt(entry[1], offset === 0 ? "left" : "right");
		},
		[collapseWikiLinkDraftAt, editor],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (!event.nativeEvent.isComposing) {
				if (completionControllerRef.current?.handleKeyDown(event)) {
					event.stopPropagation();
					return;
				}
				if (handleWikiLinkArrow(event)) {
					event.stopPropagation();
					return;
				}
				if (handleWikiLinkBoundaryTextInput(event)) {
					event.stopPropagation();
					return;
				}
				if (event.key === "Escape") setWikiCompletionDraft(null);
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				if (timerRef.current) {
					clearTimeout(timerRef.current);
					timerRef.current = null;
				}
				persistRef.current();
			}
		},
		[handleWikiLinkArrow, handleWikiLinkBoundaryTextInput],
	);

	const handleEditorSelect = useCallback(() => {
		window.requestAnimationFrame(() => {
			expandWikiLinkAtSelectionBoundary();
		});
	}, [expandWikiLinkAtSelectionBoundary]);

	/**
	 * A cursor crossing a display-node boundary creates a marked, ordinary text
	 * leaf. On blur, reify only complete valid syntax; unfinished text deliberately stays
	 * as text so IME composition, deletion, and pasted drafts retain normal
	 * editor semantics.
	 */
	const collapseWikiLinkDrafts = useCallback(() => {
		const drafts = [...editor.api.nodes({ at: [] })].filter(([node]) =>
			isWikiLinkDraftText(node),
		);
		if (!drafts.length) return;
		editor.tf.withoutNormalizing(() => {
			for (const [node, path] of drafts) {
				if (!isWikiLinkDraftText(node)) continue;
				const parsed = parseWikiLinkMarkdown(node.text);
				if (!parsed) {
					editor.tf.unsetNodes("wikiLinkDraft", { at: path });
					continue;
				}
				editor.tf.removeNodes({ at: path });
				editor.tf.insertNodes(parsed, { at: path });
			}
		});
	}, [editor]);

	const handleEditorBlur = useCallback(
		(event: React.FocusEvent<HTMLDivElement>) => {
			if (event.currentTarget.contains(event.relatedTarget)) return;
			collapseWikiLinkDrafts();
		},
		[collapseWikiLinkDrafts],
	);

	const docCtx = useMemo(
		() => ({
			filePath: filePath ?? null,
			onAssetsChanged,
		}),
		[filePath, onAssetsChanged],
	);

	return (
		<MarkdownDocProvider value={docCtx}>
			<Plate editor={editor} onValueChange={handleChange}>
				<div className={cn("flex h-full min-h-0 flex-col", className)}>
					{showToolbar && !readOnly ? <MarkdownEditorToolbar /> : null}
					<EditorContainer
						ref={editorContainerRef}
						className="agentero-scroll min-h-0 flex-1"
						onKeyDownCapture={readOnly ? undefined : handleKeyDown}
						onBlur={readOnly ? undefined : handleEditorBlur}
						onSelectCapture={readOnly ? undefined : handleEditorSelect}
					>
						{/*
						 * min-h-full + generous bottom padding so the last line is easy
						 * to click and Enter can always create a new block below it
						 * (matches Plate default variant pb-72).
						 */}
						<Editor
							variant="none"
							placeholder={placeholder}
							readOnly={readOnly}
							className="min-h-full px-6 pt-4 pb-48"
							style={fontSize ? { fontSize } : undefined}
						/>
						{!readOnly ? (
							<WikiLinkSuggestion
								draft={wikiCompletionDraft}
								onClose={() => setWikiCompletionDraft(null)}
								controllerRef={completionControllerRef}
							/>
						) : null}
					</EditorContainer>
				</div>
			</Plate>
		</MarkdownDocProvider>
	);
}
