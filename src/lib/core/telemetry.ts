/**
 * Renderer-side diagnostics reporting: batches uncaught errors and forwards
 * them to the Host (`telemetry_report_frontend_errors`), which owns the
 * opt-out switch and the upload. No-op outside the Tauri desktop app.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/core/tauri";

type FrontendError = {
	message: string;
	stack?: string;
	context?: string;
};

let buffer: FrontendError[] = [];
let flushScheduled = false;
let installed = false;

/** Install window-level error hooks. Call once during boot. */
export function initErrorReporting(): void {
	if (installed || !isTauri()) return;
	installed = true;
	window.addEventListener("error", (event) => {
		reportFrontendError(
			event.message,
			event.error instanceof Error ? event.error.stack : undefined,
			"window.onerror",
		);
	});
	window.addEventListener("unhandledrejection", (event) => {
		const reason: unknown = event.reason;
		const message = reason instanceof Error ? reason.message : String(reason);
		const stack = reason instanceof Error ? reason.stack : undefined;
		reportFrontendError(message, stack, "unhandledrejection");
	});
}

/** Buffer one error; flushed to the Host after a short debounce. */
export function reportFrontendError(
	message: string,
	stack?: string,
	context?: string,
): void {
	if (!isTauri() || !message) return;
	buffer.push({
		message: message.slice(0, 500),
		stack: stack?.slice(0, 4000),
		context,
	});
	if (buffer.length > 20) buffer = buffer.slice(-20);
	if (!flushScheduled) {
		flushScheduled = true;
		setTimeout(() => void flush(), 2000);
	}
}

async function flush(): Promise<void> {
	flushScheduled = false;
	const errors = buffer;
	buffer = [];
	if (errors.length === 0) return;
	try {
		await invoke("telemetry_report_frontend_errors", { args: { errors } });
	} catch {
		// Diagnostics must never break the app; the Host also enforces opt-out.
	}
}
