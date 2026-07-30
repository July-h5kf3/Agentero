/**
 * DockWorkspace host: assembles `centerProps` from the domain stores and owns
 * the workspace sync effects (PDF viewer LRU, layout persistence, empty-strip
 * Library fallback, tree-selection follow). Library query keystrokes and PDF
 * annotation updates re-render this host only — never the whole App.
 */

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { registerPdfHandle } from "@/components/viewer/pdf-viewer-registry";
import {
	DockWorkspace,
	type WorkspaceExternalDrop,
} from "@/components/workspace/dock-workspace";
import {
	useLibraryStore,
	useSettings,
	useUiStore,
	useVaultStore,
	useWorkspaceStore,
} from "@/hooks/use-app-stores";
import { isLibraryVirtualPath } from "@/lib/paper/api";
import {
	openLibraryPaper,
	rescanLibraryPapers,
} from "@/lib/paper/library-actions";
import { setLibraryQuery } from "@/lib/paper/library-store";
import { setTabAsks, setTabHighlights } from "@/lib/pdf/annotations-store";
import type { LibraryColumnPref } from "@/lib/settings";
import { patchSettings } from "@/lib/settings/react-store";
import { openSettingsWindow } from "@/lib/shell/settings-window";
import { layout, openRightTab, togglePdfZen } from "@/lib/shell/ui-store";
import { joinVaultPath } from "@/lib/vault";
import { handleTrashChanged } from "@/lib/vault/actions";
import { isRemoteVaultHandle } from "@/lib/vault/remote/remote-vault";
import { refreshTree, setTreeSelectedPath } from "@/lib/vault/store";
import { renameWikiHeadingAction } from "@/lib/wiki/actions";
import {
	closeTab,
	ensureLibraryTabPresent,
	handleActivePanelChange,
	hydratePlaceholderTabs,
	openTab,
	openTabNotes,
	persistFile,
} from "@/lib/workspace/actions";
import { registerDockHandle } from "@/lib/workspace/dock-registry";
import {
	setDockLayout,
	setPdfLru,
	toggleTabHtmlMode,
	updateTab,
} from "@/lib/workspace/store";
import { savePersistedTabs } from "@/lib/workspace/tabs";

/**
 * Number of PDF *viewers* kept mounted (most recent first). Dockview already
 * keeps PDF panel shells mounted (`renderer: 'always'`); this LRU only gates
 * EmbedPDF/PDFium so switching among recent PDFs is instant without holding
 * every open document on the main thread.
 */
const PDF_TAB_MOUNT_LRU = 4;

function handleWorkspaceDrop(drop: WorkspaceExternalDrop): void {
	const path = drop.paths[0];
	if (!path) return;
	openTab(path, {
		placement: {
			direction: drop.direction,
			referencePanelId: drop.referencePanelId,
		},
		skipDefaultNotes: true,
	});
}

function handleLibraryColumnsChange(cols: LibraryColumnPref[]): void {
	patchSettings({ libraryColumns: cols });
}

