import { memo } from "react";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { PapersLibrary } from "@/components/layout/papers-library";
import { RecycleBinView } from "@/components/layout/recycle-bin-view";
import { HtmlViewer } from "@/components/viewer/html-viewer";
import { ImageViewer } from "@/components/viewer/image-viewer";
import {
	PdfViewer,
	type PdfViewerHandle,
} from "@/components/viewer/pdf-viewer";
import type { PaperMetadata } from "@/lib/paper-metadata";
import type { PdfHighlight } from "@/lib/pdf-highlight/types";
import { type DocTab, tabIsPaperNotes } from "@/lib/tabs";
import { isMarkdownPath, paperRelFromNotes } from "@/lib/vault";

type TabCenterProps = {
	tab: DocTab;
	active: boolean;
	vaultPath: string | null;
	/** Papers library (only used by the Library tab). */
	libraryPapers: PaperMetadata[];
	libraryLoading: boolean;
	libraryQuery: string;
	/** Vault-relative folder scope; null = full library. */
	libraryScopePath: string | null;
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
	/** Immersive full-window PDF reading. */
	pdfZen: boolean;
	onTogglePdfZen: () => void;
	onOpenAnnotations: () => void;
	registerPdfHandle: (tabId: string, handle: PdfViewerHandle | null) => void;
	onPdfHighlightsChange: (tabId: string, list: PdfHighlight[]) => void;
};

/** Center-pane view for a single open tab (library, trash, editor, PDF, image, HTML). */
export const TabCenter = memo(function TabCenter({
	tab,
	active,
	vaultPath,
	libraryPapers,
	libraryLoading,
	libraryQuery,
	libraryScopePath,
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
	pdfZen,
	onTogglePdfZen,
	onOpenAnnotations,
	registerPdfHandle,
	onPdfHighlightsChange,
}: TabCenterProps) {
	if (tab.kind === "library") {
		return (
			<PapersLibrary
				papers={libraryPapers}
				loading={libraryLoading}
				query={libraryQuery}
				scopePath={libraryScopePath}
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
				active={active}
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
					zen={pdfZen}
					onToggleZen={onTogglePdfZen}
					onOpenAnnotations={onOpenAnnotations}
					className="h-full w-full"
					onHandle={(h) => registerPdfHandle(tab.id, h)}
					onHighlightsChange={(list) => onPdfHighlightsChange(tab.id, list)}
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
});
