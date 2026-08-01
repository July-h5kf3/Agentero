export {
	createVaultDirectory,
	isMarkdownPath,
	isTextOpenable,
	readVaultBytes,
	readVaultFile,
	removeVaultPath,
	writeVaultBytes,
	writeVaultFile,
} from "@/lib/vault/fs";
export {
	collectDirectoryRelPaths,
	collectMarkdownRelPaths,
	isValidVaultEntryName,
	joinVaultPath,
	normalizePathKey,
	paperRelFromNotes,
	resolveCreateParent,
	treeFindNode,
	vaultDisplayName,
	vaultRelativePath,
} from "@/lib/vault/path";
export {
	createVault,
	ensureVault,
	pickCreateVaultDirectory,
	pickVaultDirectory,
	seededSkillIdsFromCreated,
} from "@/lib/vault/pick";
export { ensureLocalFsScope } from "@/lib/vault/scope";
export {
	getRecentVaults,
	getSavedVaultPath,
	openNewWindow,
	removeRecentVault,
	saveVaultPath,
} from "@/lib/vault/session";
export {
	collectTreeRefreshTargets,
	collectWikiTargetRelPaths,
	isEagerTreeRel,
	listVaultDirChildren,
	loadVaultTree,
	pendingDirsAmongExpanded,
	replaceTreeNodeChildren,
	shouldIgnoreTreeName,
	treeHasPendingChildren,
} from "@/lib/vault/tree";
export type { FileNode } from "@/lib/vault/types";
