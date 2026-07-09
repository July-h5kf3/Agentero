import {
	BlockquotePlugin,
	BoldPlugin,
	H1Plugin,
	H2Plugin,
	H3Plugin,
	ItalicPlugin,
	UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { MarkdownPlugin } from "@platejs/markdown";
import { Plate, usePlateEditor } from "platejs/react";
import { useEffect, useState } from "react";

import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import { BlockquoteElement } from "@/components/ui/blockquote-node";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { H1Element, H2Element, H3Element } from "@/components/ui/heading-node";

const STORAGE_KEY = "motif-editor-content";

const defaultMarkdown = `### Title

> This is a quote.

With some **bold** text for emphasis!
`;

function useDebounce<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debounced;
}

export default function App() {
	const [markdown, setMarkdown] = useState(
		() => localStorage.getItem(STORAGE_KEY) ?? defaultMarkdown,
	);
	const debouncedMarkdown = useDebounce(markdown, 300);

	const editor = usePlateEditor({
		plugins: [
			BoldPlugin,
			ItalicPlugin,
			UnderlinePlugin,
			H1Plugin.withComponent(H1Element),
			H2Plugin.withComponent(H2Element),
			H3Plugin.withComponent(H3Element),
			BlockquotePlugin.withComponent(BlockquoteElement),
			...MarkdownKit,
		],
		value: (editor) =>
			editor.getApi(MarkdownPlugin).markdown.deserialize(markdown),
	});

	useEffect(() => {
		localStorage.setItem(STORAGE_KEY, markdown);
	}, [markdown]);

	useEffect(() => {
		const value = editor
			.getApi(MarkdownPlugin)
			.markdown.deserialize(debouncedMarkdown);
		editor.tf.reset();
		editor.tf.setValue(value);
	}, [debouncedMarkdown, editor]);

	return (
		<div className="flex h-screen flex-col">
			<div className="flex flex-1 overflow-hidden">
				<div className="flex w-1/2 flex-col border-r">
					<div className="border-b px-4 py-2 text-sm font-medium">Markdown</div>
					<textarea
						className="flex-1 resize-none bg-muted/30 p-4 font-mono text-sm outline-none"
						value={markdown}
						onChange={(event) => setMarkdown(event.target.value)}
						placeholder="Type Markdown here..."
					/>
				</div>
				<div className="flex w-1/2 flex-col">
					<div className="border-b px-4 py-2 text-sm font-medium">Preview</div>
					<EditorContainer className="flex-1">
						<Plate editor={editor}>
							<Editor placeholder="Rendered Markdown will appear here..." />
						</Plate>
					</EditorContainer>
				</div>
			</div>
		</div>
	);
}
