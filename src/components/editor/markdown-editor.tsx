"use client";

import "katex/dist/katex.min.css";
import { MarkdownPlugin } from "@platejs/markdown";
import { Plate, usePlateEditor } from "platejs/react";
import {
	forwardRef,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import { Editor, EditorContainer } from "@/components/editor/editor";
import { MarkdownEditorToolbar } from "@/components/editor/editor-toolbar";
import { MarkdownEditorKit } from "@/components/editor/plugins/markdown-editor-kit";
import { joinFrontmatter, splitFrontmatter } from "@/lib/markdown-doc";
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
	/** Persist serialized Markdown (frontmatter re-attached) to `path`. */
	onPersist?: (path: string, markdown: string) => void;
	onDirtyChange?: (dirty: boolean) => void;
};

/** Imperative handle for appending content without clobbering unsaved edits. */
export type MarkdownEditorHandle = {
	/** Append a Markdown fragment to the end of the document and persist. */
	appendMarkdown: (markdown: string) => void;
};

const CHANGE_DEBOUNCE_MS = 500;

export const MarkdownEditor = forwardRef<
	MarkdownEditorHandle,
	MarkdownEditorProps
>(function MarkdownEditor(
	{
		initialMarkdown,
		filePath,
		readOnly,
		placeholder,
		className,
		fontSize,
		showToolbar,
		onPersist,
		onDirtyChange,
	},
	ref,
) {
	const frontmatterRef = useRef("");
	const savedRef = useRef(initialMarkdown);
	const readyRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const editor = usePlateEditor({
		plugins: MarkdownEditorKit,
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
		savedRef.current = md;
		onDirtyChange?.(false);
		if (filePath && onPersist) onPersist(filePath, md);
	}, [readOnly, serialize, filePath, onPersist, onDirtyChange]);

	// Latest persist closure, for the unmount flush (captures this file's path).
	const persistRef = useRef(persist);
	persistRef.current = persist;

	useImperativeHandle(
		ref,
		() => ({
			appendMarkdown: (markdown: string) => {
				if (readOnly) return;
				const fragment = markdown.trim();
				if (!fragment) return;
				const nodes = editor
					.getApi(MarkdownPlugin)
					.markdown.deserialize(fragment);
				if (!Array.isArray(nodes) || !nodes.length) return;
				editor.tf.insertNodes(nodes, { at: [editor.children.length] });
				if (timerRef.current) {
					clearTimeout(timerRef.current);
					timerRef.current = null;
				}
				onDirtyChange?.(false);
				persistRef.current();
			},
		}),
		[editor, readOnly, onDirtyChange],
	);

	// Mark ready after the initial normalization pass so opening a file never saves.
	// On unmount, flush any pending edit to THIS editor's file.
	useEffect(() => {
		readyRef.current = true;
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
				persistRef.current();
			}
		};
	}, []);

	const handleChange = useCallback(() => {
		if (readOnly || !readyRef.current) return;
		onDirtyChange?.(true);
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			persistRef.current();
		}, CHANGE_DEBOUNCE_MS);
	}, [readOnly, onDirtyChange]);

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

	return (
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
	);
});
