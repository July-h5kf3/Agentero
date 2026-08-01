/**
 * Right rail: Agent chat (kept mounted across sidebar ↔ zen), Backlinks +
 * Graph, or PDF annotations. Subscribes to its stores directly.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type AnnotationRow,
	AnnotationsPanel,
	type AskRow,
	type VisualTraceRow,
} from "@/components/viewer/annotations-panel";
import type { PdfViewerHandle } from "@/components/viewer/embed/pdf-viewer";
import { pdfHandleFor } from "@/components/viewer/pdf-viewer-registry";
import { ReferencesPanel } from "@/components/viewer/references-panel";
import { BacklinksPanel } from "@/components/wiki/backlinks-panel";
import { GraphPanel } from "@/components/wiki/graph-panel";
import {
	useAnnotationsStore,
	useLibraryStore,
	useSettings,
	useUiStore,
	useVaultStore,
	useWikiStore,
	useWorkspaceStore,
} from "@/hooks/use-app-stores";
import { normalizeAgentSourcePath } from "@/lib/agent/sources";
import { toVaultRelative } from "@/lib/core/path";
import { cn } from "@/lib/core/utils";
import { isLibraryVirtualPath, isTrashVirtualPath } from "@/lib/paper/api";
import { paperDirFromPath } from "@/lib/paper/detect";
import { tracePreview } from "@/lib/pdf/agent-trace/schema";
import {
	annotationSnippet,
	annotationWikilinkAlias,
	listPaperAnnotationSummaries,
	type PaperAnnotationSummary,
	paperAbsFromWorkspaceTab,
	pdfTabIdForPaper,
	wikiTargetForPaper,
} from "@/lib/pdf/annotation-ref";
import { listPdfAskThreads } from "@/lib/pdf/ask/io";
import { normalizeHighlightColor } from "@/lib/pdf/highlight/palette";
import { openSettingsWindow } from "@/lib/shell/settings-window";
import { layout, uiStore } from "@/lib/shell/ui-store";
import {
	navigateWiki,
	openGraphPath,
	openPaper,
} from "@/lib/workspace/actions";
import { getActiveTabId } from "@/lib/workspace/store";

// The Agent panel is lazy-loaded: it isn't mounted until the agent sidebar /
// zen mode is opened, so its (large) bundle stays out of the initial chunk.
const AgentPanel = lazy(() =>
	import("@/components/agent/agent-panel").then((m) => ({
		default: m.AgentPanel,
	})),
);

/**
 * Agent chat Sources / inline citation click: vault paper paths → paper
 * workspace; other vault files → open tab; http(s) → system browser.
 * Exit zen so the paper is visible.
 */
function onOpenAgentSettings(): void {
	openSettingsWindow("agent");
}

function handleAgentOpenSource(source: string): void {
	const trimmed = normalizeAgentSourcePath(source);
	if (!trimmed) return;
	if (/^https?:\/\//i.test(trimmed)) {
		void import("@tauri-apps/plugin-opener")
			.then(({ openUrl }) => openUrl(trimmed))
			.catch(() => {
				window.open(trimmed, "_blank", "noopener,noreferrer");
			});
		return;
	}
	if (uiStore.getState().agentZenMode) {
		layout()?.exitAgentZen();
	}
	openGraphPath(trimmed);
}

/**
 * PDF handles live on the paper-body tab id. When NOTES is focused, fall back
 * to the sibling paper tab; if the viewer is unmounted, open the paper first.
 */
function annotationAction(
	paperAbs: string | null,
	fn: (h: PdfViewerHandle) => void,
): void {
	const candidates = [
		paperAbs ? pdfTabIdForPaper(paperAbs) : null,
		getActiveTabId(),
	].filter((id): id is string => Boolean(id));
	for (const id of candidates) {
		const handle = pdfHandleFor(id);
		if (handle) {
			fn(handle);
			return;
		}
	}
	if (paperAbs) openPaper(paperAbs);
}

