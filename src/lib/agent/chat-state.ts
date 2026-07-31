/**
 * Pure chat transcript / agent switcher helpers for AgentPanel.
 * Kept free of React so unit tests can cover stream merge + option building.
 */
import type { ToolUIPart } from "ai";
import type {
	AgentListResponse,
	AgentModelChoice,
	AgentPlanEntry,
	AgentPlanEvent,
	AgentResultPayload,
	AgentStreamEvent,
	AgentTemplate,
	AgentToolEvent,
	CatalogScanResponse,
	PromptImage,
} from "@/lib/agent/api";
import {
	isVisualAnnotationPromptText,
	stripPromptEnvelopeForDisplay,
} from "@/lib/agent/prompt-display";
import { copyTextToClipboard } from "@/lib/core/clipboard";

/** Snapshot of a visual PDF annotation attached to a local user chat line. */
export type ChatVisualAnnotation = {
	id: string;
	/** 1-based PDF page number. */
	page: number;
	comment: string;
	image: PromptImage;
	/** Vault-relative paper path when known. */
	paperPath?: string;
};

export type ToolUiState = {
	id: string;
	title: string;
	kind: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	input?: unknown;
	output?: unknown;
};

/**
 * Ordered slice of an agent turn. Reasoning, tool calls, plan and message text
 * are stored in the sequence the agent emitted them so the transcript can show
 * interleaved thinking (think → tool → think → answer) instead of grouping all
 * reasoning and tools into fixed blocks.
 */
export type AgentPart =
	| { type: "reasoning"; id: string; text: string }
	| { type: "text"; id: string; text: string }
	| { type: "tool"; id: string; tool: ToolUiState }
	| { type: "plan"; id: string; entries: AgentPlanEntry[] };

export type ChatLine =
	| {
			id: string;
			kind: "user";
			/** Free-form composer text (may be empty when only visual annotations). */
			text: string;
			/** Local multimodal visual crops sent with this turn (session-local). */
			visualAnnotations?: ChatVisualAnnotation[];
	  }
	| {
			id: string;
			kind: "agent";
			parts: AgentPart[];
			sources?: string[];
			streaming?: boolean;
	  }
	| { id: string; kind: "error"; text: string }
	| { id: string; kind: "system"; text: string };

export type ChatSessionHistoryItem = {
	id: string;
	agentId: string;
	source: "local" | "indexed" | "external";
	title: string;
	agentName: string;
	startedAt: string;
	lines: ChatLine[];
	status: "running" | "completed" | "cancelled" | "failed";
	/** Durable ACP provider session id used to resume this conversation. */
	providerSessionId?: string | null;
};

export type PendingTerminalEvent =
	| { kind: "completed"; event: AgentResultPayload }
	| { kind: "failed"; error: string };

export type PendingSessionEvent =
	| { kind: "stream"; event: AgentStreamEvent }
	| { kind: "tool"; event: AgentToolEvent }
	| { kind: "plan"; event: AgentPlanEvent };

let chatLineSeq = 0;
export function nextLineId(prefix: string) {
	chatLineSeq += 1;
	return `${prefix}-${chatLineSeq}`;
}

let agentPartSeq = 0;
export function nextPartId(prefix: string) {
	agentPartSeq += 1;
	return `${prefix}-${agentPartSeq}`;
}

/** Test helper — reset module counters between cases. */
export function resetAgentChatIds() {
	chatLineSeq = 0;
	agentPartSeq = 0;
}

/** Build a chat error line (shared structure for all failure paths). */
export function errorChatLine(text: string): ChatLine {
	return { id: nextLineId("err"), kind: "error", text };
}

/** Coerce unknown thrown values into a display string. */
export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Background workflows (paper-reader, visual pin chat, etc.) must not appear
 * in Agent chat history as separate ACP sessions. Matches titles already
 * indexed before hideFromChatHistory existed; visual prompts are filtered
 * because hideFromChatHistory is not yet enforced on the host list path.
 */
export function isBackgroundWorkflowHistoryTitle(title: string): boolean {
	const t = stripPromptEnvelopeForDisplay(title).toLowerCase();
	const raw = title.toLowerCase();
	if (isVisualAnnotationPromptText(title)) return true;
	return (
		raw.includes("paper-reader") ||
		raw.includes("paper_reader") ||
		raw.includes("agentero paper-reader") ||
		raw.includes("write structured lecture notes") ||
		raw.includes("activate and follow $paper-reader") ||
		raw.includes("activate and follow /paper-reader") ||
		raw.includes("you are running the agentero paper-reader") ||
		raw.includes("you are helping the user discuss a visual region") ||
		t.includes("activate and follow $paper-reader") ||
		t.includes("write structured lecture notes")
	);
}

