import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import type {
	PdfBookmarkObject,
	PdfHighlightAnnoObject,
	PdfLinkAnnoObject,
} from "@embedpdf/models";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import {
	AnnotationLayer,
	AnnotationPluginPackage,
	type AnnotationTransferItem,
	useAnnotationCapability,
} from "@embedpdf/plugin-annotation/react";
import {
	BookmarkPluginPackage,
	useBookmarkCapability,
} from "@embedpdf/plugin-bookmark/react";
import {
	DocumentContent,
	DocumentManagerPluginPackage,
	useDocumentManagerCapability,
} from "@embedpdf/plugin-document-manager/react";
import {
	GlobalPointerProvider,
	InteractionManagerPluginPackage,
	PagePointerProvider,
	useInteractionManagerCapability,
} from "@embedpdf/plugin-interaction-manager/react";
import {
	RenderLayer,
	RenderPluginPackage,
} from "@embedpdf/plugin-render/react";
import {
	Scroller,
	ScrollPluginPackage,
	useScroll,
} from "@embedpdf/plugin-scroll/react";
import {
	SearchLayer,
	SearchPluginPackage,
	useSearch,
} from "@embedpdf/plugin-search/react";
import {
	type FormattedSelection,
	SelectionLayer,
	SelectionPluginPackage,
	useSelectionCapability,
} from "@embedpdf/plugin-selection/react";
import {
	TilingLayer,
	TilingPluginPackage,
} from "@embedpdf/plugin-tiling/react";
import {
	useIsViewportGated,
	useViewportCapability,
	useViewportElement,
	useViewportPlugin,
	ViewportElementContext,
	ViewportPluginPackage,
} from "@embedpdf/plugin-viewport/react";
import {
	useZoom,
	ZoomGestureWrapper,
	ZoomMode,
	ZoomPluginPackage,
} from "@embedpdf/plugin-zoom/react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	List,
	Maximize2,
	MessageSquareText,
	Minimize2,
	Minus,
	MoveVertical,
	Plus,
	RotateCcw,
	ScanSearch,
	Search,
	X,
} from "lucide-react";
import {
	type HTMLAttributes,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	CitationLinkLayer,
	isLinkObject,
	useLinkTextResolver,
} from "@/components/viewer/embed/citation-links";
import { usePdfEngineContext } from "@/components/viewer/embed/engine-provider";
import {
	EMBED_PAGE_ATTR,
	pageElByIndex,
	rectRightScreen,
	rectTopCenterScreen,
} from "@/components/viewer/embed/geometry";
import { renderPdfRegionPromptImage } from "@/components/viewer/embed/pdf-region-crop";
import { PdfRegionSelectLayer } from "@/components/viewer/embed/pdf-region-select-layer";
import { anchorFromEmbedSelection } from "@/components/viewer/embed/selection-anchor";
import { AnnotationEditor } from "@/components/viewer/pdf-ask/annotation-editor";
import { AskPopover } from "@/components/viewer/pdf-ask/ask-popover";
import { SelectionGutter } from "@/components/viewer/pdf-ask/selection-gutter";
import { SelectionMenu } from "@/components/viewer/pdf-ask/selection-menu";
import { TranslateCard } from "@/components/viewer/pdf-ask/translate-card";
import { VisualAnnotationEditor } from "@/components/viewer/pdf-ask/visual-annotation-editor";
import { VisualTraceCard } from "@/components/viewer/pdf-ask/visual-trace-card";
import { PdfCitationPreview } from "@/components/viewer/pdf-citation-preview";
import {
	cancelAgentRun,
	listAgents,
	listenAgentCompleted,
	listenAgentFailed,
	listenAgentStream,
	type PromptImage,
	runOnce,
} from "@/lib/agent";
import {
	clearActiveSelection,
	pinActiveSelection,
	publishSelection,
} from "@/lib/agent/selection-store";
import { addVisualDraft } from "@/lib/agent/visual-context-store";
import { notifyError } from "@/lib/core/notify";
import { openExternalUrl } from "@/lib/core/open-external";
import { cn } from "@/lib/core/utils";
import { isPdfViewerSource } from "@/lib/paper";
import { writeReadingMetaPageCount } from "@/lib/paper/reading-heatmap";
import {
	type Citation,
	looksLikeCitationMarker,
	matchCitationByMarker,
	paperRefsList,
} from "@/lib/paper/refs";
import {
	buildVisualAnnotationsPrompt,
	buildVisualTraceContinuePrompt,
	completeTrace,
	createRunningTraces,
	deletePdfVisualTrace,
	failTrace,
	listPdfVisualTraces,
	newTraceMessageId,
	type PdfVisualSessionTrace,
	traceMessages,
	tracePin,
	tracePreview,
	writePdfVisualTrace,
} from "@/lib/pdf/agent-trace";
import {
	createEmptyThread,
	deletePdfAskThread,
	listPdfAskThreads,
	newMessageId,
	popoverScreenPoint,
	toSummaries,
	writePdfAskThread,
} from "@/lib/pdf/ask";
import { buildPdfAskPrompt } from "@/lib/pdf/ask/prompt";
import { threadHasUserQuestion, threadPin } from "@/lib/pdf/ask/schema";
import type {
	PdfAskAnchor,
	PdfAskNormalizedRect,
	PdfAskThread,
} from "@/lib/pdf/ask/types";
import { bookmarkPageIndex } from "@/lib/pdf/bookmark";
import {
	clearCitationHover,
	setCitationHover,
} from "@/lib/pdf/citation-hover-store";
import { createPdfViewportResizeGate } from "@/lib/pdf/dockview-resize";
import {
	hasAnnotationsFile,
	highlightViewFromObject,
	isHighlightObject,
	loadAnnotationItems,
	saveAnnotationItems,
} from "@/lib/pdf/highlight/annotation-store";
import { migrateHighlightMarks } from "@/lib/pdf/highlight/migrate-marks";
import {
	DEFAULT_HIGHLIGHT_COLOR,
	HIGHLIGHT_HEX,
	HIGHLIGHT_HEX_LIST,
	HIGHLIGHT_OPACITY,
	type HighlightColor,
} from "@/lib/pdf/highlight/palette";
import type { PdfHighlight } from "@/lib/pdf/highlight/types";
import { readReadingPage, writeReadingPage } from "@/lib/pdf/reading-position";
import {
	type ActiveSelectionCard,
	pinFromRects,
	type SelectionPin,
} from "@/lib/pdf/selection";
import {
	createTranslateRecord,
	deletePdfTranslate,
	listPdfTranslates,
	writePdfTranslate,
} from "@/lib/pdf/translate";
import type { PdfTranslateRecord } from "@/lib/pdf/translate/types";
import {
	formatPdfZoomPercentage,
	PDF_ZOOM_MAX,
	PDF_ZOOM_MIN,
	parsePdfZoomPercentage,
} from "@/lib/pdf/zoom";
import { loadSettings } from "@/lib/settings";
import { formatShortcutById } from "@/lib/shell/shortcuts";
import { openRightTab, requestOpenAgentSession } from "@/lib/shell/ui-store";
import {
	buildTranslatePrompt,
	prepareTranslateTask,
	resolveTranslateAgent,
	runTranslate,
} from "@/lib/translate";
import { isDockviewSashTarget } from "@/lib/workspace/dockview-sash";

export type PdfViewerHandle = {
	getHighlights: () => PdfHighlight[];
	scrollToHighlight: (id: string) => void;
	editComment: (id: string) => void;
	deleteHighlight: (id: string) => void;
	/** Jump to an ask pin and reopen its conversation card. */
	scrollToAsk: (id: string) => void;
	deleteAsk: (id: string) => void;
	/** Jump to a visual agent-trace pin and open its preview card. */
	scrollToVisualTrace: (id: string) => void;
	deleteVisualTrace: (id: string) => void;
	/** Toggle visual-region annotation mode (⌘.). */
	toggleVisualAnnotation: () => void;
};

export type PdfViewerProps = {
	/**
	 * PDF source: local `blob:` (bytes via fs) or remote https. Prefer local
	 * vault PDF; remote URL is fallback when download fails.
	 */
	source: string | null;
	/**
	 * Local PDF bytes. Preferred over `source`: the engine opens the document
	 * straight from the buffer, avoiding a `fetch(blob:)` that stalls/fails in
	 * some webviews (Windows WebView2). `source` is the fallback (remote https).
	 */
	sourceBytes?: ArrayBuffer | null;
	/** Stable per-tab document id (EmbedPDF documentId + scope key). */
	docId?: string | null;
	/** Absolute path to paper folder for annotations/marks persistence */
	paperAbsPath?: string | null;
	/** Vault-relative paper path stored inside JSON */
	paperRelPath?: string | null;
	/** Current vault root for ACP cwd */
	vaultPath?: string | null;
	/** Immersive full-window reading mode (adapts width + hides app chrome). */
	zen?: boolean;
	/** Toggle immersive mode; when provided a toolbar button is shown. */
	onToggleZen?: () => void;
	/** Open the annotations overview (App-level right sidebar tab). */
	onOpenAnnotations?: () => void;
	/** Open Translate settings from a translation error card. */
	onOpenSettings?: () => void;
	className?: string;
	/** Register/unregister an imperative handle for the annotations panel */
	onHandle?: (handle: PdfViewerHandle | null) => void;
	/** Called whenever the highlight list changes (for the annotations panel) */
	onHighlightsChange?: (highlights: PdfHighlight[]) => void;
	/** Called whenever PDF ask threads change (for the annotations panel) */
	onAsksChange?: (threads: PdfAskThread[]) => void;
	/** Called whenever visual agent-trace marks change (for the annotations panel) */
	onVisualTracesChange?: (traces: PdfVisualSessionTrace[]) => void;
};

/** Recursive outline (bookmarks) list for the PDF side panel. */
function OutlineTree({
	nodes,
	depth,
	onGoToPage,
}: {
	nodes: PdfBookmarkObject[];
	depth: number;
	onGoToPage: (page: number) => void;
}) {
	return (
		<ul className="space-y-0.5">
			{nodes.map((n) => (
				<li key={`${depth}-${n.title}-${JSON.stringify(n.target ?? null)}`}>
					<button
						type="button"
						className="w-full truncate rounded px-2 py-1 text-left text-muted-foreground text-xs hover:bg-muted/60 hover:text-foreground"
						style={{ paddingLeft: 8 + depth * 12 }}
						title={n.title}
						onClick={() => {
							const pageIndex = bookmarkPageIndex(n);
							if (pageIndex != null) {
								onGoToPage(pageIndex + 1);
							}
						}}
					>
						{n.title}
					</button>
					{n.children?.length ? (
						<OutlineTree
							nodes={n.children}
							depth={depth + 1}
							onGoToPage={onGoToPage}
						/>
					) : null}
				</li>
			))}
		</ul>
	);
}

/**
 * PDF viewer built on EmbedPDF (headless, PDFium/WASM). The engine is shared
 * app-wide via {@link usePdfEngineContext}; each tab mounts its own
 * `<EmbedPDF>` provider keyed by `docId` so scroll/zoom/selection/annotation
 * state stays isolated across the persistent tab set.
 *
 * Highlights/批注 are EmbedPDF annotations (persisted to
 * `marks/annotations.json`). Ask (AI Q&A) and Translate stay app-specific
 * overlays, re-sourced from the selection plugin and persisted as
 * `marks/<id>.json`.
 */
