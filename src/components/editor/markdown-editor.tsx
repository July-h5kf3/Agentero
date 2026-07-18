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
} from "react";
import { Editor, EditorContainer } from "@/components/editor/editor";
import { MarkdownEditorToolbar } from "@/components/editor/editor-toolbar";
import { ImageElement } from "@/components/editor/image-node";
import { MarkdownDocProvider } from "@/components/editor/markdown-doc-context";
import { MarkdownEditorKit } from "@/components/editor/plugins/markdown-editor-kit";
import i18n from "@/i18n";
import { joinFrontmatter, splitFrontmatter } from "@/lib/markdown-doc";
import {
	collectImageUrlCounts,
	deleteRemovedManagedAssets,
	saveImageToMarkdownAssets,
} from "@/lib/markdown-image";
import { errorMessage, notifyError } from "@/lib/notify";
import { cn } from "@/lib/utils";

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
}: MarkdownEditorProps) {
	const frontmatterRef = useRef("");
	const savedRef = useRef(initialMarkdown);
	const readyRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const filePathRef = useRef(filePath ?? null);
	filePathRef.current = filePath ?? null;
	const onAssetsChangedRef = useRef(onAssetsChanged);
	onAssetsChangedRef.current = onAssetsChanged;
	/** Image URL ref-counts; used to GC `./assets/` when an image node is removed. */
	const imageCountsRef = useRef<Map<string, number> | null>(null);

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
		onDirtyChange?.(false);
		if (filePath && onPersist) onPersist(filePath, md, lastSaved);
	}, [readOnly, serialize, filePath, onPersist, onDirtyChange]);

	// Latest persist closure, for the unmount flush (captures this file's path).
	const persistRef = useRef(persist);
	persistRef.current = persist;

	// Mark ready after the initial normalization pass so opening a file never saves.
	// Seed image URL counts so we only GC assets removed after open.
	// On unmount, flush any pending edit to THIS editor's file.
	useEffect(() => {
		readyRef.current = true;
		imageCountsRef.current = collectImageUrlCounts(editor.children);
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
				persistRef.current();
			}
		};
	}, [editor]);

	const handleChange = useCallback(() => {
		if (readOnly || !readyRef.current) return;

		// When an image node leaves the document, delete its managed `./assets/` file.
		const nextCounts = collectImageUrlCounts(editor.children);
		const prevCounts = imageCountsRef.current;
		imageCountsRef.current = nextCounts;
		const mdPath = filePathRef.current;
		if (prevCounts && mdPath) {
			void deleteRemovedManagedAssets(mdPath, prevCounts, nextCounts).then(
				(n) => {
					if (n > 0) onAssetsChangedRef.current?.();
				},
			);
		}

		onDirtyChange?.(true);
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			persistRef.current();
		}, CHANGE_DEBOUNCE_MS);
	}, [editor, readOnly, onDirtyChange]);

	const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			persistRef.current();
		}
	}, []);

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
						className="agentero-scroll min-h-0 flex-1"
						onKeyDown={readOnly ? undefined : handleKeyDown}
					>
						<Editor
							variant="none"
							placeholder={placeholder}
							readOnly={readOnly}
							className="min-h-full px-6 py-4"
							style={fontSize ? { fontSize } : undefined}
						/>
					</EditorContainer>
				</div>
			</Plate>
		</MarkdownDocProvider>
	);
}
