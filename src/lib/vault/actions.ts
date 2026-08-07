/**
 * Vault actions: vault switching, tree CRUD (create/trash/move/rename),
 * Finder/terminal reveal, and recycle-bin maintenance. Cross-domain effects
 * (open tabs, wiki links, library rows) flow through the domain stores.
 */

import i18n from "@/i18n";
import { clearSelections } from "@/lib/agent/selection-store";
import { clearVisualDrafts } from "@/lib/agent/visual-context-store";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/core/notify";
import { isTauri } from "@/lib/core/tauri";
import {
	isLibraryVirtualPath,
	isTrashVirtualPath,
	listTrash,
	movePaperFolder,
	purgeAllTrash,
	trashPaths,
} from "@/lib/paper/api";
import {
	bumpTrashReloadSignal,
	refreshLibrary,
	setLibraryQuery,
	setLibraryScopePath,
} from "@/lib/paper/library-store";
import { setZoteroOpen } from "@/lib/shell/ui-store";
import {
	createVault,
	createVaultDirectory,
	ensureLocalFsScope,
	ensureVault,
	isValidVaultEntryName,
	joinVaultPath,
	openNewWindow,
	pickCreateVaultDirectory,
	pickVaultDirectory,
	removeRecentVault,
	removeTreeNode,
	saveVaultPath,
	seededSkillIdsFromCreated,
	vaultPathExists,
	vaultRelativePath,
	writeVaultFile,
} from "@/lib/vault";
import {
	clearRemoteSessionMeta,
	isRemoteVaultHandle,
	rememberRecentRemoteVault,
	remoteConnect,
	remoteDisconnect,
	remoteSessionIdFromHandle,
	saveRemoteSessionMeta,
} from "@/lib/vault/remote/remote-vault";
import { openInTerminal, revealInFileManager } from "@/lib/vault/reveal";
import type { TreeCreateKind } from "@/lib/vault/store";
import {
	bumpTreeGeneration,
	getVaultPath,
	refreshRecentVaults,
	refreshTree,
	setCreateDraft,
	setTree,
	setTreeLoading,
	setTreeSelectedPath,
	setVaultBusy,
	setVaultPath,
	vaultStore,
} from "@/lib/vault/store";
import { moveVaultPath, normalizeVaultRel } from "@/lib/wiki";
import { syncMovedPaths } from "@/lib/wiki/actions";
import {
	rebuildWikiAndNotify,
	setRenameBusy,
	setRenameDraft,
	setRenameError,
	trackInternalRenamePaths,
	wikiStore,
} from "@/lib/wiki/store";
import {
	closeTabsUnderPath,
	dirtyVaultPaths,
	openPath,
} from "@/lib/workspace/actions";
import { setActiveTabId, setTabs } from "@/lib/workspace/store";
import { basenameOf } from "@/lib/workspace/tabs";

export async function activateVault(path: string): Promise<void> {
	bumpTreeGeneration();
	setTree([]);
	setTreeLoading(true);
	// Tear down previous remote session so work catalogs are flushed.
	const prev = getVaultPath();
	if (prev && isRemoteVaultHandle(prev) && prev !== path) {
		const prevId = remoteSessionIdFromHandle(prev);
		if (prevId) {
			try {
				await remoteDisconnect(prevId);
			} catch {
				// best-effort
			}
		}
		clearRemoteSessionMeta();
	}
	saveVaultPath(path);
	setVaultPath(path);
	setTabs([]);
	setActiveTabId(null);
	setTreeSelectedPath(null);
	setLibraryQuery("");
	setLibraryScopePath(null);
	// Ephemeral composer context is vault-scoped in practice; clear so drafts
	// never write marks into the previous vault after a switch.
	clearVisualDrafts();
	clearSelections();
	refreshRecentVaults();
	// Wiki rebuild needs local fs watcher semantics; remote is best-effort.
	if (!isRemoteVaultHandle(path)) {
		await rebuildWikiAndNotify(path);
	}
}

