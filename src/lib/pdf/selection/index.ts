export {
	deleteMarkFile,
	listMarkRaw,
	MARKS_FOLDER,
	markPath,
	marksDir,
	type PdfMarkKind,
	readMarkRaw,
	writeMarkFile,
} from "@/lib/pdf/selection/marks-io";
export { type NormalizedRect, pinFromRects } from "@/lib/pdf/selection/pin";
export type {
	ActiveSelectionCard,
	SelectionOverlayKind,
	SelectionPin,
} from "@/lib/pdf/selection/types";
