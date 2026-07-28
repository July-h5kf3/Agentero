import { open } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { invokeApi } from "@/lib/core/ipc";
import { isTauri } from "@/lib/core/tauri";
import {
	remoteEnsureVault,
	remoteSessionIdFromHandle,
} from "@/lib/vault/remote/remote-vault";
import type { CreateVaultResult } from "@/lib/vault/types";

export async function pickVaultDirectory(): Promise<string | null> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.openDesktopOnly"));
	}

	const selected = await open({
		directory: true,
		multiple: false,
		title: i18n.t("app:vault.dialogTitle"),
	});

	if (selected === null) return null;
	const path = Array.isArray(selected) ? selected[0] : selected;
	return path ?? null;
}

/** Pick a directory that will be scaffolded as a new Agentero vault. */
export async function pickCreateVaultDirectory(): Promise<string | null> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.createDesktopOnly"));
	}

	const selected = await open({
		directory: true,
		multiple: false,
		title: i18n.t("app:vault.createDialogTitle"),
	});

	if (selected === null) return null;
	const path = Array.isArray(selected) ? selected[0] : selected;
	return path ?? null;
}

/**
 * Scaffold a Agentero vault at `path` (Host: vault_create).
 * Creates papers/notes/plans/.agentero, AGENTS.md, catalog.sqlite.
 * Does not create PAPERS.md / library.bib. Does not overwrite existing files.
 */
export async function createVault(
	path: string,
	locale?: string,
): Promise<CreateVaultResult> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.createDesktopOnly"));
	}

	const { logOp } = await import("@/lib/core/logger");
	return logOp("createVault", { path, locale }, async () => {
		return invokeApi<CreateVaultResult>(
			"vault_create",
			{ path, locale },
			{
				fallback: i18n.t("app:vault.createFailed"),
			},
		);
	});
}

/**
 * Idempotent ensure for an open vault (Host: vault_ensure).
 * Seeds any **missing** bundled skills under `.agents/skills/` after app updates;
 * never overwrites user-edited skill files. Safe to call on every open.
 */
export async function ensureVault(
	path: string,
	locale?: string,
): Promise<CreateVaultResult> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.createDesktopOnly"));
	}

	const { logOp } = await import("@/lib/core/logger");
	return logOp("ensureVault", { path, locale }, async () => {
		const remoteSessionId = remoteSessionIdFromHandle(path);
		if (remoteSessionId) {
			return remoteEnsureVault(remoteSessionId, locale);
		}
		return invokeApi<CreateVaultResult>(
			"vault_ensure",
			{ path, locale },
			{
				fallback: i18n.t("app:vault.createFailed"),
			},
		);
	});
}

/**
 * Skill package ids newly written under `.agents/skills/<id>/…`
 * (from `CreateVaultResult.created`). Ignores top-level README/LICENSE.
 */
export function seededSkillIdsFromCreated(created: string[]): string[] {
	const ids = new Set<string>();
	for (const raw of created) {
		const rel = raw.replace(/\\/g, "/");
		const m = /^\.agents\/skills\/([^/]+)\//.exec(rel);
		if (m?.[1]) ids.add(m[1]);
	}
	return [...ids].sort((a, b) => a.localeCompare(b));
}
