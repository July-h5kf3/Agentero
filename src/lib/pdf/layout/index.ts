export { getPdfAiRuntime } from "@/lib/pdf/layout/ai-runtime";
export {
	LAYOUT_KIND_BADGE_CLASS,
	LAYOUT_KIND_BORDER,
	LAYOUT_KIND_FILL,
	LAYOUT_KIND_HEX,
	layoutKindBorder,
	layoutKindFill,
	layoutKindHex,
} from "@/lib/pdf/layout/colors";
export {
	LAYOUT_HOVER_DWELL_MS,
	LAYOUT_SIDEBAR_MIN_SCORE,
} from "@/lib/pdf/layout/constants";
export {
	bboxContainment,
	bboxIoU,
	type DedupeLayoutOptions,
	dedupeLayoutRegions,
} from "@/lib/pdf/layout/dedupe";
export {
	bboxArea,
	hoverableLayoutRegions,
	hoverableLayoutRegionsOnPage,
	pickLayoutRegionAtPoint,
	pointInBbox,
} from "@/lib/pdf/layout/hit-test";
export {
	LAYOUT_SIDECAR_FILE,
	LAYOUT_SIDECAR_SCHEMA_VERSION,
	layoutSidecarPath,
	type PdfLayoutSidecar,
	parseLayoutSidecar,
	readLayoutSidecar,
	writeLayoutSidecar,
} from "@/lib/pdf/layout/io";
export {
	isAlgorithmLayoutKind,
	isCaptionLayoutKind,
	isFigureLayoutKind,
	isFormulaLayoutKind,
	isFormulaNumberLayoutKind,
	isSidebarLayoutKind,
	isTableLayoutKind,
	isTargetLayoutLabel,
	isTextLayoutKind,
	layoutDedupeGroup,
	layoutLabelToKind,
} from "@/lib/pdf/layout/labels";
export {
	areFigureNeighbors,
	bboxCoveredBy,
	bboxFullyContains,
	buildFigureBboxWithFullTitle,
	type CaptionPlacement,
	captionAttachScore,
	captionCompatibleWithHost,
	clipFigureBboxToTitleColumn,
	connectedPanelGroups,
	formulaOverlapsText,
	hostFamily,
	isMainAlgorithmCaption,
	isMainFigureCaption,
	isMainTableCaption,
	isSubpanelCaption,
	LAYOUT_MERGE,
	type LayoutHostFamily,
	mergeCaptionsIntoHosts,
	mergeFormulasByNumber,
	panelInTitleColumn,
	panelsAboveTitle,
	preferredCaptionPlacement,
	requireFigureTitles,
	resolveFigureBboxOverlaps,
	selectClusterForTitle,
	selectFormulasForNumber,
	suppressOrphanFiguresInsideClusters,
	unionBbox,
	verticalCeilingForTitle,
} from "@/lib/pdf/layout/merge-captions";
export {
	attachLayoutModelTaskListener,
	ensureLayoutModel,
	getLayoutModelStatus,
	LAYOUT_MODEL_TASK_ID,
	type LayoutModelStatus,
	layoutModelLocalUrl,
	prefetchLayoutModel,
} from "@/lib/pdf/layout/model";
export {
	buildLayoutDocumentResult,
	documentLayoutToResult,
	pageLayoutToRegions,
	regionsFromDocumentLayout,
	summarizeLayoutResult,
} from "@/lib/pdf/layout/normalize";
export {
	type RunLayoutAnalysisOptions,
	runDocumentLayoutAnalysis,
} from "@/lib/pdf/layout/run-analysis";
export {
	clearLayoutDocumentResult,
	getFocusedLayoutRegion,
	getLayoutDocumentResult,
	isLayoutOverlayVisible,
	layoutAnalysisStore,
	setFocusedLayoutRegion,
	setLayoutAnalysisUi,
	setLayoutDocumentResult,
	setLayoutOverlayVisible,
	toggleLayoutOverlayVisible,
} from "@/lib/pdf/layout/store";
export {
	attachTitlesFromTextRuns,
	type CaptionRole,
	captionRoleFromGeometry,
	captionRoleFromText,
	enrichCaptionRegionsWithText,
	extractFormulaNumberLabel,
	looksLikeFigureCaption,
	looksLikeFormulaNumber,
	resolveCaptionRole,
	textFromRunsInBbox,
} from "@/lib/pdf/layout/title-text";
export type {
	LayoutAnalysisUiStatus,
	PdfLayoutDocumentResult,
	PdfLayoutKind,
	PdfLayoutRegion,
} from "@/lib/pdf/layout/types";
