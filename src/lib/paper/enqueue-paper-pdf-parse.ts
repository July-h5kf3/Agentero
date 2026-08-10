/**
 * Enqueue liteparse PDF → PAPER.md as a unified background task.
 *
 * Mirrors the layout-analysis queue pattern: one task per paper, deduped
 * within the session, with its own cancellation lifecycle.
 */

import i18n from "@/i18n";
import { enqueueBackgroundTask } from "@/lib/core/background-tasks";
import { invokeApi } from "@/lib/core/ipc";
import { logger } from "@/lib/core/logger";
import { refreshLibrary } from "@/lib/paper/library-store";
import { refreshTree } from "@/lib/vault/store";

const queuedPapers = new Set<string>();

function normalizePaperKey(vaultPath: string, paperRelPath: string): string {
	return `${vaultPath.replace(/[/\\]+$/, "")}:${paperRelPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}`;
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
				async ({ id, signal }) => {
					if (signal.aborted) return;
					await invokeApi(
						"paper_parse_body",
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
					await refreshTree(vaultPath);
					await refreshLibrary();
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