export async function openVault(): Promise<void> {
	try {
		if (!isTauri()) {
			notifyError(i18n.t("app:errors.openVaultDesktopOnly"));
			return;
		}
		setVaultBusy(true);
		const path = await pickVaultDirectory();
		if (!path) return;
		await activateVault(path);
	} catch (e) {
		notifyError(e instanceof Error ? e.message : String(e));
	} finally {
		setVaultBusy(false);
	}
}

export async function openRemoteVault(args: {
	host: string;
	user?: string;
	remotePath: string;
}): Promise<void> {
	try {
		if (!isTauri()) {
			notifyError(i18n.t("app:errors.openVaultDesktopOnly"));
			return;
		}
		setVaultBusy(true);
		const info = await remoteConnect(args);
		saveRemoteSessionMeta(info);
		rememberRecentRemoteVault({
			kind: "remote",
			host: args.host,
			user: args.user,
			remotePath: args.remotePath,
			label: info.displayName,
		});
		// Pseudo-handle routes tree / IO through Host remote_* commands.
		await activateVault(info.vaultHandle);
	} catch (e) {
		notifyError(
			e instanceof Error ? e.message : i18n.t("app:vault.remoteConnectFailed"),
		);
	} finally {
		setVaultBusy(false);
	}
}

export async function openRecentVault(path: string): Promise<void> {
	try {
		if (!isTauri()) {
			notifyError(i18n.t("app:errors.openVaultDesktopOnly"));
			return;
		}
		setVaultBusy(true);
		await ensureLocalFsScope(path);
		const { exists } = await import("@tauri-apps/plugin-fs");
		if (!(await exists(path))) {
			removeRecentVault(path);
			refreshRecentVaults();
			notifyError(i18n.t("app:vault.recentMissing", { path }));
			return;
		}
		await activateVault(path);
	} catch (e) {
		notifyError(e instanceof Error ? e.message : String(e));
	} finally {
		setVaultBusy(false);
	}
}

export function removeRecent(path: string): void {
	removeRecentVault(path);
	refreshRecentVaults();
}

export async function newWindow(): Promise<void> {
	try {
		if (!isTauri()) {
			notifyError(i18n.t("app:errors.openVaultDesktopOnly"));
			return;
		}
		await openNewWindow();
	} catch (e) {
		notifyError(e instanceof Error ? e.message : String(e));
	}
}

/** Full refresh: tree, wiki index, library rows. */
export function refreshAll(): void {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	void (async () => {
		await refreshTree(vaultPath);
		await rebuildWikiAndNotify(vaultPath);
		await refreshLibrary();
	})();
}

/**
 * After app updates, seed new bundled skills and safely upgrade managed
 * first-party skills (frontmatter `version` only). User-owned files
 * (no/higher/same version) stay put.
 */
export function seedVaultSkills(path: string): void {
	if (!isTauri() || !path) return;
	void ensureVault(path, i18n.language)
		.then((result) => {
			const installed = seededSkillIdsFromCreated(result.created);
			const updated = seededSkillIdsFromCreated(result.updated);
			if (installed.length === 0 && updated.length === 0) return;
			// Path may have changed while ensure was in flight.
			if (getVaultPath() !== path) return;
			if (installed.length > 0) {
				notifySuccess(
					i18n.t("app:vault.skillsSeeded", {
						count: installed.length,
						names: installed.join(", "),
					}),
					{ id: "vault-skills-seeded" },
				);
			}
			if (updated.length > 0) {
				notifySuccess(
					i18n.t("app:vault.skillsUpdated", {
						count: updated.length,
						names: updated.join(", "),
					}),
					{ id: "vault-skills-updated" },
				);
			}
		})
		.catch(() => {
			// Best-effort: opening the vault must not fail if seed is blocked.
		});
}

/** ⌥⌘R — reveal selected vault path in Finder / Explorer. */
export function revealSelectedInFinder(): void {
	const { treeSelectedPath, vaultPath } = vaultStore.getState();
	const path = treeSelectedPath;
	if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) return;
	if (isRemoteVaultHandle(vaultPath) || isRemoteVaultHandle(path)) {
		notifyWarning(i18n.t("app:vault.remoteNoFinder"));
		return;
	}
	if (!isTauri()) {
		notifyError(i18n.t("sidebar:fileTree.revealDesktopOnly"));
		return;
	}
	void (async () => {
		try {
			await revealInFileManager(path);
		} catch {
			notifyError(i18n.t("sidebar:fileTree.revealFailed"));
		}
	})();
}

