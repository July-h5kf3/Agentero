/**
 * Renderer-side executor registry for Rust JobCenter jobs.
 *
 * Rust emits `job:offer` when a renderer-executed job (e.g. layout analysis)
 * starts. This module routes offers to the matching frontend executor and
 * provides helpers to report progress / completion back via `job_report`.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeApi } from "@/lib/core/ipc";
import { logger } from "@/lib/core/logger";

export type JobState =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "skipped";

export type JobOfferPayload = {
	jobId: string;
	kind: JobKind;
	vaultPath: string;
	paperPath?: string | null;
	force: boolean;
};

export type JobKind =
	| "parseRefs"
	| "parseBody"
	| "layoutAnalyze"
	| "layoutTranslate"
	| "downloadAssets"
	| "pageCount"
	| "wikiReindex";

export type JobExecutor = (offer: JobOfferPayload) => Promise<void>;

const executors = new Map<JobKind, JobExecutor>();
let unlisten: UnlistenFn | null = null;

export function registerJobExecutor(
	kind: JobKind,
	executor: JobExecutor,
): void {
	executors.set(kind, executor);
}

export async function startJobCenterExecutorListener(): Promise<void> {
	if (unlisten) return;
	unlisten = await listen<{ job: JobOfferPayload }>("job:offer", (event) => {
		const offer = event.payload.job;
		const executor = executors.get(offer.kind);
		if (!executor) {
			logger.warn("no executor registered for job offer", {
				kind: offer.kind,
				jobId: offer.jobId,
			});
			return;
		}
		void executor(offer).catch((error) => {
			logger.error("job executor failed", {
				kind: offer.kind,
				jobId: offer.jobId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	});
}

export function stopJobCenterExecutorListener(): void {
	unlisten?.();
	unlisten = null;
}

export async function jobReport(args: {
	jobId: string;
	progress?: number | null;
	phase?: string | null;
	error?: string | null;
	state?: JobState | null;
}): Promise<void> {
	await invokeApi(
		"job_report",
		{
			args: {
				jobId: args.jobId,
				progress: args.progress ?? undefined,
				phase: args.phase ?? undefined,
				error: args.error ?? undefined,
				state: args.state ?? undefined,
			},
		},
		{ allowVoid: true },
	);
}
