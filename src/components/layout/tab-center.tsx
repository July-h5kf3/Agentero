import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { PapersLibrary } from "@/components/layout/papers-library";
import { RecycleBinView } from "@/components/layout/recycle-bin-view";
import { HtmlViewer } from "@/components/viewer/html-viewer";
import { ImageViewer } from "@/components/viewer/image-viewer";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { type DocTab, tabIsPaperNotes } from "@/lib/tabs";
import { isMarkdownPath, paperRelFromNotes } from "@/lib/vault";

type TabCenterProps = {
	tab: DocTab;
	activeTabId: string | null;
	vaultPath: string | null;
	/** Papers library (only used by the Library tab). */
	libraryPapers: PaperMetadata[];
	libraryLoading: boolean;
	libraryQuery: string;
	libraryTagFilter: string | null;
	rescanning: boolean;
	onLibraryTagFilterChange: (tag: string | null) => void;
	onOpenLibraryPaper: (paper: PaperMetadata) => void;
	onRescanPapers: () => void;
	onTrashChanged: () => void;
	/** Markdown editor config. */
	editorFontSize: number;
	showEditorToolbar: boolean;
	notesPlaceholder: string;
	markdownPlaceholder: string;
	onPersistFile: (path: string, md: string) => void;
	onEditorAssetsChanged: () => void;
	onTabPatch: (id: string, patch: Partial<DocTab>) => void;
	onAddPdfNote: (tab: DocTab, quote: string) => void;
};

/** Center-pane view for a single open tab (library, trash, editor, PDF, image, HTML). */
export function TabCenter({
	tab,
	activeTabId,
	vaultPath,
	libraryPapers,
	libraryLoading,
	libraryQuery,
	libraryTagFilter,
	rescanning,
	onLibraryTagFilterChange,
	onOpenLibraryPaper,
	onRescanPapers,
	onTrashChanged,
	editorFontSize,
	showEditorToolbar,
	notesPlaceholder,
	markdownPlaceholder,
	onPersistFile,
	onEditorAssetsChanged,
	onTabPatch,
	onAddPdfNote,
}: TabCenterProps) {
	if (tab.kind === "library") {
		return (
			<PapersLibrary
				papers={libraryPapers}
				loading={libraryLoading}
				query={libraryQuery}
				tagFilter={libraryTagFilter}
				onTagFilterChange={onLibraryTagFilterChange}
				onOpenPaper={onOpenLibraryPaper}
				onRescan={onRescanPapers}
				rescanning={rescanning}
				className="bg-muted/20"
			/>
		);
	}
	if (tab.kind === "trash") {
		return (
			<RecycleBinView
				vaultPath={vaultPath}
				active={tab.id === activeTabId}
				onChanged={onTrashChanged}
				className="bg-muted/20"
			/>
		);
	}
	const isNotes = tabIsPaperNotes(tab);
	if (tab.mode === "markdown") {
		return (
			<div className="min-h-0 flex-1 overflow-hidden bg-muted/30">
				<MarkdownEditor
					key={
						isNotes
							? `notes-center-${tab.id}-${tab.notesKey}`
							: `file-${tab.id}-${tab.seedKey}`
					}
					className="agentero-scroll h-full min-h-0"
					initialMarkdown={isNotes ? tab.notesSeed : tab.markdownSeed}
					filePath={
						isNotes ? tab.notesPath : isMarkdownPath(tab.path) ? tab.path : null
					}
					fontSize={editorFontSize}
					showToolbar={showEditorToolbar}
					placeholder={isNotes ? notesPlaceholder : markdownPlaceholder}
					onPersist={onPersistFile}
					onAssetsChanged={onEditorAssetsChanged}
					onDirtyChange={(d) =>
						onTabPatch(
							tab.id,
							isNotes ? { notesDirty: d } : { markdownDirty: d },
						)
					}
				/>
			</div>
		);
	}
	if (tab.mode === "pdf") {
		return (
			<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
				<PdfViewer
					source={tab.pdfUrl}
					paperAbsPath={
						tab.notesPath ? tab.notesPath.replace(/[\\/]NOTES\.md$/i, "") : null
					}
					paperRelPath={
						tab.paperMeta?.path ?? paperRelFromNotes(tab.notesPath, vaultPath)
					}
					vaultPath={vaultPath}
					onAddNote={(quote) => onAddPdfNote(tab, quote)}
					className="h-full w-full"
				/>
			</div>
		);
	}
	if (tab.mode === "image") {
		return (
			<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
				<ImageViewer
					source={tab.imageUrl}
					alt={tab.title}
					className="h-full w-full"
				/>
			</div>
		);
	}
	return (
		<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
			<HtmlViewer srcUrl={tab.htmlUrl} className="h-full w-full" />
		</div>
	);
}
