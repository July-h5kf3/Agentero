import { invokeApi } from "@/lib/core/ipc";

export type DoctorIssue = {
	code: string;
	message: string;
	severity: "error" | "warning";
	path?: string;
};

export type DoctorSection = {
	ok: boolean;
	issues: DoctorIssue[];
};

export type AliasRepairCandidate = {
	path: string;
	paperTitle: string;
	currentAliases: string[];
	titleAlias: string;
	shortAlias: string;
	expectedHash: string;
	fixable: boolean;
	selectedByDefault: boolean;
	reason?: string;
};

export type DoctorReport = {
	ok: boolean;
	vault: DoctorSection;
	catalog: DoctorSection & {
		schemaVersion?: number;
		expectedSchemaVersion: number;
	};
	wikilinks: {
		checkedFiles: number;
		counts: {
			resolved: number;
			missing: number;
			ambiguous: number;
			invalidFragment: number;
		};
		issues: unknown[];
	};
	aliases: {
		ok: boolean;
		checkedPapers: number;
		completePapers: number;
		candidates: AliasRepairCandidate[];
		issues: DoctorIssue[];
	};
};

export type AliasRepairChange = {
	path: string;
	titleAlias: string;
	shortAlias: string;
	expectedHash: string;
};

export function doctorCheck(vaultPath: string): Promise<DoctorReport> {
	return invokeApi<DoctorReport>("doctor_check", {
		args: { vaultPath },
	});
}

export function doctorApplyAliases(
	vaultPath: string,
	changes: AliasRepairChange[],
): Promise<{ updatedPaths: string[] }> {
	return invokeApi<{ updatedPaths: string[] }>("doctor_apply_aliases", {
		args: { vaultPath, changes },
	});
}

export function doctorSetDirtyPaths(
	vaultPath: string,
	dirtyPaths: string[],
): Promise<void> {
	return invokeApi<void>(
		"doctor_set_dirty_paths",
		{ args: { vaultPath, dirtyPaths } },
		{ allowVoid: true },
	);
}
