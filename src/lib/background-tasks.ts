/**
 * Lightweight background-task store (IDE-style progress / queue).
 * No external state lib — useSyncExternalStore for React subscriptions.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import { logger } from "@/lib/logger";
import { isTauri } from "@/lib/tauri";

export type BackgroundTaskKind =
	| "download"
	| "downloadAll"
	| "lookup"
	| "import"
	| "export"
	| "parse"
	| "paperRead"
	| "connector"
	| "other";

export type BackgroundTaskStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export type BackgroundTask = {
	id: string;
	kind: BackgroundTaskKind;
	/** Short label shown in the panel */
	title: string;
	/** Secondary line (path, phase, …) */
	detail?: string;
	status: BackgroundTaskStatus;
	/** 0–100; null = indeterminate */
	progress: number | null;
	/** 1-based order among active (queued + running) tasks */
	queueIndex: number;
	error?: string;
	createdAt: number;
	updatedAt: number;
};

type Listener = () => void;

type Store = {
	tasks: BackgroundTask[];
	expanded: boolean;
};

type BackgroundTaskProgressEvent = {
	taskId: string;
	phase: string;
	downloadedBytes: number;
	totalBytes?: number;
	progress: number | null;
};

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes;
	let unit = -1;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function phaseLabel(phase: string): string {
	if (phase === "pdf") return i18n.t("app:tasks.downloadPhasePdf");
	if (phase === "tex") return i18n.t("app:tasks.downloadPhaseTex");
	return i18n.t("app:tasks.downloadPhaseAsset");
}

let store: Store = {
	tasks: [],
	expanded: false,
};

const listeners = new Set<Listener>();
const controllers = new Map<string, AbortController>();

export class BackgroundTaskCancelledError extends Error {
	readonly code = "BACKGROUND_TASK_CANCELLED";

	constructor() {
		super("background task cancelled");
		this.name = "BackgroundTaskCancelledError";
	}
}

export function isBackgroundTaskCancelledError(error: unknown): boolean {
	return (
		error instanceof BackgroundTaskCancelledError ||
		(error instanceof Error && error.name === "AbortError")
	);
}

function emit() {
	for (const l of listeners) l();
}

function reindexQueue(tasks: BackgroundTask[]): BackgroundTask[] {
	let i = 1;
	return tasks.map((t) => {
		if (t.status === "queued" || t.status === "running") {
			return { ...t, queueIndex: i++ };
		}
		return { ...t, queueIndex: 0 };
	});
}

function setStore(next: Store) {
	store = {
		...next,
		tasks: reindexQueue(next.tasks),
	};
	emit();
}

export function getBackgroundTasksSnapshot(): Store {
	return store;
}

