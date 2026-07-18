/**
 * Host wraps Composer turns with a system envelope (`build_prompt`) before
 * sending to ACP/Codex. Codex also injects separate `<environment_context>`
 * user turns. Transcripts store those bodies; the chat UI must show only the
 * human request (empty string ⇒ skip the line).
 */

const USER_REQUEST_MARKER = "User request:\n";

const ENVELOPE_PREFIXES = [
	"You are an assistant working inside a Agentero research Vault",
	"You are an assistant working inside a Motif research Vault",
	"You are running the Agentero paper-reader workflow",
	"You are helping with a research vault",
	"You are answering questions about a local research vault",
	"Draft a Related Work section from local papers",
] as const;

const SKILL_TAIL_MARKERS = [
	"\n\n## Skill:",
	"\n\n# Skill:",
	"\n\n### Skill:",
	"\n\n<skill",
	"\n\nActive skills use the $ trigger",
	"\n\nActive skills use the / trigger",
	"\n\nAgentero injects skill instructions",
] as const;

function stripEnvironmentContextBlocks(text: string): string {
	let out = text;
	while (true) {
		const lower = out.toLowerCase();
		const start = lower.indexOf("<environment_context");
		if (start < 0) break;
		const closeRel = lower.indexOf("</environment_context>", start);
		const end =
			closeRel >= 0 ? closeRel + "</environment_context>".length : out.length;
		out = out.slice(0, start) + out.slice(end);
	}
	return out;
}

function looksLikeMachineOnlyUserTurn(text: string): boolean {
	const t = text.trim();
	if (!t) return true;
	const lower = t.toLowerCase();
	if (
		lower.startsWith("<environment_context") &&
		lower.includes("</environment_context>")
	) {
		if (!stripEnvironmentContextBlocks(t).trim()) return true;
	}
	if (
		lower.startsWith("<permissions instructions>") ||
		lower.startsWith("<skills_instructions>") ||
		lower.startsWith("<multi_agent_mode>")
	) {
		return true;
	}
	return false;
}

function cutSkillTail(text: string): string {
	let out = text;
	for (const marker of SKILL_TAIL_MARKERS) {
		const i = out.indexOf(marker);
		if (i >= 0) out = out.slice(0, i);
	}
	return out.trim();
}

/** Recover the human-visible user text from a stored Agentero / Codex turn. */
export function stripPromptEnvelopeForDisplay(text: string): string {
	const raw = stripEnvironmentContextBlocks(text.trim()).trim();
	if (!raw || looksLikeMachineOnlyUserTurn(raw)) return "";

	const markerIdx = raw.lastIndexOf(USER_REQUEST_MARKER);
	if (markerIdx >= 0) {
		return cutSkillTail(raw.slice(markerIdx + USER_REQUEST_MARKER.length));
	}

	if (ENVELOPE_PREFIXES.some((p) => raw.startsWith(p))) {
		const parts = raw.split(/\n\n+/);
		const last = parts[parts.length - 1]?.trim() ?? "";
		if (last && last !== raw && !looksLikeMachineOnlyUserTurn(last)) {
			return cutSkillTail(last);
		}
		return "";
	}

	if (looksLikeMachineOnlyUserTurn(raw)) return "";
	return raw;
}

/** One-line history label from a (possibly enveloped) title or first user turn. */
export function displayHistoryTitle(raw: string, fallback = ""): string {
	const cleaned = stripPromptEnvelopeForDisplay(raw);
	const first =
		cleaned
			.split(/\r?\n/)
			.map((l) => l.trim())
			.find(Boolean) ?? "";
	if (!first) return fallback || "";
	return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}