/** ⌥⌘T — open system terminal at selected path (dir = self, file = parent). */
export function openSelectedInTerminal(): void {
	const { treeSelectedPath, vaultPath } = vaultStore.getState();
	const path = treeSelectedPath;
	if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) return;
	if (isRemoteVaultHandle(vaultPath) || isRemoteVaultHandle(path)) {
		notifyWarning(i18n.t("app:vault.remoteNoTerminal"));
		return;
	}
	if (!isTauri()) {
		notifyError(i18n.t("sidebar:fileTree.openInTerminalDesktopOnly"));
		return;
	}
	void (async () => {
		try {
			await openInTerminal(path);
		} catch {
			notifyError(i18n.t("sidebar:fileTree.openInTerminalFailed"));
		}
	})();
}

/** Delete vault paths into the recycle bin (`.agentero/.trash/`). */
export async function trashPathsAndNotify(absPaths: string[]): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath || !isTauri()) {
		notifyError(i18n.t("sidebar:fileTree.deleteDesktopOnly"));
		return;
	}
	const rootNorm = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "");
	const valid = absPaths
		.map((p) => p.replace(/\\/g, "/").replace(/\/+$/, ""))
		.filter(
			(p) =>
				p &&
				!isLibraryVirtualPath(p) &&
				!isTrashVirtualPath(p) &&
				p !== rootNorm &&
				p.startsWith(`${rootNorm}/`),
		);
	if (valid.length === 0) return;
	setVaultBusy(true);
	trackInternalRenamePaths(valid, Number.POSITIVE_INFINITY);
	try {
		const rels = valid
			.map((p) => vaultRelativePath(vaultPath, p))
			.filter((r): r is string => Boolean(r));
		await trashPaths(vaultPath, rels);
		for (const p of valid) closeTabsUnderPath(p);
		// Optimistic prune so a concurrent remote list of the deleted path
		// cannot leave a ghost folder while refresh rebuilds.
		let pruned = vaultStore.getState().tree;
		for (const p of valid) {
			pruned = removeTreeNode(pruned, p);
		}
		setTree(pruned);
		const treeNorm = vaultStore
			.getState()
			.treeSelectedPath?.replace(/\\/g, "/")
			.replace(/\/+$/, "");
		if (
			treeNorm &&
			valid.some((p) => treeNorm === p || treeNorm.startsWith(`${p}/`))
		) {
			setTreeSelectedPath(null);
		}
		await refreshTree(vaultPath);
		if (!isRemoteVaultHandle(vaultPath)) {
			await rebuildWikiAndNotify(vaultPath);
		}
		await refreshLibrary();
	} catch (e) {
		notifyError(
			e instanceof Error ? e.message : i18n.t("sidebar:fileTree.deleteFailed"),
		);
	} finally {
		trackInternalRenamePaths(valid, Date.now() + 2000);
		setVaultBusy(false);
	}
}

export function deleteSelectedPath(): void {
	const path = vaultStore.getState().treeSelectedPath;
	if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) {
		notifyError(i18n.t("sidebar:fileTree.deleteNeedsSelection"));
		return;
	}
	void trashPathsAndNotify([path]);
}

/** Refresh tree / library / wiki after a recycle-bin restore. */
export async function handleTrashChanged(): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	setTreeSelectedPath(null);
	await refreshTree(vaultPath);
	await rebuildWikiAndNotify(vaultPath);
	await refreshLibrary();
}

/** Empty recycle bin from the trash node context menu (confirm + purge). */
export async function emptyTrash(): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath || !isTauri()) return;
	try {
		const items = await listTrash(vaultPath);
		if (items.length === 0) return;
		if (
			!window.confirm(
				i18n.t("sidebar:recycleBin.emptyConfirm", { count: items.length }),
			)
		) {
			return;
		}
		await purgeAllTrash(vaultPath);
		bumpTrashReloadSignal();
	} catch (e) {
		notifyError(
			e instanceof Error ? e.message : i18n.t("sidebar:recycleBin.purgeFailed"),
		);
	}
}

