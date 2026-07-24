export {
	createVaultDirectory,
	isMarkdownPath,
	isTextOpenable,
	readVaultFile,
	removeVaultPath,
	writeVaultBytes,
	writeVaultFile,
} from "@/lib/vault/fs";
export * from "@/lib/vault/fs-watch";
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
export * from "@/lib/vault/remote/remote-vault";
export { joinRemotePath, remoteRelFromJoined } from "@/lib/vault/remote-path";
export * from "@/lib/vault/reveal";
export { ensureLocalFsScope } from "@/lib/vault/scope";
export * from "@/lib/vault/search";
export {
	getLastVaultPath,
	getRecentVaults,
	getSavedVaultPath,
	getSessionVaultPath,
	isFreshWindow,
	openNewWindow,
	rememberRecentVault,
	removeRecentVault,
	saveVaultPath,
} from "@/lib/vault/session";
export {
	isEagerTreeRel,
	listVaultDirChildren,
	loadVaultTree,
	pendingDirsAmongExpanded,
	replaceTreeNodeChildren,
	shouldIgnoreTreeName,
	TREE_EAGER_ROOT_NAMES,
	TREE_IGNORE_NAMES,
	treeHasPendingChildren,
} from "@/lib/vault/tree";
export type { CreateVaultResult, FileNode } from "@/lib/vault/types";
