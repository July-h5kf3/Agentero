"use client";

import { MarkdownPlugin } from "@platejs/markdown";
import { ImagePlugin } from "@platejs/media/react";
import { TocPlugin } from "@platejs/toc/react";
import { RangeApi } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import {
	type FormEvent,
	type KeyboardEvent,
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { MarkdownDocProvider } from "@/components/editor/context/markdown-doc-context";
import { Editor, EditorContainer } from "@/components/editor/editor-surface";
import { WikiEmbedProjectionProvider } from "@/components/editor/embeds/projection-context";
import { useCompletionDrafts } from "@/components/editor/hooks/use-completion-drafts";
import { useEditorContextMenu } from "@/components/editor/hooks/use-editor-context-menu";
import { useMarkdownPersistence } from "@/components/editor/hooks/use-markdown-persistence";
import { useSelectionContextPublish } from "@/components/editor/hooks/use-selection-context-publish";
import { ImageElement } from "@/components/editor/nodes/block/image-node";
import { FindReplaceBar } from "@/components/editor/overlays/find-replace-bar";
import { FrontmatterPanel } from "@/components/editor/overlays/frontmatter-panel";
import { HeadingRenameDialog } from "@/components/editor/overlays/heading-rename-dialog";
import { SlashCommandMenu } from "@/components/editor/overlays/slash-command-menu";
import { TocSidebar } from "@/components/editor/overlays/toc-sidebar";
import { WikiLinkSuggestion } from "@/components/editor/overlays/wiki-link-suggestion";
import { convertBlockquoteMarkerToCallout } from "@/components/editor/plugins/callout-plugin";
import { MarkdownEditorKit } from "@/components/editor/plugins/markdown-editor-kit";
import { MarkdownEditorToolbar } from "@/components/editor/toolbar/markdown-toolbar";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import i18n from "@/i18n";
import { errorMessage, notifyError } from "@/lib/core/notify";
import { cn } from "@/lib/core/utils";
import { prepareMarkdownForDeserialize } from "@/lib/markdown/deserialize";
import { splitFrontmatter } from "@/lib/markdown/doc";
import { editorContextMenuCapabilities } from "@/lib/markdown/editor-context-menu";
import { saveImageToMarkdownAssets } from "@/lib/markdown/image";
import { formatModShortcut } from "@/lib/shell/shortcuts";
import type { LinkFragment, WikiRenameHeadingRequest } from "@/lib/wiki";
import {
	isWikiLinkDraftEditingOffset,
	isWikiLinkDraftText,
	isWikiLinkNode,
	parseWikiLinkMarkdown,
	wikiLinkDraftEditableBounds,
	wikiLinkDraftExteriorPlacement,
	wikiLinkNodeMatchesSource,
	wikiLinkNodeSource,
	wikiLinkToMarkdown,
} from "@/lib/wiki/wikilink-model";
import { wikiLinkArrowDirection } from "@/lib/wiki-completion";
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
	onPersist?: (
		path: string,
		markdown: string,
		lastSaved: string,
	) => Promise<boolean>;
	onDirtyChange?: (dirty: boolean) => void;
	/** After writing an image under `./assets/` (refresh file tree). */
	onAssetsChanged?: () => void;
	/** Explicitly rename one saved heading and repair its inbound fragments. */
	onRenameHeading?: (
		path: string,
		request: Omit<WikiRenameHeadingRequest, "path">,
	) => Promise<void>;
	/** A one-shot request to scroll to a resolved internal-link anchor. */
	navigationIntent?: { id: number; fragment: LinkFragment };
};

const EmbeddedMarkdownProjection = lazy(async () => {
	const module = await import(
		"@/components/editor/embeds/embedded-markdown-projection"
	);
	return { default: module.EmbeddedMarkdownProjection };
});

