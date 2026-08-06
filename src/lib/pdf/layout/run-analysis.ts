import type {
	DocumentAnalysisProgress,
	DocumentLayout,
	LayoutAnalysisScope,
	LayoutTask,
} from "@embedpdf/plugin-layout-analysis";

import { logger } from "@/lib/core/logger";
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
	/** Re-analyze even if pages are cached. */
	force?: boolean;
	onProgress?: (messageStage: DocumentAnalysisProgress) => void;
	onDone?: (summary: string, total: number) => void;
	onError?: (message: string, aborted: boolean) => void;
};

function taskToPromise<T>(task: {
	wait: (ok: (v: T) => void, err: (e: unknown) => void) => void;
}): Promise<T> {
	return new Promise((resolve, reject) => {
		task.wait(resolve, reject);
	});
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
): Promise<PdfLayoutDocumentResult> {
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

	let regions = mergeCaptionsIntoHosts(raw);

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
		} catch {
			// ignore
		}
	}

	return buildLayoutDocumentResult(documentId, regions);
}

/**
 * Shared analyze-all-pages runner for toolbar + PdfViewerHandle + figures panel.
 * Awaits Host XDG model ensure (ModelScope → HuggingFace) before analysis.
 */
export async function runDocumentLayoutAnalysis(
	scope: LayoutAnalysisScope,
	documentId: string,
	options: RunLayoutAnalysisOptions = {},
): Promise<LayoutTask<DocumentLayout, DocumentAnalysisProgress>> {
	setLayoutAnalysisUi(
		{ stage: "running", message: "Preparing layout model…" },
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

	setLayoutAnalysisUi(
		{ stage: "running", message: "Analyzing layout…" },
		documentId,
	);

	const task = scope.analyzeAllPages({ force: options.force });

	task.onProgress((p) => {
		options.onProgress?.(p);
		let message = "Analyzing layout…";
		switch (p.stage) {
			case "downloading-model": {
				// Host may still be writing the file; plugin loads via agentero-model://.
				const pct = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
				message = `Loading layout model… ${pct}%`;
				break;
			}
			case "creating-session":
				message = "Initializing layout model…";
				break;
			case "rendering":
				message = `Rendering page ${p.pageIndex + 1}…`;
				break;
			case "layout-detection":
				message = `Detecting layout on page ${p.pageIndex + 1}…`;
				break;
			case "mapping-coordinates":
				message = `Mapping coordinates on page ${p.pageIndex + 1}…`;
				break;
			case "table-structure":
				message = `Table structure page ${p.pageIndex + 1}…`;
				break;
			case "page-complete":
				message = `Layout page ${p.completed}/${p.total}`;
				break;
			default:
				break;
		}
		setLayoutAnalysisUi({ stage: "running", message }, documentId);
	});

	task.wait(
		(docLayout) => {
			setLayoutAnalysisUi(
				{ stage: "running", message: "Merging figures & captions…" },
				documentId,
			);
			void buildTextAwareResult(scope, documentId, docLayout)
				.then((result) => {
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
