import type {
	DocumentAnalysisProgress,
	DocumentLayout,
	LayoutAnalysisScope,
	LayoutTask,
} from "@embedpdf/plugin-layout-analysis";

import { logger } from "@/lib/core/logger";
import { readLayoutSidecar, writeLayoutSidecar } from "@/lib/pdf/layout/io";
import { mergeCaptionsIntoHosts } from "@/lib/pdf/layout/merge-captions";
import { ensureLayoutModel } from "@/lib/pdf/layout/model";
import {
	buildLayoutDocumentResult,
	regionsFromDocumentLayout,
	summarizeLayoutResult,
} from "@/lib/pdf/layout/normalize";
import {
	setLayoutAnalysisUi,
	setLayoutDocumentResult,
} from "@/lib/pdf/layout/store";
import {
	attachTitlesFromTextRuns,
	enrichCaptionRegionsWithText,
} from "@/lib/pdf/layout/title-text";
import type {
	PdfLayoutDocumentResult,
	PdfLayoutRegion,
} from "@/lib/pdf/layout/types";

export type RunLayoutAnalysisOptions = {
	/** Re-analyze even if pages are cached in EmbedPDF or source/layout.json. */
	force?: boolean;
	/** Paper folder path; when present, raw layout persists to source/layout.json. */
	paperAbsPath?: string | null;
	/** PDF page count for progress bar before the first page-complete event. */
	totalPages?: number | null;
	onProgress?: (messageStage: DocumentAnalysisProgress) => void;
	onDone?: (summary: string, total: number) => void;
	onError?: (message: string, aborted: boolean) => void;
};

/** Intra-page phase weight (0–1) so the bar advances within a page. */
function pagePhaseWeight(stage: DocumentAnalysisProgress["stage"]): number {
	switch (stage) {
		case "creating-session":
			return 0.05;
		case "rendering":
			return 0.2;
		case "layout-detection":
			return 0.55;
		case "mapping-coordinates":
			return 0.8;
		case "table-structure":
			return 0.9;
		case "page-complete":
			return 1;
		default:
			return 0.4;
	}
}

function clampProgress(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(100, Math.round(value)));
}

function taskToPromise<T>(task: {
	wait: (ok: (v: T) => void, err: (e: unknown) => void) => void;
}): Promise<T> {
	return new Promise((resolve, reject) => {
		task.wait(resolve, reject);
	});
}

function buildResultFromRawRegions(
	documentId: string,
	rawRegions: PdfLayoutRegion[],
): PdfLayoutDocumentResult {
	return buildLayoutDocumentResult(
		documentId,
		mergeCaptionsIntoHosts(rawRegions),
		rawRegions,
	);
}

/**
 * 1) Extract text on every caption box
 * 2) Assign captionRole (Figure/Table/Algorithm/subpanel)
 * 3) Merge by role + geometry
 * 4) Fill host titles from titleBbox if needed
 */
async function buildTextAwareResult(
	scope: LayoutAnalysisScope,
	documentId: string,
	docLayout: DocumentLayout,
): Promise<{
	rawRegions: PdfLayoutRegion[];
	result: PdfLayoutDocumentResult;
}> {
	let raw: PdfLayoutRegion[] = regionsFromDocumentLayout(docLayout);

	const pages = new Set(raw.map((r) => r.pageIndex));
	for (const pageIndex of pages) {
		const pageLayout = docLayout.pages.find((p) => p.pageIndex === pageIndex);
		const pageSize = pageLayout?.pageSize;
		if (!pageSize || pageSize.width <= 0 || pageSize.height <= 0) continue;
		try {
			const textRuns = await taskToPromise(scope.getPageTextRuns(pageIndex));
			const runs = textRuns.runs ?? [];
			raw = enrichCaptionRegionsWithText(raw, pageIndex, runs, pageSize);
		} catch {
			// continue without text for this page
		}
	}

	let result = buildResultFromRawRegions(documentId, raw);
	let regions = result.regions;

	// Ensure hosts with titleBbox have title strings.
	for (const pageIndex of pages) {
		const pageLayout = docLayout.pages.find((p) => p.pageIndex === pageIndex);
		const pageSize = pageLayout?.pageSize;
		if (!pageSize) continue;
		const need = regions.some(
			(r) => r.pageIndex === pageIndex && r.titleBbox && !r.title?.trim(),
		);
		if (!need) continue;
		try {
			const textRuns = await taskToPromise(scope.getPageTextRuns(pageIndex));
			regions = attachTitlesFromTextRuns(
				regions,
				pageIndex,
				textRuns.runs ?? [],
				pageSize,
			);
			result = buildLayoutDocumentResult(documentId, regions, raw);
		} catch {
			// ignore
		}
	}

	return { rawRegions: raw, result };
}

/**
 * Shared analyze-all-pages runner for toolbar + PdfViewerHandle + figures panel.
 * Awaits Host XDG model ensure (ModelScope → HuggingFace) before analysis.
 */
