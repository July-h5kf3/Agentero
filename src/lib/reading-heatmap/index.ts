export {
	aggregateReadingHeatmap,
	documentPosition,
	emptyHeatmap,
	isEmptyHeatmap,
	meanRectY,
} from "@/lib/reading-heatmap/aggregate";
export {
	heatmapCacheKey,
	loadReadingActivityPoints,
	loadReadingHeatmap,
	loadReadingHeatmaps,
} from "@/lib/reading-heatmap/load";
export {
	parseReadingMeta,
	type ReadingMeta,
	readReadingMeta,
	writeReadingMetaPageCount,
} from "@/lib/reading-heatmap/meta";
export {
	EMPTY_READING_HEATMAP,
	READING_HEATMAP_BIN_COUNT,
	type ReadingActivityKind,
	type ReadingActivityPoint,
	type ReadingHeatmap,
} from "@/lib/reading-heatmap/types";
