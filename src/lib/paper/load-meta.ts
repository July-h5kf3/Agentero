import { invokeApi } from "@/lib/core/ipc";
import { isTauri } from "@/lib/core/tauri";
import { arxivUrls } from "@/lib/paper/arxiv";
import { withNormalizedTags } from "@/lib/paper/tags";
import type { PaperMetadata } from "@/lib/paper/types";
import { toVaultRelative } from "@/lib/wiki";

function enrichArxivUrls(data: PaperMetadata): PaperMetadata {
	if (!data.arxiv_id) return data;
	const urls = arxivUrls(data.arxiv_id);
	if (!urls) return data;
	if (!data.pdf_url) data.pdf_url = urls.pdf;
	if (!data.html_url) data.html_url = urls.html;
	if (!data.source_url) data.source_url = urls.abs;
	return data;
}

/**
 * Vault-relative paper folder path for catalog APIs.
 * `metadata.json` omits `path` (folder identity is the path); callers must re-inject it.
 */
export function paperCatalogPath(
	paperDir: string,
	vaultRoot?: string | null,
): string | undefined {
	if (!vaultRoot) return undefined;
	const path = toVaultRelative(vaultRoot, paperDir)
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!path || path === ".") return undefined;
	return path;
}

/**
 * Load paper metadata from catalog.sqlite via Host `paper_get`.
 *
 * Always sets `path` (vault-relative) when `vaultRoot` is known.
 * Projection file `metadata.json` is write-only for rescan / external tools.
 *
 * @param paperDir absolute paper folder path
 * @param vaultRoot absolute vault root (needed for catalog lookup)
 */
export async function loadPaperMetadata(
	paperDir: string,
	vaultRoot?: string | null,
): Promise<PaperMetadata | null> {
	const path = paperCatalogPath(paperDir, vaultRoot);
	if (!isTauri() || !vaultRoot || !path) return null;

	// Primary: SQLite catalog (local vault path or remote work mirror)
	try {
		const { isRemoteVaultHandle, remotePaperGet, remoteSessionIdFromHandle } =
			await import("@/lib/vault/remote/remote-vault");
		let data: PaperMetadata | null = null;
		if (isRemoteVaultHandle(vaultRoot)) {
			const sessionId = remoteSessionIdFromHandle(vaultRoot);
			if (sessionId) {
				data = (await remotePaperGet(sessionId, { path })) as PaperMetadata;
			}
		} else {
			data =
				(await invokeApi<PaperMetadata>(
					"paper_get",
					{ args: { vaultPath: vaultRoot, path } },
					{ allowVoid: true },
				)) ?? null;
		}
		if (data?.id) {
			return withNormalizedTags(
				enrichArxivUrls({
					...data,
					path: data.path ?? path,
				}),
			);
		}
	} catch {
		// catalog miss or Host error
	}
	return null;
}

/**
 * Async paper-folder check when tree children are unavailable
 * (graph navigation, session restore). Probes marker files on disk.
 */