function ReferencesSidebar() {
	const vaultPath = useVaultStore((s) => s.vaultPath);
	const vaultPaperPaths = useVaultStore((s) => s.vaultPaperPaths);
	const activeTabId = useWorkspaceStore((s) => s.activeTabId);
	const selectedPath = useWorkspaceStore(
		(s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.path ?? null,
	);
	const paperPath = useMemo(() => {
		if (
			!selectedPath ||
			isLibraryVirtualPath(selectedPath) ||
			isTrashVirtualPath(selectedPath)
		) {
			return null;
		}
		const relative = toVaultRelative(vaultPath, selectedPath);
		return paperDirFromPath(relative, vaultPaperPaths);
	}, [selectedPath, vaultPath, vaultPaperPaths]);

	return (
		<ReferencesPanel
			vaultPath={vaultPath}
			paperPath={paperPath}
			activeTabId={activeTabId}
		/>
	);
}

function AnnotationsSidebar() {
	const activeTab = useWorkspaceStore((s) =>
		s.tabs.find((tab) => tab.id === s.activeTabId),
	);
	const vaultPath = useVaultStore((s) => s.vaultPath);
	const paperFolders = useVaultStore((s) => s.paperFolders);
	const paperAbs = useMemo(
		() => paperAbsFromWorkspaceTab(activeTab ?? null, vaultPath, paperFolders),
		[activeTab, vaultPath, paperFolders],
	);
	// Highlight store + PdfViewerHandle are keyed by the PDF body tab id.
	const pdfTabId = paperAbs ? pdfTabIdForPaper(paperAbs) : null;

	const storeHighlights = useAnnotationsStore((s) =>
		pdfTabId ? s.highlightsByTab[pdfTabId] : undefined,
	);
	const storeAsks = useAnnotationsStore((s) =>
		pdfTabId ? s.asksByTab[pdfTabId] : undefined,
	);
	const storeVisuals = useAnnotationsStore((s) =>
		pdfTabId ? s.visualTracesByTab[pdfTabId] : undefined,
	);

	const [diskSummaries, setDiskSummaries] = useState<PaperAnnotationSummary[]>(
		[],
	);
	const [diskAsks, setDiskAsks] = useState<AskRow[]>([]);

	// When NOTES is focused the PDF tab may be unmounted — load marks from disk.
	useEffect(() => {
		if (!paperAbs) {
			setDiskSummaries([]);
			setDiskAsks([]);
			return;
		}
		const hasLive =
			(storeHighlights?.length ?? 0) > 0 || (storeVisuals?.length ?? 0) > 0;
		if (hasLive && (storeAsks?.length ?? 0) > 0) {
			setDiskSummaries([]);
			setDiskAsks([]);
			return;
		}
		let cancelled = false;
		void (async () => {
			const [summaries, asks] = await Promise.all([
				hasLive ? Promise.resolve([]) : listPaperAnnotationSummaries(paperAbs),
				storeAsks?.length ? Promise.resolve([]) : listPdfAskThreads(paperAbs),
			]);
			if (cancelled) return;
			if (!hasLive) setDiskSummaries(summaries);
			if (!storeAsks?.length) {
				setDiskAsks(
					asks
						.filter((th) => th.messages.some((m) => m.role === "user"))
						.map((th) => {
							const firstUser = th.messages.find((m) => m.role === "user");
							return {
								id: th.id,
								page: th.anchor.page,
								preview:
									firstUser?.content.trim() || th.anchor.quote?.trim() || th.id,
								messageCount: th.messages.filter(
									(m) => m.role === "user" || m.role === "assistant",
								).length,
							};
						}),
				);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [paperAbs, storeHighlights, storeVisuals, storeAsks]);

	/** Resolvable vault-relative target (never display title alone). */
	const wikiTarget = useMemo(() => {
		const paperPath = activeTab?.paperMeta?.path?.replace(/\\/g, "/");
		if (paperPath) return wikiTargetForPaper(paperPath, paperPath);
		if (paperAbs && vaultPath) {
			const rel = toVaultRelative(vaultPath, paperAbs);
			if (rel) return wikiTargetForPaper(rel, rel);
		}
		return null;
	}, [activeTab?.paperMeta?.path, paperAbs, vaultPath]);

	const paperTitle = activeTab?.paperMeta?.title?.trim() || null;

	const items = useMemo<AnnotationRow[]>(() => {
		if (storeHighlights?.length) {
			return [...storeHighlights]
				.sort(
					(a, b) =>
						a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0),
				)
				.map((h) => ({
					id: h.id,
					page: h.page,
					quote: h.quote,
					comment: h.comment ?? "",
					color: normalizeHighlightColor(h.color),
					linkAlias: annotationWikilinkAlias(
						paperTitle,
						annotationSnippet({ comment: h.comment, quote: h.quote }),
					),
				}));
		}
		return diskSummaries
			.filter((s) => s.kind === "highlight")
			.map((s) => ({
				id: s.id,
				page: s.page,
				quote: s.quote,
				comment: s.comment,
				color: normalizeHighlightColor(s.color),
				linkAlias: annotationWikilinkAlias(paperTitle, s.preview),
			}));
	}, [storeHighlights, diskSummaries, paperTitle]);

	const askRows = useMemo<AskRow[]>(() => {
		if (storeAsks?.length) {
			return [...storeAsks]
				.sort(
					(a, b) =>
						a.anchor.page - b.anchor.page ||
						(a.anchor.rects[0]?.y ?? 0) - (b.anchor.rects[0]?.y ?? 0),
				)
				.map((th) => {
					const firstUser = th.messages.find((m) => m.role === "user");
					const preview =
						firstUser?.content.trim() || th.anchor.quote?.trim() || th.id;
					return {
						id: th.id,
						page: th.anchor.page,
						preview,
						messageCount: th.messages.filter(
							(m) => m.role === "user" || m.role === "assistant",
						).length,
					};
				});
		}
		return diskAsks;
	}, [storeAsks, diskAsks]);

	const visualTraceRows = useMemo<VisualTraceRow[]>(() => {
		if (storeVisuals?.length) {
			return [...storeVisuals]
				.sort(
					(a, b) =>
						a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0),
				)
				.map((tr) => ({
					id: tr.id,
					page: tr.page,
					preview: tracePreview(tr, "Visual annotation", 160),
					linkAlias: annotationWikilinkAlias(
						paperTitle,
						annotationSnippet({ comment: tr.comment }),
					),
				}));
		}
		return diskSummaries
			.filter((s) => s.kind === "agent-trace")
			.map((s) => ({
				id: s.id,
				page: s.page,
				preview: s.preview,
				linkAlias: annotationWikilinkAlias(paperTitle, s.preview),
			}));
	}, [storeVisuals, diskSummaries, paperTitle]);

	return (
		<AnnotationsPanel
			items={items}
			asks={askRows}
			visualTraces={visualTraceRows}
			wikiTarget={wikiTarget}
			onJump={(id) =>
				annotationAction(paperAbs, (h) => h.scrollToHighlight(id))
			}
			onEdit={(id) => annotationAction(paperAbs, (h) => h.editComment(id))}
			onDelete={(id) =>
				annotationAction(paperAbs, (h) => h.deleteHighlight(id))
			}
			onJumpAsk={(id) => annotationAction(paperAbs, (h) => h.scrollToAsk(id))}
			onDeleteAsk={(id) => annotationAction(paperAbs, (h) => h.deleteAsk(id))}
			onJumpVisual={(id) =>
				annotationAction(paperAbs, (h) => h.scrollToVisualTrace(id))
			}
			onDeleteVisual={(id) =>
				annotationAction(paperAbs, (h) => h.deleteVisualTrace(id))
			}
		/>
	);
}

export function RightSidebar() {
	const { t } = useTranslation(["app"]);
	const rightSidebarOpen = useUiStore((s) => s.rightSidebarOpen);
	const rightSidebarTab = useUiStore((s) => s.rightSidebarTab);
	const agentZenMode = useUiStore((s) => s.agentZenMode);
	const agentPanelMounted = useUiStore((s) => s.agentPanelMounted);
	const vaultPath = useVaultStore((s) => s.vaultPath);
	const vaultMdFiles = useVaultStore((s) => s.vaultMdFiles);
	const vaultDirPaths = useVaultStore((s) => s.vaultDirPaths);
	const vaultPaperPaths = useVaultStore((s) => s.vaultPaperPaths);
	const paperMetaByRelPath = useLibraryStore((s) => s.paperMetaByRelPath);
	const paperTreeLabelMode = useSettings((s) => s.paperTreeLabelMode);
	const wikiIndexRevision = useWikiStore((s) => s.wikiIndexRevision);
	const selectedPath = useWorkspaceStore(
		(s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.path ?? null,
	);
	const selectedPaperTitle = useWorkspaceStore(
		(s) =>
			s.tabs.find((tab) => tab.id === s.activeTabId)?.paperMeta?.title ?? null,
	);

	return (
		<>
			{/* Keep AgentPanel alive across sidebar ↔ zen (no remount / lost chat). */}
			{(agentPanelMounted ||
				agentZenMode ||
				(rightSidebarOpen && rightSidebarTab === "agent")) && (
				<div
					className={cn(
						"h-full min-h-0",
						!agentZenMode &&
							(!rightSidebarOpen || rightSidebarTab !== "agent") &&
							"hidden",
					)}
				>
					<Suspense fallback={null}>
						<AgentPanel
							vaultPath={vaultPath}
							selectedPath={selectedPath}
							selectedPaperTitle={selectedPaperTitle}
							vaultMarkdownPaths={vaultMdFiles}
							vaultDirectoryPaths={vaultDirPaths}
							vaultPaperPaths={vaultPaperPaths}
							paperMetaByRelPath={paperMetaByRelPath}
							paperTreeLabelMode={paperTreeLabelMode}
							className="min-h-0 h-full"
							title={t("labels.agent")}
							variant={agentZenMode ? "zen" : "sidebar"}
							autoFocus={
								agentZenMode ||
								(rightSidebarOpen && rightSidebarTab === "agent")
							}
							onOpenAgentSettings={onOpenAgentSettings}
							onOpenSource={handleAgentOpenSource}
						/>
					</Suspense>
				</div>
			)}
			{rightSidebarOpen && !agentZenMode && rightSidebarTab === "backlinks" ? (
				<div className="flex h-full min-h-0 flex-col overflow-hidden">
					<BacklinksPanel
						vaultPath={vaultPath}
						selectedPath={selectedPath}
						onNavigate={(link) =>
							void navigateWiki({
								targetRaw: link.occurrence.targetRaw,
								path: link.targetPath ?? null,
								status: link.status,
								fragment: link.occurrence.fragment,
							})
						}
						className="min-h-0 basis-[42%] border-b"
						wikiIndexRevision={wikiIndexRevision}
					/>
					<GraphPanel
						vaultPath={vaultPath}
						selectedPath={selectedPath}
						onOpenPath={openGraphPath}
						className="min-h-0 flex-1"
						wikiIndexRevision={wikiIndexRevision}
					/>
				</div>
			) : null}
			{rightSidebarOpen &&
			!agentZenMode &&
			rightSidebarTab === "annotations" ? (
				<AnnotationsSidebar />
			) : null}
			{rightSidebarOpen && !agentZenMode && rightSidebarTab === "references" ? (
				<ReferencesSidebar />
			) : null}
		</>
	);
}
