/**
 * Enqueue post-download / post-import layout analysis as a JobCenter task.
 * The renderer registers as the executor and runs the ONNX model when Rust
 * emits `job:offer` for a `layoutAnalyze` job.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import {
	BackgroundTaskCancelledError,
	enqueueBackgroundTask,
	isBackgroundTaskCancelledError,
} from "@/lib/core/background-tasks";
import { invokeApi } from "@/lib/core/ipc";
import {
	type JobOfferPayload,
	type JobState,
	jobReport,
	registerJobExecutor,
	startJobCenterExecutorListener,
} from "@/lib/core/job-center";
import { logger } from "@/lib/core/logger";
import { loadPaperMetadata } from "@/lib/paper/load-meta";
import { analyzePaperLayoutHeadless } from "@/lib/pdf/layout/headless-analyze";
import { readLayoutSidecar } from "@/lib/pdf/layout/io";
import { layoutAnalysisStore } from "@/lib/pdf/layout/store";
import { getVaultPath } from "@/lib/vault/store";

const JOB_CHANGED_EVENT = "job:changed";

const queuedPapers = new Set<string>();

function normalizePaperKey(paperAbsPath: string): string {
	return paperAbsPath.replace(/[/\\]+$/, "").replace(/\\/g, "/");
}

export function initJobCenterExecutors(): void {
	registerJobExecutor("layoutAnalyze", runLayoutAnalyzeExecutor);
	void startJobCenterExecutorListener();
}

async function runLayoutAnalyzeExecutor(offer: JobOfferPayload): Promise<void> {
	const paperAbsPath = offer.paperPath
		? `${offer.vaultPath}/${offer.paperPath}`.replace(/\\/g, "/")
		: offer.vaultPath;
	const paperLabel =
		offer.paperPath?.split("/").filter(Boolean).pop() || paperAbsPath;

	const abortController = new AbortController();
	let cancelledUnlisten: UnlistenFn | null = null;

	try {
		cancelledUnlisten = await listen<{ job: { id: string; state: JobState } }>(
			JOB_CHANGED_EVENT,
			(event) => {
				if (event.payload.job.id !== offer.jobId) return;
				if (event.payload.job.state === "cancelled") {
					abortController.abort();
				}
			},
		);

		const unsub = layoutAnalysisStore.subscribe((state) => {
			const { ui } = state;
			if (ui.stage !== "running" || typeof ui.progress !== "number") return;
			void jobReport({
				jobId: offer.jobId,
				progress: ui.progress,
				phase: ui.message?.trim() || i18n.t("viewer:figures.analyzing"),
			});
		});

		try {
			if (abortController.signal.aborted) throw new Error("cancelled");
			await analyzePaperLayoutHeadless({
				paperAbsPath,
				paperLabel,
				signal: abortController.signal,
			});
			await jobReport({
				jobId: offer.jobId,
				progress: 100,
				phase: "completed",
				state: "succeeded",
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			const state = message.toLowerCase().includes("cancel")
				? "cancelled"
				: "failed";
			await jobReport({
				jobId: offer.jobId,
				state,
				error: state === "failed" ? message : undefined,
			});
		} finally {
			unsub();
		}
	} finally {
		cancelledUnlisten?.();
	}
}

type JobSnapshot = {
	id: string;
	state: JobState;
	progress?: number | null;
	phase?: string | null;
	error?: string | null;
};

type JobChangedPayload = {
	job: JobSnapshot;
};

function isFinishedJobState(state: JobState): boolean {
	return (
		state === "succeeded" ||
		state === "failed" ||
		state === "cancelled" ||
		state === "skipped"
	);
}

function settleJobSnapshot(snapshot: JobSnapshot): void {
	if (snapshot.state === "succeeded" || snapshot.state === "skipped") return;
	if (snapshot.state === "cancelled") throw new BackgroundTaskCancelledError();
	if (snapshot.state === "failed") {
		throw new Error(snapshot.error?.trim() || "layout analysis failed");
	}
}

async function waitForLayoutJob(
	job: JobSnapshot,
	signal: AbortSignal,
	setProgress: (n: number | null) => void,
): Promise<void> {
	let unlisten: UnlistenFn | null = null;
	let abortHandler: (() => void) | null = null;
	await new Promise<void>((resolve, reject) => {
		const settle = (snapshot: JobSnapshot) => {
			if (snapshot.id !== job.id) return;
			if (snapshot.progress !== undefined) setProgress(snapshot.progress);
			if (!isFinishedJobState(snapshot.state)) return;
			try {
				settleJobSnapshot(snapshot);
				resolve();
			} catch (error) {
				reject(error);
			}
		};
		const onAbort = () => {
			void invokeApi<boolean>(
				"job_cancel",
				{ jobId: job.id },
				{ fallback: "layout analysis cancellation failed" },
			).catch((error) =>
				logger.warn("layout analysis job cancellation failed", {
					jobId: job.id,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
			reject(new BackgroundTaskCancelledError());
		};
		abortHandler = onAbort;
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		void (async () => {
			try {
				unlisten = await listen<JobChangedPayload>(
					JOB_CHANGED_EVENT,
					(event) => {
						settle(event.payload.job);
					},
				);
				settle(job);
			} catch (error) {
				reject(error);
			}
		})();
	}).finally(() => {
		if (abortHandler) signal.removeEventListener("abort", abortHandler);
		unlisten?.();
	});
}

/**
 * After assets land on disk, ensure layout.json is produced.
 * No-op when sidecar already exists or a job is already queued for this paper.
 */
export function enqueuePaperLayoutAnalysis(opts: {
	paperAbsPath: string;
	/** Short label for the tasks panel. Falls back to the paper title from the catalog, then the folder name. */
	paperLabel?: string;
}): void {
	const paperAbsPath = normalizePaperKey(opts.paperAbsPath);
	if (!paperAbsPath || queuedPapers.has(paperAbsPath)) return;

	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	const paperRelPath = paperAbsPath
		.slice(vaultPath.length)
		.replace(/^[/\\]+/, "");
	if (!paperRelPath) return;

	queuedPapers.add(paperAbsPath);

	void (async () => {
		try {
			const cached = await readLayoutSidecar(paperAbsPath);
			if (cached?.regions?.length) {
				queuedPapers.delete(paperAbsPath);
				return;
			}

			let label = opts.paperLabel?.trim();
			if (!label) {
				const meta = await loadPaperMetadata(paperAbsPath, vaultPath);
				label =
					meta?.title?.trim() ||
					paperAbsPath.split("/").filter(Boolean).pop() ||
					paperAbsPath;
			}

			await enqueueBackgroundTask(
				{
					kind: "parse",
					title: i18n.t("app:tasks.layoutAnalysis"),
					detail: label,
				},
				async ({ signal, setProgress }) => {
					if (signal.aborted) return;
					const job = await invokeApi<JobSnapshot>(
						"job_layout_analyze_enqueue",
						{
							args: {
								vaultPath,
								path: paperRelPath,
								lane: "normal",
								force: false,
							},
						},
						{ fallback: "layout analysis enqueue failed" },
					);
					await waitForLayoutJob(job, signal, setProgress);
				},
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