/** Core move loop reused by the dialog and by drag-and-drop. */
export async function movePathsTo(
	rawPaths: string[],
	destParentRel: string,
): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath) return;
	const paths = rawPaths.filter(
		(p) => !isLibraryVirtualPath(p) && !isTrashVirtualPath(p),
	);
	if (paths.length === 0) return;
	setVaultBusy(true);
	let failed = 0;
	try {
		for (const path of paths) {
			const rel = vaultRelativePath(vaultPath, path);
			if (!rel) {
				failed++;
				continue;
			}
			const destinationParent = normalizeVaultRel(destParentRel) || "papers";
			const expectedToRel = `${destinationParent}/${basenameOf(rel)}`;
			const pendingEventPaths = [path, joinVaultPath(vaultPath, expectedToRel)];
			trackInternalRenamePaths(pendingEventPaths, Number.POSITIVE_INFINITY);
			try {
				const result = await movePaperFolder(
					vaultPath,
					rel,
					destParentRel,
					dirtyVaultPaths(vaultPath),
				);
				const toAbs = joinVaultPath(vaultPath, result.newRel);
				syncMovedPaths(
					vaultPath,
					path,
					toAbs,
					rel,
					result.newRel,
					result.linkUpdate,
				);
			} catch {
				trackInternalRenamePaths(pendingEventPaths, Date.now() + 2000);
				failed++;
			}
		}
		await refreshTree(vaultPath);
		await refreshLibrary();
		if (failed > 0) {
			notifyWarning(
				i18n.t("sidebar:fileTree.movedWithErrors", { count: failed }),
			);
		}
	} catch (e) {
		notifyError(
			e instanceof Error ? e.message : i18n.t("sidebar:fileTree.moveFailed"),
		);
	} finally {
		setVaultBusy(false);
	}
}

/** Open the in-app rename dialog for a path. */
export function startRenamePath(path: string): void {
	const vaultPath = getVaultPath();
	if (!vaultPath || isRemoteVaultHandle(vaultPath)) {
		notifyWarning(i18n.t("app:vault.remoteNoAutoLinkRepair"));
		return;
	}
	const fromRel = vaultRelativePath(vaultPath, path);
	if (!fromRel) return;
	const currentName = basenameOf(path);
	setRenameError(null);
	setRenameDraft({ path, currentName, value: currentName });
}

export async function confirmRenamePath(): Promise<void> {
	const { renameDraft, renameBusy } = wikiStore.getState();
	const vaultPath = getVaultPath();
	if (!renameDraft || !vaultPath || renameBusy) return;
	const nextName = renameDraft.value.trim();
	if (!isValidVaultEntryName(nextName)) {
		setRenameError(i18n.t("sidebar:fileTree.invalidName"));
		return;
	}
	if (nextName === renameDraft.currentName) {
		setRenameDraft(null);
		setRenameError(null);
		return;
	}
	const fromRel = vaultRelativePath(vaultPath, renameDraft.path);
	if (!fromRel) {
		setRenameError(i18n.t("sidebar:fileTree.renameFailed"));
		return;
	}
	const parent = fromRel.includes("/")
		? fromRel.slice(0, fromRel.lastIndexOf("/"))
		: "";
	const toRel = parent ? `${parent}/${nextName}` : nextName;
	const toAbs = joinVaultPath(vaultPath, toRel);
	const pendingEventPaths = [renameDraft.path, toAbs];
	trackInternalRenamePaths(pendingEventPaths, Number.POSITIVE_INFINITY);
	try {
		setRenameBusy(true);
		setRenameError(null);
		const result = await moveVaultPath(
			vaultPath,
			fromRel,
			toRel,
			dirtyVaultPaths(vaultPath),
		);
		syncMovedPaths(vaultPath, renameDraft.path, toAbs, fromRel, toRel, result);
		await refreshTree(vaultPath);
		await refreshLibrary();
		setRenameDraft(null);
		notifySuccess(
			i18n.t("sidebar:fileTree.renamedLinks", {
				count: result.updatedSources.length,
			}),
		);
	} catch (error) {
		trackInternalRenamePaths(pendingEventPaths, Date.now() + 2000);
		setRenameError(
			error instanceof Error
				? error.message
				: i18n.t("sidebar:fileTree.renameFailed"),
		);
	} finally {
		setRenameBusy(false);
	}
}

