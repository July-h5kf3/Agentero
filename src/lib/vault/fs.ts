import { readTextFile } from "@tauri-apps/plugin-fs";
import i18n from "@/i18n";
import { isTauri } from "@/lib/core/tauri";
import {
	parseRemoteJoinedPath,
	remoteMkdir,
	remoteReadText,
	remoteRemove,
	remoteWriteBytes,
	remoteWriteText,
} from "@/lib/vault/remote/remote-vault";

export function isMarkdownPath(path: string): boolean {
	return /\.(md|mdx|markdown)$/i.test(path);
}

export function isTextOpenable(path: string): boolean {
	return (
		isMarkdownPath(path) ||
		/\.(txt|json|bib|tex|html?|css|ts|tsx|js|jsx|rs|toml|yaml|yml)$/i.test(path)
	);
}

export async function readVaultFile(path: string): Promise<string> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.readDesktopOnly"));
	}

	const remoteRead = parseRemoteJoinedPath(path);
	if (remoteRead) {
		if (!remoteRead.rel) throw new Error("invalid remote path");
		return remoteReadText(remoteRead.sessionId, remoteRead.rel);
	}

	return readTextFile(path);
}

/** Write text file (creates parent dirs when possible). */
export async function writeVaultFile(
	path: string,
	content: string,
): Promise<void> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.writeDesktopOnly"));
	}

	const remoteWrite = parseRemoteJoinedPath(path);
	if (remoteWrite) {
		if (!remoteWrite.rel) throw new Error("invalid remote path");
		await remoteWriteText(remoteWrite.sessionId, remoteWrite.rel, content);
		return;
	}

	const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
	const parent = path.replace(/[\\/][^\\/]+$/, "");
	if (parent && parent !== path) {
		try {
			await mkdir(parent, { recursive: true });
		} catch {
			// Parent may already exist
		}
	}
	await writeTextFile(path, content);
}

/** Write binary file (creates parent dirs when possible). Used for Markdown `./assets/` images. */
export async function writeVaultBytes(
	path: string,
	bytes: Uint8Array,
): Promise<void> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.writeDesktopOnly"));
	}

	const remote = parseRemoteJoinedPath(path);
	if (remote) {
		if (!remote.rel) throw new Error("invalid remote path");
		await remoteWriteBytes(remote.sessionId, remote.rel, bytes);
		return;
	}

	const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");
	const parent = path.replace(/[\\/][^\\/]+$/, "");
	if (parent && parent !== path) {
		try {
			await mkdir(parent, { recursive: true });
		} catch {
			// Parent may already exist
		}
	}
	await writeFile(path, bytes);
}

/** Create a directory (and parents) under the vault. */
export async function createVaultDirectory(path: string): Promise<void> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.writeDesktopOnly"));
	}

	const remote = parseRemoteJoinedPath(path);
	if (remote) {
		if (!remote.rel) throw new Error("invalid remote path");
		await remoteMkdir(remote.sessionId, remote.rel);
		return;
	}

	const { mkdir } = await import("@tauri-apps/plugin-fs");
	await mkdir(path, { recursive: true });
}

/**
 * Remove a file or directory under the vault.
 * Directories are removed recursively (including non-empty).
 * Remote vaults use SFTP remove (no recycle bin in MVP).
 */
export async function removeVaultPath(path: string): Promise<void> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.writeDesktopOnly"));
	}
	const trimmed = path.trim();
	if (!trimmed || trimmed.startsWith("agentero:")) {
		throw new Error(i18n.t("sidebar:fileTree.deleteInvalid"));
	}
	const remote = parseRemoteJoinedPath(trimmed);
	if (remote) {
		if (!remote.rel) throw new Error("invalid remote path");
		await remoteRemove(remote.sessionId, remote.rel, true);
		return;
	}
	const { remove } = await import("@tauri-apps/plugin-fs");
	await remove(trimmed, { recursive: true });
}
