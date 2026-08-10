/**
 * Enqueue liteparse PDF → PAPER.md as a unified background task.
 *
 * Mirrors the layout-analysis queue pattern: one task per paper, deduped
 * within the session, with its own cancellation lifecycle.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import {
	BackgroundTaskCancelledError,
	enqueueBackgroundTask,
} from "@/lib/core/background-tasks";
import { invokeApi } from "@/lib/core/ipc";
import { logger } from "@/lib/core/logger";

const queuedPapers = new Set<string>();
const JOB_CHANGED_EVENT = "job:changed";

type JobState =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "skipped";

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

function normalizePaperKey(vaultPath: string, paperRelPath: string): string {
	return `${vaultPath.replace(/[/\\]+$/, "")}:${paperRelPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}`;
}

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
		throw new Error(snapshot.error?.trim() || "PDF body parse failed");
	}
}

async function loadJobSnapshot(
	jobId: string,
	vaultPath: string,
	paperRelPath: string,
): Promise<JobSnapshot | null> {
	const jobs = await invokeApi<JobSnapshot[]>(
		"job_list",
		{
			args: {
				vaultPath,
				path: paperRelPath,
			},
		},
		{ fallback: "PDF body parse status check failed" },
	);
	return jobs.find((job) => job.id === jobId) ?? null;
}

async function waitForParseBodyJob(
	job: JobSnapshot,
	vaultPath: string,
	paperRelPath: string,
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
				{ fallback: "PDF body parse cancellation failed" },
			).catch((error) =>
				logger.warn("PDF body parse job cancellation failed", {
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
				const latest = await loadJobSnapshot(job.id, vaultPath, paperRelPath);
				if (latest) settle(latest);
			} catch (error) {
				reject(error);
			}
		})();
	}).finally(() => {
		if (abortHandler) signal.removeEventListener("abort", abortHandler);
		unlisten?.();
	});
}

export type EnqueuePaperPdfParseOptions = {
	vaultPath: string;
	paperRelPath: string;
	paperLabel?: string;
};

/**
 * Ensure PAPER.md is generated for a paper folder. No-op when a task for this
 * paper is already queued/running this session.
 */
export function enqueuePaperPdfParse(opts: EnqueuePaperPdfParseOptions): void {
	const vaultPath = opts.vaultPath.trim();
	const paperRelPath = opts.paperRelPath.trim().replace(/\\/g, "/");
	if (!vaultPath || !paperRelPath) return;

	const key = normalizePaperKey(vaultPath, paperRelPath);
	if (queuedPapers.has(key)) return;
	queuedPapers.add(key);

	const label =
		opts.paperLabel?.trim() ||
		paperRelPath.split("/").filter(Boolean).pop() ||
		paperRelPath;

	void (async () => {
		try {
			await enqueueBackgroundTask(
				{
					kind: "pdfParse",
					title: i18n.t("app:tasks.pdfParse"),
					detail: label,
				},
				async ({ id, signal, setProgress }) => {
					if (signal.aborted) return;
					const job = await invokeApi<JobSnapshot>(
						"job_parse_body_enqueue",
						{
							args: {
								vaultPath,
								path: paperRelPath,
								force: false,
								taskId: id,
							},
						},
						{ fallback: "PDF body parse failed" },
					);
					await waitForParseBodyJob(
						job,
						vaultPath,
						paperRelPath,
						signal,
						setProgress,
					);
				},
				{ concurrency: 2 },
			);
		} catch (e) {
			logger.warn("enqueue paper pdf parse failed", {
				vaultPath,
				paperRelPath,
				error: e instanceof Error ? e.message : String(e),
			});
		} finally {
			queuedPapers.delete(key);
		}
	})();
}