export function PdfViewer(props: PdfViewerProps) {
	const { t } = useTranslation("viewer");
	const {
		engine,
		isLoading: engineLoading,
		error: engineError,
	} = usePdfEngineContext();

	const source = isPdfViewerSource(props.source) ? props.source.trim() : null;
	const sourceBytes = props.sourceBytes ?? null;
	const docId =
		props.docId?.trim() ||
		props.paperRelPath ||
		props.paperAbsPath ||
		source ||
		"pdf";

	const plugins = useMemo(() => {
		if (!source && !sourceBytes) return null;
		// Prefer bytes (no fetch step); fall back to a URL (remote https).
		const initialDocument = sourceBytes
			? { buffer: sourceBytes, documentId: docId, name: docId }
			: { url: source as string, documentId: docId, name: docId };
		return [
			createPluginRegistration(DocumentManagerPluginPackage, {
				initialDocuments: [initialDocument],
			}),
			createPluginRegistration(ViewportPluginPackage),
			createPluginRegistration(ScrollPluginPackage),
			createPluginRegistration(RenderPluginPackage),
			createPluginRegistration(TilingPluginPackage),
			createPluginRegistration(ZoomPluginPackage, {
				defaultZoomLevel: ZoomMode.FitWidth,
				minZoom: PDF_ZOOM_MIN,
				maxZoom: PDF_ZOOM_MAX,
			}),
			createPluginRegistration(InteractionManagerPluginPackage),
			createPluginRegistration(SelectionPluginPackage),
			createPluginRegistration(AnnotationPluginPackage, {
				annotationAuthor: "Agentero",
				colorPresets: HIGHLIGHT_HEX_LIST,
				selectAfterCreate: false,
				deactivateToolAfterCreate: true,
			}),
			createPluginRegistration(SearchPluginPackage),
			createPluginRegistration(BookmarkPluginPackage),
		];
	}, [source, sourceBytes, docId]);

	const hostClass = cn(
		"relative flex h-full min-h-0 flex-col bg-muted/20",
		props.className,
	);

	if (!source && !sourceBytes) {
		return (
			<div id="agentero-pdf-host" className={hostClass}>
				<p className="p-6 text-center text-muted-foreground text-sm">
					{t("pdf.empty")}
				</p>
			</div>
		);
	}

	if (engineError) {
		return (
			<div id="agentero-pdf-host" className={hostClass}>
				<p className="p-6 text-destructive text-sm">
					{engineError.message || t("pdf.loadError")}
				</p>
			</div>
		);
	}

	if (engineLoading || !engine || !plugins) {
		return (
			<div id="agentero-pdf-host" className={hostClass}>
				<p className="p-6 text-center text-muted-foreground text-sm">
					{t("pdf.loading")}
				</p>
			</div>
		);
	}

	return (
		<div id="agentero-pdf-host" className={hostClass}>
			<EmbedPDF
				key={`${docId}::${source ?? "buffer"}`}
				engine={engine}
				plugins={plugins}
			>
				<DocumentContent documentId={docId}>
					{({ isLoaded, isLoading }) => {
						if (!isLoaded) {
							return (
								<p className="p-6 text-center text-muted-foreground text-sm">
									{isLoading ? t("pdf.loading") : t("pdf.empty")}
								</p>
							);
						}
						return <PdfViewerInner {...props} docId={docId} />;
					}}
				</DocumentContent>
			</EmbedPDF>
		</div>
	);
}

type PdfViewerInnerProps = PdfViewerProps & { docId: string };

const WHEEL_ZOOM_THRESHOLD = 100;

/**
 * Custom Ctrl/Cmd+wheel zoom handler.
 *
 * EmbedPDF's ZoomGestureWrapper multiplies the current scale by a factor
 * derived from `deltaY`, which makes a single mouse-wheel tick double or
 * halve the zoom. We disable that built-in behavior and instead step the zoom
 * with the same fixed increments used by the toolbar +/- buttons.
 */
function WheelZoomHandler({ docId }: { docId: string }) {
	const viewportRef = useViewportElement();
	const { provides: zoom } = useZoom(docId);
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;

	useEffect(() => {
		const container = viewportRef?.current;
		if (!container) return;

		let accumulated = 0;
		let resetTimeout: ReturnType<typeof setTimeout> | null = null;

		const resetAccumulation = () => {
			accumulated = 0;
			resetTimeout = null;
		};

		const scheduleReset = () => {
			if (resetTimeout) clearTimeout(resetTimeout);
			resetTimeout = setTimeout(resetAccumulation, 150);
		};

		const handleWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();

			const z = zoomRef.current;
			if (!z) return;

			accumulated += e.deltaY;
			scheduleReset();

			while (Math.abs(accumulated) >= WHEEL_ZOOM_THRESHOLD) {
				if (accumulated > 0) {
					z.zoomOut();
					accumulated -= WHEEL_ZOOM_THRESHOLD;
				} else {
					z.zoomIn();
					accumulated += WHEEL_ZOOM_THRESHOLD;
				}
			}
		};

		container.addEventListener("wheel", handleWheel, { passive: false });
		return () => {
			container.removeEventListener("wheel", handleWheel);
			if (resetTimeout) clearTimeout(resetTimeout);
		};
	}, [viewportRef]);

	return null;
}

/**
 * Dockview updates panel geometry on every sash pointermove. EmbedPDF's
 * ResizeObserver otherwise turns each of those moves into viewport + scroll
 * state updates. Keep the DOM viewport following the panel while resize
 * metrics are gated; releasing the sash lets EmbedPDF observe the final size
 * once.
 */
type DockviewViewportProps = HTMLAttributes<HTMLDivElement> & {
	children: ReactNode;
	documentId: string;
	hostRef: RefObject<HTMLDivElement | null>;
};

function DockviewViewport({
	children,
	documentId,
	hostRef,
	...props
}: DockviewViewportProps) {
	const [viewportGap, setViewportGap] = useState(0);
	const viewportRef = useRef<HTMLDivElement>(null);
	const { plugin: viewportPlugin } = useViewportPlugin();
	const { provides: viewportCapability } = useViewportCapability();
	const isGated = useIsViewportGated(documentId);

	useEffect(() => {
		if (viewportCapability) {
			setViewportGap(viewportCapability.getViewportGap());
		}
	}, [viewportCapability]);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewportPlugin || !viewport) return;

		try {
			viewportPlugin.registerViewport(documentId);
		} catch {
			return;
		}

		const ownerDocument = viewport.ownerDocument;
		const ownerWindow = ownerDocument.defaultView;
		const workspace = hostRef.current?.closest(".agentero-dockview") ?? null;
		const requestFrame = (callback: FrameRequestCallback) =>
			ownerWindow
				? ownerWindow.requestAnimationFrame(callback)
				: requestAnimationFrame(callback);
		const cancelFrame = (handle: number) => {
			if (ownerWindow) ownerWindow.cancelAnimationFrame(handle);
			else cancelAnimationFrame(handle);
		};
		const commitResize = () => {
			viewportPlugin.setViewportResizeMetrics(documentId, {
				width: viewport.offsetWidth,
				height: viewport.offsetHeight,
				clientWidth: viewport.clientWidth,
				clientHeight: viewport.clientHeight,
				scrollTop: viewport.scrollTop,
				scrollLeft: viewport.scrollLeft,
				scrollWidth: viewport.scrollWidth,
				scrollHeight: viewport.scrollHeight,
				clientLeft: viewport.clientLeft,
				clientTop: viewport.clientTop,
			});
		};
		const resizeGate = createPdfViewportResizeGate({
			commitResize,
			requestFrame,
			cancelFrame,
		});
		let dockResizeActive = false;

		const removeEndListeners = () => {
			ownerDocument.removeEventListener("pointerup", finishResize, true);
			ownerDocument.removeEventListener("pointercancel", finishResize, true);
			ownerDocument.removeEventListener("contextmenu", finishResize, true);
			ownerWindow?.removeEventListener("blur", finishResize);
		};

		const finishResize = () => {
			if (!dockResizeActive) return;
			dockResizeActive = false;
			removeEndListeners();
			resizeGate.endDockResize();
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (
				dockResizeActive ||
				!workspace ||
				!isDockviewSashTarget(event.target, workspace)
			) {
				return;
			}

			dockResizeActive = true;
			resizeGate.beginDockResize();
			ownerDocument.addEventListener("pointerup", finishResize, true);
			ownerDocument.addEventListener("pointercancel", finishResize, true);
			ownerDocument.addEventListener("contextmenu", finishResize, true);
			ownerWindow?.addEventListener("blur", finishResize);
		};

		const handleScroll = () => {
			viewportPlugin.setViewportScrollMetrics(documentId, {
				scrollTop: viewport.scrollTop,
				scrollLeft: viewport.scrollLeft,
			});
		};
		viewport.addEventListener("scroll", handleScroll);

		const ResizeObserverCtor = ownerWindow?.ResizeObserver ?? ResizeObserver;
		const resizeObserver = new ResizeObserverCtor(() => {
			resizeGate.notifyResize();
		});
		resizeObserver.observe(viewport);

		const unsubscribeScrollRequest = viewportPlugin.onScrollRequest(
			documentId,
			({ x, y, behavior = "auto" }) => {
				requestFrame(() => {
					viewport.scrollTo({ left: x, top: y, behavior });
				});
			},
		);

		ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
		return () => {
			ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
			removeEndListeners();
			dockResizeActive = false;
			resizeGate.dispose();
			resizeObserver.disconnect();
			viewport.removeEventListener("scroll", handleScroll);
			unsubscribeScrollRequest();
			viewportPlugin.unregisterViewport(documentId);
		};
	}, [documentId, hostRef, viewportPlugin]);

	const { style, ...restProps } = props;

	return (
		<ViewportElementContext.Provider
			value={viewportRef as RefObject<HTMLDivElement>}
		>
			<div
				{...restProps}
				ref={viewportRef}
				style={{
					width: "100%",
					height: "100%",
					overflow: "auto",
					...style,
					padding: `${viewportGap}px`,
				}}
			>
				{!isGated && children}
			</div>
		</ViewportElementContext.Provider>
	);
}

type SelectionMenuState = {
	screen: { x: number; y: number };
	anchor: PdfAskAnchor;
	pages: FormattedSelection[];
};

type CitationPreviewState = {
	screen: { x: number; y: number };
	marker: string;
	citation: Citation | null;
};

type EditorState = {
	screen: { x: number; y: number };
	pageIndex: number;
	id: string;
	quote: string;
	comment: string;
};

type VisualDraftEditorState = {
	screen: { x: number; y: number };
	page: number;
	region: PdfAskNormalizedRect;
	image: PromptImage;
};

