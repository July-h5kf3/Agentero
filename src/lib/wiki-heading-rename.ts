import {
	type WikiRenameHeadingRequest,
	type WikiRenameHeadingResult,
	wikiRenameFailure,
} from "@/lib/wiki";

export type WikiHeadingAnchor = {
	text: string;
	path: string[];
	level: number;
	line: number;
};

export type WikiHeadingRenameErrorKey =
	| "ambiguousHeading"
	| "generic"
	| "headingMissing"
	| "invalidHeading"
	| "manualRecovery"
	| "overlappingEdits"
	| "rolledBack"
	| "sourceChanged"
	| "unsavedEdits";

export type WikiHeadingRenameAvailability = {
	dirty: boolean;
	filePath: string | null | undefined;
	hasHandler: boolean;
	heading: WikiHeadingAnchor | null;
	readOnly: boolean | undefined;
};

export function canRenameWikiHeading({
	dirty,
	filePath,
	hasHandler,
	heading,
	readOnly,
}: WikiHeadingRenameAvailability): boolean {
	return Boolean(!readOnly && filePath && hasHandler && !dirty && heading);
}

function frontmatterClosingLine(lines: string[]): number {
	if (lines[0]?.replace(/\r$/, "").trim() !== "---") return -1;
	for (let index = 1; index < lines.length; index++) {
		const trimmed = lines[index]?.replace(/\r$/, "").trim();
		if (trimmed === "---" || trimmed === "...") return index;
	}
	// Match the Host extractor: an unterminated opening delimiter is ordinary
	// Markdown, so its later headings remain visible to the Wiki index.
	return -1;
}

/**
 * Extract saved ATX headings with the same frontmatter, fence, closing-marker,
 * hierarchy, and 1-based line rules as the Rust Wiki extractor.
 */
export function extractWikiHeadingAnchors(
	markdown: string,
): WikiHeadingAnchor[] {
	const lines = markdown.split("\n");
	const frontmatterEnd = frontmatterClosingLine(lines);
	const stack: Array<string | undefined> = [];
	const headings: WikiHeadingAnchor[] = [];
	let inFence = false;

	for (const [index, rawLine] of lines.entries()) {
		if (frontmatterEnd >= 0 && index <= frontmatterEnd) continue;
		const line = rawLine.replace(/\r$/, "");
		const trimmed = line.trimStart();
		if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const match = /^(#{1,6}) (.*)$/.exec(trimmed);
		if (!match) continue;
		const level = match[1]?.length ?? 0;
		const text = (match[2] ?? "").trim().replace(/#+$/u, "").trimEnd();
		if (!text) continue;

		stack.length = Math.min(stack.length, level);
		while (stack.length < level) stack.push(undefined);
		stack[level - 1] = text;
		headings.push({
			text,
			path: stack.filter((part): part is string => part !== undefined),
			level,
			line: index + 1,
		});
	}

	return headings;
}

/** Resolve a Plate heading ordinal against the byte-preserved saved Markdown. */
export function savedWikiHeadingAt(
	markdown: string,
	ordinal: number,
	expectedLevel: number,
): WikiHeadingAnchor | null {
	const heading = extractWikiHeadingAnchors(markdown)[ordinal];
	return heading?.level === expectedLevel ? heading : null;
}

export function buildWikiHeadingRenameRequest(
	path: string,
	heading: WikiHeadingAnchor,
	expectedContent: string,
	newText: string,
): WikiRenameHeadingRequest {
	return {
		path,
		headingPath: heading.path,
		headingLine: heading.line,
		expectedContent,
		newText: newText.trim(),
	};
}

/** Target first, then unique rewritten sources, for reload and embed refresh. */
export function wikiHeadingRenameAffectedPaths(
	result: WikiRenameHeadingResult,
): string[] {
	return [...new Set([result.path, ...result.updatedSources])];
}

/** Convert Host transaction details into stable editor i18n keys. */
export function wikiHeadingRenameErrorKey(
	error: unknown,
): WikiHeadingRenameErrorKey {
	const failure = wikiRenameFailure(error);
	if (!failure) return "generic";
	if (failure.rollback === "manual-recovery-required") return "manualRecovery";
	if (failure.rollback === "completed") return "rolledBack";
	switch (failure.code) {
		case "unsavedEdits":
			return "unsavedEdits";
		case "sourceChanged":
		case "indexStale":
			return "sourceChanged";
		case "headingMissing":
			return "headingMissing";
		case "invalidHeading":
			return "invalidHeading";
		case "ambiguousHeading":
			return "ambiguousHeading";
		case "overlappingEdits":
			return "overlappingEdits";
		default:
			return "generic";
	}
}
