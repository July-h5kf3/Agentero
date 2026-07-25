/**
 * Lightweight background-task store (IDE-style progress / queue).
 * zustand vanilla store — usable from plain modules; React subscribes
 * via `useStore` in `use-background-tasks`.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createStore } from "zustand/vanilla";
import i18n from "@/i18n";
import { logger } from "@/lib/core/logger";
import { isTauri } from "@/lib/core/tauri";

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
	/** Optional item counters for batch operations (e.g. import 2/5). */
	currentCount?: number;
	totalCount?: number;
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

/** Vanilla store so plain modules can start/patch tasks without React. */
export const backgroundTasksStore = createStore<Store>(() => ({
	tasks: [],
	expanded: false,
}));

const controllers = new Map<string, AbortController>();

/** Stable cancel message; keep in sync with {@link notifyError} filter. */
export const BACKGROUND_TASK_CANCELLED_MESSAGE = "background task cancelled";

export class BackgroundTaskCancelledError extends Error {
	readonly code = "BACKGROUND_TASK_CANCELLED";

	constructor() {
		super(BACKGROUND_TASK_CANCELLED_MESSAGE);
		this.name = "BackgroundTaskCancelledError";
	}
}

export function isBackgroundTaskCancelledError(error: unknown): boolean {
	return (
		error instanceof BackgroundTaskCancelledError ||
		(error instanceof Error &&
			(error.name === "AbortError" ||
				error.message === BACKGROUND_TASK_CANCELLED_MESSAGE))
	);
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
	backgroundTasksStore.setState(
		{
			...next,
			tasks: reindexQueue(next.tasks),
		},
		true,
	);
}

function store(): Store {
	return backgroundTasksStore.getState();
}

export function getBackgroundTasksSnapshot(): Store {
	return backgroundTasksStore.getState();
}

