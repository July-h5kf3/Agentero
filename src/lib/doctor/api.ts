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

export type WikiCheckIssue = {
	status: string;
	source: string;
	line: number;
	targetRaw: string;
	syntax: string;
	embed: boolean;
	targetPath?: string;
	candidates?: string[];
	context?: string;
};

export type VisualMarkCandidate = {
	path: string;
	markId: string;
	reason: string;
	fixable: boolean;
	selectedByDefault: boolean;
};

export type DuplicateKind = "id" | "path";

export type DuplicateRow = {
	path: string;
	id: string;
	title: string;
	updatedAt: string;
	pathExists: boolean;
};

export type DuplicateGroup = {
	kind: DuplicateKind;
	key: string;
	rows: DuplicateRow[];
};

export type DuplicateReport = {
	duplicateIds: DuplicateGroup[];
	duplicatePaths: DuplicateGroup[];
	totalDuplicateRows: number;
};

export type DuplicateRepairResult = {
	removedRows: number;
	removedPaths: string[];
	keptPaths: string[];
};

export type DoctorReport = {
	ok: boolean;
	vault: DoctorSection;
	catalog: DoctorSection & {
		schemaVersion?: number;
		expectedSchemaVersion: number;
		duplicateReport?: DuplicateReport;
	};
	wikilinks: {
		checkedFiles: number;
		counts: {
			resolved: number;
			missing: number;
			ambiguous: number;
			invalidFragment: number;
		};
		issues: WikiCheckIssue[];
	};
	aliases: {
		ok: boolean;
		checkedPapers: number;
		completePapers: number;
		candidates: AliasRepairCandidate[];
		/** Incomplete NOTES paths the user chose to ignore (persisted in vault). */
		ignoredPaths: string[];
		issues: DoctorIssue[];
	};
	visualMarks?: {
		ok: boolean;
		checkedFiles: number;
		candidates: VisualMarkCandidate[];
		issues: DoctorIssue[];
	};
};

export type DoctorVaultState = {
	ignoredAliasPaths: string[];
};

export type AliasRepairChange = {
	path: string;
	titleAlias: string;
	shortAlias: string;
	expectedHash: string;
};

export type WikilinkRepairLayer = "deterministic" | "manual";
export type WikilinkEditKind = "target" | "fragment";

export type WikilinkRepairSuggestion = {
	id: string;
	source: string;
	line: number;
	status: string;
	syntax: string;
	embed: boolean;
	targetRaw: string;
	suggestedReplacement: string;
	editKind: WikilinkEditKind;
	rangeStart: number;
	rangeEnd: number;
	expected: string;
	expectedHash: string;
	/** Same-line text before the edit span (git-style context). */
	linePrefix?: string;
	/** Same-line text after the edit span. */
	lineSuffix?: string;
	layer: WikilinkRepairLayer;
	reason: string;
	selectedByDefault: boolean;
	candidates?: string[];
	context?: string;
};

export type WikilinkRepairResidual = {
	id: string;
	source: string;
	line: number;
	status: string;
	syntax: string;
	embed: boolean;
	targetRaw: string;
	editKind: WikilinkEditKind;
	rangeStart: number;
	rangeEnd: number;
	expected: string;
	expectedHash: string;
	linePrefix?: string;
	lineSuffix?: string;
	candidates?: string[];
	context?: string;
	targetPath?: string;
	vaultHints?: string[];
};

export type WikilinkRepairPlan = {
	suggestions: WikilinkRepairSuggestion[];
	residuals: WikilinkRepairResidual[];
};

export type WikilinkRepairChange = {
	source: string;
	rangeStart: number;
	rangeEnd: number;
	expected: string;
	replacement: string;
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

/** Persist ignore/restore for paper-alias candidates (vault `.agentero/doctor.json`). */
export function doctorIgnoreAliases(
	vaultPath: string,
	paths: string[],
	ignore: boolean,
): Promise<DoctorVaultState> {
	return invokeApi<DoctorVaultState>("doctor_ignore_aliases", {
		args: { vaultPath, paths, ignore },
	});
}

export function doctorPlanWikilinks(
	vaultPath: string,
): Promise<WikilinkRepairPlan> {
	return invokeApi<WikilinkRepairPlan>("doctor_plan_wikilinks", {
		args: { vaultPath },
	});
}

export function doctorApplyWikilinks(
	vaultPath: string,
	changes: WikilinkRepairChange[],
): Promise<{ updatedPaths: string[] }> {
	return invokeApi<{ updatedPaths: string[] }>("doctor_apply_wikilinks", {
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

export type VisualMarkRepairChange = {
	path: string;
};

export function doctorApplyVisualMarks(
	vaultPath: string,
	changes: VisualMarkRepairChange[],
): Promise<{ updatedPaths: string[] }> {
	return invokeApi<{ updatedPaths: string[] }>("doctor_apply_visual_marks", {
		args: { vaultPath, changes },
	});
}

export function doctorFixCatalogDuplicates(
	vaultPath: string,
): Promise<DuplicateRepairResult> {
	return invokeApi<DuplicateRepairResult>("doctor_fix_catalog_duplicates", {
		args: { vaultPath },
	});
}
