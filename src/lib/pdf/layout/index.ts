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
	bboxContainment,
	bboxIoU,
	type DedupeLayoutOptions,
	dedupeLayoutRegions,
} from "@/lib/pdf/layout/dedupe";
export {
	isAlgorithmLayoutKind,
	isCaptionLayoutKind,
	isFigureLayoutKind,
	isFormulaLayoutKind,
	isFormulaNumberLayoutKind,
	isSidebarLayoutKind,
	isTableLayoutKind,
	isTargetLayoutLabel,
	layoutDedupeGroup,
	layoutLabelToKind,
} from "@/lib/pdf/layout/labels";
export {
	areFigureNeighbors,
	bboxFullyContains,
	buildFigureBboxWithFullTitle,
	type CaptionPlacement,
	captionAttachScore,
	captionCompatibleWithHost,
	clipFigureBboxToTitleColumn,
	connectedPanelGroups,
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
	layoutAnalysisStore,
	setFocusedLayoutRegion,
	setLayoutAnalysisUi,
	setLayoutDocumentResult,
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