export function startCreate(kind: TreeCreateKind, parentPath: string): void {
	if (!getVaultPath() || !isTauri()) {
		notifyError(i18n.t("sidebar:fileTree.needsVault"));
		return;
	}
	setCreateDraft({ kind, parentPath });
}

export function cancelCreate(): void {
	setCreateDraft(null);
}

export async function confirmCreate(name: string): Promise<void> {
	const { createDraft } = vaultStore.getState();
	const vaultPath = getVaultPath();
	if (!createDraft || !vaultPath || !isTauri()) {
		setCreateDraft(null);
		return;
	}
	const trimmed = name.trim();
	if (!isValidVaultEntryName(trimmed)) {
		notifyError(i18n.t("sidebar:fileTree.invalidName"));
		setCreateDraft(null);
		return;
	}
	const full = joinVaultPath(createDraft.parentPath, trimmed);
	const kind = createDraft.kind;
	// Clear draft first so the tree can re-render after create.
	setCreateDraft(null);
	try {
		setVaultBusy(true);
		// Use vault-aware exists: local FS plugin cannot see `remote:<id>/…`.
		if (await vaultPathExists(full)) {
			notifyError(i18n.t("sidebar:fileTree.alreadyExists", { name: trimmed }));
			return;
		}
		if (kind === "file") {
			await writeVaultFile(full, "");
			await refreshTree(vaultPath);
			openPath(full);
		} else {
			await createVaultDirectory(full);
			await refreshTree(vaultPath);
			setTreeSelectedPath(full);
		}
	} catch (e) {
		notifyError(e instanceof Error ? e.message : String(e));
	} finally {
		setVaultBusy(false);
	}
}

export async function createNewVault(): Promise<void> {
	try {
		if (!isTauri()) {
			notifyError(i18n.t("app:errors.openVaultDesktopOnly"));
			return;
		}
		setVaultBusy(true);
		const path = await pickCreateVaultDirectory();
		if (!path) return;
		const result = await createVault(path, i18n.language);
		const root = result.path || path;
		await activateVault(root);
		const sep = root.includes("\\") ? "\\" : "/";
		const openRel = result.openPath || "AGENTS.md";
		const openAbs = `${root.replace(/[\\/]+$/, "")}${sep}${openRel.replace(/\//g, sep)}`;
		openPath(openAbs);
	} catch (e) {
		notifyError(e instanceof Error ? e.message : String(e));
	} finally {
		setVaultBusy(false);
	}
}

/** Welcome-page entry: create a vault, then open the Zotero migrate dialog. */
export async function migrateZoteroFromWelcome(): Promise<void> {
	try {
		if (!isTauri()) {
			notifyError(i18n.t("app:errors.openVaultDesktopOnly"));
			return;
		}
		setVaultBusy(true);
		const path = await pickCreateVaultDirectory();
		if (!path) return;
		const result = await createVault(path, i18n.language);
		const root = result.path || path;
		await activateVault(root);
		setZoteroOpen(true);
	} catch (e) {
		notifyError(e instanceof Error ? e.message : String(e));
	} finally {
		setVaultBusy(false);
	}
}

/**
 * Validate a restored local Vault: the path can remain in localStorage after
 * the directory is deleted. Clears all vault state when missing.
 */
export function validateRestoredVault(): void {
	const restoredPath = getVaultPath();
	if (!isTauri() || !restoredPath || isRemoteVaultHandle(restoredPath)) return;
	void ensureLocalFsScope(restoredPath)
		.then(() => import("@tauri-apps/plugin-fs"))
		.then(({ exists }) => exists(restoredPath))
		.then((pathExists) => {
			if (pathExists || getVaultPath() !== restoredPath) return;
			saveVaultPath(null);
			setVaultPath(null);
			setTree([]);
			setTabs([]);
			setActiveTabId(null);
			setTreeSelectedPath(null);
		})
		.catch(() => {
			// Leave the restored state intact when the existence check fails.
		});
}