function uid(): string {
	return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Keep completed/failed for a short while, then drop them. */
const COMPLETED_TTL_MS = 4000;
const MAX_HISTORY = 12;

function schedulePrune(id: string) {
	window.setTimeout(() => {
		const snapshot = getBackgroundTasksSnapshot();
		const tasks = snapshot.tasks.filter((t) => t.id !== id);
		if (tasks.length !== snapshot.tasks.length) {
			const active = tasks.some(
				(t) => t.status === "queued" || t.status === "running",
			);
			setStore({
				...snapshot,
				tasks,
				expanded: active ? snapshot.expanded : false,
			});
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
	const tasks = [...store().tasks, task].slice(-MAX_HISTORY - 8);
	setStore({ ...store(), tasks, expanded: store().expanded });
	return task.id;
}

export function updateBackgroundTask(
	id: string,
	patch: Partial<
		Pick<BackgroundTask, "title" | "detail" | "status" | "progress" | "error">
	>,
): void {
	const tasks = store().tasks.map((t) =>
		t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t,
	);
	setStore({ ...store(), tasks });
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
	const task = store().tasks.find((item) => item.id === id);
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

type BackgroundTaskFn<T> = (ctx: {
	id: string;
	signal: AbortSignal;
	setProgress: (n: number | null) => void;
	setDetail: (d: string) => void;
}) => Promise<T>;

function isTaskCancelled(id: string, signal: AbortSignal): boolean {
	return (
		signal.aborted ||
		getBackgroundTasksSnapshot().tasks.find((t) => t.id === id)?.status ===
			"cancelled"
	);
}

function throwIfTaskCancelled(id: string, signal: AbortSignal): void {
	if (isTaskCancelled(id, signal)) {
		throw new BackgroundTaskCancelledError();
	}
}

async function attachProgressListener(id: string): Promise<UnlistenFn | null> {
	if (!isTauri()) return null;
	return listen<BackgroundTaskProgressEvent>(
		"background-task:progress",
		(event) => {
			if (event.payload.taskId !== id) return;
			const { downloadedBytes, totalBytes, currentCount, totalCount } =
				event.payload;
			if (currentCount != null && totalCount != null) {
				updateBackgroundTask(id, {
					progress: event.payload.progress,
					detail: i18n.t("app:tasks.batchProgress", {
						phase: phaseLabel(event.payload.phase),
						current: currentCount,
						total: totalCount,
					}),
				});
				return;
			}
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
	);
}

class Semaphore {
	private running = 0;
	private queue: Array<() => void> = [];

	constructor(private max: number) {}

	async acquire(): Promise<void> {
		if (this.running < this.max) {
			this.running++;
			return;
		}
		await new Promise<void>((resolve) => this.queue.push(resolve));
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.running = Math.max(0, this.running - 1);
		}
	}
}

const semaphores = new Map<BackgroundTaskKind, Semaphore>();

function getSemaphore(
	kind: BackgroundTaskKind,
	concurrency: number,
): Semaphore {
	let sem = semaphores.get(kind);
	if (!sem) {
		sem = new Semaphore(concurrency);
		semaphores.set(kind, sem);
	}
	return sem;
}

/**
 * Run an async job as a queued background task with a per-kind concurrency limit.
 * The task is created immediately in `queued` status and starts when a slot is free.
 */
export async function runQueuedBackgroundTask<T>(
	input: {
		kind: BackgroundTaskKind;
		title: string;
		detail?: string;
	},
	concurrency: number,
	fn: BackgroundTaskFn<T>,
): Promise<T> {
	const id = startBackgroundTask({
		kind: input.kind,
		title: input.title,
		detail: input.detail,
		running: false,
	});
	const controller = new AbortController();
	controllers.set(id, controller);
	const unlisten = await attachProgressListener(id);
	logger.info(
		`op enqueue background_task kind=${input.kind} task_id=${id} title=${input.title}`,
	);
	let acquired = false;
	try {
		throwIfTaskCancelled(id, controller.signal);
		await getSemaphore(input.kind, concurrency).acquire();
		acquired = true;
		throwIfTaskCancelled(id, controller.signal);
		updateBackgroundTask(id, { status: "running" });
		const result = await fn({
			id,
			signal: controller.signal,
			setProgress: (n) => updateBackgroundTask(id, { progress: n }),
			setDetail: (d) => updateBackgroundTask(id, { detail: d }),
		});
		throwIfTaskCancelled(id, controller.signal);
		completeBackgroundTask(id);
		return result;
	} catch (e) {
		if (
			isTaskCancelled(id, controller.signal) ||
			isBackgroundTaskCancelledError(e)
		) {
			if (
				getBackgroundTasksSnapshot().tasks.find((t) => t.id === id)?.status !==
				"cancelled"
			) {
				cancelBackgroundTask(id);
			}
			throw new BackgroundTaskCancelledError();
		}
		const msg = e instanceof Error ? e.message : String(e);
		failBackgroundTask(id, msg);
		throw e;
	} finally {
		if (acquired) {
			getSemaphore(input.kind, concurrency).release();
		}
		controllers.delete(id);
		unlisten?.();
	}
}

export function setBackgroundTasksExpanded(expanded: boolean): void {
	setStore({ ...store(), expanded });
}

export function clearFinishedBackgroundTasks(): void {
	const tasks = store().tasks.filter(
		(t) => t.status === "queued" || t.status === "running",
	);
	setStore({
		...store(),
		tasks,
		expanded: tasks.length > 0 ? store().expanded : false,
	});
}

export function getActiveBackgroundTasks(
	tasks: BackgroundTask[],
): BackgroundTask[] {
	return tasks.filter((t) => t.status === "queued" || t.status === "running");
}

const FINISHED_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
	"completed",
	"failed",
	"cancelled",
]);

export function isFinishedBackgroundTask(task: BackgroundTask): boolean {
	return FINISHED_STATUSES.has(task.status);
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
	const unlisten = await attachProgressListener(id);
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
		throwIfTaskCancelled(id, controller.signal);
		completeBackgroundTask(id);
		const ms = Math.round(performance.now() - start);
		logger.info(
			`op end background_task ok=true duration_ms=${ms} kind=${input.kind} task_id=${id}`,
		);
		return result;
	} catch (e) {
		if (
			isTaskCancelled(id, controller.signal) ||
			isBackgroundTaskCancelledError(e)
		) {
			if (
				getBackgroundTasksSnapshot().tasks.find((t) => t.id === id)?.status !==
				"cancelled"
			) {
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