function PdfViewerInner({
	docId,
	paperAbsPath = null,
	paperRelPath = null,
	vaultPath = null,
	zen = false,
	onToggleZen,
	onOpenAnnotations,
	onOpenSettings,
	onHandle,
	onHighlightsChange,
	onAsksChange,
	onVisualTracesChange,
}: PdfViewerInnerProps) {
	const { t } = useTranslation("viewer");
	const { engine } = usePdfEngineContext();
	const { provides: zoom, state: zoomState } = useZoom(docId);
	const { provides: scroll, state: scrollState } = useScroll(docId);
	const { provides: selectionCap } = useSelectionCapability();
	const { provides: interactionCap } = useInteractionManagerCapability();
	const { provides: annotationCap } = useAnnotationCapability();
	const { provides: docCap } = useDocumentManagerCapability();
	const { state: searchState, provides: search } = useSearch(docId);
	const { provides: bookmarkCap } = useBookmarkCapability();

	const currentPage = scrollState.currentPage || 1;
	const totalPages = scrollState.totalPages || 0;
	const zoomLevel = zoomState.currentZoomLevel || 1;

	const [pageField, setPageField] = useState("1");
	const [zoomField, setZoomField] = useState(() =>
		formatPdfZoomPercentage(zoomLevel),
	);
	const [highlights, setHighlights] = useState<PdfHighlight[]>([]);
	const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(
		null,
	);
	const [regionSelecting, setRegionSelecting] = useState(false);
	const [visualCropPending, setVisualCropPending] = useState(false);
	const [citations, setCitations] = useState<Citation[]>([]);
	const [citationPreview, setCitationPreview] =
		useState<CitationPreviewState | null>(null);
	const [editor, setEditor] = useState<EditorState | null>(null);
	const [visualDraftEditor, setVisualDraftEditor] =
		useState<VisualDraftEditorState | null>(null);

	const [threads, setThreads] = useState<PdfAskThread[]>([]);
	const [translates, setTranslates] = useState<PdfTranslateRecord[]>([]);
	const [visualTraces, setVisualTraces] = useState<PdfVisualSessionTrace[]>([]);
	const [activeCard, setActiveCard] = useState<ActiveSelectionCard | null>(
		null,
	);
	const [cardScreen, setCardScreen] = useState<{ x: number; y: number } | null>(
		null,
	);
	const [streaming, setStreaming] = useState(false);
	const [askError, setAskError] = useState<string | null>(null);
	const [visualStreaming, setVisualStreaming] = useState(false);
	const [visualError, setVisualError] = useState<string | null>(null);
	/** Keep the just-created Cmd+Enter card expanded until the user dismisses it. */
	const [visualCardExpanded, setVisualCardExpanded] = useState(false);
	const [translateStreaming, setTranslateStreaming] = useState(false);
	const [translateError, setTranslateError] = useState<string | null>(null);

	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState("");
	const [outline, setOutline] = useState<PdfBookmarkObject[]>([]);
	const [showOutline, setShowOutline] = useState(false);
	const findInputRef = useRef<HTMLInputElement>(null);

	const pageFocusedRef = useRef(false);
	const restoredRef = useRef(false);
	const importedRef = useRef(false);
	const importingRef = useRef(false);
	const marksLoadedRef = useRef(false);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const hostRef = useRef<HTMLDivElement>(null);
	const zoomRef = useRef(zoomLevel);
	zoomRef.current = zoomLevel;
	const zoomFieldFocusedRef = useRef(false);
	const zoomFieldCancelRef = useRef(false);
	const highlightsRef = useRef(highlights);
	highlightsRef.current = highlights;
	const threadsRef = useRef(threads);
	threadsRef.current = threads;
	const translatesRef = useRef(translates);
	translatesRef.current = translates;
	const visualTracesRef = useRef(visualTraces);
	visualTracesRef.current = visualTraces;
	const activeCardRef = useRef<ActiveSelectionCard | null>(null);
	activeCardRef.current = activeCard;
	const activeSessionRef = useRef<string | null>(null);
	const visualSessionRef = useRef<string | null>(null);
	const translateSessionRef = useRef<string | null>(null);
	const hidePopoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const citationHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	/** Stable key for resume-reading (null for loose PDFs without a paper path). */
	const paperKey = paperRelPath || paperAbsPath || null;

	useEffect(() => {
		setCitations([]);
		setCitationPreview(null);
		setRegionSelecting(false);
		clearCitationHover(docId);
		if (!vaultPath || !paperRelPath) return;
		let cancelled = false;
		void paperRefsList(vaultPath, paperRelPath)
			.then((sidecar) => {
				if (!cancelled) setCitations(sidecar?.citations ?? []);
			})
			.catch(() => {
				if (!cancelled) setCitations([]);
			});
		return () => {
			cancelled = true;
		};
	}, [docId, vaultPath, paperRelPath]);

	useEffect(() => {
		if (!zoomFieldFocusedRef.current) {
			setZoomField(formatPdfZoomPercentage(zoomLevel));
		}
	}, [zoomLevel]);

	const commitZoomField = useCallback(
		(value: string) => {
			const requested = parsePdfZoomPercentage(value);
			if (requested == null) {
				setZoomField(formatPdfZoomPercentage(zoomLevel));
				return;
			}
			zoom?.requestZoom(requested);
			setZoomField(formatPdfZoomPercentage(requested));
		},
		[zoom, zoomLevel],
	);

	const askSummaries = useMemo(
		() => toSummaries(threads.filter(threadHasUserQuestion)),
		[threads],
	);
	const activeThread = useMemo(() => {
		if (activeCard?.kind !== "ask") return null;
		return threads.find((th) => th.id === activeCard.id) ?? null;
	}, [threads, activeCard]);
	const activeTranslate = useMemo(() => {
		if (activeCard?.kind !== "translate") return null;
		return translates.find((tr) => tr.id === activeCard.id) ?? null;
	}, [translates, activeCard]);
	const activeVisualTrace = useMemo(() => {
		if (activeCard?.kind !== "agent-trace") return null;
		return visualTraces.find((tr) => tr.id === activeCard.id) ?? null;
	}, [visualTraces, activeCard]);

	// ---- Highlights (EmbedPDF annotations) ----

	const [citationLinks, setCitationLinks] = useState<
		Map<number, PdfLinkAnnoObject[]>
	>(new Map());

	const rebuildHighlights = useCallback(() => {
		if (!annotationCap) return;
		const scope = annotationCap.forDocument(docId);
		const all = scope.getAnnotations();
		const list = all
			.map((a) => a.object)
			.filter(isHighlightObject)
			.map((o) => highlightViewFromObject(o, paperKey ?? ""));
		setHighlights(list);
		onHighlightsChange?.(list);
		const links = new Map<number, PdfLinkAnnoObject[]>();
		for (const tracked of all) {
			const o = tracked.object;
			if (isLinkObject(o) && o.target) {
				const arr = links.get(o.pageIndex);
				if (arr) arr.push(o);
				else links.set(o.pageIndex, [o]);
			}
		}
		setCitationLinks(links);
	}, [annotationCap, docId, paperKey, onHighlightsChange]);

	const scheduleSave = useCallback(() => {
		if (!paperAbsPath || !annotationCap) return;
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(async () => {
			try {
				const items = await annotationCap
					.forDocument(docId)
					.exportAnnotations()
					.toPromise();
				await saveAnnotationItems(paperAbsPath, items);
			} catch {
				// transient export failures are non-fatal; next change retries
			}
		}, 600);
	}, [paperAbsPath, annotationCap, docId]);

	useEffect(() => {
		if (!annotationCap) return;
		const scope = annotationCap.forDocument(docId);
		const off = scope.onAnnotationEvent((event) => {
			rebuildHighlights();
			if (event.type !== "loaded" && !importingRef.current) scheduleSave();
		});
		rebuildHighlights();
		return () => off();
	}, [annotationCap, docId, rebuildHighlights, scheduleSave]);

	useEffect(() => {
		if (importedRef.current || !annotationCap || !docCap || totalPages <= 0)
			return;
		importedRef.current = true;
		void (async () => {
			const scope = annotationCap.forDocument(docId);
			let items: AnnotationTransferItem[] = paperAbsPath
				? await loadAnnotationItems(paperAbsPath)
				: [];
			if (
				paperAbsPath &&
				!items.length &&
				!(await hasAnnotationsFile(paperAbsPath))
			) {
				const doc = docCap.getDocument(docId);
				const migrated = await migrateHighlightMarks(
					paperAbsPath,
					(pageIndex) => doc?.pages[pageIndex]?.size ?? null,
				);
				if (migrated.length) {
					items = migrated;
					await saveAnnotationItems(paperAbsPath, migrated);
				}
			}
			if (items.length) {
				importingRef.current = true;
				scope.importAnnotations(items);
				setTimeout(() => {
					importingRef.current = false;
					rebuildHighlights();
				}, 0);
			}
		})();
	}, [
		annotationCap,
		docCap,
		docId,
		totalPages,
		paperAbsPath,
		rebuildHighlights,
	]);

	// ---- Ask / Translate persistence + streaming ----

	const upsertThread = useCallback((thread: PdfAskThread) => {
		setThreads((prev) => {
			const i = prev.findIndex((t) => t.id === thread.id);
			if (i < 0) return [thread, ...prev];
			const next = [...prev];
			next[i] = thread;
			return next;
		});
	}, []);

	const persist = useCallback(
		async (thread: PdfAskThread) => {
			if (!paperAbsPath) return;
			try {
				await writePdfAskThread(paperAbsPath, thread);
			} catch {
				// keep UI responsive
			}
		},
		[paperAbsPath],
	);

	const upsertTranslate = useCallback((rec: PdfTranslateRecord) => {
		setTranslates((prev) => {
			const i = prev.findIndex((x) => x.id === rec.id);
			if (i < 0) return [rec, ...prev];
			const next = [...prev];
			next[i] = rec;
			return next;
		});
	}, []);

	const persistTranslate = useCallback(
		async (rec: PdfTranslateRecord) => {
			if (!paperAbsPath) return;
			try {
				await writePdfTranslate(paperAbsPath, rec);
			} catch {
				// keep UI responsive
			}
		},
		[paperAbsPath],
	);

	const markTranslateFailure = useCallback(
		(id: string, message: string) => {
			const latest = translatesRef.current.find((r) => r.id === id);
			if (latest) {
				upsertTranslate({
					...latest,
					error: message,
					updatedAt: new Date().toISOString(),
				});
			}
			setTranslateStreaming(false);
			setTranslateError(message);
		},
		[upsertTranslate],
	);

	// Load persisted ask threads + translate records + agent-trace marks once.
	useEffect(() => {
		if (marksLoadedRef.current || !paperAbsPath) return;
		marksLoadedRef.current = true;
		void (async () => {
			const [ts, trs, traces] = await Promise.all([
				listPdfAskThreads(paperAbsPath),
				listPdfTranslates(paperAbsPath),
				listPdfVisualTraces(paperAbsPath),
			]);
			if (ts.length) setThreads(ts);
			if (trs.length) setTranslates(trs);
			if (traces.length) setVisualTraces(traces);
		})();
	}, [paperAbsPath]);

	// Refresh agent-trace pins when returning to this paper after a new send.
	useEffect(() => {
		if (!paperAbsPath || !marksLoadedRef.current) return;
		let cancelled = false;
		const refresh = () => {
			void listPdfVisualTraces(paperAbsPath).then((traces) => {
				if (!cancelled) setVisualTraces(traces);
			});
		};
		refresh();
		const onFocus = () => refresh();
		window.addEventListener("focus", onFocus);
		const timer = window.setInterval(refresh, 4000);
		return () => {
			cancelled = true;
			window.removeEventListener("focus", onFocus);
			window.clearInterval(timer);
		};
	}, [paperAbsPath]);

	// Publish ask threads (with a real question) to the annotations panel.
	useEffect(() => {
		onAsksChange?.(threads.filter(threadHasUserQuestion));
	}, [threads, onAsksChange]);

	// Publish visual agent-trace marks to the annotations panel.
	useEffect(() => {
		onVisualTracesChange?.(visualTraces);
	}, [visualTraces, onVisualTracesChange]);

	const cardScreenRef = useRef<{ x: number; y: number } | null>(null);
	const placeActiveCard = useCallback((card: ActiveSelectionCard) => {
		const host = hostRef.current;
		if (!host) return;
		let page = 1;
		let rects: PdfAskAnchor["rects"] = [];
		let pin: { x: number; y: number } | null = null;
		if (card.kind === "ask") {
			const thread = threadsRef.current.find((th) => th.id === card.id);
			if (!thread) return;
			page = thread.anchor.page;
			rects = thread.anchor.rects;
			pin = threadPin(thread);
		} else if (card.kind === "translate") {
			const tr = translatesRef.current.find((r) => r.id === card.id);
			if (!tr) return;
			page = tr.page;
			rects = tr.rects;
			pin = pinFromRects(tr.rects);
		} else if (card.kind === "agent-trace") {
			const tr = visualTracesRef.current.find((item) => item.id === card.id);
			if (!tr) return;
			page = tr.page;
			rects = tr.rects;
			pin = tracePin(tr);
		} else {
			return;
		}
		const pageEl = pageElByIndex(host, page - 1);
		const pt = popoverScreenPoint(pageEl, rects, pin) ?? { x: 80, y: 120 };
		// Skip identical coords — avoids re-rendering the open card (and its
		// input) on every scroll tick when the pin did not actually move.
		const prev = cardScreenRef.current;
		if (
			prev &&
			Math.round(prev.x) === Math.round(pt.x) &&
			Math.round(prev.y) === Math.round(pt.y)
		) {
			return;
		}
		cardScreenRef.current = pt;
		setCardScreen(pt);
	}, []);

	const cancelHoverHide = useCallback(() => {
		if (hidePopoverTimerRef.current) {
			clearTimeout(hidePopoverTimerRef.current);
			hidePopoverTimerRef.current = null;
		}
	}, []);

	const discardIfEmptyDraft = useCallback((threadId: string | null) => {
		if (!threadId) return;
		const th = threadsRef.current.find((t) => t.id === threadId);
		if (!th || threadHasUserQuestion(th)) return;
		setThreads((prev) => prev.filter((t) => t.id !== threadId));
	}, []);

	const hideActiveCard = useCallback(() => {
		const cur = activeCardRef.current;
		if (cur?.kind === "ask") {
			discardIfEmptyDraft(cur.id);
			setAskError(null);
		}
		if (cur?.kind === "translate") setTranslateError(null);
		if (cur?.kind === "agent-trace") {
			setVisualError(null);
			setVisualCardExpanded(false);
		}
		setActiveCard(null);
		cardScreenRef.current = null;
		setCardScreen(null);
		setEditor(null);
	}, [discardIfEmptyDraft]);

	const scheduleHoverHide = useCallback(() => {
		cancelHoverHide();
		hidePopoverTimerRef.current = setTimeout(() => {
			hidePopoverTimerRef.current = null;
			hideActiveCard();
		}, 1000);
	}, [cancelHoverHide, hideActiveCard]);

	const stopTranslateSession = useCallback(() => {
		const sid = translateSessionRef.current;
		if (sid) {
			void cancelAgentRun(sid).catch(() => undefined);
			if (activeSessionRef.current === sid) activeSessionRef.current = null;
			translateSessionRef.current = null;
		}
		setTranslateStreaming(false);
	}, []);

	const openCard = useCallback(
		(card: ActiveSelectionCard) => {
			cancelHoverHide();
			if (
				activeCardRef.current?.kind === "translate" &&
				(card.kind !== "translate" || card.id !== activeCardRef.current.id)
			) {
				stopTranslateSession();
			}
			setActiveCard(card);
			if (card.kind === "ask") setAskError(null);
			if (card.kind === "translate") setTranslateError(null);
			placeActiveCard(card);
		},
		[cancelHoverHide, placeActiveCard, stopTranslateSession],
	);

	const openThread = useCallback(
		(thread: PdfAskThread) => openCard({ kind: "ask", id: thread.id }),
		[openCard],
	);

	const createThreadFromAnchor = useCallback(
		(anchor: PdfAskAnchor) => {
			const paperPath = paperRelPath || paperAbsPath || "paper";
			const thread = createEmptyThread({ paperPath, anchor });
			setThreads((prev) => [thread, ...prev.filter(threadHasUserQuestion)]);
			return thread;
		},
		[paperAbsPath, paperRelPath],
	);

	const startFromAnchor = useCallback(
		(anchor: PdfAskAnchor) => {
			const thread = createThreadFromAnchor(anchor);
			openThread(thread);
		},
		[createThreadFromAnchor, openThread],
	);

	const sendToThread = useCallback(
		async (
			thread: PdfAskThread,
			question: string,
			agentOpts?: { agentId?: string; modelId?: string },
			/** When set (edit/resend), replace the transcript from this base instead of appending to full history. */
			baseMessages?: PdfAskThread["messages"],
			/** Visual PDF crops attached to this turn. */
			images?: PromptImage[],
		) => {
			const threadId = thread.id;
			if (!question.trim()) return;
			const userMsg = {
				id: newMessageId(),
				role: "user" as const,
				content: question,
				createdAt: new Date().toISOString(),
			};
			const prior = baseMessages ?? thread.messages;
			const withUser: PdfAskThread = {
				...thread,
				status: "open",
				messages: [...prior, userMsg],
				updatedAt: new Date().toISOString(),
			};
			upsertThread(withUser);
			void persist(withUser);
			setAskError(null);
			setStreaming(true);

			const assistantId = newMessageId();
			const prompt = buildPdfAskPrompt(withUser, question);
			try {
				const accepted = await runOnce({
					prompt,
					agentId: agentOpts?.agentId,
					modelId: agentOpts?.modelId,
					images,
					vaultPath: vaultPath ?? undefined,
					workflow: "free",
					autoApprove: true,
					hideFromChatHistory: true,
				});
				activeSessionRef.current = accepted.sessionId;
				const withAssistant: PdfAskThread = {
					...withUser,
					messages: [
						...withUser.messages,
						{
							id: assistantId,
							role: "assistant",
							content: "",
							createdAt: new Date().toISOString(),
							agentSessionId: accepted.sessionId,
						},
					],
				};
				upsertThread(withAssistant);
				const sessionId = accepted.sessionId;
				const unsubs: UnlistenFn[] = [];
				const cleanup = () => {
					for (const u of unsubs) u();
					if (activeSessionRef.current === sessionId)
						activeSessionRef.current = null;
					setStreaming(false);
				};
				unsubs.push(
					await listenAgentStream((ev) => {
						if (ev.sessionId !== sessionId) return;
						if ((ev.kind ?? "message") === "thought") return;
						setThreads((prev) =>
							prev.map((th) => {
								if (th.id !== threadId) return th;
								const msgs = [...th.messages];
								const last = msgs[msgs.length - 1];
								if (last?.id !== assistantId) return th;
								msgs[msgs.length - 1] = {
									...last,
									content: last.content + ev.chunk,
								};
								return { ...th, messages: msgs };
							}),
						);
					}),
				);
				unsubs.push(
					await listenAgentCompleted((ev) => {
						if (ev.sessionId !== sessionId) return;
						setThreads((prev) =>
							prev.map((th) => {
								if (th.id !== threadId) return th;
								const msgs = [...th.messages];
								const last = msgs[msgs.length - 1];
								if (last?.id === assistantId) {
									msgs[msgs.length - 1] = {
										...last,
										content: ev.content || last.content,
										sources: (ev.sources ?? []).map((uri) => ({ uri })),
									};
								}
								const done: PdfAskThread = {
									...th,
									messages: msgs,
									updatedAt: new Date().toISOString(),
								};
								void persist(done);
								return done;
							}),
						);
						cleanup();
					}),
				);
				unsubs.push(
					await listenAgentFailed((ev) => {
						if (ev.sessionId !== sessionId) return;
						setAskError(ev.error || t("pdfAsk.agentFailed"));
						setThreads((prev) =>
							prev.map((th) => {
								if (th.id !== threadId) return th;
								const msgs = th.messages.filter((m) => m.id !== assistantId);
								const done = { ...th, messages: msgs };
								void persist(done);
								return done;
							}),
						);
						cleanup();
					}),
				);
			} catch (e) {
				setStreaming(false);
				setAskError(e instanceof Error ? e.message : t("pdfAsk.agentFailed"));
			}
		},
		[upsertThread, persist, vaultPath, t],
	);

	const resolvePdfAskAgent = useCallback(async () => {
		const registry = await listAgents().catch(() => null);
		const resolved = resolveTranslateAgent(loadSettings().pdfAsk, registry);
		if (!resolved.agentId) {
			const msg = t("pdfAsk.noAgent");
			notifyError(msg);
			setAskError(msg);
			return null;
		}
		return resolved;
	}, [t]);

	/** Crop a region and open the visual-annotation draft editor (does not send). */
	const beginVisualAnnotation = useCallback(
		async (page: number, region: PdfAskNormalizedRect) => {
			if (!engine || !docCap || visualCropPending) return;
			const document = docCap.getDocument(docId);
			if (!document) {
				notifyError(t("pdfExplain.cropFailed"));
				return;
			}
			setVisualCropPending(true);
			setRegionSelecting(false);
			try {
				const image = await renderPdfRegionPromptImage({
					engine,
					document,
					pageIndex: page - 1,
					region,
				});
				const pageEl = pageElByIndex(hostRef.current, page - 1);
				const screen = pageEl
					? (() => {
							const box = pageEl.getBoundingClientRect();
							return {
								x: box.left + (region.x + region.w) * box.width + 8,
								y: box.top + region.y * box.height,
							};
						})()
					: { x: 120, y: 120 };
				setVisualDraftEditor({
					screen,
					page,
					region,
					image,
				});
			} catch (error) {
				const message =
					error instanceof Error ? error.message : t("pdfExplain.cropFailed");
				notifyError(t("pdfExplain.cropFailed"), { description: message });
			} finally {
				setVisualCropPending(false);
			}
		},
		[engine, docCap, docId, visualCropPending, t],
	);

	const handleVisualDraftSave = useCallback(
		(comment: string) => {
			const draft = visualDraftEditor;
			if (!draft) return;
			addVisualDraft({
				paperPath: paperRelPath || paperAbsPath || "paper",
				paperAbsPath: paperAbsPath ?? undefined,
				page: draft.page,
				rects: [draft.region],
				comment,
				image: draft.image,
			});
			setVisualDraftEditor(null);
			openRightTab("agent");
		},
		[visualDraftEditor, paperRelPath, paperAbsPath],
	);

	const upsertVisualTrace = useCallback((trace: PdfVisualSessionTrace) => {
		setVisualTraces((prev) => {
			const next = [trace, ...prev.filter((tr) => tr.id !== trace.id)];
			// Keep ref in sync so openCard/placeActiveCard can find a just-created mark.
			visualTracesRef.current = next;
			return next;
		});
	}, []);

	const persistVisualTrace = useCallback(
		async (trace: PdfVisualSessionTrace) => {
			if (!paperAbsPath) return;
			try {
				await writePdfVisualTrace(paperAbsPath, trace);
			} catch {
				// Best-effort; in-memory card still works for this session.
			}
		},
		[paperAbsPath],
	);

	/**
	 * Run (or continue) a visual-trace conversation in the pin modal.
	 * First turn may attach the crop image; follow-ups use history in the prompt.
	 */
	const sendToVisualTrace = useCallback(
		async (
			trace: PdfVisualSessionTrace,
			question: string,
			opts?: {
				images?: PromptImage[];
				/** When true, use the multi-annotation first-turn prompt. */
				firstTurn?: boolean;
				agentOpts?: { agentId?: string; modelId?: string };
			},
		) => {
			const q = question.trim();
			if (!q && !opts?.firstTurn) return;
			const content =
				q || trace.comment.trim() || t("pdfExplain.visualAnnotation");
			const now = new Date().toISOString();
			const userMsg = {
				id: newTraceMessageId(),
				role: "user" as const,
				content,
				createdAt: now,
			};
			// Prefer stored transcript; fall back to synthesized comment+answer so
			// continue never drops the first turn (which looked like "replacing" it).
			const prior = traceMessages(trace);
			// Avoid duplicating the seed user message when firstTurn already seeded it.
			const baseMessages =
				opts?.firstTurn &&
				prior.length === 1 &&
				prior[0]?.role === "user" &&
				prior[0].content === content
					? prior
					: [...prior, userMsg];
			const withUser: PdfVisualSessionTrace = {
				...trace,
				status: "running",
				// Never overwrite the original annotation comment on follow-ups.
				comment: trace.comment.trim() || content,
				messages: baseMessages,
				updatedAt: now,
				error: undefined,
			};
			upsertVisualTrace(withUser);
			void persistVisualTrace(withUser);
			setVisualError(null);
			setVisualStreaming(true);

			const assistantId = newTraceMessageId();
			const prompt = opts?.firstTurn
				? buildVisualAnnotationsPrompt([
						{ page: withUser.page, comment: content },
					])
				: buildVisualTraceContinuePrompt({
						page: withUser.page,
						comment: withUser.comment,
						messages: baseMessages,
						latestUserQuestion: content,
					});
			// Crop for visual context: first turn uses caller images; follow-ups
			// re-attach the stored crop because we do NOT session/resume (many
			// PDF-Ask agents lack resume_session → "Method not found").
			const cropImages: PromptImage[] | undefined = opts?.images?.length
				? opts.images
				: withUser.image?.data
					? [
							{
								data: withUser.image.data,
								mimeType: withUser.image.mimeType || "image/png",
							},
						]
					: undefined;
			try {
				// Same pattern as PDF Ask: each turn is a fresh runOnce with
				// history embedded in the prompt — never pass sessionId here.
				const accepted = await runOnce({
					prompt,
					agentId: opts?.agentOpts?.agentId ?? withUser.agentId,
					modelId: opts?.agentOpts?.modelId,
					images: cropImages,
					vaultPath: vaultPath ?? undefined,
					workflow: "free",
					autoApprove: true,
					hideFromChatHistory: true,
				});
				visualSessionRef.current = accepted.sessionId;
				const withAssistant: PdfVisualSessionTrace = {
					...withUser,
					agentId: accepted.agentId || withUser.agentId,
					runtimeSessionId: accepted.sessionId,
					messageId: accepted.messageId,
					messages: [
						...baseMessages,
						{
							id: assistantId,
							role: "assistant",
							content: "",
							createdAt: new Date().toISOString(),
							agentSessionId: accepted.sessionId,
						},
					],
				};
				upsertVisualTrace(withAssistant);
				void persistVisualTrace(withAssistant);

				const sessionId = accepted.sessionId;
				const unsubs: UnlistenFn[] = [];
				// Coalesce stream chunks to ~1 React update per frame so the
				// message list does not thrash the main thread while open.
				let pendingChunk = "";
				let streamRaf: number | null = null;
				const flushStreamChunk = () => {
					streamRaf = null;
					if (!pendingChunk) return;
					const chunk = pendingChunk;
					pendingChunk = "";
					setVisualTraces((prev) =>
						prev.map((tr) => {
							if (tr.id !== withUser.id) return tr;
							const msgs = [...(tr.messages ?? [])];
							const last = msgs[msgs.length - 1];
							if (last?.id !== assistantId) return tr;
							msgs[msgs.length - 1] = {
								...last,
								content: last.content + chunk,
							};
							return { ...tr, messages: msgs };
						}),
					);
				};
				const cleanup = () => {
					if (streamRaf != null) {
						cancelAnimationFrame(streamRaf);
						streamRaf = null;
					}
					if (pendingChunk) flushStreamChunk();
					for (const u of unsubs) u();
					if (visualSessionRef.current === sessionId) {
						visualSessionRef.current = null;
					}
					setVisualStreaming(false);
				};
				unsubs.push(
					await listenAgentStream((ev) => {
						if (ev.sessionId !== sessionId) return;
						if ((ev.kind ?? "message") === "thought") return;
						pendingChunk += ev.chunk;
						if (streamRaf == null) {
							streamRaf = requestAnimationFrame(flushStreamChunk);
						}
					}),
				);
				unsubs.push(
					await listenAgentCompleted((ev) => {
						if (ev.sessionId !== sessionId) return;
						if (streamRaf != null) {
							cancelAnimationFrame(streamRaf);
							streamRaf = null;
						}
						if (pendingChunk) flushStreamChunk();
						setVisualTraces((prev) => {
							const current = prev.find((tr) => tr.id === withUser.id);
							if (!current) return prev;
							const done = completeTrace(current, {
								providerSessionId: ev.providerSessionId ?? undefined,
								answerSnapshot: ev.content || undefined,
								sources: ev.sources ?? undefined,
								assistantMessageId: assistantId,
							});
							// Ensure final assistant text is set even if stream was empty.
							if (ev.content) {
								const msgs = [...(done.messages ?? [])];
								const last = msgs[msgs.length - 1];
								if (last?.id === assistantId) {
									msgs[msgs.length - 1] = {
										...last,
										content: ev.content || last.content,
									};
									done.messages = msgs;
									done.answerSnapshot = ev.content || last.content;
								}
							}
							void persistVisualTrace(done);
							return prev.map((tr) => (tr.id === done.id ? done : tr));
						});
						cleanup();
					}),
				);
				unsubs.push(
					await listenAgentFailed((ev) => {
						if (ev.sessionId !== sessionId) return;
						const err = ev.error || t("pdfAsk.agentFailed");
						setVisualError(err);
						setVisualTraces((prev) => {
							const current = prev.find((tr) => tr.id === withUser.id);
							if (!current) return prev;
							// Drop only the empty streaming assistant bubble; keep
							// every user turn so multi-turn history is not lost.
							const failed = failTrace(current, {
								error: err,
								assistantMessageId: assistantId,
							});
							void persistVisualTrace(failed);
							return prev.map((tr) => (tr.id === failed.id ? failed : tr));
						});
						cleanup();
					}),
				);
			} catch (e) {
				setVisualStreaming(false);
				const message =
					e instanceof Error ? e.message : t("pdfAsk.agentFailed");
				setVisualError(message);
				// Keep baseMessages (incl. the new user turn) so the failure does
				// not look like it replaced the first message.
				const failed = failTrace(withUser, { error: message });
				upsertVisualTrace(failed);
				void persistVisualTrace(failed);
			}
		},
		[persistVisualTrace, t, upsertVisualTrace, vaultPath],
	);

	/** ⌘/Ctrl+Enter from the region editor: create mark + chat in-place. */
	const handleVisualSendNow = useCallback(
		(comment: string) => {
			const draft = visualDraftEditor;
			if (!draft) return;
			const paperPath = paperRelPath || paperAbsPath || "paper";
			const content = comment.trim() || t("pdfExplain.visualAnnotation");
			const now = new Date().toISOString();
			const userMsg = {
				id: newTraceMessageId(),
				role: "user" as const,
				content,
				createdAt: now,
			};
			// Provisional mark so the card can open before runOnce accepts.
			const [provisional] = createRunningTraces({
				paperPath,
				agentId: "pending",
				runtimeSessionId: "pending",
				messageId: "pending",
				items: [
					{
						page: draft.page,
						rects: [draft.region],
						comment: content,
						image: {
							data: draft.image.data,
							mimeType: draft.image.mimeType || "image/png",
						},
						messages: [userMsg],
					},
				],
				createdAt: now,
			});
			if (!provisional) return;
			setVisualDraftEditor(null);
			upsertVisualTrace(provisional);
			setVisualCardExpanded(true);
			setVisualError(null);
			// Use crop screen immediately; placeActiveCard also works via synced ref.
			cardScreenRef.current = draft.screen;
			setCardScreen(draft.screen);
			openCard({ kind: "agent-trace", id: provisional.id });

			void (async () => {
				try {
					const resolved = await resolvePdfAskAgent();
					const agentId = resolved?.agentId;
					if (!agentId) {
						setVisualTraces((prev) =>
							prev.filter((tr) => tr.id !== provisional.id),
						);
						hideActiveCard();
						return;
					}
					await sendToVisualTrace({ ...provisional, agentId }, content, {
						firstTurn: true,
						images: [draft.image],
						agentOpts: {
							agentId,
							modelId: resolved.modelId,
						},
					});
				} catch (e) {
					const message =
						e instanceof Error ? e.message : t("pdfAsk.agentFailed");
					notifyError(message);
					setVisualError(message);
				}
			})();
		},
		[
			visualDraftEditor,
			paperRelPath,
			paperAbsPath,
			t,
			upsertVisualTrace,
			openCard,
			resolvePdfAskAgent,
			sendToVisualTrace,
			hideActiveCard,
		],
	);

	const handleVisualContinue = useCallback(
		(question: string) => {
			const card = activeCardRef.current;
			const traceId = card?.kind === "agent-trace" ? card.id : null;
			if (!traceId) return;
			setVisualCardExpanded(true);
			void (async () => {
				try {
					const resolved = await resolvePdfAskAgent();
					if (!resolved) return;
					// Re-read after await so we append onto the latest transcript,
					// not a stale snapshot that could drop the first turn.
					const latest = visualTracesRef.current.find(
						(tr) => tr.id === traceId,
					);
					if (!latest) return;
					void sendToVisualTrace(latest, question, {
						agentOpts: {
							agentId: resolved.agentId,
							modelId: resolved.modelId,
						},
					});
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					notifyError(message);
					setVisualError(message);
				}
			})();
		},
		[resolvePdfAskAgent, sendToVisualTrace],
	);

	const handleSend = useCallback(
		(question: string) => {
			const card = activeCardRef.current;
			const threadId = card?.kind === "ask" ? card.id : null;
			if (!threadId) return;
			const thread = threadsRef.current.find((th) => th.id === threadId);
			if (!thread) return;
			void (async () => {
				try {
					const resolved = await resolvePdfAskAgent();
					if (!resolved) return;
					void sendToThread(thread, question, {
						agentId: resolved.agentId,
						modelId: resolved.modelId,
					});
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					notifyError(message);
					setAskError(message);
				}
			})();
		},
		[sendToThread, resolvePdfAskAgent],
	);

	/** Edit last (or any) user turn: drop that message and everything after, then re-send. */
	const handleResend = useCallback(
		(messageId: string, question: string) => {
			const card = activeCardRef.current;
			const threadId = card?.kind === "ask" ? card.id : null;
			if (!threadId) return;
			const thread = threadsRef.current.find((th) => th.id === threadId);
			if (!thread) return;
			const index = thread.messages.findIndex(
				(m) => m.id === messageId && m.role === "user",
			);
			if (index < 0) return;
			const baseMessages = thread.messages.slice(0, index);
			void (async () => {
				try {
					const resolved = await resolvePdfAskAgent();
					if (!resolved) return;
					void sendToThread(
						thread,
						question,
						{
							agentId: resolved.agentId,
							modelId: resolved.modelId,
						},
						baseMessages,
					);
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					notifyError(message);
					setAskError(message);
				}
			})();
		},
		[sendToThread, resolvePdfAskAgent],
	);

	const dismissAskChrome = useCallback(() => {
		if (activeSessionRef.current) {
			void cancelAgentRun(activeSessionRef.current).catch(() => undefined);
			activeSessionRef.current = null;
		}
		setStreaming(false);
		setAskError(null);
		if (activeCardRef.current?.kind === "ask") {
			setActiveCard(null);
			setCardScreen(null);
		}
	}, []);

	const handleHide = useCallback(() => {
		const id =
			activeCardRef.current?.kind === "ask" ? activeCardRef.current.id : null;
		if (id) {
			const thread = threadsRef.current.find((th) => th.id === id);
			if (thread) {
				if (!threadHasUserQuestion(thread)) {
					setThreads((prev) => prev.filter((t) => t.id !== thread.id));
				} else if (thread.status !== "ended") {
					const ended: PdfAskThread = {
						...thread,
						status: "ended",
						updatedAt: new Date().toISOString(),
					};
					upsertThread(ended);
					void persist(ended);
				}
			}
		}
		dismissAskChrome();
	}, [upsertThread, persist, dismissAskChrome]);

	const handleDelete = useCallback(() => {
		const id =
			activeCardRef.current?.kind === "ask" ? activeCardRef.current.id : null;
		if (id) {
			setThreads((prev) => prev.filter((th) => th.id !== id));
			if (paperAbsPath) void deletePdfAskThread(paperAbsPath, id);
		}
		dismissAskChrome();
	}, [paperAbsPath, dismissAskChrome]);

	const deleteTranslateCard = useCallback(() => {
		const id =
			activeCardRef.current?.kind === "translate"
				? activeCardRef.current.id
				: null;
		stopTranslateSession();
		if (id) {
			setTranslates((prev) => prev.filter((r) => r.id !== id));
			if (paperAbsPath) void deletePdfTranslate(paperAbsPath, id);
		}
		hideActiveCard();
	}, [paperAbsPath, stopTranslateSession, hideActiveCard]);

	const deleteVisualTraceById = useCallback(
		(id: string) => {
			setVisualTraces((prev) => prev.filter((tr) => tr.id !== id));
			if (paperAbsPath) void deletePdfVisualTrace(paperAbsPath, id);
			if (
				activeCardRef.current?.kind === "agent-trace" &&
				activeCardRef.current.id === id
			) {
				hideActiveCard();
			}
		},
		[paperAbsPath, hideActiveCard],
	);

	const handleDeleteVisualTrace = useCallback(() => {
		const id =
			activeCardRef.current?.kind === "agent-trace"
				? activeCardRef.current.id
				: null;
		if (id) deleteVisualTraceById(id);
		else hideActiveCard();
	}, [deleteVisualTraceById, hideActiveCard]);

	const openVisualTraceSession = useCallback(
		(trace: PdfVisualSessionTrace) => {
			if (!trace.agentId || trace.agentId === "pending") {
				notifyError(t("pdfAsk.noAgent"));
				return;
			}
			if (!trace.runtimeSessionId || trace.runtimeSessionId === "pending") {
				notifyError(t("pdfExplain.traceSessionUnavailable"));
				return;
			}
			const messages = traceMessages(trace);
			const title =
				messages.find((m) => m.role === "user")?.content.trim() ||
				trace.comment.trim() ||
				t("pdfExplain.visualAnnotation");
			requestOpenAgentSession({
				agentId: trace.agentId,
				// Runtime id is last run only; product key is visualTrace.traceId.
				runtimeSessionId: trace.runtimeSessionId,
				providerSessionId: trace.providerSessionId,
				messageId: trace.messageId,
				title,
				prompt: title,
				answerSnapshot: trace.answerSnapshot,
				visualTrace: {
					traceId: trace.id,
					page: trace.page,
					comment: trace.comment,
					paperPath: trace.paperPath,
					image: trace.image,
					messages: messages.map((m) => ({ ...m })),
					status: trace.status,
				},
			});
			hideActiveCard();
		},
		[hideActiveCard, t],
	);

	/** Stable callbacks so VisualTraceCard memo can skip PdfViewer re-renders. */
	const handleOpenActiveVisualSession = useCallback(() => {
		const card = activeCardRef.current;
		if (card?.kind !== "agent-trace") return;
		const tr = visualTracesRef.current.find((item) => item.id === card.id);
		if (tr) openVisualTraceSession(tr);
	}, [openVisualTraceSession]);

	const handleStopVisualSession = useCallback(() => {
		const sid = visualSessionRef.current;
		if (!sid) return;
		void cancelAgentRun(sid).catch(() => undefined);
		visualSessionRef.current = null;
		setVisualStreaming(false);
	}, []);

	const openEditorForAnnotation = useCallback(
		(id: string) => {
			const obj = annotationCap
				?.forDocument(docId)
				.getAnnotationById(id)?.object;
			if (!obj || !isHighlightObject(obj)) return;
			const pageEl = pageElByIndex(hostRef.current, obj.pageIndex);
			if (!pageEl) return;
			setEditor({
				screen: rectRightScreen(pageEl, obj.rect, zoomRef.current),
				pageIndex: obj.pageIndex,
				id,
				quote: ((obj.custom ?? {}) as { quote?: string }).quote?.trim() ?? "",
				comment: obj.contents?.trim() ?? "",
			});
		},
		[annotationCap, docId],
	);

	const handleOpenPin = useCallback(
		(pin: SelectionPin) => {
			if (pin.kind === "ask") {
				const thread = threadsRef.current.find((th) => th.id === pin.id);
				if (!thread) return;
				const open: PdfAskThread = { ...thread, status: "open" };
				upsertThread(open);
				openThread(open);
				return;
			}
			if (pin.kind === "translate") openCard({ kind: "translate", id: pin.id });
			if (pin.kind === "annotate") openEditorForAnnotation(pin.id);
			if (pin.kind === "agent-trace") {
				const markId = pin.traceId || pin.id;
				const tr = visualTracesRef.current.find((item) => item.id === markId);
				if (!tr) return;
				const host = hostRef.current;
				if (host) {
					const pageEl = pageElByIndex(host, tr.page - 1);
					const pt = popoverScreenPoint(pageEl, tr.rects, tracePin(tr));
					cancelHoverHide();
					setActiveCard({ kind: "agent-trace", id: tr.id });
					setCardScreen(pt ?? { x: 80, y: 120 });
					return;
				}
				openCard({ kind: "agent-trace", id: tr.id });
			}
		},
		[
			upsertThread,
			openThread,
			openCard,
			openEditorForAnnotation,
			cancelHoverHide,
		],
	);

	// ---- Selection action menu ----

	const closeSelectionMenu = useCallback(() => {
		setSelectionMenu(null);
		selectionCap?.clear(docId);
	}, [selectionCap, docId]);

	const createHighlights = useCallback(
		(pages: FormattedSelection[], color: HighlightColor, quote: string) => {
			const scope = annotationCap?.forDocument(docId);
			if (!scope) return [] as { pageIndex: number; id: string }[];
			const created: { pageIndex: number; id: string }[] = [];
			for (const page of pages) {
				const id = crypto.randomUUID();
				const obj: PdfHighlightAnnoObject = {
					type: PdfAnnotationSubtype.HIGHLIGHT,
					id,
					pageIndex: page.pageIndex,
					rect: page.rect,
					segmentRects: page.segmentRects,
					strokeColor: HIGHLIGHT_HEX[color],
					opacity: HIGHLIGHT_OPACITY,
					created: new Date(),
					custom: { app: "agentero", paletteKey: color, quote },
				};
				scope.createAnnotation(page.pageIndex, obj);
				created.push({ pageIndex: page.pageIndex, id });
			}
			return created;
		},
		[annotationCap, docId],
	);

	const handleHighlight = useCallback(
		(color: HighlightColor) => {
			if (!selectionMenu) return;
			createHighlights(
				selectionMenu.pages,
				color,
				selectionMenu.anchor.quote ?? "",
			);
			closeSelectionMenu();
		},
		[selectionMenu, createHighlights, closeSelectionMenu],
	);

	const handleNote = useCallback(() => {
		if (!selectionMenu) return;
		const quote = selectionMenu.anchor.quote ?? "";
		const anchorPage = selectionMenu.pages[0];
		const created = createHighlights(
			selectionMenu.pages,
			DEFAULT_HIGHLIGHT_COLOR,
			quote,
		);
		const first = created[0];
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		if (first && anchorPage) {
			const pageEl = pageElByIndex(hostRef.current, anchorPage.pageIndex);
			if (pageEl) {
				setEditor({
					screen: rectRightScreen(pageEl, anchorPage.rect, zoomRef.current),
					pageIndex: first.pageIndex,
					id: first.id,
					quote,
					comment: "",
				});
			}
		}
	}, [selectionMenu, createHighlights, selectionCap, docId]);

	const handleCopy = useCallback(() => {
		selectionCap?.copyToClipboard(docId);
	}, [selectionCap, docId]);

	const handleMenuAsk = useCallback(() => {
		if (!selectionMenu) return;
		const anchor = selectionMenu.anchor;
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		startFromAnchor(anchor);
	}, [selectionMenu, startFromAnchor, selectionCap, docId]);

	const handleMenuAddToChat = useCallback(() => {
		if (!selectionMenu) return;
		const anchor = selectionMenu.anchor;
		const quote = anchor.quote?.trim();
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		if (!quote) return;
		// Re-publish after clear: clearing the PDF selection also drops the live chip.
		publishSelection({
			text: quote,
			sourcePath: paperRelPath ?? paperAbsPath ?? "PDF",
			origin: "pdf",
			page: anchor.page,
		});
		pinActiveSelection();
		openRightTab("agent");
	}, [selectionMenu, selectionCap, docId, paperRelPath, paperAbsPath]);

	const handleMenuTranslate = useCallback(() => {
		if (!selectionMenu) return;
		const anchor = selectionMenu.anchor;
		const quote = anchor.quote?.trim();
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		if (!quote) return;
		stopTranslateSession();
		const paperPath = paperRelPath || paperAbsPath || "paper";
		const rec = createTranslateRecord({
			paperPath,
			page: anchor.page,
			rects: anchor.rects,
			quote,
		});
		upsertTranslate(rec);
		openCard({ kind: "translate", id: rec.id });
		setTranslateStreaming(true);
		setTranslateError(null);

		const { providerId, targetLangName } = prepareTranslateTask({
			text: quote,
			context: { page: anchor.page, surface: "pdf-selection" },
		});

		if (providerId === "agent") {
			const prompt = buildTranslatePrompt({
				text: quote,
				targetLangName,
				page: anchor.page,
				surface: "pdf-selection",
			});
			void (async () => {
				try {
					const registry = await listAgents().catch(() => null);
					const resolved = resolveTranslateAgent(
						loadSettings().translate,
						registry,
					);
					if (!resolved.agentId) {
						const msg = t("selection.translateNoAgent");
						notifyError(msg);
						markTranslateFailure(rec.id, msg);
						return;
					}
					const accepted = await runOnce({
						prompt,
						agentId: resolved.agentId,
						modelId: resolved.modelId,
						vaultPath: vaultPath ?? undefined,
						workflow: "free",
						autoApprove: true,
						hideFromChatHistory: true,
					});
					const sessionId = accepted.sessionId;
					translateSessionRef.current = sessionId;
					activeSessionRef.current = sessionId;
					const unsubs: UnlistenFn[] = [];
					const cleanup = () => {
						for (const u of unsubs) u();
						if (translateSessionRef.current === sessionId)
							translateSessionRef.current = null;
						if (activeSessionRef.current === sessionId)
							activeSessionRef.current = null;
						setTranslateStreaming(false);
					};
					unsubs.push(
						await listenAgentStream((ev) => {
							if (ev.sessionId !== sessionId) return;
							if ((ev.kind ?? "message") === "thought") return;
							const latest =
								translatesRef.current.find((r) => r.id === rec.id) ?? rec;
							upsertTranslate({
								...latest,
								result: (latest.result ?? "") + ev.chunk,
								updatedAt: new Date().toISOString(),
								error: undefined,
							});
						}),
					);
					unsubs.push(
						await listenAgentCompleted((ev) => {
							if (ev.sessionId !== sessionId) return;
							const latest =
								translatesRef.current.find((r) => r.id === rec.id) ?? rec;
							const next = {
								...latest,
								result: (ev.content || latest.result || "").trim(),
								updatedAt: new Date().toISOString(),
								error: undefined,
							};
							upsertTranslate(next);
							void persistTranslate(next);
							setTranslateError(null);
							cleanup();
						}),
					);
					unsubs.push(
						await listenAgentFailed((ev) => {
							if (ev.sessionId !== sessionId) return;
							const msg = ev.error || t("pdfAsk.agentFailed");
							notifyError(msg);
							markTranslateFailure(rec.id, msg);
							cleanup();
						}),
					);
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					notifyError(message);
					markTranslateFailure(rec.id, message);
				}
			})();
			return;
		}

		void (async () => {
			try {
				const result = await runTranslate(
					{
						text: quote,
						context: { page: anchor.page, surface: "pdf-selection" },
					},
					{ providerId },
				);
				const latest =
					translatesRef.current.find((r) => r.id === rec.id) ?? rec;
				const next = {
					...latest,
					result: result.trim(),
					updatedAt: new Date().toISOString(),
					error: undefined,
				};
				upsertTranslate(next);
				void persistTranslate(next);
				setTranslateStreaming(false);
				setTranslateError(null);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				notifyError(message);
				markTranslateFailure(rec.id, message);
			}
		})();
	}, [
		selectionMenu,
		selectionCap,
		docId,
		t,
		vaultPath,
		paperAbsPath,
		paperRelPath,
		stopTranslateSession,
		upsertTranslate,
		persistTranslate,
		markTranslateFailure,
		openCard,
	]);

	// Show the selection action menu when a drag-selection ends.
	useEffect(() => {
		if (!selectionCap || !docCap) return;
		const scope = selectionCap.forDocument(docId);
		const offEnd = scope.onEndSelection(() => {
			const pages = selectionCap.getFormattedSelection(docId);
			if (!pages.length) {
				setSelectionMenu(null);
				return;
			}
			const first = pages[0];
			const pageEl = pageElByIndex(hostRef.current, first.pageIndex);
			if (!pageEl) return;
			const screen = rectTopCenterScreen(pageEl, first.rect, zoomRef.current);
			void (async () => {
				let quote = "";
				try {
					const lines = await selectionCap.getSelectedText(docId).toPromise();
					quote = (lines ?? []).join(" ").replace(/\s+/g, " ").trim();
				} catch {
					// text extraction is best-effort
				}
				const doc = docCap.getDocument(docId);
				const anchor = anchorFromEmbedSelection(
					pages,
					quote,
					(pageIndex) => doc?.pages[pageIndex]?.size ?? null,
				);
				if (!anchor) return;
				setSelectionMenu({ screen, anchor, pages });
				publishSelection({
					text: quote,
					sourcePath: paperRelPath ?? paperAbsPath ?? "PDF",
					origin: "pdf",
					page: anchor.page,
				});
			})();
		});
		const offChange = scope.onSelectionChange((sel) => {
			if (!sel) {
				setSelectionMenu(null);
				clearActiveSelection("pdf");
			}
		});
		return () => {
			offEnd();
			offChange();
			clearActiveSelection("pdf");
		};
	}, [selectionCap, docCap, docId, paperRelPath, paperAbsPath]);

	// Re-anchor the active ask/translate card on scroll + zoom. zoomLevel is an
	// intentional dep: it forces re-placement after a zoom (body reads live zoom).
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-anchor after zoom
	useEffect(() => {
		if (!activeCard) return;
		// Force re-place after zoom even if rounded coords match the previous pin.
		cardScreenRef.current = null;
		placeActiveCard(activeCard);
		if (!scroll) return;
		let raf: number | null = null;
		const off = scroll.onScroll(() => {
			if (raf != null) return;
			raf = requestAnimationFrame(() => {
				raf = null;
				if (activeCardRef.current) placeActiveCard(activeCardRef.current);
			});
		});
		return () => {
			if (raf != null) cancelAnimationFrame(raf);
			off();
		};
	}, [activeCard, scroll, placeActiveCard, zoomLevel]);

	// Run a debounced full-document search as the query changes.
	useEffect(() => {
		if (!search) return;
		const q = findQuery.trim();
		if (!q) {
			search.stopSearch();
			return;
		}
		const id = setTimeout(() => {
			void search.searchAllPages(q);
		}, 250);
		return () => clearTimeout(id);
	}, [findQuery, search]);

	// Load the document outline (bookmarks / TOC) once available.
	useEffect(() => {
		if (!bookmarkCap || totalPages <= 0) return;
		let cancelled = false;
		void bookmarkCap
			.forDocument(docId)
			.getBookmarks()
			.toPromise()
			.then((res) => {
				if (!cancelled) setOutline(res?.bookmarks ?? []);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [bookmarkCap, docId, totalPages]);

	// Cmd/Ctrl+F opens the in-document find bar when the PDF host is focused.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return;
			if (!host.matches(":hover") && !host.contains(document.activeElement))
				return;
			e.preventDefault();
			setFindOpen(true);
			search?.startSearch();
			setTimeout(() => findInputRef.current?.focus(), 0);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [search]);

	const saveEditor = useCallback(
		(text: string) => {
			if (!editor) return;
			annotationCap
				?.forDocument(docId)
				.updateAnnotation(editor.pageIndex, editor.id, {
					contents: text.trim() || undefined,
				});
			setEditor(null);
		},
		[editor, annotationCap, docId],
	);

	// Register the imperative handle for the annotations panel.
	useEffect(() => {
		if (!onHandle) return;
		const handle: PdfViewerHandle = {
			getHighlights: () => highlightsRef.current,
			scrollToHighlight: (id) => {
				const obj = annotationCap
					?.forDocument(docId)
					.getAnnotationById(id)?.object;
				if (!obj || !isHighlightObject(obj)) return;
				scroll?.scrollToPage({ pageNumber: obj.pageIndex + 1 });
				annotationCap?.forDocument(docId).selectAnnotation(obj.pageIndex, id);
			},
			editComment: (id) => openEditorForAnnotation(id),
			deleteHighlight: (id) => {
				const obj = annotationCap
					?.forDocument(docId)
					.getAnnotationById(id)?.object;
				if (obj && isHighlightObject(obj))
					annotationCap?.forDocument(docId).deleteAnnotation(obj.pageIndex, id);
			},
			scrollToAsk: (id) => {
				const thread = threadsRef.current.find((th) => th.id === id);
				if (!thread) return;
				scroll?.scrollToPage({ pageNumber: thread.anchor.page });
				openThread({ ...thread, status: "open" });
			},
			deleteAsk: (id) => {
				setThreads((prev) => prev.filter((th) => th.id !== id));
				if (paperAbsPath) void deletePdfAskThread(paperAbsPath, id);
			},
			scrollToVisualTrace: (id) => {
				const tr = visualTracesRef.current.find((item) => item.id === id);
				if (!tr) return;
				scroll?.scrollToPage({ pageNumber: tr.page });
				openCard({ kind: "agent-trace", id: tr.id });
			},
			deleteVisualTrace: (id) => {
				deleteVisualTraceById(id);
			},
			toggleVisualAnnotation: () => {
				if (visualCropPending) return;
				setSelectionMenu(null);
				setVisualDraftEditor(null);
				selectionCap?.clear(docId);
				setRegionSelecting((active) => !active);
			},
		};
		onHandle(handle);
		return () => onHandle(null);
	}, [
		onHandle,
		annotationCap,
		scroll,
		docId,
		paperAbsPath,
		openEditorForAnnotation,
		openThread,
		openCard,
		deleteVisualTraceById,
		selectionCap,
		visualCropPending,
	]);

	// Keep the page-number input in sync with the observed current page.
	useEffect(() => {
		if (!pageFocusedRef.current) setPageField(String(currentPage));
	}, [currentPage]);

	// On first load: record page count (reading heatmap) and restore last page.
	useEffect(() => {
		if (restoredRef.current || totalPages <= 0 || !scroll) return;
		restoredRef.current = true;
		if (paperAbsPath) {
			void writeReadingMetaPageCount(paperAbsPath, totalPages).catch(
				() => undefined,
			);
		}
		if (paperKey) {
			const saved = readReadingPage(paperKey);
			if (saved && saved > 1 && saved <= totalPages) {
				scroll.scrollToPage({ pageNumber: saved });
			}
		}
	}, [totalPages, scroll, paperAbsPath, paperKey]);

	// Persist the last read page (debounced) as the user scrolls.
	useEffect(() => {
		if (!paperKey || !restoredRef.current || currentPage < 1) return;
		const id = setTimeout(() => {
			writeReadingPage(paperKey, currentPage);
		}, 400);
		return () => clearTimeout(id);
	}, [paperKey, currentPage]);

	const scrollToResult = (idx: number) => {
		const r = searchState.results[idx];
		if (r && scroll) scroll.scrollToPage({ pageNumber: r.pageIndex + 1 });
	};

	const closeFind = () => {
		setFindOpen(false);
		setFindQuery("");
		search?.stopSearch();
	};

	const goToPage = (n: number) => {
		if (!scroll || totalPages <= 0) return;
		const clamped = Math.min(totalPages, Math.max(1, Math.floor(n)));
		scroll.scrollToPage({ pageNumber: clamped });
	};

	const commitPageField = () => {
		const n = Number.parseInt(pageField, 10);
		if (Number.isFinite(n)) goToPage(n);
		else setPageField(String(currentPage));
	};

	// ---- In-text citation / internal PDF links ----

	const resolveLinkText = useLinkTextResolver(docId);
	const linkHoverSeqRef = useRef(0);

	const cancelCitationHide = useCallback(() => {
		if (!citationHideTimerRef.current) return;
		clearTimeout(citationHideTimerRef.current);
		citationHideTimerRef.current = null;
	}, []);

	const scheduleCitationHide = useCallback(() => {
		cancelCitationHide();
		citationHideTimerRef.current = setTimeout(() => {
			citationHideTimerRef.current = null;
			setCitationPreview(null);
		}, 250);
	}, [cancelCitationHide]);

	/** GoTo/destination → smooth scroll (annotation plugin); URI → browser. */
	const handleCitationLinkActivate = useCallback(
		(link: PdfLinkAnnoObject) => {
			const target = link.target;
			if (!target || !annotationCap) return;
			annotationCap
				.navigateTarget(target, docId)
				.toPromise()
				.then((result) => {
					if (result.outcome === "uri") openExternalUrl(result.uri);
				})
				.catch(() => {});
		},
		[annotationCap, docId],
	);

	const handleCitationLinkHover = useCallback(
		(link: PdfLinkAnnoObject | null) => {
			const seq = ++linkHoverSeqRef.current;
			if (!link) {
				clearCitationHover(docId);
				scheduleCitationHide();
				return;
			}
			cancelCitationHide();
			setCitationPreview(null);
			void resolveLinkText(link).then((text) => {
				if (linkHoverSeqRef.current !== seq || !text) return;
				if (!looksLikeCitationMarker(text)) {
					clearCitationHover(docId);
					return;
				}
				setCitationHover(docId, text);
				const citationId = matchCitationByMarker(citations, text);
				const citation =
					citations.find((item) => item.id === citationId) ?? null;
				const pageEl = pageElByIndex(hostRef.current, link.pageIndex);
				if (!pageEl) return;
				setCitationPreview({
					screen: rectRightScreen(pageEl, link.rect, zoomRef.current),
					marker: text,
					citation,
				});
			});
		},
		[
			docId,
			resolveLinkText,
			citations,
			scheduleCitationHide,
			cancelCitationHide,
		],
	);

	useEffect(
		() => () => {
			clearCitationHover(docId);
			if (citationHideTimerRef.current) {
				clearTimeout(citationHideTimerRef.current);
			}
		},
		[docId],
	);

	const handleVisualRegionSelect = useCallback(
		(page: number, region: PdfAskNormalizedRect) => {
			void beginVisualAnnotation(page, region);
		},
		[beginVisualAnnotation],
	);

	useEffect(() => {
		if (!regionSelecting) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setRegionSelecting(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [regionSelecting]);

	// Region-select mode must not allow EmbedPDF text selection under the marquee.
	useEffect(() => {
		if (!regionSelecting) return;
		setSelectionMenu(null);
		selectionCap?.clear(docId);
		const scope = interactionCap?.forDocument(docId);
		scope?.pause();
		return () => {
			scope?.resume();
		};
	}, [regionSelecting, selectionCap, interactionCap, docId]);

	/**
	 * Page renderer for the Scroller. Memoized so plain scroll/zoom re-renders
	 * (which only change `currentPage`/`zoomLevel`) keep a stable callback
	 * identity and avoid re-running the per-page pin/filter work.
	 */
	const renderPage = useCallback(
		({
			pageIndex,
			width,
			height,
		}: {
			pageIndex: number;
			width: number;
			height: number;
		}) => {
			const pageNumber = pageIndex + 1;
			const activeTranslateOnPage =
				activeTranslate?.page === pageNumber ? activeTranslate : null;
			const pins: SelectionPin[] = [
				...highlights
					.filter(
						(highlight) =>
							highlight.page === pageNumber &&
							Boolean(highlight.comment?.trim()),
					)
					.flatMap((highlight): SelectionPin[] => {
						const obj = annotationCap
							?.forDocument(docId)
							.getAnnotationById(highlight.id)?.object;
						if (!obj || !isHighlightObject(obj)) return [];
						const pageWidth = width / zoomRef.current;
						const pageHeight = height / zoomRef.current;
						if (pageWidth <= 0 || pageHeight <= 0) return [];
						return [
							{
								id: highlight.id,
								kind: "annotate",
								x: Math.min(
									0.98,
									Math.max(
										0.02,
										(obj.rect.origin.x + obj.rect.size.width) / pageWidth,
									),
								),
								y: Math.min(
									0.98,
									Math.max(
										0.02,
										(obj.rect.origin.y + obj.rect.size.height / 2) / pageHeight,
									),
								),
								preview: highlight.comment?.trim() ?? highlight.id,
							},
						];
					}),
				...askSummaries
					.filter((s) => s.page === pageNumber)
					.map(
						(s): SelectionPin => ({
							id: s.id,
							kind: "ask",
							x: s.x,
							y: s.y,
							preview: s.preview,
							ended: s.status === "ended",
						}),
					),
				...translates
					.filter((tr) => tr.page === pageNumber && !tr.error)
					.map((tr): SelectionPin => {
						const pin = pinFromRects(tr.rects);
						return {
							id: tr.id,
							kind: "translate",
							x: pin.x,
							y: pin.y,
							preview: tr.result?.trim() || tr.quote?.trim() || tr.id,
						};
					}),
				...visualTraces
					.filter((tr) => tr.page === pageNumber)
					.map((tr): SelectionPin => {
						const pin = tracePin(tr);
						return {
							id: tr.id,
							kind: "agent-trace",
							x: pin.x,
							y: pin.y,
							preview: tracePreview(tr),
							ended: tr.status !== "running",
							traceId: tr.id,
						};
					}),
			];
			return (
				<div
					className="relative overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10"
					style={{ width, height }}
					{...{ [EMBED_PAGE_ATTR]: pageIndex }}
				>
					<RenderLayer
						documentId={docId}
						pageIndex={pageIndex}
						style={{ position: "absolute", inset: 0 }}
					/>
					<TilingLayer
						documentId={docId}
						pageIndex={pageIndex}
						style={{ position: "absolute", inset: 0 }}
					/>
					<SearchLayer
						documentId={docId}
						pageIndex={pageIndex}
						style={{ position: "absolute", inset: 0 }}
					/>
					<PagePointerProvider
						documentId={docId}
						pageIndex={pageIndex}
						style={{ position: "absolute", inset: 0 }}
					>
						{/* Unmount text selection while framing a visual region. */}
						{regionSelecting ? null : (
							<SelectionLayer documentId={docId} pageIndex={pageIndex} />
						)}
						<AnnotationLayer documentId={docId} pageIndex={pageIndex} />
						<CitationLinkLayer
							links={citationLinks.get(pageIndex) ?? []}
							pageWidthPt={width / zoomRef.current}
							pageHeightPt={height / zoomRef.current}
							label={t("pdf.linkAria")}
							onActivate={handleCitationLinkActivate}
							onHover={handleCitationLinkHover}
						/>
						<PdfRegionSelectLayer
							active={regionSelecting && !visualCropPending}
							label={t("pdfExplain.regionSelectionLabel", {
								page: pageNumber,
							})}
							onSelect={(region) =>
								handleVisualRegionSelect(pageNumber, region)
							}
						/>
						{activeTranslateOnPage
							? activeTranslateOnPage.rects.map((rect) => (
									<div
										key={`${activeTranslateOnPage.id}-source-${rect.x}-${rect.y}-${rect.w}-${rect.h}`}
										className="pointer-events-none absolute z-[1] rounded-[2px] bg-yellow-300/40 dark:bg-yellow-400/35"
										style={{
											left: `${rect.x * 100}%`,
											top: `${rect.y * 100}%`,
											width: `${rect.w * 100}%`,
											height: `${rect.h * 100}%`,
										}}
										aria-hidden="true"
									/>
								))
							: null}
						<SelectionGutter
							items={pins}
							activeId={activeCard?.id ?? null}
							onOpen={handleOpenPin}
							onEnter={cancelHoverHide}
							onLeave={scheduleHoverHide}
						/>
					</PagePointerProvider>
				</div>
			);
		},
		[
			docId,
			highlights,
			annotationCap,
			askSummaries,
			visualTraces,
			translates,
			activeTranslate,
			activeCard?.id,
			handleOpenPin,
			cancelHoverHide,
			scheduleHoverHide,
			citationLinks,
			handleCitationLinkActivate,
			handleCitationLinkHover,
			regionSelecting,
			visualCropPending,
			handleVisualRegionSelect,
			t,
		],
	);

	return (
		<div ref={hostRef} className="relative flex h-full min-h-0 w-full flex-col">
			{outline.length > 0 ? (
				<div className="pointer-events-none absolute top-2 left-3 z-30">
					<TooltipProvider delayDuration={200}>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									className="pointer-events-auto rounded-lg border border-border/80 bg-background/95 shadow-sm backdrop-blur-sm"
									aria-label={t("pdf.outline")}
									aria-pressed={showOutline}
									onClick={() => setShowOutline((v) => !v)}
								>
									<List className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.outline")}</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</div>
			) : null}
			{showOutline && outline.length > 0 ? (
				<aside className="agentero-scroll absolute inset-y-0 left-0 z-20 w-60 border-r bg-background/95 pt-11 pb-2 backdrop-blur-sm">
					<div className="px-2">
						<OutlineTree nodes={outline} depth={0} onGoToPage={goToPage} />
					</div>
				</aside>
			) : null}
			{findOpen ? (
				<TooltipProvider delayDuration={200}>
					<div className="absolute top-12 right-3 z-30 flex items-center gap-1 rounded-lg border border-border/80 bg-background/95 p-1 shadow-md backdrop-blur-sm">
						<Search className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
						<input
							ref={findInputRef}
							type="text"
							className="w-40 bg-transparent text-xs outline-none"
							placeholder={t("pdf.findPlaceholder")}
							value={findQuery}
							onChange={(e) => setFindQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									scrollToResult(
										e.shiftKey
											? (search?.previousResult() ?? -1)
											: (search?.nextResult() ?? -1),
									);
								} else if (e.key === "Escape") {
									e.preventDefault();
									closeFind();
								}
							}}
						/>
						<span className="min-w-11 shrink-0 px-1 text-center text-muted-foreground text-xs tabular-nums">
							{findQuery.trim()
								? searchState.total > 0
									? `${searchState.activeResultIndex + 1}/${searchState.total}`
									: t("pdf.findNoResults")
								: ""}
						</span>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.findPrev")}
									disabled={searchState.total === 0}
									onClick={() => scrollToResult(search?.previousResult() ?? -1)}
								>
									<ChevronUp className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.findPrev")}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.findNext")}
									disabled={searchState.total === 0}
									onClick={() => scrollToResult(search?.nextResult() ?? -1)}
								>
									<ChevronDown className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.findNext")}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.findClose")}
									onClick={closeFind}
								>
									<X className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{t("pdf.findClose")}
							</TooltipContent>
						</Tooltip>
					</div>
				</TooltipProvider>
			) : null}
			<div className="pointer-events-none absolute top-2 right-3 z-20 flex items-center gap-1">
				<TooltipProvider delayDuration={200}>
					<div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border/80 bg-background/95 p-0.5 shadow-sm backdrop-blur-sm">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.zoomOut")}
									disabled={zoomLevel <= PDF_ZOOM_MIN}
									onClick={() => zoom?.zoomOut()}
								>
									<Minus className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.zoomOut")}</TooltipContent>
						</Tooltip>
						<div className="relative">
							<input
								type="text"
								inputMode="decimal"
								maxLength={6}
								value={zoomField}
								aria-label={t("pdf.zoomPercentage")}
								title={t("pdf.zoomPercentage")}
								className="h-6 w-12 rounded border border-transparent bg-transparent py-0 pr-3.5 pl-1 text-right font-medium text-muted-foreground text-xs tabular-nums outline-none hover:border-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
								onChange={(event) => setZoomField(event.target.value)}
								onFocus={(event) => {
									zoomFieldFocusedRef.current = true;
									event.currentTarget.select();
								}}
								onBlur={(event) => {
									zoomFieldFocusedRef.current = false;
									if (zoomFieldCancelRef.current) {
										zoomFieldCancelRef.current = false;
										setZoomField(formatPdfZoomPercentage(zoomLevel));
										return;
									}
									commitZoomField(event.currentTarget.value);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										event.currentTarget.blur();
									} else if (event.key === "Escape") {
										event.preventDefault();
										zoomFieldCancelRef.current = true;
										event.currentTarget.blur();
									}
								}}
							/>
							<span
								aria-hidden="true"
								className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground text-xs"
							>
								%
							</span>
						</div>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.zoomIn")}
									disabled={zoomLevel >= PDF_ZOOM_MAX}
									onClick={() => zoom?.zoomIn()}
								>
									<Plus className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.zoomIn")}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.zoomFit")}
									onClick={() => zoom?.requestZoom(ZoomMode.FitWidth)}
								>
									<RotateCcw className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.zoomFit")}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.zoomFitPage")}
									onClick={() => zoom?.requestZoom(ZoomMode.FitPage)}
								>
									<MoveVertical className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{t("pdf.zoomFitPage")}
							</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant={regionSelecting ? "secondary" : "ghost"}
									aria-label={t("pdfExplain.selectRegion")}
									aria-pressed={regionSelecting}
									disabled={visualCropPending || !engine}
									onClick={() => {
										setSelectionMenu(null);
										setVisualDraftEditor(null);
										selectionCap?.clear(docId);
										setRegionSelecting((active) => !active);
									}}
								>
									<ScanSearch
										className={cn(
											"size-3.5",
											visualCropPending && "animate-pulse",
										)}
									/>
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{regionSelecting
									? t("pdfExplain.cancelRegion")
									: t("pdfExplain.selectRegion")}
								<span className="ml-2 text-muted-foreground">
									{formatShortcutById("visualAnnotation")}
								</span>
							</TooltipContent>
						</Tooltip>
						{onToggleZen ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										size="icon-xs"
										variant="ghost"
										aria-label={zen ? t("pdf.zenExit") : t("pdf.zenEnter")}
										aria-pressed={zen}
										onClick={onToggleZen}
									>
										{zen ? (
											<Minimize2 className="size-3.5" />
										) : (
											<Maximize2 className="size-3.5" />
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{zen ? t("pdf.zenExit") : t("pdf.zenEnter")}
								</TooltipContent>
							</Tooltip>
						) : null}
						{onOpenAnnotations ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										size="icon-xs"
										variant="ghost"
										aria-label={t("annotations.title")}
										onClick={onOpenAnnotations}
									>
										<MessageSquareText className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{t("annotations.title")}
								</TooltipContent>
							</Tooltip>
						) : null}
					</div>
				</TooltipProvider>
			</div>

			<DockviewViewport
				documentId={docId}
				hostRef={hostRef}
				className="agentero-scroll-both min-h-0 min-w-0 flex-1"
			>
				<WheelZoomHandler docId={docId} />
				{/* Pinch zoom still handled by EmbedPDF; wheel zoom is replaced above so
				    the step size matches the toolbar +/- buttons. */}
				<ZoomGestureWrapper documentId={docId} enableWheel={false}>
					<GlobalPointerProvider documentId={docId}>
						<Scroller documentId={docId} renderPage={renderPage} />
					</GlobalPointerProvider>
				</ZoomGestureWrapper>
			</DockviewViewport>

			{typeof document !== "undefined"
				? createPortal(
						<>
							{selectionMenu ? (
								<SelectionMenu
									screen={selectionMenu.screen}
									onHighlight={handleHighlight}
									onCopy={handleCopy}
									onNote={handleNote}
									onAsk={handleMenuAsk}
									onAddToChat={handleMenuAddToChat}
									onTranslate={handleMenuTranslate}
									onClose={closeSelectionMenu}
								/>
							) : null}

							{visualDraftEditor ? (
								<VisualAnnotationEditor
									screen={visualDraftEditor.screen}
									page={visualDraftEditor.page}
									image={visualDraftEditor.image}
									onSave={handleVisualDraftSave}
									onSendNow={handleVisualSendNow}
									onClose={() => setVisualDraftEditor(null)}
								/>
							) : null}

							{citationPreview ? (
								<PdfCitationPreview
									screen={citationPreview.screen}
									marker={citationPreview.marker}
									citation={citationPreview.citation}
									onOpenReferences={() => {
										setCitationPreview(null);
										openRightTab("references");
									}}
									onPointerEnter={cancelCitationHide}
									onPointerLeave={scheduleCitationHide}
								/>
							) : null}

							{activeThread && cardScreen ? (
								<AskPopover
									thread={activeThread}
									screen={cardScreen}
									streaming={streaming}
									error={askError}
									onSend={handleSend}
									onResend={handleResend}
									onHide={handleHide}
									onDelete={handleDelete}
									onPointerEnter={cancelHoverHide}
									onPointerLeave={scheduleHoverHide}
									onStop={() => {
										const sid = activeSessionRef.current;
										if (!sid) return;
										void cancelAgentRun(sid).catch(() => undefined);
										activeSessionRef.current = null;
										setStreaming(false);
									}}
								/>
							) : null}

							{activeVisualTrace && cardScreen ? (
								<VisualTraceCard
									trace={activeVisualTrace}
									screen={cardScreen}
									streaming={visualStreaming}
									error={visualError}
									initialExpanded={visualCardExpanded}
									onOpenSession={handleOpenActiveVisualSession}
									onSend={handleVisualContinue}
									onDelete={handleDeleteVisualTrace}
									onHide={hideActiveCard}
									onPointerEnter={cancelHoverHide}
									onPointerLeave={scheduleHoverHide}
									onStop={handleStopVisualSession}
								/>
							) : null}

							{activeTranslate && cardScreen ? (
								<TranslateCard
									screen={cardScreen}
									result={activeTranslate.result ?? ""}
									streaming={translateStreaming}
									error={translateError ?? activeTranslate.error ?? null}
									onOpenSettings={() => onOpenSettings?.()}
									onHide={hideActiveCard}
									onDelete={deleteTranslateCard}
									onPointerEnter={cancelHoverHide}
									onPointerLeave={scheduleHoverHide}
								/>
							) : null}

							{editor ? (
								<AnnotationEditor
									screen={editor.screen}
									initialComment={editor.comment}
									onSave={saveEditor}
									onClose={() => setEditor(null)}
									onPointerEnter={cancelHoverHide}
									onPointerLeave={scheduleHoverHide}
								/>
							) : null}
						</>,
						document.body,
					)
				: null}

			{totalPages > 0 ? (
				<div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
					<TooltipProvider delayDuration={200}>
						<div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border/80 bg-background/95 p-0.5 shadow-sm backdrop-blur-sm">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										size="icon-xs"
										variant="ghost"
										aria-label={t("pdf.prevPage")}
										disabled={currentPage <= 1}
										onClick={() => goToPage(currentPage - 1)}
									>
										<ChevronLeft className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="top">{t("pdf.prevPage")}</TooltipContent>
							</Tooltip>
							<input
								type="text"
								inputMode="numeric"
								className="w-8 rounded bg-transparent text-center font-medium text-foreground text-xs tabular-nums outline-none focus:bg-muted"
								aria-label={t("pdf.goToPage")}
								value={pageField}
								onFocus={(e) => {
									pageFocusedRef.current = true;
									e.currentTarget.select();
								}}
								onChange={(e) =>
									setPageField(e.target.value.replace(/[^0-9]/g, ""))
								}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										commitPageField();
										e.currentTarget.blur();
									}
								}}
								onBlur={() => {
									pageFocusedRef.current = false;
									commitPageField();
								}}
							/>
							<span className="px-0.5 text-muted-foreground text-xs tabular-nums">
								/ {totalPages}
							</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										size="icon-xs"
										variant="ghost"
										aria-label={t("pdf.nextPage")}
										disabled={currentPage >= totalPages}
										onClick={() => goToPage(currentPage + 1)}
									>
										<ChevronRight className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="top">{t("pdf.nextPage")}</TooltipContent>
							</Tooltip>
						</div>
					</TooltipProvider>
				</div>
			) : null}
		</div>
	);
}
