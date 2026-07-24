import { memo } from "react";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { PapersLibrary } from "@/components/library/papers-library";
import { Skeleton } from "@/components/ui/skeleton";
import {
	PdfViewer,
	type PdfViewerHandle,
} from "@/components/viewer/embed/pdf-viewer";
import { HtmlViewer } from "@/components/viewer/html-viewer";
import { ImageViewer } from "@/components/viewer/image-viewer";
import { RecycleBinView } from "@/components/workspace/recycle-bin-view";
import type { PaperMetadata } from "@/lib/paper";
import type { PdfAskThread } from "@/lib/pdf/ask/types";
import type { PdfHighlight } from "@/lib/pdf/highlight/types";
import type { LibraryColumnPref } from "@/lib/settings";
import { isMarkdownPath, paperRelFromNotes } from "@/lib/vault";
import { type DocTab, tabIsPaperNotes } from "@/lib/workspace/tabs";

export type TabCenterProps = {
	/** Primary tab or split pane (shared fields). */
	tab: DocTab;
	active: boolean;
	/**
	 * Whether this PDF tab should stay mounted even when inactive (LRU of
	 * recently viewed PDFs). Non-PDF tabs ignore this. When false and inactive,
	 * the heavyweight PDF viewer unmounts to release its engine document.
	 */
	pdfKeepMounted: boolean;
	vaultPath: string | null;
	/** Papers library (only used by the Library tab). */
	libraryPapers: PaperMetadata[];
	libraryLoading: boolean;
	libraryQuery: string;
	onLibraryQueryChange: (query: string) => void;
	/** Vault-relative folder scope; null = full library. */
	libraryScopePath: string | null;
	/** Library table column order + visibility. */
	libraryColumns: LibraryColumnPref[];
	onLibraryColumnsChange: (columns: LibraryColumnPref[]) => void;
	rescanning: boolean;
	onOpenLibraryPaper: (paper: PaperMetadata) => void;
	onRescanPapers: () => void;
	onMigrateZotero: () => void;
	onTrashChanged: () => void;
	/** Bump to reload recycle bin after Empty Recycle Bin from the sidebar. */
	trashReloadSignal?: number;
	/** Markdown editor config. */
	editorFontSize: number;
	showEditorToolbar: boolean;
	notesPlaceholder: string;
	markdownPlaceholder: string;
	onPersistFile: (path: string, md: string, lastSaved: string) => void;
	onEditorAssetsChanged: () => void;
	onTabPatch: (id: string, patch: Partial<DocTab>) => void;
	/** Immersive full-window PDF reading. */
	pdfZen: boolean;
	onTogglePdfZen: () => void;
	onOpenAnnotations: () => void;
	onOpenSettings: () => void;
	registerPdfHandle: (tabId: string, handle: PdfViewerHandle | null) => void;
	onPdfHighlightsChange: (tabId: string, list: PdfHighlight[]) => void;
	onPdfAsksChange: (tabId: string, list: PdfAskThread[]) => void;
};

function TabLoadingSkeleton() {
	return (
		<div
			className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden bg-muted/20 p-4"
			aria-busy="true"
			role="status"
		>
			<Skeleton className="library-shimmer h-8 w-2/5" />
			<div className="flex min-h-0 flex-1 flex-col gap-3 rounded-md border bg-background/40 p-4">
				<Skeleton className="library-shimmer h-4 w-3/4" />
				<Skeleton className="library-shimmer h-3 w-full" />
				<Skeleton className="library-shimmer h-3 w-11/12" />
				<Skeleton className="library-shimmer h-3 w-4/5" />
				<div className="mt-4 space-y-3">
					<Skeleton className="library-shimmer h-3 w-full" />
					<Skeleton className="library-shimmer h-3 w-5/6" />
					<Skeleton className="library-shimmer h-3 w-2/3" />
				</div>
			</div>
		</div>
	);
}

/** Center-pane view for a single open tab (library, trash, editor, PDF, image, HTML). */
export const TabCenter = memo(function TabCenter({
	tab,
	active,
	pdfKeepMounted,
	vaultPath,
	libraryPapers,
	libraryLoading,
	libraryQuery,
	onLibraryQueryChange,
	libraryScopePath,
	libraryColumns,
	onLibraryColumnsChange,
	rescanning,
	onOpenLibraryPaper,
	onRescanPapers,
	onMigrateZotero,
	onTrashChanged,
	trashReloadSignal = 0,
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
	onOpenSettings,
	registerPdfHandle,
	onPdfHighlightsChange,
	onPdfAsksChange,
}: TabCenterProps) {
	if (!tab.loaded) {
		return <TabLoadingSkeleton />;
	}
	if (tab.kind === "library") {
		return (
			<PapersLibrary
				papers={libraryPapers}
				vaultPath={vaultPath}
				active={active}
				loading={libraryLoading}
				query={libraryQuery}
				onQueryChange={onLibraryQueryChange}
				scopePath={libraryScopePath}
				columns={libraryColumns}
				onColumnsChange={onLibraryColumnsChange}
				onOpenPaper={onOpenLibraryPaper}
				onRescan={onRescanPapers}
				rescanning={rescanning}
				onMigrateZotero={onMigrateZotero}
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
				reloadSignal={trashReloadSignal}
				className="bg-muted/20"
			/>
		);
	}
	const isNotes = tabIsPaperNotes(tab);
	if (tab.mode === "markdown") {
		return (
			<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/30">
				<MarkdownEditor
					key={
						isNotes
							? `notes-center-${tab.id}-${tab.notesKey}`
							: `file-${tab.id}-${tab.seedKey}`
					}
					className="h-full min-h-0"
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
		// PERF: only mount the heavyweight EmbedPDF viewer for the active tab.
		// Inactive PDF tabs release their engine document + plugin registry so a
		// large open-tab set keeps at most one PDFium document alive (PDFium runs
		// on the main thread). Reading position / annotations / ask threads are
		// persisted, so remounting on re-activation restores them automatically.
		if (!active && !pdfKeepMounted) return null;
		return (
			<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
				<PdfViewer
					source={tab.pdfUrl}
					sourceBytes={tab.pdfBytes}
					docId={tab.id}
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
					onOpenSettings={onOpenSettings}
					className="h-full w-full"
					onHandle={(h) => registerPdfHandle(tab.id, h)}
					onHighlightsChange={(list) => onPdfHighlightsChange(tab.id, list)}
					onAsksChange={(list) => onPdfAsksChange(tab.id, list)}
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
