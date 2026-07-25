"use client";

import { MarkdownPlugin } from "@platejs/markdown";
import { ImagePlugin } from "@platejs/media/react";
import { Plate, usePlateEditor } from "platejs/react";
import { memo, useMemo } from "react";
import { Editor } from "@/components/editor/editor";
import { ImageElement } from "@/components/editor/image-node";
import { MarkdownDocProvider } from "@/components/editor/markdown-doc-context";
import { MarkdownEditorKit } from "@/components/editor/plugins/markdown-editor-kit";
import { splitFrontmatter } from "@/lib/markdown-doc";

export const EmbeddedMarkdownProjection = memo(
	function EmbeddedMarkdownProjection({
		markdown,
		filePath,
	}: {
		markdown: string;
		filePath: string;
	}) {
		const plugins = useMemo(
			() => [...MarkdownEditorKit, ImagePlugin.withComponent(ImageElement)],
			[],
		);
		const editor = usePlateEditor({
			plugins,
			value: (currentEditor) => {
				const { body } = splitFrontmatter(markdown);
				return currentEditor
					.getApi(MarkdownPlugin)
					.markdown.deserialize(body || " ");
			},
		});

		return (
			<MarkdownDocProvider value={{ filePath }}>
				<Plate editor={editor}>
					<Editor
						variant="none"
						readOnly
						className="min-h-0 cursor-default px-4 pb-3 pt-2 text-sm leading-relaxed [&>*:first-child]:mt-0"
					/>
				</Plate>
			</MarkdownDocProvider>
		);
	},
);