/** Empty-state suggestion chips — one per row. Labels via i18n. */
export const SUGGESTION_KEYS = [
	"summarizePaper",
	"askLibrary",
	"listClaims",
	"draftRelatedWork",
] as const;

export type SuggestionKey = (typeof SUGGESTION_KEYS)[number];

/**
 * Each suggestion routes to a purpose-built backend workflow so the agent gets
 * the right system prompt (progressive disclosure, citation discipline, …)
 * instead of a generic free-form chat.
 */
export const SUGGESTION_WORKFLOW: Record<SuggestionKey, string> = {
	summarizePaper: "summary",
	askLibrary: "qa",
	listClaims: "qa",
	draftRelatedWork: "related_work",
};

export type AgentOption = {
	key: string;
	id: string | null;
	templateId: string | null;
	name: string;
	isDefault: boolean;
	source: "registry" | "catalog";
	template?: AgentTemplate;
};

function catalogTemplateFromId(templateId: string): AgentTemplate | undefined {
	switch (templateId) {
		case "opencode":
		case "gemini":
		case "claude-acp":
		case "codex-acp":
		case "qodercli":
		case "grok-build":
		case "custom":
			return templateId;
		default:
			return undefined;
	}
}

/** Catalog entry is usable in Chat only when ACP handshake succeeded. */
export function catalogEntryUsable(e: {
	acpStatus: string;
	binaryAvailable: boolean;
	acpCommandAvailable: boolean;
}): boolean {
	return e.acpStatus === "ready";
}

export function registryAgentUsable(a: {
	available: boolean;
	lastProbeOk?: boolean | null;
}): boolean {
	return a.available || a.lastProbeOk === true;
}

/**
 * Agents shown in the Chat header switcher.
 * Unavailable ACP backends are omitted entirely (not shown as disabled).
 */
export function buildOptions(
	registry: AgentListResponse | null,
	catalog: CatalogScanResponse | null,
): AgentOption[] {
	const options: AgentOption[] = [];
	const seenIds = new Set<string>();

	if (catalog) {
		for (const e of catalog.entries) {
			if (!catalogEntryUsable(e)) continue;
			const id = e.registeredId ?? null;
			if (id) seenIds.add(id);
			options.push({
				key: `catalog:${e.templateId}`,
				id,
				templateId: e.templateId,
				name: e.name,
				isDefault: e.isDefault,
				source: "catalog",
				template: catalogTemplateFromId(e.templateId),
			});
		}
		for (const a of catalog.customAgents) {
			if (!registryAgentUsable(a)) continue;
			if (seenIds.has(a.id)) continue;
			seenIds.add(a.id);
			options.push({
				key: `reg:${a.id}`,
				id: a.id,
				templateId: null,
				name: a.name,
				isDefault: catalog.defaultId === a.id,
				source: "registry",
				template: a.template,
			});
		}
	}

	if (registry) {
		for (const a of registry.agents) {
			if (!registryAgentUsable(a)) continue;
			if (seenIds.has(a.id)) continue;
			seenIds.add(a.id);
			options.push({
				key: `reg:${a.id}`,
				id: a.id,
				templateId: null,
				name: a.name,
				isDefault: registry.defaultId === a.id,
				source: "registry",
				template: a.template,
			});
		}
	}

	return options;
}

export function resolveSelected(
	options: AgentOption[],
	selectedId: string | null,
	registry: AgentListResponse | null,
): AgentOption | undefined {
	// options is already availability-filtered
	if (selectedId) {
		const byId = options.find((o) => o.id === selectedId);
		if (byId) return byId;
	}
	const def = options.find((o) => o.isDefault);
	if (def) return def;
	if (registry?.defaultId) {
		const byDefault = options.find((o) => o.id === registry.defaultId);
		if (byDefault) return byDefault;
	}
	return options[0];
}

export function mapToolStatus(
	status: string | null | undefined,
): ToolUiState["status"] {
	switch (status) {
		case "in_progress":
			return "in_progress";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		default:
			return "pending";
	}
}