export function subscribeBackgroundTasks(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function uid(): string {
	return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Keep completed/failed for a short while, then drop them. */
const COMPLETED_TTL_MS = 4000;
const MAX_HISTORY = 12;

function schedulePrune(id: string) {
	window.setTimeout(() => {
		const tasks = store.tasks.filter((t) => t.id !== id);
		if (tasks.length !== store.tasks.length) {
			setStore({ ...store, tasks });
		}
		// Collapse when nothing left
		if (
			tasks.every((t) =>
				["completed", "failed", "cancelled"].includes(t.status),
			) ||
			tasks.length === 0
		) {
			const stillActive = tasks.some(
				(t) => t.status === "queued" || t.status === "running",
			);
			if (!stillActive && tasks.length === 0) {
				setStore({ ...store, tasks: [], expanded: false });
			}
		}
	}, COMPLETED_TTL_MS);
}

export function startBackgroundTask(input: {
	kind: BackgroundTaskKind;
	title: string;
	detail?: string;
	/** Start as running immediately (default true). */
	running?: boolean;
	progress?: number | null;
}): string {
	const now = Date.now();
	const task: BackgroundTask = {
		id: uid(),
		kind: input.kind,
		title: input.title,
		detail: input.detail,
		status: input.running === false ? "queued" : "running",
		progress: input.progress === undefined ? null : input.progress,
		queueIndex: 0,
		createdAt: now,
		updatedAt: now,
	};
	const tasks = [...store.tasks, task].slice(-MAX_HISTORY - 8);
	setStore({ ...store, tasks, expanded: store.expanded });
	return task.id;
}

export function updateBackgroundTask(
	id: string,
	patch: Partial<
		Pick<BackgroundTask, "title" | "detail" | "status" | "progress" | "error">
	>,
): void {
	const tasks = store.tasks.map((t) =>
		t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t,
	);
	setStore({ ...store, tasks });
}

export function completeBackgroundTask(id: string, detail?: string): void {
	updateBackgroundTask(id, {
		status: "completed",
		progress: 100,
		...(detail !== undefined ? { detail } : {}),
	});
	schedulePrune(id);
}

export function failBackgroundTask(id: string, error: string): void {
	updateBackgroundTask(id, {
		status: "failed",
		error,
		detail: error,
	});
	schedulePrune(id);
}

export function cancelBackgroundTask(id: string): void {
	const task = store.tasks.find((item) => item.id === id);
	if (!task || (task.status !== "queued" && task.status !== "running")) return;
	controllers.get(id)?.abort();
	updateBackgroundTask(id, {
		status: "cancelled",
		detail: i18n.t("app:tasks.cancelled"),
	});
	if (isTauri()) {
		void invoke("background_task_cancel", { taskId: id }).catch((error) =>
			logger.warn(
				`background task cancellation signal failed: ${String(error)}`,
			),
		);
	}
	schedulePrune(id);
}

export function registerBackgroundTaskCancellation(id: string): AbortSignal {
	const controller = new AbortController();
	controllers.set(id, controller);
	return controller.signal;
}

export function releaseBackgroundTaskCancellation(id: string): void {
	controllers.delete(id);
}

export function setBackgroundTasksExpanded(expanded: boolean): void {
	setStore({ ...store, expanded });
}

export function clearFinishedBackgroundTasks(): void {
	const tasks = store.tasks.filter(
		(t) => t.status === "queued" || t.status === "running",
	);
	setStore({
		...store,
		tasks,
		expanded: tasks.length > 0 ? store.expanded : false,
	});
}

export function getActiveBackgroundTasks(
	tasks: BackgroundTask[],
): BackgroundTask[] {
	return tasks.filter((t) => t.status === "queued" || t.status === "running");
}

/**
 * Run an async job as a background task with automatic complete/fail.
 */
export async function runBackgroundTask<T>(
	input: {
		kind: BackgroundTaskKind;
		title: string;
		detail?: string;
	},
	fn: (ctx: {
		id: string;
		signal: AbortSignal;
		setProgress: (n: number | null) => void;
		setDetail: (d: string) => void;
	}) => Promise<T>,
): Promise<T> {
	const id = startBackgroundTask({
		kind: input.kind,
		title: input.title,
		detail: input.detail,
		running: true,
		progress: null,
	});
	const controller = new AbortController();
	controllers.set(id, controller);
	const start = performance.now();
	const unlisten = isTauri()
		? await listen<BackgroundTaskProgressEvent>(
				"background-task:progress",
				(event) => {
					if (event.payload.taskId !== id) return;
					const { downloadedBytes, totalBytes } = event.payload;
					updateBackgroundTask(id, {
						progress: event.payload.progress,
						detail:
							totalBytes == null
								? i18n.t("app:tasks.downloadBytesUnknown", {
										phase: phaseLabel(event.payload.phase),
										downloaded: formatBytes(downloadedBytes),
									})
								: i18n.t("app:tasks.downloadBytes", {
										phase: phaseLabel(event.payload.phase),
										downloaded: formatBytes(downloadedBytes),
										total: formatBytes(totalBytes),
									}),
					});
				},
			)
		: null;
	logger.info(
		`op start background_task kind=${input.kind} task_id=${id} title=${input.title}`,
	);
	try {
		const result = await fn({
			id,
			signal: controller.signal,
			setProgress: (n) => updateBackgroundTask(id, { progress: n }),
			setDetail: (d) => updateBackgroundTask(id, { detail: d }),
		});
		if (
			controller.signal.aborted ||
			store.tasks.find((t) => t.id === id)?.status === "cancelled"
		) {
			throw new BackgroundTaskCancelledError();
		}
		completeBackgroundTask(id);
		const ms = Math.round(performance.now() - start);
		logger.info(
			`op end background_task ok=true duration_ms=${ms} kind=${input.kind} task_id=${id}`,
		);
		return result;
	} catch (e) {
		if (controller.signal.aborted || isBackgroundTaskCancelledError(e)) {
			if (store.tasks.find((t) => t.id === id)?.status !== "cancelled") {
				cancelBackgroundTask(id);
			}
			throw new BackgroundTaskCancelledError();
		}
		const msg = e instanceof Error ? e.message : String(e);
		failBackgroundTask(id, msg);
		const ms = Math.round(performance.now() - start);
		logger.error(
			`op end background_task ok=false duration_ms=${ms} kind=${input.kind} task_id=${id} error=${msg}`,
		);
		throw e;
	} finally {
		controllers.delete(id);
		unlisten?.();
	}
}
