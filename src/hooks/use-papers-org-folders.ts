import { useMemo } from "react";

import { isPaperDirectory } from "@/lib/paper";
import { type FileNode, vaultRelativePath } from "@/lib/vault";

/**
 * Vault-relative `papers/` org folders (papers root first, paper units
 * excluded) for import-destination pickers. Mirrors the derivation in
 * `MovePapersDialog` so both pickers agree on what is an org folder.
 */
export function usePapersOrgFolders(
	vaultPath: string | null,
	tree: FileNode[],
): string[] {
	return useMemo(() => {
		const out = ["papers"];
		if (!vaultPath) return out;
		const walk = (list: FileNode[]) => {
			for (const n of list) {
				if (n.kind !== "directory") continue;
				if (isPaperDirectory(n.path, n.children)) continue;
				const rel = vaultRelativePath(vaultPath, n.path);
				const under =
					rel !== null && (rel === "papers" || rel.startsWith("papers/"));
				if (under && rel !== "papers") out.push(rel);
				if (n.children?.length) walk(n.children);
			}
		};
		walk(tree);
		return Array.from(new Set(out));
	}, [tree, vaultPath]);
}
