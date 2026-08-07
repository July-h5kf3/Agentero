/**
 * Enqueue post-download / post-import layout analysis as a background task.
 * Opens the paper later still re-runs as a guarantee (cache hit is silent).
 */

import i18n from "@/i18n";
import {
	enqueueBackgroundTask,
	isBackgroundTaskCancelledError,
	setBackgroundTasksExpanded,
} from "@/lib/core/background-tasks";
import { logger } from "@/lib/core/logger";
import { analyzePaperLayoutHeadless } from "@/lib/pdf/layout/headless-analyze";
import { readLayoutSidecar } from "@/lib/pdf/layout/io";
import { layoutAnalysisStore } from "@/lib/pdf/layout/store";

/** Papers already queued or running headless analysis this session. */
const queuedPapers = new Set<string>();

function normalizePaperKey(paperAbsPath: string): string {
	return paperAbsPath.replace(/[/\\]+$/, "").replace(/\\/g, "/");
}

/**
 * After assets land on disk, ensure layout.json is produced.
 * No-op when sidecar already exists or a job is already queued for this paper.
 */
export function enqueuePaperLayoutAnalysis(opts: {
	paperAbsPath: string;
	/** Short label for the tasks panel (vault-rel path / title). */
	paperLabel?: string;
}): void {
	const paperAbsPath = normalizePaperKey(opts.paperAbsPath);
	if (!paperAbsPath || queuedPapers.has(paperAbsPath)) return;

	const label =
		opts.paperLabel?.trim() ||
		paperAbsPath.split("/").filter(Boolean).pop() ||
		paperAbsPath;

	queuedPapers.add(paperAbsPath);

	void (async () => {
		try {
			const cached = await readLayoutSidecar(paperAbsPath);
			if (cached?.regions?.length) {
				queuedPapers.delete(paperAbsPath);
				return;
			}

			setBackgroundTasksExpanded(true);
			await enqueueBackgroundTask(
				{
					kind: "parse",
					title: i18n.t("app:tasks.layoutAnalysis"),
					detail: label,
				},
				async ({ setProgress, setDetail, signal }) => {
					const syncFromLayoutUi = () => {
						const { ui } = layoutAnalysisStore.getState();
						if (ui.stage !== "running") return;
						if (typeof ui.progress === "number") {
							setProgress(ui.progress);
						}
						const page =
							typeof ui.page === "number" && ui.page > 0
								? ui.page
								: typeof ui.completed === "number"
									? ui.completed
									: null;
						const total =
							typeof ui.total === "number" && ui.total > 0 ? ui.total : null;
						const message =
							ui.message?.trim() || i18n.t("viewer:figures.analyzing");
						const pageLine =
							total != null && page != null
								? i18n.t("viewer:figures.progressPages", {
										page,
										total,
									})
								: typeof ui.progress === "number"
									? i18n.t("viewer:figures.progressPct", {
											pct: Math.round(ui.progress),
										})
									: null;
						setDetail(pageLine ? `${message} · ${pageLine}` : message);
					};

					setProgress(0);
					setDetail(i18n.t("viewer:pdf.layout.preparingModel"));
					const unsub = layoutAnalysisStore.subscribe(syncFromLayoutUi);
					syncFromLayoutUi();
					try {
						if (signal.aborted) throw new Error("cancelled");
						const result = await analyzePaperLayoutHeadless({
							paperAbsPath,
							signal,
						});
						setProgress(100);
						setDetail(result.summary);
					} finally {
						unsub();
					}
				},
				// One ONNX layout job at a time.
				{ concurrency: 1 },
			);
		} catch (e) {
			if (isBackgroundTaskCancelledError(e)) return;
			logger.warn("enqueue paper layout analysis failed", {
				paperAbsPath,
				error: e instanceof Error ? e.message : String(e),
			});
		} finally {
			queuedPapers.delete(paperAbsPath);
		}
	})();
}
