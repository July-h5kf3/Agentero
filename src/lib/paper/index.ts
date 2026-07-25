export * from "@/lib/paper/api";
export * from "@/lib/paper/arxiv";
export {
	PAPER_DIR_MARKERS,
	PAPER_FILE_MARKERS,
	type PaperDownloadReason,
	paperAssetDownloadReasons,
	paperAssetsComplete,
	paperHasLocalPaperMd,
	paperHasLocalPdf,
	paperHasLocalTex,
	paperNeedsAssetDownload,
	paperNeedsRead,
} from "@/lib/paper/assets";
export {
	collectPaperFoldersFromTree,
	collectPapersNeedingAssetDownload,
	detectPaperDirectory,
	directoryHasPaperMarkers,
	isPaperDirectory,
	paperDirFromPath,
	resolvePapersParentDir,
} from "@/lib/paper/detect";
export { loadPaperMetadata, paperCatalogPath } from "@/lib/paper/load-meta";
export * from "@/lib/paper/local-pdf-meta";
export * from "@/lib/paper/lookup";
export {
	canAttemptPdfDownload,
	findLocalPdfPath,
	isPdfViewerSource,
	localBytesToViewerSource,
	localFileToArrayBuffer,
	localImageToViewerSource,
	localPdfToViewerSource,
	paperRemoteAssetsFromMetadata,
	resolveRemoteUrl,
	revokePdfViewerSource,
} from "@/lib/paper/media";
export {
	isPapersRoot,
	isUnderPapers,
	metadataPathForPaper,
	notesPathForPaper,
} from "@/lib/paper/paths";
export * from "@/lib/paper/reader";
export { withNormalizedTags } from "@/lib/paper/tags";
export {
	formatAuthorsShort,
	formatPaperTreeLabel,
	isPaperTreeLabelMode,
	isPaperTreeSortMode,
	PAPER_TREE_LABEL_MODES,
	PAPER_TREE_SORT_MODES,
	type PaperTreeLabelMode,
	type PaperTreeSortMode,
	sortFileTreeNodes,
} from "@/lib/paper/tree-label";
export type {
	PaperCreator,
	PaperMetadata,
	PaperPdfOrigin,
	PaperTag,
	PaperTagInput,
	RemoteAsset,
} from "@/lib/paper/types";