export async function runDocumentLayoutAnalysis(
	scope: LayoutAnalysisScope,
	documentId: string,
	options: RunLayoutAnalysisOptions = {},
): Promise<LayoutTask<DocumentLayout, DocumentAnalysisProgress> | null> {
	if (!options.force && options.paperAbsPath) {
		setLayoutAnalysisUi(
			{
				stage: "running",
				message: "Loading cached layout…",
				progress: null,
			},
			documentId,
		);
		const cached = await readLayoutSidecar(options.paperAbsPath);
		if (cached) {
			const result = buildResultFromRawRegions(documentId, cached.regions);
			setLayoutDocumentResult(result);
			const summary = summarizeLayoutResult(result);
			setLayoutAnalysisUi(
				{
					stage: "done",
					message: summary,
					total: result.regions.length,
				},
				documentId,
			);
			console.info("[layout-analysis]", {
				documentId,
				summary,
				cache: true,
				regions: result.regions,
			});
			options.onDone?.(summary, result.regions.length);
			return null;
		}
	}

	setLayoutAnalysisUi(
		{
			stage: "running",
			message: "Analyzing layout…",
			progress: null,
		},
		documentId,
	);

	try {
		const s = await ensureLayoutModel();
		if (s && !s.ready) {
			logger.warn("layout model ensure returned not ready", s);
		}
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		logger.warn("layout model ensure failed", { error: message });
		setLayoutAnalysisUi({ stage: "error", message }, documentId);
		options.onError?.(message, false);
		// Return a no-op style task: rethrow by starting nothing — callers need a task.
		// Fall through only if we still want plugin fallback; fail closed here.
		throw e;
	}

	let knownTotal =
		typeof options.totalPages === "number" && options.totalPages > 0
			? Math.floor(options.totalPages)
			: null;
	let completedPages = 0;

	setLayoutAnalysisUi(
		{
			stage: "running",
			message: "Analyzing layout…",
			progress: 0,
			completed: 0,
			total: knownTotal ?? undefined,
		},
		documentId,
	);

	const task = scope.analyzeAllPages({ force: options.force });

	task.onProgress((p) => {
		options.onProgress?.(p);
		const message = "Analyzing layout…";
		let progress: number | null = knownTotal && knownTotal > 0 ? 0 : null;
		let page: number | undefined;

		switch (p.stage) {
			case "downloading-model": {
				// Host may still be writing the file; plugin loads via agentero-model://.
				// Keep stable message; only surface numeric progress when known.
				const pct = p.total > 0 ? (p.loaded / p.total) * 100 : 0;
				progress = clampProgress(pct);
				break;
			}
			case "creating-session":
				progress = knownTotal && knownTotal > 0 ? 0 : null;
				break;
			case "rendering":
			case "layout-detection":
			case "mapping-coordinates":
			case "table-structure": {
				// Keep a stable "Analyzing layout…" message; page progress is
				// shown via progress bar + page counters in the figures panel.
				page = p.pageIndex + 1;
				if (knownTotal && knownTotal > 0) {
					const phase = pagePhaseWeight(p.stage);
					progress = clampProgress(((p.pageIndex + phase) / knownTotal) * 100);
				} else {
					// No page count yet: soft advance by page index alone.
					progress = clampProgress(Math.min(95, (p.pageIndex + 0.5) * 4));
				}
				break;
			}
			case "page-complete":
				if (p.total > 0) knownTotal = p.total;
				completedPages = p.completed;
				page = p.pageIndex + 1;
				progress =
					p.total > 0 ? clampProgress((p.completed / p.total) * 100) : null;
				break;
			default:
				break;
		}

		setLayoutAnalysisUi(
			{
				stage: "running",
				message,
				progress,
				page,
				completed: completedPages,
				total: knownTotal ?? undefined,
			},
			documentId,
		);
	});

	task.wait(
		(docLayout) => {
			setLayoutAnalysisUi(
				{
					stage: "running",
					message: "Merging figures & captions…",
					progress: 99,
					page: knownTotal ?? completedPages,
					completed: knownTotal ?? completedPages,
					total: knownTotal ?? undefined,
				},
				documentId,
			);
			void buildTextAwareResult(scope, documentId, docLayout)
				.then(async ({ rawRegions, result }) => {
					try {
						await writeLayoutSidecar(options.paperAbsPath, rawRegions);
					} catch (e) {
						const message = e instanceof Error ? e.message : String(e);
						logger.warn("layout sidecar write failed", { error: message });
					}
					setLayoutDocumentResult(result);
					const summary = summarizeLayoutResult(result);
					setLayoutAnalysisUi(
						{
							stage: "done",
							message: summary,
							total: result.regions.length,
						},
						documentId,
					);
					console.info("[layout-analysis]", {
						documentId,
						summary,
						regions: result.regions,
					});
					options.onDone?.(summary, result.regions.length);
				})
				.catch((err) => {
					const message = err instanceof Error ? err.message : String(err);
					setLayoutAnalysisUi({ stage: "error", message }, documentId);
					options.onError?.(message, false);
				});
		},
		(error) => {
			if (error.type === "abort") {
				setLayoutAnalysisUi({ stage: "cancelled" }, documentId);
				options.onError?.("cancelled", true);
				return;
			}
			const reason = error.reason;
			const message =
				reason &&
				typeof reason === "object" &&
				"message" in reason &&
				typeof reason.message === "string"
					? reason.message
					: "Layout analysis failed";
			setLayoutAnalysisUi({ stage: "error", message }, documentId);
			options.onError?.(message, false);
		},
	);

	return task;
}
