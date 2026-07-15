/**
 * Lightweight background-task store (IDE-style progress / queue).
 * No external state lib — useSyncExternalStore for React subscriptions.
 */

export type BackgroundTaskKind =
	| "download"
	| "downloadAll"
	| "lookup"
	| "import"
	| "export"
	| "parse"
	| "other";

export type BackgroundTaskStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed";

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

let store: Store = {
	tasks: [],
	expanded: false,
};

const listeners = new Set<Listener>();

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
			tasks.every((t) => t.status === "completed" || t.status === "failed") ||
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
	try {
		const result = await fn({
			id,
			setProgress: (n) => updateBackgroundTask(id, { progress: n }),
			setDetail: (d) => updateBackgroundTask(id, { detail: d }),
		});
		completeBackgroundTask(id);
		return result;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		failBackgroundTask(id, msg);
		throw e;
	}
}
