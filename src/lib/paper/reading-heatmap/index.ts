export {
	aggregateReadingHeatmap,
	documentPosition,
	emptyHeatmap,
	isEmptyHeatmap,
	meanRectY,
} from "@/lib/paper/reading-heatmap/aggregate";
export {
	heatmapCacheKey,
	loadReadingActivityPoints,
	loadReadingHeatmap,
	loadReadingHeatmaps,
} from "@/lib/paper/reading-heatmap/load";
export {
	parseReadingMeta,
	type ReadingMeta,
	readReadingMeta,
	writeReadingMetaPageCount,
} from "@/lib/paper/reading-heatmap/meta";
export {
	EMPTY_READING_HEATMAP,
	READING_HEATMAP_BIN_COUNT,
	type ReadingActivityKind,
	type ReadingActivityPoint,
	type ReadingHeatmap,
} from "@/lib/paper/reading-heatmap/types";