export function WorkspaceHost() {
	const { t } = useTranslation(["app"]);
	const vaultPath = useVaultStore((s) => s.vaultPath);
	const tabs = useWorkspaceStore((s) => s.tabs);
	const activeTabId = useWorkspaceStore((s) => s.activeTabId);
	const dockLayout = useWorkspaceStore((s) => s.dockLayout);
	const pdfLru = useWorkspaceStore((s) => s.pdfLru);
	const libraryPapers = useLibraryStore((s) => s.papers);
	const libraryLoading = useLibraryStore((s) => s.loading);
	const libraryQuery = useLibraryStore((s) => s.query);
	const libraryScopePath = useLibraryStore((s) => s.scopePath);
	const rescanning = useLibraryStore((s) => s.rescanning);
	const trashReloadSignal = useLibraryStore((s) => s.trashReloadSignal);
	const pdfZenMode = useUiStore((s) => s.pdfZenMode);
	const libraryColumns = useSettings((s) => s.libraryColumns);
	const editorFontSize = useSettings((s) => s.editorFontSize);
	const showEditorToolbar = useSettings((s) => s.showEditorToolbar);

	const activeTab = useMemo(
		() => tabs.find((tab) => tab.id === activeTabId) ?? null,
		[tabs, activeTabId],
	);

	// Keep active PDF panels plus a few recently viewed ones mounted.
	useEffect(() => {
		const ids = tabs.filter((tab) => tab.mode === "pdf").map((tab) => tab.id);
		const activePdf = activeTab?.mode === "pdf" ? activeTab.id : null;
		if (!activePdf && !ids.length) return;
		setPdfLru((prev) => {
			let next = prev;
			const promote = activePdf ? [activePdf, ...ids] : ids;
			for (const id of promote) {
				if (next[0] === id) continue;
				next = [id, ...next.filter((x) => x !== id)];
			}
			return next.slice(0, PDF_TAB_MOUNT_LRU);
		});
	}, [activeTab?.mode, activeTab?.id, tabs]);

	// Tree selection / create-parent follows the active document.
	// Scoped library keeps the tree highlight on the org folder.
	const selectedPath = activeTab?.path ?? null;
	useEffect(() => {
		if (!selectedPath) return;
		if (isLibraryVirtualPath(selectedPath) && libraryScopePath && vaultPath) {
			setTreeSelectedPath(joinVaultPath(vaultPath, libraryScopePath));
			return;
		}
		setTreeSelectedPath(selectedPath);
	}, [selectedPath, libraryScopePath, vaultPath]);

	// After seeding placeholders from layout, load resources once (mount-only).
	useEffect(() => {
		hydratePlaceholderTabs();
	}, []);

	// Default page: empty strip with a Vault open → show full Library.
	useEffect(() => {
		if (!vaultPath) return;
		if (tabs.length > 0) return;
		ensureLibraryTabPresent();
	}, [vaultPath, tabs.length]);

	// Layout alone is persisted (panels + order + active + path/mode in params).
	useEffect(() => {
		savePersistedTabs(dockLayout);
	}, [dockLayout]);

	// Leave immersive reading on Escape, or when the active tab is not a PDF.
	useEffect(() => {
		if (!pdfZenMode) return;
		if (activeTab?.mode !== "pdf") {
			layout()?.exitPdfZen();
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				layout()?.exitPdfZen();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [pdfZenMode, activeTab]);

	/**
	 * Memoized DocView props — must not be an inline object in JSX, or
	 * DocView's React.memo never bails out. Grouped by kind so library /
	 * editor / PDF surfaces stay decoupled.
	 */
	const centerProps = useMemo(
		() => ({
			vaultPath,
			library: {
				papers: libraryPapers,
				loading: libraryLoading,
				query: libraryQuery,
				onQueryChange: setLibraryQuery,
				scopePath: libraryScopePath,
				columns: libraryColumns,
				onColumnsChange: handleLibraryColumnsChange,
				rescanning,
				onOpenPaper: openLibraryPaper,
				onRescan: () => void rescanLibraryPapers(),
			},
			editor: {
				fontSize: editorFontSize,
				showToolbar: showEditorToolbar,
				notesPlaceholder: t("editor.notesPlaceholder"),
				markdownPlaceholder: t("editor.markdownPlaceholder"),
				onPersistFile: persistFile,
				onAssetsChanged: () => {
					if (vaultPath) void refreshTree(vaultPath);
				},
				onTabPatch: updateTab,
				onRenameHeading:
					vaultPath && !isRemoteVaultHandle(vaultPath)
						? renameWikiHeadingAction
						: undefined,
			},
			pdf: {
				zen: pdfZenMode,
				onToggleZen: togglePdfZen,
				onOpenAnnotations: () => openRightTab("annotations"),
				onOpenSettings: () => openSettingsWindow("translate"),
				registerHandle: registerPdfHandle,
				onHighlightsChange: setTabHighlights,
				onAsksChange: setTabAsks,
			},
			onTrashChanged: () => void handleTrashChanged(),
			trashReloadSignal,
		}),
		[
			vaultPath,
			libraryPapers,
			libraryLoading,
			libraryQuery,
			libraryScopePath,
			libraryColumns,
			editorFontSize,
			showEditorToolbar,
			rescanning,
			trashReloadSignal,
			pdfZenMode,
			t,
		],
	);

	return (
		<DockWorkspace
			ref={registerDockHandle}
			tabs={tabs}
			activePanelId={activeTabId}
			layout={dockLayout}
			pdfKeepMountedIds={[
				...pdfLru,
				...(activeTab?.mode === "pdf" && activeTab ? [activeTab.id] : []),
			]}
			centerProps={centerProps}
			onActivePanelChange={handleActivePanelChange}
			onClosePanel={closeTab}
			onLayoutChange={setDockLayout}
			onToggleHtmlMode={toggleTabHtmlMode}
			onOpenNotesPanel={openTabNotes}
			onExternalDrop={handleWorkspaceDrop}
		/>
	);
}