type WikiLinkExteriorBoundary = {
	path: number[];
	placement: "before" | "after";
	embed: boolean;
	source: "draft" | "stable" | "display";
};

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
	onRenameHeading,
	navigationIntent,
}: MarkdownEditorProps) {
	const filePathRef = useRef(filePath ?? null);
	filePathRef.current = filePath ?? null;
	const onAssetsChangedRef = useRef(onAssetsChanged);
	onAssetsChangedRef.current = onAssetsChanged;
	const editorContainerRef = useRef<HTMLDivElement | null>(null);
	/** Swallow the `beforeinput` insertParagraph that follows slash Enter confirm. */
	const suppressNextEditorBreakRef = useRef(false);
	const syncingWikiLinkPresentationRef = useRef(false);
	const composingWikiLinkDraftRef = useRef(false);
	const wikiLinkPresentationFrameRef = useRef<number | null>(null);
	const wikiLinkPresentationMarkdownRef = useRef<string | null>(null);
	const activeWikiLinkPathRef = useRef<{
		current: number[] | null;
		unref: () => number[] | null;
	} | null>(null);
	const [findOpen, setFindOpen] = useState(false);
	const [findFocusTick, setFindFocusTick] = useState(0);

	useEffect(() => {
		if (!navigationIntent) return;
		const root = editorContainerRef.current;
		if (!root) return;
		const fragment = navigationIntent.fragment;
		// Annotation fragments jump in the PDF viewer, not the Markdown editor.
		if (fragment.kind === "annotation") return;
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
			TocPlugin,
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
			const { body } = splitFrontmatter(initialMarkdown);
			return ed
				.getApi(MarkdownPlugin)
				.markdown.deserialize(prepareMarkdownForDeserialize(body || " "));
		},
	});

	const {
		frontmatterYaml,
		onFrontmatterChange: handleFrontmatterChange,
		serialize,
		noteDocumentChanged,
		saveNow,
		savedRef,
		dirtyRef,
	} = useMarkdownPersistence({
		editor,
		initialMarkdown,
		filePath,
		readOnly,
		onPersist,
		onDirtyChange,
		filePathRef,
		onAssetsChangedRef,
	});

	const {
		wikiCompletionDraft,
		slashCommandDraft,
		completionControllerRef,
		slashCommandControllerRef,
		updateWikiCompletionDraft,
		updateSlashCommandDraft,
		handleMenuKeyDown,
		setWikiCompletionDraft,
		setSlashCommandDraft,
		closeMenus,
	} = useCompletionDrafts({ editor, editorContainerRef });

	const handleChange = useCallback(() => {
		window.requestAnimationFrame(updateWikiCompletionDraft);
		window.requestAnimationFrame(updateSlashCommandDraft);
		noteDocumentChanged();
	}, [noteDocumentChanged, updateSlashCommandDraft, updateWikiCompletionDraft]);

	const expandWikiLinkAt = useCallback(
		(path: number[], cursorOffset: number) => {
			const entry = editor.api.node(path);
			if (!entry || !isWikiLinkNode(entry[0])) return false;
			const sourcePath = [...path, 0];
			let raw = wikiLinkNodeSource(entry[0]);
			if (!raw) {
				raw = wikiLinkToMarkdown(entry[0]);
				wikiLinkPresentationMarkdownRef.current = serialize();
				editor.tf.insertText(raw, {
					at: { path: sourcePath, offset: 0 },
				});
			}
			const point = {
				path: sourcePath,
				offset: Math.max(0, Math.min(cursorOffset, raw.length)),
			};
			editor.tf.select({ anchor: point, focus: point });
			return true;
		},
		[editor, serialize],
	);

	const isSelectionEditingWikiLinkDraft = useCallback(
		(path: number[], raw: string, selection = editor.selection) => {
			if (!selection) return false;
			if (RangeApi.isCollapsed(selection)) {
				return (
					selection.anchor.path.join(",") === path.join(",") &&
					isWikiLinkDraftEditingOffset(raw, selection.anchor.offset)
				);
			}
			const draftRange = editor.api.range(path);
			return draftRange
				? RangeApi.intersection(selection, draftRange) !== null
				: false;
		},
		[editor],
	);

	const selectedWikiLinkPath = useCallback(
		(selection: typeof editor.selection): number[] | null => {
			if (!selection) return null;
			for (const point of [selection.anchor, selection.focus]) {
				const parent = editor.api.parent(point.path);
				if (parent && isWikiLinkNode(parent[0])) return parent[1];
			}
			return null;
		},
		[editor],
	);

	/**
	 * Commit an edited source child back into the stable node's navigation
	 * attributes. Valid links keep the same element identity; invalid syntax is
	 * deliberately unwrapped to ordinary text so user input is never discarded.
	 */
	const syncWikiLinkNodeAt = useCallback(
		(path: number[]) => {
			const entry = editor.api.node(path);
			if (!entry || !isWikiLinkNode(entry[0])) return false;
			const raw = wikiLinkNodeSource(entry[0]);
			const parsed = parseWikiLinkMarkdown(raw);
			if (parsed && wikiLinkNodeMatchesSource(entry[0], parsed)) return true;

			wikiLinkPresentationMarkdownRef.current = serialize();
			if (parsed) {
				editor.tf.setNodes(
					{
						value: parsed.value,
						heading: parsed.heading,
						alias: parsed.alias ?? undefined,
						embed: parsed.embed === true ? true : undefined,
					},
					{ at: path },
				);
				return true;
			}

			const selectionRef = editor.selection
				? editor.api.rangeRef(editor.selection, { affinity: "forward" })
				: null;
			editor.tf.withoutNormalizing(() => {
				editor.tf.removeNodes({ at: path });
				editor.tf.insertNodes({ text: raw }, { at: path });
			});
			const selection = selectionRef?.unref();
			if (selection) editor.tf.select(selection);
			return false;
		},
		[editor, serialize],
	);

	/**
	 * Reify a complete editable source leaf into its display node. Presentation
	 * transitions keep the user's current selection; explicit keyboard exits
	 * request the text point immediately before or after the display node.
	 */
	const reifyWikiLinkDraftAt = useCallback(
		(
			path: number[],
			placement: "preserve" | "before" | "after" | "none" = "preserve",
		) => {
			const entry = editor.api.node(path);
			if (!entry || !isWikiLinkDraftText(entry[0])) return false;
			const parsed = parseWikiLinkMarkdown(entry[0].text);
			if (!parsed) return false;
			let resolvedPlacement = placement;
			if (
				placement === "preserve" &&
				editor.selection &&
				RangeApi.isCollapsed(editor.selection) &&
				editor.selection.anchor.path.join(",") === path.join(",")
			) {
				resolvedPlacement =
					wikiLinkDraftExteriorPlacement(
						entry[0].text,
						editor.selection.anchor.offset,
					) ?? placement;
			}
			wikiLinkPresentationMarkdownRef.current = serialize();
			const selectionRefs: { unref: () => typeof editor.selection }[] = [];
			const linkRefs: { unref: () => number[] | null }[] = [];
			editor.tf.withoutNormalizing(() => {
				if (resolvedPlacement === "preserve" && editor.selection) {
					selectionRefs.push(
						editor.api.rangeRef(editor.selection, { affinity: "forward" }),
					);
				}
				editor.tf.removeNodes({ at: path });
				editor.tf.insertNodes(parsed, { at: path });
				if (resolvedPlacement === "before" || resolvedPlacement === "after") {
					linkRefs.push(editor.api.pathRef(path, { affinity: "forward" }));
				}
			});

			if (resolvedPlacement === "preserve") {
				const selection = selectionRefs[0]?.unref();
				if (selection) editor.tf.select(selection);
				return true;
			}
			if (resolvedPlacement === "none") return true;
			const linkPath = linkRefs[0]?.unref();
			if (!linkPath) return true;
			const cursor =
				resolvedPlacement === "before"
					? editor.api.before(linkPath)
					: editor.api.after(linkPath);
			if (cursor) editor.tf.select(cursor);
			return true;
		},
		[editor, serialize],
	);

	/**
	 * The source/display distinction is a projection of the Slate selection.
	 * A complete draft cannot remain visible when that selection leaves it.
	 */
	const syncWikiLinkPresentation = useCallback(
		(selection: typeof editor.selection) => {
			if (
				syncingWikiLinkPresentationRef.current ||
				composingWikiLinkDraftRef.current
			) {
				return;
			}
			const draftRefs = [...editor.api.nodes({ at: [] })]
				.filter(([node]) => isWikiLinkDraftText(node))
				.filter(([node, path]) => {
					if (!isWikiLinkDraftText(node)) return false;
					return (
						parseWikiLinkMarkdown(node.text) !== null &&
						!isSelectionEditingWikiLinkDraft(path, node.text, selection)
					);
				})
				.map(([, path]) => editor.api.pathRef(path, { affinity: "forward" }));
			const selectedPath = selectedWikiLinkPath(selection);
			const activeRef = activeWikiLinkPathRef.current;
			const activePath = activeRef?.current;
			const selectionStayedInActive =
				activePath &&
				selectedPath &&
				activePath.join(",") === selectedPath.join(",");
			const stablePathToSync =
				activeRef && !selectionStayedInActive ? activeRef.unref() : null;
			if (activeRef && !selectionStayedInActive) {
				activeWikiLinkPathRef.current = null;
			}
			if (
				selectedPath &&
				(!activeWikiLinkPathRef.current ||
					activeWikiLinkPathRef.current.current?.join(",") !==
						selectedPath.join(","))
			) {
				activeWikiLinkPathRef.current = editor.api.pathRef(selectedPath, {
					affinity: "forward",
				});
			}
			if (!draftRefs.length && !stablePathToSync) return;
			syncingWikiLinkPresentationRef.current = true;
			try {
				for (const ref of draftRefs) {
					const path = ref.unref();
					if (path) reifyWikiLinkDraftAt(path);
				}
				if (stablePathToSync) syncWikiLinkNodeAt(stablePathToSync);
			} finally {
				for (const ref of draftRefs) ref.unref();
				syncingWikiLinkPresentationRef.current = false;
			}
		},
		[
			editor,
			isSelectionEditingWikiLinkDraft,
			reifyWikiLinkDraftAt,
			selectedWikiLinkPath,
			syncWikiLinkNodeAt,
		],
	);

	const scheduleWikiLinkPresentationSync = useCallback(() => {
		if (wikiLinkPresentationFrameRef.current !== null) return;
		wikiLinkPresentationFrameRef.current = window.requestAnimationFrame(() => {
			wikiLinkPresentationFrameRef.current = null;
			syncWikiLinkPresentation(editor.selection);
		});
	}, [editor, syncWikiLinkPresentation]);

	useEffect(
		() => () => {
			activeWikiLinkPathRef.current?.unref();
			activeWikiLinkPathRef.current = null;
			if (wikiLinkPresentationFrameRef.current === null) return;
			window.cancelAnimationFrame(wikiLinkPresentationFrameRef.current);
			wikiLinkPresentationFrameRef.current = null;
		},
		[],
	);

	const getWikiLinkExteriorBoundary =
		useCallback((): WikiLinkExteriorBoundary | null => {
			const selection = editor.selection;
			if (!selection || !RangeApi.isCollapsed(selection)) return null;
			const entry = editor.api.node(selection.anchor.path);
			if (!entry) return null;
			if (isWikiLinkDraftText(entry[0])) {
				const parsed = parseWikiLinkMarkdown(entry[0].text);
				if (!parsed) return null;
				const placement = wikiLinkDraftExteriorPlacement(
					entry[0].text,
					selection.anchor.offset,
				);
				return placement
					? {
							path: entry[1],
							placement,
							embed: parsed.embed === true,
							source: "draft",
						}
					: null;
			}
			if (typeof (entry[0] as { text?: unknown }).text !== "string") {
				return null;
			}
			const [leaf, leafPath] = entry as [{ text: string }, number[]];
			const parentEntry = editor.api.parent(leafPath);
			if (!parentEntry || leafPath.length !== parentEntry[1].length + 1) {
				return null;
			}
			if (isWikiLinkNode(parentEntry[0])) {
				const raw = wikiLinkNodeSource(parentEntry[0]);
				const placement = wikiLinkDraftExteriorPlacement(
					raw,
					selection.anchor.offset,
				);
				return placement
					? {
							path: parentEntry[1],
							placement,
							embed: parentEntry[0].embed === true,
							source: "stable",
						}
					: null;
			}
			const [parent, parentPath] = parentEntry as [
				{ children?: unknown[] },
				number[],
			];
			const index = leafPath[leafPath.length - 1];
			const placement =
				selection.anchor.offset === 0
					? ("after" as const)
					: selection.anchor.offset === leaf.text.length
						? ("before" as const)
						: null;
			const adjacentIndex =
				placement === "after"
					? index - 1
					: placement === "before"
						? index + 1
						: -1;
			const adjacent = parent.children?.[adjacentIndex];
			if (!placement || adjacentIndex < 0 || !isWikiLinkNode(adjacent)) {
				return null;
			}
			return {
				path: [...parentPath, adjacentIndex],
				placement,
				embed: adjacent.embed === true,
				source: "display",
			};
		}, [editor]);

	const prepareWikiLinkBoundaryInput = useCallback(
		(boundary: WikiLinkExteriorBoundary) => {
			if (
				boundary.source === "draft" &&
				!reifyWikiLinkDraftAt(boundary.path, boundary.placement)
			) {
				return false;
			}
			if (boundary.source === "stable") {
				const point =
					boundary.placement === "before"
						? editor.api.before(boundary.path)
						: editor.api.after(boundary.path);
				if (!point) return false;
				editor.tf.select(point);
			}
			if (boundary.embed && boundary.placement === "after") {
				editor.tf.insertBreak();
			}
			return true;
		},
		[editor, reifyWikiLinkDraftAt],
	);

	const handleWikiLinkBoundaryBeforeInput = useCallback(
		(event: FormEvent<HTMLDivElement>) => {
			const nativeEvent = event.nativeEvent as InputEvent;
			const inputType = nativeEvent.inputType ?? "";
			// Slash menu confirms with Enter: keydown is preventDefault'd, but
			// WebKit/Tauri still emits beforeinput insertParagraph afterwards,
			// which would put the caret on a new line after the command runs.
			if (
				suppressNextEditorBreakRef.current &&
				(inputType === "insertParagraph" || inputType === "insertLineBreak")
			) {
				event.preventDefault();
				suppressNextEditorBreakRef.current = false;
				return;
			}
			if (nativeEvent.isComposing || !inputType.startsWith("insert")) {
				return;
			}
			if (inputType === "insertParagraph" || inputType === "insertLineBreak") {
				return;
			}
			const text =
				nativeEvent.data ??
				nativeEvent.dataTransfer?.getData("text/plain") ??
				"";
			if (!text) return;
			const boundary = getWikiLinkExteriorBoundary();
			if (
				text === "!" &&
				boundary?.placement === "before" &&
				!boundary.embed &&
				boundary.source !== "draft"
			) {
				const entry = editor.api.node(boundary.path);
				if (!entry || !isWikiLinkNode(entry[0])) return;
				const link = entry[0];
				const raw = wikiLinkNodeSource(link);
				const sourcePath = [...boundary.path, 0];
				editor.tf.withoutNormalizing(() => {
					editor.tf.insertText(raw ? "!" : `!${wikiLinkToMarkdown(link)}`, {
						at: { path: sourcePath, offset: 0 },
					});
					editor.tf.setNodes({ embed: true }, { at: boundary.path });
					const point = { path: sourcePath, offset: 1 };
					editor.tf.select({ anchor: point, focus: point });
				});
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			if (!boundary || !prepareWikiLinkBoundaryInput(boundary)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			editor.tf.insertText(text);
		},
		[editor, getWikiLinkExteriorBoundary, prepareWikiLinkBoundaryInput],
	);

	const handleWikiLinkArrow = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			const direction = wikiLinkArrowDirection(event);
			if (!direction) return false;
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
			const adjacentIndex =
				direction === "backward" && selection.anchor.offset === 0
					? index - 1
					: direction === "forward" &&
							selection.anchor.offset === leaf.text.length
						? index + 1
						: -1;
			const adjacent = parent.children?.[adjacentIndex];
			if (adjacentIndex < 0 || !isWikiLinkNode(adjacent)) return false;
			const isVertical = event.key === "ArrowUp" || event.key === "ArrowDown";
			if (isVertical && !adjacent.embed) return false;
			const raw = wikiLinkNodeSource(adjacent) || wikiLinkToMarkdown(adjacent);
			const { start, end } = wikiLinkDraftEditableBounds(raw);
			const expanded = expandWikiLinkAt(
				[...parentPath, adjacentIndex],
				direction === "backward" ? end : start,
			);
			if (expanded) event.preventDefault();
			return expanded;
		},
		[editor, expandWikiLinkAt],
	);

	const handleWikiLinkBoundaryDelete = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (
				event.key !== "Backspace" ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey
			) {
				return false;
			}
			const boundary = getWikiLinkExteriorBoundary();
			if (
				boundary?.source !== "display" ||
				boundary.placement !== "after" ||
				!boundary.embed
			) {
				return false;
			}
			const entry = editor.api.node(boundary.path);
			if (!entry || !isWikiLinkNode(entry[0])) return false;
			const raw = wikiLinkToMarkdown(entry[0]);
			if (!expandWikiLinkAt(boundary.path, raw.length)) return false;
			const caret = editor.selection?.anchor;
			if (!caret || caret.offset < 1) return false;
			editor.tf.delete({
				at: {
					anchor: { path: caret.path, offset: caret.offset - 1 },
					focus: caret,
				},
			});
			event.preventDefault();
			return true;
		},
		[editor, expandWikiLinkAt, getWikiLinkExteriorBoundary],
	);

	const handleWikiLinkDraftEnter = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (event.key !== "Enter") return false;
			const selection = editor.selection;
			if (
				!selection ||
				selection.anchor.offset !== selection.focus.offset ||
				selection.anchor.path.join(",") !== selection.focus.path.join(",")
			) {
				return false;
			}
			const entry = editor.api.node(selection.anchor.path);
			if (!entry) return false;
			if (!isWikiLinkDraftText(entry[0])) {
				const parentEntry = editor.api.parent(entry[1]);
				if (!parentEntry || !isWikiLinkNode(parentEntry[0])) return false;
				const raw = wikiLinkNodeSource(parentEntry[0]);
				const { end } = wikiLinkDraftEditableBounds(raw);
				if (selection.anchor.offset !== end || !parseWikiLinkMarkdown(raw)) {
					return false;
				}
				syncWikiLinkNodeAt(parentEntry[1]);
				const after = editor.api.after(parentEntry[1]);
				if (!after) return false;
				editor.tf.select(after);
				event.preventDefault();
				editor.tf.insertBreak();
				return true;
			}
			const { end } = wikiLinkDraftEditableBounds(entry[0].text);
			const boundary = getWikiLinkExteriorBoundary();
			const placement =
				selection.anchor.offset === end ? "after" : boundary?.placement;
			const path = boundary?.source === "draft" ? boundary.path : entry[1];
			if (!placement) return false;
			const collapsed = reifyWikiLinkDraftAt(path, placement);
			if (!collapsed) return false;
			event.preventDefault();
			editor.tf.insertBreak();
			return true;
		},
		[
			editor,
			getWikiLinkExteriorBoundary,
			reifyWikiLinkDraftAt,
			syncWikiLinkNodeAt,
		],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			const target = event.target;
			const isEditorTarget =
				target instanceof HTMLElement &&
				target.closest("[data-slate-editor]") !== null &&
				target.closest("input, textarea, select, [contenteditable='false']") ===
					null;
			if (!isEditorTarget) return;

			if (!event.nativeEvent.isComposing) {
				if (
					(event.metaKey || event.ctrlKey) &&
					!event.shiftKey &&
					!event.altKey &&
					event.key.toLowerCase() === "a"
				) {
					// Handle Select All before browser/Slate default handling so
					// the editor selection and the native DOM selection stay in sync.
					event.preventDefault();
					event.stopPropagation();
					const scrollRoot = editorContainerRef.current;
					const scrollTop = scrollRoot?.scrollTop ?? 0;
					const scrollLeft = scrollRoot?.scrollLeft ?? 0;
					editor.tf.selectAll();
					if (scrollRoot) {
						// The selection focus is the document end, so Plate may
						// scroll there while synchronizing the native selection.
						const restoreScroll = () => {
							scrollRoot.scrollTop = scrollTop;
							scrollRoot.scrollLeft = scrollLeft;
						};
						restoreScroll();
						window.requestAnimationFrame(() => {
							restoreScroll();
							window.requestAnimationFrame(restoreScroll);
						});
					}
					return;
				}
				if (handleMenuKeyDown(event)) {
					event.stopPropagation();
					return;
				}
				if (handleWikiLinkBoundaryDelete(event)) {
					event.stopPropagation();
					return;
				}
				if (handleWikiLinkArrow(event)) {
					event.stopPropagation();
					return;
				}
				if (handleWikiLinkDraftEnter(event)) {
					event.stopPropagation();
					return;
				}
				if (event.key === "Enter" && convertBlockquoteMarkerToCallout(editor)) {
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				if (event.key === "Escape") {
					closeMenus();
					setFindOpen(false);
				}
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.shiftKey &&
				!event.altKey &&
				event.key.toLowerCase() === "f"
			) {
				event.preventDefault();
				event.stopPropagation();
				setFindOpen(true);
				setFindFocusTick((tick) => tick + 1);
				return;
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				saveNow();
			}
		},
		[
			editor,
			handleWikiLinkArrow,
			handleWikiLinkBoundaryDelete,
			handleWikiLinkDraftEnter,
			saveNow,
			handleMenuKeyDown,
			closeMenus,
		],
	);

	/**
	 * A cursor crossing a display-node boundary creates a marked, ordinary text
	 * leaf. On blur, reify only complete valid syntax; unfinished text deliberately stays
	 * as text so IME composition, deletion, and pasted drafts retain normal
	 * editor semantics.
	 */
	const finalizeWikiLinkDrafts = useCallback(() => {
		const draftRefs = [...editor.api.nodes({ at: [] })]
			.filter(([node]) => isWikiLinkDraftText(node))
			.map(([, path]) => editor.api.pathRef(path, { affinity: "forward" }));
		if (!draftRefs.length) return;
		syncingWikiLinkPresentationRef.current = true;
		try {
			editor.tf.withoutNormalizing(() => {
				for (const ref of draftRefs) {
					const path = ref.unref();
					if (!path) continue;
					const entry = editor.api.node(path);
					const node = entry?.[0];
					if (!isWikiLinkDraftText(node)) continue;
					if (!parseWikiLinkMarkdown(node.text)) {
						editor.tf.unsetNodes("wikiLinkDraft", { at: path });
						continue;
					}
					reifyWikiLinkDraftAt(path, "none");
				}
			});
		} finally {
			for (const ref of draftRefs) ref.unref();
			syncingWikiLinkPresentationRef.current = false;
		}
		syncWikiLinkPresentation(null);
	}, [editor, reifyWikiLinkDraftAt, syncWikiLinkPresentation]);

	const handleEditorBlur = useCallback(
		(event: React.FocusEvent<HTMLDivElement>) => {
			if (event.currentTarget.contains(event.relatedTarget)) return;
			// Completion menus portal to document.body — focus moving into them
			// must not dismiss the list (arrow/click interaction).
			const related = event.relatedTarget;
			if (
				related instanceof Element &&
				related.closest("[data-editor-completion]")
			) {
				return;
			}
			closeMenus();
			finalizeWikiLinkDrafts();
		},
		[closeMenus, finalizeWikiLinkDrafts],
	);

	const handleWikiLinkCompositionStart = useCallback(() => {
		composingWikiLinkDraftRef.current = true;
		const boundary = getWikiLinkExteriorBoundary();
		if (boundary) {
			prepareWikiLinkBoundaryInput(boundary);
		}
	}, [getWikiLinkExteriorBoundary, prepareWikiLinkBoundaryInput]);

	const handleWikiLinkCompositionEnd = useCallback(() => {
		composingWikiLinkDraftRef.current = false;
		scheduleWikiLinkPresentationSync();
	}, [scheduleWikiLinkPresentationSync]);

	const {
		selectionExpanded: contextMenuSelectionExpanded,
		onContextMenu: handleEditorContextMenu,
		onOpenChange: handleContextMenuOpenChange,
		copy: handleContextMenuCopy,
		cut: handleContextMenuCut,
		paste: handleContextMenuPaste,
		insertLink: insertContextMenuLink,
		formatMarkdown: handleContextMenuFormatMarkdown,
		formatting: formattingMarkdown,
		headingContext,
		renameOpen: headingRenameOpen,
		setRenameOpen: setHeadingRenameOpen,
		renameBusy: headingRenameBusy,
		confirmRename: confirmHeadingRename,
	} = useEditorContextMenu({
		editor,
		editorContainerRef,
		readOnly,
		serialize,
		savedRef,
		dirtyRef,
		filePathRef,
		onRenameHeading,
		updateWikiCompletionDraft,
	});

	const docCtx = useMemo(
		() => ({
			filePath: filePath ?? null,
			onAssetsChanged,
		}),
		[filePath, onAssetsChanged],
	);

	const scheduleSelectionContextPublish = useSelectionContextPublish({
		editor,
		filePathRef,
	});

	const handleEditorValueChange = useCallback(() => {
		const presentationMarkdown = wikiLinkPresentationMarkdownRef.current;
		if (presentationMarkdown !== null) {
			wikiLinkPresentationMarkdownRef.current = null;
			window.requestAnimationFrame(updateWikiCompletionDraft);
			scheduleWikiLinkPresentationSync();
			if (serialize() === presentationMarkdown) return;
		}
		handleChange();
		scheduleWikiLinkPresentationSync();
	}, [
		handleChange,
		scheduleWikiLinkPresentationSync,
		serialize,
		updateWikiCompletionDraft,
	]);
	const contextMenuCapabilities = editorContextMenuCapabilities({
		headingRenameAvailable: Boolean(headingContext),
		readOnly: Boolean(readOnly),
		selectionExpanded: contextMenuSelectionExpanded,
	});

	return (
		<WikiEmbedProjectionProvider component={EmbeddedMarkdownProjection}>
			<MarkdownDocProvider value={docCtx}>
				<Plate
					editor={editor}
					onSelectionChange={() => {
						syncWikiLinkPresentation(editor.selection);
						// Re-anchor or dismiss completion from caret moves (not only
						// document edits) so arrow navigation cannot leave a stale menu.
						window.requestAnimationFrame(updateWikiCompletionDraft);
						window.requestAnimationFrame(updateSlashCommandDraft);
						scheduleSelectionContextPublish();
					}}
					onValueChange={handleEditorValueChange}
				>
					<div
						className={cn(
							"flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
							className,
						)}
					>
						{showToolbar && !readOnly ? (
							<MarkdownEditorToolbar
								onOpenFind={() => {
									setFindOpen(true);
									setFindFocusTick((tick) => tick + 1);
								}}
								propertiesPanel={
									<FrontmatterPanel
										value={frontmatterYaml}
										readOnly={readOnly}
										onChange={readOnly ? undefined : handleFrontmatterChange}
									/>
								}
							/>
						) : null}
						<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
							<div className="relative min-h-0 min-w-0 flex-1">
								<ContextMenu onOpenChange={handleContextMenuOpenChange}>
									<ContextMenuTrigger asChild>
										<EditorContainer
											ref={editorContainerRef}
											className="agentero-scroll h-full min-w-0 overflow-y-auto"
											onScrollCapture={() => {
												// Reposition instead of hard-dismiss: arrow-key list
												// updates can reflow and fire scroll without leaving [[.
												window.requestAnimationFrame(updateWikiCompletionDraft);
												window.requestAnimationFrame(updateSlashCommandDraft);
											}}
											onContextMenuCapture={handleEditorContextMenu}
											onKeyDownCapture={readOnly ? undefined : handleKeyDown}
											onBeforeInputCapture={
												readOnly ? undefined : handleWikiLinkBoundaryBeforeInput
											}
											onBlur={readOnly ? undefined : handleEditorBlur}
											onCompositionStartCapture={
												readOnly ? undefined : handleWikiLinkCompositionStart
											}
											onCompositionEndCapture={
												readOnly ? undefined : handleWikiLinkCompositionEnd
											}
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
													onContinue={(raw) =>
														setWikiCompletionDraft((current) =>
															current ? { ...current, raw } : current,
														)
													}
													controllerRef={completionControllerRef}
												/>
											) : null}
											{!readOnly ? (
												<SlashCommandMenu
													draft={slashCommandDraft}
													onClose={() => setSlashCommandDraft(null)}
													controllerRef={slashCommandControllerRef}
													onCommandExecuted={() => {
														suppressNextEditorBreakRef.current = true;
														// Clear if beforeinput never arrives (some engines).
														window.setTimeout(() => {
															suppressNextEditorBreakRef.current = false;
														}, 100);
													}}
												/>
											) : null}
										</EditorContainer>
									</ContextMenuTrigger>
									<ContextMenuContent className="w-56">
										<ContextMenuItem
											disabled={!contextMenuCapabilities.cut}
											onSelect={() => {
												void handleContextMenuCut();
											}}
										>
											{i18n.t("editor:contextMenu.cut")}
											<ContextMenuShortcut>
												{formatModShortcut("x")}
											</ContextMenuShortcut>
										</ContextMenuItem>
										<ContextMenuItem
											disabled={!contextMenuCapabilities.copy}
											onSelect={() => {
												void handleContextMenuCopy();
											}}
										>
											{i18n.t("editor:contextMenu.copy")}
											<ContextMenuShortcut>
												{formatModShortcut("c")}
											</ContextMenuShortcut>
										</ContextMenuItem>
										<ContextMenuItem
											disabled={!contextMenuCapabilities.paste}
											onSelect={() => {
												void handleContextMenuPaste();
											}}
										>
											{i18n.t("editor:contextMenu.paste")}
											<ContextMenuShortcut>
												{formatModShortcut("v")}
											</ContextMenuShortcut>
										</ContextMenuItem>
										<ContextMenuSeparator />
										<ContextMenuItem
											disabled={
												!contextMenuCapabilities.formatMarkdown ||
												formattingMarkdown
											}
											onSelect={() => {
												void handleContextMenuFormatMarkdown();
											}}
										>
											{i18n.t(
												formattingMarkdown
													? "editor:contextMenu.formatMarkdownBusy"
													: "editor:contextMenu.formatMarkdown",
											)}
										</ContextMenuItem>
										<ContextMenuSeparator />
										<ContextMenuItem
											disabled={!contextMenuCapabilities.insertLink}
											onSelect={() => insertContextMenuLink("wiki")}
										>
											{i18n.t("editor:contextMenu.insertWikiLink")}
										</ContextMenuItem>
										<ContextMenuItem
											disabled={!contextMenuCapabilities.insertLink}
											onSelect={() => insertContextMenuLink("external")}
										>
											{i18n.t("editor:contextMenu.insertExternalLink")}
										</ContextMenuItem>
										<ContextMenuSeparator />
										<ContextMenuItem
											disabled={!contextMenuCapabilities.renameHeading}
											onSelect={() => {
												if (headingContext) setHeadingRenameOpen(true);
											}}
										>
											{i18n.t("editor:headingRename.menu")}
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
								{findOpen && !readOnly ? (
									<FindReplaceBar
										focusTick={findFocusTick}
										onClose={() => {
											setFindOpen(false);
											editor.tf.focus();
										}}
									/>
								) : null}
								<TocSidebar rootMargin="-8px 0px -80% 0px" topOffset={16} />
							</div>
						</div>
						<HeadingRenameDialog
							open={headingRenameOpen}
							heading={headingContext}
							busy={headingRenameBusy}
							onOpenChange={setHeadingRenameOpen}
							onConfirm={confirmHeadingRename}
						/>
					</div>
				</Plate>
			</MarkdownDocProvider>
		</WikiEmbedProjectionProvider>
	);
}
