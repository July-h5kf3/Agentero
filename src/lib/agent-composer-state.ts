export type AgentComposerState = {
	text: string;
	mentionedPaths: string[];
	selectedSkillIds: string[];
	includeSelectedFile: boolean;
};

export type ComposerStateStorage = Pick<
	Storage,
	"getItem" | "setItem" | "removeItem"
>;

const COMPOSER_STATE_PREFIX = "agentero-agent-composer-state-v1";

function uniqueStrings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(
			value.filter((item): item is string => typeof item === "string"),
		),
	];
}

function parseState(value: unknown): AgentComposerState | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<AgentComposerState>;
	return {
		text: typeof candidate.text === "string" ? candidate.text : "",
		mentionedPaths: uniqueStrings(candidate.mentionedPaths),
		selectedSkillIds: uniqueStrings(candidate.selectedSkillIds),
		includeSelectedFile: candidate.includeSelectedFile === true,
	};
}

function removeSubmittedStrings(current: string[], submitted: string[]) {
	const submittedSet = new Set(submitted);
	return current.filter((value) => !submittedSet.has(value));
}

export function clearSubmittedComposerState(
	current: AgentComposerState,
	submitted: AgentComposerState,
): AgentComposerState {
	return {
		text: current.text === submitted.text ? "" : current.text,
		mentionedPaths: removeSubmittedStrings(
			current.mentionedPaths,
			submitted.mentionedPaths,
		),
		selectedSkillIds: removeSubmittedStrings(
			current.selectedSkillIds,
			submitted.selectedSkillIds,
		),
		includeSelectedFile:
			current.includeSelectedFile === submitted.includeSelectedFile
				? false
				: current.includeSelectedFile,
	};
}

function storageKey(scopeKey: string, sessionId: string) {
	return `${COMPOSER_STATE_PREFIX}:${encodeURIComponent(scopeKey)}:${encodeURIComponent(sessionId)}`;
}

export function composerScopeKey(
	vaultPath: string | null,
	agentId: string | null,
): string | null {
	if (!vaultPath || !agentId) return null;
	return JSON.stringify([vaultPath, agentId]);
}

export function loadAgentComposerState(
	storage: ComposerStateStorage,
	scopeKey: string,
	sessionId: string,
): AgentComposerState | null {
	try {
		const raw = storage.getItem(storageKey(scopeKey, sessionId));
		if (!raw) return null;
		return parseState(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function saveAgentComposerState(
	storage: ComposerStateStorage,
	scopeKey: string,
	sessionId: string,
	state: AgentComposerState,
) {
	try {
		storage.setItem(storageKey(scopeKey, sessionId), JSON.stringify(state));
	} catch {
		// Persistence is best-effort; the in-memory Composer remains usable.
	}
}

export function removeAgentComposerState(
	storage: ComposerStateStorage,
	scopeKey: string,
	sessionId: string,
) {
	try {
		storage.removeItem(storageKey(scopeKey, sessionId));
	} catch {
		// ignore
	}
}
