import {
	BlockquotePlugin,
	BoldPlugin,
	H1Plugin,
	H2Plugin,
	H3Plugin,
	ItalicPlugin,
	UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { PDFViewer } from "@react-pdf/renderer";
import type { Value } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import { useState } from "react";

import { MyDocument } from "@/components/pdf/my-document";
import { BlockquoteElement } from "@/components/ui/blockquote-node";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { FixedToolbar } from "@/components/ui/fixed-toolbar";
import { H1Element, H2Element, H3Element } from "@/components/ui/heading-node";
import { MarkToolbarButton } from "@/components/ui/mark-toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar";
import { TooltipProvider } from "@/components/ui/tooltip";

const initialValue: Value = [
	{
		children: [{ text: "Title" }],
		type: "h3",
	},
	{
		children: [
			{
				children: [{ text: "This is a quote." }],
				type: "p",
			},
		],
		type: "blockquote",
	},
	{
		children: [
			{ text: "With some " },
			{ bold: true, text: "bold" },
			{ text: " text for emphasis!" },
		],
		type: "p",
	},
];

export default function App() {
	const [showPdf, setShowPdf] = useState(false);

	const editor = usePlateEditor({
		plugins: [
			BoldPlugin,
			ItalicPlugin,
			UnderlinePlugin,
			H1Plugin.withComponent(H1Element),
			H2Plugin.withComponent(H2Element),
			H3Plugin.withComponent(H3Element),
			BlockquotePlugin.withComponent(BlockquoteElement),
		],
		value: () => {
			const savedValue = localStorage.getItem("installation-react-demo");
			return savedValue ? JSON.parse(savedValue) : initialValue;
		},
	});

	return (
		<TooltipProvider>
			<div className="flex h-screen flex-col">
				<Plate
					editor={editor}
					onChange={({ value }) => {
						localStorage.setItem(
							"installation-react-demo",
							JSON.stringify(value),
						);
					}}
				>
					<FixedToolbar className="flex justify-start gap-1 rounded-t-lg">
						<ToolbarButton onClick={() => editor.tf.h1.toggle()}>
							H1
						</ToolbarButton>
						<ToolbarButton onClick={() => editor.tf.h2.toggle()}>
							H2
						</ToolbarButton>
						<ToolbarButton onClick={() => editor.tf.h3.toggle()}>
							H3
						</ToolbarButton>
						<ToolbarButton onClick={() => editor.tf.blockquote.toggle()}>
							Quote
						</ToolbarButton>
						<MarkToolbarButton nodeType="bold" tooltip="Bold (⌘+B)">
							B
						</MarkToolbarButton>
						<MarkToolbarButton nodeType="italic" tooltip="Italic (⌘+I)">
							I
						</MarkToolbarButton>
						<MarkToolbarButton nodeType="underline" tooltip="Underline (⌘+U)">
							U
						</MarkToolbarButton>
						<div className="flex-1" />
						<ToolbarButton
							className="px-2"
							onClick={() => setShowPdf((prev) => !prev)}
						>
							{showPdf ? "Hide PDF" : "Preview PDF"}
						</ToolbarButton>
						<ToolbarButton
							className="px-2"
							onClick={() => editor.tf.setValue(initialValue)}
						>
							Reset
						</ToolbarButton>
					</FixedToolbar>
					<div className="flex flex-1 overflow-hidden">
						<EditorContainer className={showPdf ? "w-1/2" : "w-full"}>
							<Editor placeholder="Type your amazing content here..." />
						</EditorContainer>
						{showPdf && (
							<div className="w-1/2 border-l">
								<PDFViewer className="size-full" showToolbar>
									<MyDocument />
								</PDFViewer>
							</div>
						)}
					</div>
				</Plate>
			</div>
		</TooltipProvider>
	);
}