export function toolPartState(
	status: ToolUiState["status"],
): ToolUIPart["state"] {
	switch (status) {
		case "in_progress":
			return "input-available";
		case "completed":
			return "output-available";
		case "failed":
			return "output-error";
		default:
			return "input-streaming";
	}
}

export type ToolPatch = {
	id: string;
	title?: string | null;
	kind?: string | null;
	status?: string | null;
	input?: unknown;
	output?: unknown;
	full?: boolean;
};

export function mergeToolState(
	prev: ToolUiState | undefined,
	patch: ToolPatch,
): ToolUiState {
	return {
		id: patch.id,
		title: patch.title ?? prev?.title ?? "",
		kind: patch.kind ?? prev?.kind ?? "other",
		status: mapToolStatus(patch.status ?? prev?.status),
		input: patch.input !== undefined ? patch.input : prev?.input,
		output: patch.output !== undefined ? patch.output : prev?.output,
	};
}

/**
 * Append a streamed message/thought chunk, extending the trailing part when it
 * matches so consecutive chunks of the same kind stay in one block but a switch
 * of kind (thought → message or vice versa) starts a fresh, ordered part.
 */
export function appendStreamPart(
	parts: AgentPart[],
	kind: "reasoning" | "text",
	chunk: string,
): AgentPart[] {
	const last = parts[parts.length - 1];
	if (last && last.type === kind) {
		const next = parts.slice();
		next[next.length - 1] = { ...last, text: last.text + chunk };
		return next;
	}
	return [...parts, { type: kind, id: nextPartId(kind), text: chunk }];
}

/**
 * Upsert a tool call by id: update the existing part in place (keeping its
 * position in the timeline) or append a new tool part at the current tail.
 */
export function applyToolToParts(
	parts: AgentPart[],
	patch: ToolPatch,
): AgentPart[] {
	const idx = parts.findIndex(
		(p) => p.type === "tool" && p.tool.id === patch.id,
	);
	if (idx >= 0) {
		const existing = parts[idx] as Extract<AgentPart, { type: "tool" }>;
		const next = parts.slice();
		next[idx] = { ...existing, tool: mergeToolState(existing.tool, patch) };
		return next;
	}
	return [
		...parts,
		{
			type: "tool",
			id: nextPartId("tool"),
			tool: mergeToolState(undefined, patch),
		},
	];
}

/** Plan updates arrive as full snapshots; keep a single plan part in place. */
export function upsertPlanPart(
	parts: AgentPart[],
	entries: AgentPlanEntry[],
): AgentPart[] {
	const idx = parts.findIndex((p) => p.type === "plan");
	if (idx >= 0) {
		const existing = parts[idx] as Extract<AgentPart, { type: "plan" }>;
		const next = parts.slice();
		next[idx] = { ...existing, entries };
		return next;
	}
	return [...parts, { type: "plan", id: nextPartId("plan"), entries }];
}

export function agentTextFromParts(parts: AgentPart[]): string {
	return parts
		.filter((p): p is Extract<AgentPart, { type: "text" }> => p.type === "text")
		.map((p) => p.text)
		.join("");
}

export function agentReasoningFromParts(parts: AgentPart[]): string {
	return parts
		.filter(
			(p): p is Extract<AgentPart, { type: "reasoning" }> =>
				p.type === "reasoning",
		)
		.map((p) => p.text)
		.join("\n\n");
}

/** True when the turn has produced anything worth keeping on screen. */
export function agentHasContent(parts: AgentPart[]): boolean {
	return parts.some((p) => {
		if (p.type === "text" || p.type === "reasoning") {
			return p.text.trim().length > 0;
		}
		if (p.type === "plan") return p.entries.length > 0;
		return true;
	});
}

export async function copyText(text: string) {
	await copyTextToClipboard(text);
}

/** Client-side dedupe (id first, then display name) for cached/stale catalogs. */
export function dedupeModelsClient(
	models: AgentModelChoice[],
): AgentModelChoice[] {
	const seenIds = new Set<string>();
	const seenNames = new Set<string>();
	const out: AgentModelChoice[] = [];
	for (const m of models) {
		const id = m.id.trim();
		const nameKey = m.name.trim().toLowerCase();
		if (!id || !nameKey) continue;
		if (seenIds.has(id) || seenNames.has(nameKey)) continue;
		seenIds.add(id);
		seenNames.add(nameKey);
		out.push({
			id,
			name: m.name.trim(),
			group: m.group,
		});
	}
	return out;
}
