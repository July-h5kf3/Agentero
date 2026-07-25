export type CreateVaultResult = {
	path: string;
	created: string[];
	openPath: string;
};

export type FileNode = {
	id: string;
	name: string;
	path: string;
	kind: "file" | "directory";
	children?: FileNode[];
	/**
	 * Directory whose children have not been listed yet (lazy tree).
	 * `true` → show as folder; load on expand. Omit / `false` when loaded
	 * (including empty dirs, which use `children: []`).
	 */
	childrenPending?: boolean;
};
