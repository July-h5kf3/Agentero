import type { ToolUIPart } from "ai";
import {
	Bot,
	Check,
	CheckIcon,
	ChevronDown,
	CopyIcon,
	FileText,
	FolderOpen,
	History,
	PencilLine,
	X,
	Zap,
} from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
	Checkpoint,
	CheckpointIcon,
	CheckpointTrigger,
} from "@/components/ai-elements/checkpoint";
import {
	Context,
	ContextContent,
	ContextContentHeader,
	ContextTrigger,
} from "@/components/ai-elements/context";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	InlineCitation,
	InlineCitationCard,
	InlineCitationCardBody,
	InlineCitationCardTrigger,
	InlineCitationCarousel,
	InlineCitationCarouselContent,
	InlineCitationCarouselHeader,
	InlineCitationCarouselIndex,
	InlineCitationCarouselItem,
	InlineCitationCarouselNext,
	InlineCitationCarouselPrev,
	InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import {
	Message,
	MessageAction,
	MessageActions,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import {
	Plan,
	PlanAction,
	PlanContent,
	PlanDescription,
	PlanHeader,
	PlanTitle,
	PlanTrigger,
} from "@/components/ai-elements/plan";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
	Source,
	Sources,
	SourcesContent,
	SourcesTrigger,
} from "@/components/ai-elements/sources";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
	type AgentEffortChoice,
	type AgentListResponse,
	type AgentModelChoice,
	type AgentPlanEntry,
	type AgentSkill,
	type CatalogScanResponse,
	cancelAgentRun,
	ensureCatalogAgent,
	listAgentSkills,
	listAgents,
	listCodexThreads,
	listenAgentCompleted,
	listenAgentEffort,
	listenAgentFailed,
	listenAgentFastMode,
	listenAgentModels,
	listenAgentPlan,
	listenAgentStream,
	listenAgentTool,
	listenAgentUsage,
	loadExternalCodexHistoryPref,
	loadModelCatalog,
	loadModelPref,
	loadYoloPref,
	readCodexThread,
	runOnce,
	saveExternalCodexHistoryPref,
	saveModelCatalog,
	saveModelPref,
	saveYoloPref,
	scanCatalog,
	setDefaultAgent,
	warmAgent,
} from "@/lib/agent";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { toVaultRelative } from "@/lib/wiki";

type AgentPanelProps = {
	vaultPath: string | null;
	selectedPath?: string | null;
	vaultMarkdownPaths?: string[];
	className?: string;
	headerActions?: ReactNode;
	autoFocus?: boolean;
	title?: string;
};

type ToolUiState = {
	id: string;
	title: string;
	kind: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	input?: unknown;
	output?: unknown;
};

type ChatLine =
	| { id: string; kind: "user"; text: string }
	| {
			id: string;
			kind: "agent";
			text: string;
			reasoning?: string;
			reasoningStreaming?: boolean;
			tools?: ToolUiState[];
			plan?: AgentPlanEntry[];
			sources?: string[];
			streaming?: boolean;
	  }
	| { id: string; kind: "error"; text: string }
	| { id: string; kind: "system"; text: string };

type ChatSessionHistoryItem = {
	id: string;
	agentId: string;
	title: string;
	agentName: string;
	startedAt: string;
	lines: ChatLine[];
	status: "running" | "completed" | "cancelled" | "failed";
};

let chatLineSeq = 0;
function nextLineId(prefix: string) {
	chatLineSeq += 1;
	return `${prefix}-${chatLineSeq}`;
}

/** Empty-state suggestion chips — one per row (3 lines). Labels via i18n. */
const SUGGESTION_KEYS = [
	"summarizePaper",
	"listClaims",
	"findRelated",
] as const;

type AgentOption = {
	key: string;
	id: string | null;
	templateId: string | null;
	name: string;
	available: boolean;
	isDefault: boolean;
	source: "registry" | "catalog";
};

/** Catalog entry is usable in Chat only when ACP handshake succeeded. */
function catalogEntryUsable(e: {
	acpStatus: string;
	binaryAvailable: boolean;
	acpCommandAvailable: boolean;
}): boolean {
	return e.acpStatus === "ready";
}

function registryAgentUsable(a: {
	available: boolean;
	lastProbeOk?: boolean | null;
}): boolean {
	return a.available || a.lastProbeOk === true;
}

/**
 * Agents shown in the Chat header switcher.
 * Unavailable ACP backends are omitted entirely (not shown as disabled).
 */
function buildOptions(
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
				available: true,
				isDefault: e.isDefault,
				source: "catalog",
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
				available: true,
				isDefault: catalog.defaultId === a.id,
				source: "registry",
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
				available: true,
				isDefault: registry.defaultId === a.id,
				source: "registry",
			});
		}
	}

	return options;
}

function resolveSelected(
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

function mapToolStatus(
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

function toolPartState(status: ToolUiState["status"]): ToolUIPart["state"] {
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

function mergeTool(
	tools: ToolUiState[] | undefined,
	patch: {
		id: string;
		title?: string | null;
		kind?: string | null;
		status?: string | null;
		input?: unknown;
		output?: unknown;
		full?: boolean;
	},
): ToolUiState[] {
	const list = tools ? [...tools] : [];
	const idx = list.findIndex((t) => t.id === patch.id);
	const prev = idx >= 0 ? list[idx] : undefined;
	const next: ToolUiState = {
		id: patch.id,
		title: patch.title ?? prev?.title ?? "",
		kind: patch.kind ?? prev?.kind ?? "other",
		status: mapToolStatus(patch.status ?? prev?.status),
		input: patch.input !== undefined ? patch.input : prev?.input,
		output: patch.output !== undefined ? patch.output : prev?.output,
	};
	if (idx >= 0) list[idx] = next;
	else list.push(next);
	return list;
}

async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// ignore
	}
}

/** Client-side dedupe (id first, then display name) for cached/stale catalogs. */
function dedupeModelsClient(models: AgentModelChoice[]): AgentModelChoice[] {
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

export function AgentPanel({
	vaultPath,
	selectedPath = null,
	vaultMarkdownPaths = [],
	className,
	headerActions,
	autoFocus = false,
	title = "Chat",
}: AgentPanelProps) {
	const { t, i18n } = useTranslation("agent");
	const [registry, setRegistry] = useState<AgentListResponse | null>(null);
	const [catalog, setCatalog] = useState<CatalogScanResponse | null>(null);
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [lines, setLines] = useState<ChatLine[]>([]);
	const [sessionHistory, setSessionHistory] = useState<
		ChatSessionHistoryItem[]
	>([]);
	const [switching, setSwitching] = useState(false);
	const [usage, setUsage] = useState<{ used: number; size: number } | null>(
		null,
	);
	const [usageBySession, setUsageBySession] = useState<
		Record<string, { used: number; size: number }>
	>({});
	const [historyOpen, setHistoryOpen] = useState(false);
	const [models, setModels] = useState<AgentModelChoice[]>([]);
	const [modelId, setModelId] = useState<string | null>(null);
	const [warming, setWarming] = useState(false);
	const [composerText, setComposerText] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [includeSelectedFile, setIncludeSelectedFile] = useState(true);
	const [mentionedPaths, setMentionedPaths] = useState<string[]>([]);
	const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
	const [skills, setSkills] = useState<AgentSkill[]>([]);
	const [effortOptions, setEffortOptions] = useState<AgentEffortChoice[]>([]);
	const [reasoningEffort, setReasoningEffort] = useState<string | null>(null);
	const [fastAvailable, setFastAvailable] = useState(false);
	const [fastEnabled, setFastEnabled] = useState(false);
	const [yoloEnabled, setYoloEnabled] = useState(false);
	const [includeExternalCodexHistory, setIncludeExternalCodexHistory] =
		useState(false);
	const [composerMenuDismissed, setComposerMenuDismissed] = useState(false);
	const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
	const [skillActiveIndex, setSkillActiveIndex] = useState(0);
	const [activeTabId, setActiveTabId] = useState("draft");
	const activeConversationRef = useRef<string | null>(null);
	const activeTabRef = useRef("draft");
	const selectedAgentIdRef = useRef<string | null>(null);
	const warmGenRef = useRef(0);
	const historyGenRef = useRef(0);
	const submittingRef = useRef(false);

	const applyModelsEvent = useCallback(
		(ev: {
			agentId: string;
			configId: string;
			currentId: string;
			models: AgentModelChoice[];
		}) => {
			if (ev.models.length === 0) return;
			// Defense in depth: host already dedupes; keep unique by id then name.
			const models = dedupeModelsClient(ev.models);
			saveModelCatalog(ev.agentId, {
				configId: ev.configId,
				currentId: ev.currentId,
				models,
			});
			const cur = selectedAgentIdRef.current;
			if (cur && cur !== ev.agentId) return;
			setModels(models);
			setModelId((prev) => {
				const pref = loadModelPref(ev.agentId);
				if (pref && models.some((m) => m.id === pref)) return pref;
				if (prev && models.some((m) => m.id === prev)) return prev;
				return ev.currentId || models[0]?.id || null;
			});
		},
		[],
	);

	const applyEffortEvent = useCallback(
		(ev: {
			agentId: string;
			currentId: string;
			efforts: AgentEffortChoice[];
		}) => {
			const cur = selectedAgentIdRef.current;
			if (cur && cur !== ev.agentId) return;
			setEffortOptions(ev.efforts);
			setReasoningEffort(ev.currentId);
		},
		[],
	);

	const applyFastModeEvent = useCallback(
		(ev: { agentId: string; enabled: boolean }) => {
			const cur = selectedAgentIdRef.current;
			if (cur && cur !== ev.agentId) return;
			setFastAvailable(true);
			setFastEnabled(ev.enabled);
		},
		[],
	);

	const refresh = useCallback(async () => {
		if (!isTauri()) return;
		try {
			const [list, scan, discoveredSkills] = await Promise.all([
				listAgents(),
				scanCatalog(),
				listAgentSkills(vaultPath ?? undefined).catch(() => []),
			]);
			setRegistry(list);
			setCatalog(scan);
			setSkills(discoveredSkills);
			setSelectedAgentId((prev) => prev ?? list.defaultId);
		} catch (e) {
			setLines((prev) => [
				...prev,
				{
					id: nextLineId("err"),
					kind: "error",
					text: e instanceof Error ? e.message : String(e),
				},
			]);
		}
	}, [vaultPath]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		activeTabRef.current = activeTabId;
	}, [activeTabId]);

	// Restore last model catalog / preference for the selected agent.
	useEffect(() => {
		selectedAgentIdRef.current = selectedAgentId;
		if (!selectedAgentId) {
			setModels([]);
			setModelId(null);
			setEffortOptions([]);
			setReasoningEffort(null);
			setFastAvailable(false);
			setFastEnabled(false);
			setUsage(null);
			setUsageBySession({});
			setYoloEnabled(false);
			setIncludeExternalCodexHistory(false);
			return;
		}
		setEffortOptions([]);
		setReasoningEffort(null);
		setFastAvailable(false);
		setFastEnabled(false);
		setUsage(null);
		setUsageBySession({});
		setYoloEnabled(loadYoloPref(selectedAgentId));
		setIncludeExternalCodexHistory(
			loadExternalCodexHistoryPref(selectedAgentId),
		);
		const catalog = loadModelCatalog(selectedAgentId);
		const pref = loadModelPref(selectedAgentId);
		if (catalog?.models.length) {
			const models = dedupeModelsClient(catalog.models);
			setModels(models);
			const preferred =
				(pref && models.some((m) => m.id === pref) && pref) ||
				(catalog.currentId &&
					models.some((m) => m.id === catalog.currentId) &&
					catalog.currentId) ||
				models[0]?.id ||
				null;
			setModelId(preferred);
		} else {
			setModels([]);
			setModelId(pref);
		}
	}, [selectedAgentId]);

	// When Chat opens (or agent/vault changes), warm ACP in the background for models/context.
	useEffect(() => {
		if (!isTauri() || !selectedAgentId) return;
		const gen = ++warmGenRef.current;
		let cancelled = false;
		setWarming(true);
		void (async () => {
			try {
				const pref = loadModelPref(selectedAgentId) ?? undefined;
				const result = await warmAgent({
					agentId: selectedAgentId,
					vaultPath: vaultPath ?? undefined,
					modelId: pref,
				});
				if (cancelled || gen !== warmGenRef.current) return;
				if (result.models) {
					applyModelsEvent(result.models);
				}
				if (
					result.usageUsed != null &&
					result.usageSize != null &&
					result.usageSize > 0
				) {
					setUsage({ used: result.usageUsed, size: result.usageSize });
				}
			} catch {
				// Warm is best-effort; first message can still discover models.
			} finally {
				if (!cancelled && gen === warmGenRef.current) setWarming(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedAgentId, vaultPath, applyModelsEvent]);

	useEffect(() => {
		if (!isTauri()) return;
		let cancelled = false;
		const unsubs: Array<() => void> = [];
		const updateSessionLines = (
			sessionId: string,
			update: (lines: ChatLine[]) => ChatLine[],
		) => {
			setSessionHistory((prev) =>
				prev.map((item) =>
					item.id === sessionId ? { ...item, lines: update(item.lines) } : item,
				),
			);
			if (activeTabRef.current === sessionId) {
				setLines(update);
			}
		};

		void (async () => {
			const u1 = await listenAgentStream((ev) => {
				const streamKind = ev.kind ?? "message";
				updateSessionLines(ev.sessionId, (prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === "agent" && last.streaming) {
						if (streamKind === "thought") {
							next[next.length - 1] = {
								...last,
								reasoning: (last.reasoning ?? "") + ev.chunk,
								reasoningStreaming: true,
							};
						} else {
							next[next.length - 1] = {
								...last,
								text: last.text + ev.chunk,
								reasoningStreaming: false,
							};
						}
						return next;
					}
					return prev;
				});
			});
			const uTool = await listenAgentTool((ev) => {
				updateSessionLines(ev.sessionId, (prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === "agent" && last.streaming) {
						next[next.length - 1] = {
							...last,
							tools: mergeTool(last.tools, {
								id: ev.toolCallId,
								title: ev.title,
								kind: ev.kind,
								status: ev.status,
								input: ev.input,
								output: ev.output,
								full: ev.full,
							}),
						};
						return next;
					}
					return prev;
				});
			});
			const uPlan = await listenAgentPlan((ev) => {
				updateSessionLines(ev.sessionId, (prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === "agent" && last.streaming) {
						next[next.length - 1] = {
							...last,
							plan: ev.entries,
						};
						return next;
					}
					return prev;
				});
			});
			const uUsage = await listenAgentUsage((ev) => {
				if (ev.size <= 0) return;
				if (ev.sessionId === "warm") {
					setUsage({ used: ev.used, size: ev.size });
					return;
				}
				setUsageBySession((prev) => ({
					...prev,
					[ev.sessionId]: { used: ev.used, size: ev.size },
				}));
			});
			const uModels = await listenAgentModels((ev) => {
				applyModelsEvent(ev);
			});
			const uEffort = await listenAgentEffort((ev) => {
				applyEffortEvent(ev);
			});
			const uFast = await listenAgentFastMode((ev) => {
				applyFastModeEvent(ev);
			});
			const u2 = await listenAgentCompleted((ev) => {
				if (ev.stopReason === "cancelled") {
					const cancelledLine: ChatLine = {
						id: nextLineId("sys"),
						kind: "system",
						text: t("messages.cancelled"),
					};
					updateSessionLines(ev.sessionId, (prev) => {
						const next = [...prev];
						const last = next[next.length - 1];
						if (last?.kind === "agent" && last.streaming) {
							const hasOutput =
								last.text.trim().length > 0 ||
								Boolean(last.reasoning?.trim()) ||
								Boolean(last.tools?.length) ||
								Boolean(last.plan?.length);
							if (hasOutput) {
								next[next.length - 1] = {
									...last,
									reasoningStreaming: false,
									streaming: false,
								};
							} else {
								next.pop();
							}
						}
						return [...next, cancelledLine];
					});
					setSessionHistory((prev) =>
						prev.map((item) =>
							item.id === ev.sessionId
								? { ...item, status: "cancelled" }
								: item,
						),
					);
					return;
				}
				updateSessionLines(ev.sessionId, (prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === "agent" && last.streaming) {
						const text =
							last.text.trim().length > 0
								? last.text
								: ev.content || "(empty response)";
						const reasoning =
							(last.reasoning && last.reasoning.trim().length > 0
								? last.reasoning
								: ev.reasoning) || undefined;
						const completedLine: ChatLine = {
							...last,
							text,
							reasoning,
							reasoningStreaming: false,
							sources: ev.sources,
							streaming: false,
						};
						next[next.length - 1] = completedLine;
						return next;
					}
					return prev;
				});
				setSessionHistory((prev) =>
					prev.map((item) =>
						item.id === ev.sessionId ? { ...item, status: "completed" } : item,
					),
				);
			});
			const u3 = await listenAgentFailed((ev) => {
				const failedLine: ChatLine = {
					id: nextLineId("err"),
					kind: "error",
					text: ev.error,
				};
				updateSessionLines(ev.sessionId, (prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === "agent" && last.streaming) {
						next.pop();
					}
					return [...next, failedLine];
				});
				setSessionHistory((prev) =>
					prev.map((item) =>
						item.id === ev.sessionId ? { ...item, status: "failed" } : item,
					),
				);
			});

			if (cancelled) {
				u1();
				uTool();
				uPlan();
				uUsage();
				uModels();
				uEffort();
				uFast();
				u2();
				u3();
				return;
			}
			unsubs.push(u1, uTool, uPlan, uUsage, uModels, uEffort, uFast, u2, u3);
		})();

		return () => {
			cancelled = true;
			for (const u of unsubs) u();
		};
	}, [applyEffortEvent, applyFastModeEvent, applyModelsEvent, t]);

	const options = buildOptions(registry, catalog);
	const selected = resolveSelected(options, selectedAgentId, registry);
	const selectedTemplate =
		selected?.templateId ??
		registry?.agents.find((agent) => agent.id === selectedAgentId)?.template ??
		null;
	const isCodexAgent = selectedTemplate === "codex-acp";

	const loadCodexHistory = useCallback(async () => {
		if (!isTauri() || !isCodexAgent || !selectedAgentId) return;
		const generation = ++historyGenRef.current;
		try {
			const threads = await listCodexThreads({
				agentId: selectedAgentId,
				vaultPath: vaultPath ?? undefined,
				includeExternal: includeExternalCodexHistory,
			});
			if (generation !== historyGenRef.current) return;
			setSessionHistory((prev) => {
				const existing = new Map(
					prev
						.filter((item) => item.agentId === selectedAgentId)
						.map((item) => [item.id, item]),
				);
				const imported = threads.map((thread) => {
					const current = existing.get(thread.id);
					const startedAt = (() => {
						const timestamp = Number(thread.updatedAt ?? thread.createdAt);
						return Number.isFinite(timestamp)
							? new Date(timestamp * 1000).toLocaleString(i18n.language)
							: "";
					})();
					if (current) {
						return {
							...current,
							agentName: selected?.name ?? "Codex",
							title: current.lines.length > 0 ? current.title : thread.title,
							startedAt: current.startedAt || startedAt,
						};
					}
					return {
						id: thread.id,
						agentId: selectedAgentId,
						title: thread.title,
						agentName: selected?.name ?? "Codex",
						startedAt,
						lines: [],
						status: "completed" as const,
					};
				});
				const importedIds = new Set(threads.map((thread) => thread.id));
				const localOnly = prev.filter(
					(item) =>
						item.agentId === selectedAgentId &&
						!importedIds.has(item.id) &&
						(item.status === "running" || item.lines.length > 0),
				);
				return [...localOnly, ...imported];
			});
		} catch {
			// History is supplementary: a failed scan must not block the Composer.
		}
	}, [
		includeExternalCodexHistory,
		i18n.language,
		isCodexAgent,
		selected?.name,
		selectedAgentId,
		vaultPath,
	]);

	useEffect(() => {
		void loadCodexHistory();
		return () => {
			historyGenRef.current += 1;
		};
	}, [loadCodexHistory]);

	const selectedModelName = useMemo(() => {
		if (!modelId) return null;
		return models.find((m) => m.id === modelId)?.name ?? modelId;
	}, [modelId, models]);

	const selectedVaultPath = useMemo(() => {
		if (!selectedPath) return null;
		const relative = toVaultRelative(vaultPath, selectedPath);
		return relative || null;
	}, [selectedPath, vaultPath]);

	const contextPaths = useMemo(() => {
		const paths = [
			...(includeSelectedFile && selectedVaultPath ? [selectedVaultPath] : []),
			...mentionedPaths,
		];
		return [...new Set(paths)];
	}, [includeSelectedFile, mentionedPaths, selectedVaultPath]);

	const mentionMatch = composerText.match(/(^|\s)@([^\s]*)$/);
	const mentionQuery = mentionMatch?.[2]?.toLocaleLowerCase() ?? "";
	const mentionOptions = useMemo(() => {
		if (!mentionMatch) return [];
		return vaultMarkdownPaths
			.filter((path) => path.toLocaleLowerCase().includes(mentionQuery))
			.filter((path) => !contextPaths.includes(path))
			.slice(0, 6);
	}, [contextPaths, mentionMatch, mentionQuery, vaultMarkdownPaths]);

	const skillMatch = composerText.match(/(^|\s)\$([^\s]*)$/);
	const skillQuery = skillMatch?.[2]?.toLocaleLowerCase() ?? "";
	const skillOptions = useMemo(() => {
		if (!skillMatch) return [];
		return skills
			.filter((skill) => {
				const searchable =
					`${skill.id} ${skill.name} ${skill.description}`.toLocaleLowerCase();
				return searchable.includes(skillQuery);
			})
			.filter((skill) => !selectedSkillIds.includes(skill.id))
			.slice(0, 6);
	}, [selectedSkillIds, skillMatch, skillQuery, skills]);

	const showMentionMenu = !composerMenuDismissed && mentionOptions.length > 0;
	const showSkillMenu = !composerMenuDismissed && skillOptions.length > 0;

	useEffect(() => {
		setMentionActiveIndex((index) =>
			mentionOptions.length
				? Math.max(0, Math.min(index, mentionOptions.length - 1))
				: 0,
		);
	}, [mentionOptions.length]);

	useEffect(() => {
		setSkillActiveIndex((index) =>
			skillOptions.length
				? Math.max(0, Math.min(index, skillOptions.length - 1))
				: 0,
		);
	}, [skillOptions.length]);

	const effortOptionsInDisplayOrder = useMemo(() => {
		const order = ["max", "xhigh", "high", "medium", "low"];
		return [...effortOptions].sort(
			(left, right) =>
				order.indexOf(left.id.toLocaleLowerCase()) -
				order.indexOf(right.id.toLocaleLowerCase()),
		);
	}, [effortOptions]);

	const formatEffort = (value: string) => {
		switch (value.toLocaleLowerCase()) {
			case "max":
				return t("composer.effort.max");
			case "xhigh":
				return t("composer.effort.xhigh");
			case "high":
				return t("composer.effort.high");
			case "medium":
				return t("composer.effort.medium");
			case "low":
				return t("composer.effort.low");
			default:
				return value;
		}
	};

	const selectedSkills = useMemo(
		() =>
			selectedSkillIds
				.map((id) => skills.find((skill) => skill.id === id))
				.filter((skill): skill is AgentSkill => Boolean(skill)),
		[selectedSkillIds, skills],
	);

	const conversationTabs = useMemo(
		() => [
			{ id: "draft", lines: null as ChatLine[] | null },
			...sessionHistory
				.filter((item) => item.lines.length > 0)
				.slice(0, 2)
				.map((item) => ({
					id: item.id,
					lines: item.lines,
				})),
		],
		[sessionHistory],
	);
	const activeTabSession = sessionHistory.find(
		(session) => session.id === activeTabId,
	);
	const activeTabIsRunning = activeTabSession?.status === "running";
	const activeUsage = usageBySession[activeTabId] ?? usage;
	const hasRunningSessions = sessionHistory.some(
		(session) => session.status === "running",
	);

	const pickModel = (id: string) => {
		setModelId(id);
		if (selectedAgentId) saveModelPref(selectedAgentId, id);
	};

	const selectAgent = async (opt: AgentOption) => {
		if (!isTauri() || switching || hasRunningSessions) return;
		if (opt.id && opt.id === selectedAgentId) return;

		setSwitching(true);
		try {
			let agentId = opt.id;
			if (!agentId && opt.templateId) {
				const agent = await ensureCatalogAgent(opt.templateId, true);
				agentId = agent.id;
			} else if (agentId) {
				await setDefaultAgent(agentId);
			} else {
				return;
			}
			setSelectedAgentId(agentId);
			await refresh();
			setLines((p) => [
				...p,
				{
					id: nextLineId("sys"),
					kind: "system",
					text: t("messages.switchedTo", { name: opt.name }),
				},
			]);
		} catch (e) {
			setLines((p) => [
				...p,
				{
					id: nextLineId("err"),
					kind: "error",
					text: e instanceof Error ? e.message : String(e),
				},
			]);
		} finally {
			setSwitching(false);
		}
	};

	const send = async (textRaw: string) => {
		const text = textRaw.trim();
		if (!text || activeTabIsRunning || submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		try {
			if (!isTauri()) {
				setLines((p) => [
					...p,
					{
						id: nextLineId("err"),
						kind: "error",
						text: t("messages.desktopOnly"),
					},
				]);
				return;
			}

			let agentId = selected?.id ?? registry?.defaultId ?? null;
			if (!agentId && selected?.templateId) {
				try {
					const agent = await ensureCatalogAgent(selected.templateId, true);
					agentId = agent.id;
					setSelectedAgentId(agentId);
					await refresh();
				} catch (e) {
					setLines((p) => [
						...p,
						{
							id: nextLineId("err"),
							kind: "error",
							text: e instanceof Error ? e.message : String(e),
						},
					]);
					return;
				}
			}

			if (!agentId) {
				setLines((p) => [
					...p,
					{
						id: nextLineId("sys"),
						kind: "system",
						text: t("messages.noAgent"),
					},
				]);
				return;
			}

			const agentOk =
				!selected ||
				selected.available ||
				registry?.agents.some((a) => a.id === agentId && a.available);
			if (!agentOk) {
				setLines((p) => [
					...p,
					{
						id: nextLineId("sys"),
						kind: "system",
						text: t("messages.notAvailable", {
							name: selected?.name ?? t("defaultName"),
						}),
					},
				]);
				return;
			}

			const prompt = contextPaths.length
				? `${text}\n\n${t("composer.contextInstruction")}\n${contextPaths
						.map((path) => `- ${path}`)
						.join("\n")}`
				: text;
			const userLine: ChatLine = { id: nextLineId("user"), kind: "user", text };
			const sessionStartLines = [...lines, userLine];
			setLines(sessionStartLines);
			const accepted = await runOnce({
				agentId,
				sessionId: isCodexAgent
					? (activeConversationRef.current ?? undefined)
					: undefined,
				prompt,
				vaultPath: vaultPath ?? undefined,
				workflow: "free",
				target: contextPaths[0],
				modelId: modelId ?? undefined,
				reasoningEffort:
					isCodexAgent && reasoningEffort ? reasoningEffort : undefined,
				fastMode: isCodexAgent && fastAvailable ? fastEnabled : undefined,
				skillIds: selectedSkillIds,
				autoApprove: yoloEnabled,
			});
			const agentLine: ChatLine = {
				id: nextLineId("agent"),
				kind: "agent",
				text: "",
				streaming: true,
				tools: [],
				plan: [],
			};
			const pendingLines = [...sessionStartLines, agentLine];
			if (isCodexAgent) activeConversationRef.current = accepted.sessionId;
			activeTabRef.current = accepted.sessionId;
			setActiveTabId(accepted.sessionId);
			setSessionHistory((prev) => [
				{
					id: accepted.sessionId,
					agentId,
					title: text,
					agentName: selected?.name ?? t("defaultName"),
					startedAt: new Date().toLocaleString(i18n.language),
					lines: pendingLines,
					status: "running",
				},
				...prev.filter((item) => item.id !== accepted.sessionId),
			]);
			setLines(pendingLines);
		} catch (e) {
			setLines((p) => [
				...p,
				{
					id: nextLineId("err"),
					kind: "error",
					text: e instanceof Error ? e.message : String(e),
				},
			]);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	};

	const cancelCurrentRun = async () => {
		const sessionId = activeTabIsRunning ? activeTabId : null;
		if (!sessionId || !isTauri()) return;
		try {
			await cancelAgentRun(sessionId);
		} catch (error) {
			setLines((prev) => [
				...prev,
				{
					id: nextLineId("err"),
					kind: "error",
					text: error instanceof Error ? error.message : String(error),
				},
			]);
		}
	};

	const attachMention = (path: string) => {
		setMentionedPaths((prev) => [...new Set([...prev, path])]);
		setComposerMenuDismissed(true);
		setComposerText((prev) =>
			prev.replace(/(^|\s)@[^\s]*$/, (_match, prefix: string) => `${prefix}`),
		);
	};

	const removeContextPath = (path: string) => {
		if (path === selectedVaultPath) {
			setIncludeSelectedFile(false);
			return;
		}
		setMentionedPaths((prev) => prev.filter((item) => item !== path));
	};

	const attachSkill = (skill: AgentSkill) => {
		setSelectedSkillIds((prev) => [...new Set([...prev, skill.id])]);
		setComposerMenuDismissed(true);
		setComposerText((prev) =>
			prev.replace(/(^|\s)\$[^\s]*$/, (_match, prefix: string) => `${prefix}`),
		);
	};

	const handleComposerMenuKeyDown = (
		event: KeyboardEvent<HTMLTextAreaElement>,
	) => {
		if (event.key === "Escape" && activeTabIsRunning) {
			event.preventDefault();
			void cancelCurrentRun();
			return;
		}

		if (event.key === "Escape" && (showMentionMenu || showSkillMenu)) {
			event.preventDefault();
			setComposerMenuDismissed(true);
			return;
		}

		if (showMentionMenu) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				setMentionActiveIndex((index) =>
					event.key === "ArrowDown"
						? (index + 1) % mentionOptions.length
						: (index - 1 + mentionOptions.length) % mentionOptions.length,
				);
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				const path = mentionOptions[mentionActiveIndex] ?? mentionOptions[0];
				if (path) attachMention(path);
			}
			return;
		}

		if (showSkillMenu) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				setSkillActiveIndex((index) =>
					event.key === "ArrowDown"
						? (index + 1) % skillOptions.length
						: (index - 1 + skillOptions.length) % skillOptions.length,
				);
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				const skill = skillOptions[skillActiveIndex] ?? skillOptions[0];
				if (skill) attachSkill(skill);
			}
		}
	};

	const newConversation = () => {
		setLines([]);
		setComposerText("");
		setMentionedPaths([]);
		setSelectedSkillIds([]);
		setIncludeSelectedFile(Boolean(selectedVaultPath));
		setActiveTabId("draft");
		activeTabRef.current = "draft";
		activeConversationRef.current = null;
	};

	return (
		<div
			className={cn("flex h-full min-h-0 flex-col bg-background", className)}
		>
			<div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
				<div
					className="flex min-w-0 flex-1 items-center gap-1.5"
					role="tablist"
					aria-label={title}
				>
					{conversationTabs.map((tab, index) => (
						<button
							key={tab.id}
							type="button"
							role="tab"
							aria-label={t("tabs.open", { number: index + 1 })}
							aria-selected={activeTabId === tab.id}
							className={cn(
								"grid size-8 place-items-center rounded-md border text-sm font-medium text-muted-foreground transition-colors",
								activeTabId === tab.id
									? "border-primary bg-background text-foreground ring-1 ring-primary"
									: "border-border bg-muted/30 hover:bg-muted hover:text-foreground",
							)}
							onClick={() => {
								activeTabRef.current = tab.id;
								setActiveTabId(tab.id);
								setLines(tab.lines ?? []);
								if (isCodexAgent) {
									activeConversationRef.current =
										tab.id === "draft" ? null : tab.id;
								}
							}}
						>
							{index + 1}
						</button>
					))}
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger
						asChild
						disabled={hasRunningSessions || switching}
					>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={t("switchAgent")}
							title={t("switchAgent")}
						>
							<Bot className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-[200px]">
						<DropdownMenuLabel className="text-muted-foreground text-xs">
							{t("agentMenu.title")}
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{options.length === 0 ? (
							<div className="px-2 py-1.5 text-muted-foreground text-xs">
								{t("agentMenu.empty")}
							</div>
						) : (
							options.map((opt) => {
								const isActive =
									selected?.key === opt.key ||
									(opt.id !== null && opt.id === selectedAgentId);
								return (
									<DropdownMenuItem
										key={opt.key}
										className="flex items-center justify-between gap-2"
										onSelect={() => void selectAgent(opt)}
									>
										<span className="min-w-0 truncate">{opt.name}</span>
										{isActive ? (
											<Check className="size-3.5 shrink-0 opacity-80" />
										) : null}
									</DropdownMenuItem>
								);
							})
						)}
					</DropdownMenuContent>
				</DropdownMenu>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={t("tabs.new")}
					title={t("tabs.new")}
					onClick={newConversation}
				>
					<PencilLine className="size-4" />
				</Button>
				<Popover open={historyOpen} onOpenChange={setHistoryOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 gap-1 px-1.5 font-normal text-muted-foreground text-sm leading-none hover:text-foreground"
							aria-label={t("history.aria")}
							title={t("history.label")}
						>
							<History className="size-3.5" />
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" className="w-80 p-0">
						<PopoverHeader className="border-b px-3 py-2">
							<div className="flex items-center justify-between gap-3">
								<PopoverTitle className="font-medium text-sm leading-none">
									{t("history.title")}
								</PopoverTitle>
								{isCodexAgent && (
									<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
										<span>{t("history.includeExternal")}</span>
										<Switch
											size="sm"
											checked={includeExternalCodexHistory}
											onCheckedChange={(enabled) => {
												setIncludeExternalCodexHistory(enabled);
												if (selectedAgentId) {
													saveExternalCodexHistoryPref(
														selectedAgentId,
														enabled,
													);
												}
											}}
											aria-label={t("history.includeExternalToggle")}
										/>
									</div>
								)}
							</div>
							<PopoverDescription className="text-muted-foreground text-sm leading-snug">
								{t("history.description")}
							</PopoverDescription>
						</PopoverHeader>
						{sessionHistory.length === 0 ? (
							<div className="px-3 py-4 text-muted-foreground text-sm leading-none">
								{t("history.empty")}
							</div>
						) : (
							<div className="max-h-72 overflow-y-auto p-1.5">
								{sessionHistory.map((item) => (
									<button
										key={item.id}
										type="button"
										className="flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
										onClick={() => {
											setHistoryOpen(false);
											if (!isCodexAgent || item.lines.length > 0) {
												setLines(item.lines);
												activeTabRef.current = item.id;
												setActiveTabId(item.id);
												if (isCodexAgent) {
													activeConversationRef.current = item.id;
												}
												return;
											}
											void (async () => {
												try {
													const history = await readCodexThread({
														agentId: selectedAgentId ?? undefined,
														threadId: item.id,
														vaultPath: vaultPath ?? undefined,
														includeExternal: includeExternalCodexHistory,
													});
													const lines: ChatLine[] = history.lines.map(
														(line) => {
															if (line.kind === "user") {
																return {
																	id: line.id,
																	kind: "user",
																	text: line.text,
																};
															}
															return {
																id: line.id,
																kind: "agent",
																text: line.text,
																reasoning: line.reasoning ?? undefined,
															};
														},
													);
													setSessionHistory((prev) =>
														prev.map((entry) =>
															entry.id === item.id
																? {
																		...entry,
																		title: history.thread.title,
																		lines,
																	}
																: entry,
														),
													);
													activeConversationRef.current = item.id;
													activeTabRef.current = item.id;
													setActiveTabId(item.id);
													setLines(lines);
												} catch (error) {
													setLines((prev) => [
														...prev,
														{
															id: nextLineId("err"),
															kind: "error",
															text:
																error instanceof Error
																	? error.message
																	: String(error),
														},
													]);
												}
											})();
										}}
									>
										<span className="text-muted-foreground text-sm leading-none">
											{item.agentName} · {t(`history.status.${item.status}`)} ·{" "}
											{item.id.slice(0, 8)}
										</span>
										<span className="line-clamp-2 font-medium text-sm leading-snug">
											{item.title}
										</span>
										<span className="text-muted-foreground text-sm leading-none">
											{item.startedAt}
										</span>
									</button>
								))}
							</div>
						)}
					</PopoverContent>
				</Popover>
				{headerActions}
			</div>

			<Conversation className="min-h-0">
				<ConversationContent>
					{lines.length === 0 ? (
						<ConversationEmptyState
							title={t("empty.title")}
							description={t("empty.description")}
						>
							<div className="mt-4 flex w-full max-w-sm flex-col items-stretch gap-2">
								{activeTabIsRunning ? (
									<Shimmer className="text-center text-sm">
										{t("empty.waiting")}
									</Shimmer>
								) : (
									SUGGESTION_KEYS.map((key) => {
										const label = t(`suggestions.${key}`);
										return (
											<Suggestion
												key={key}
												suggestion={label}
												className="h-auto w-full justify-start whitespace-normal rounded-lg px-3 py-2.5 text-left"
												onClick={(v) => void send(v)}
												disabled={activeTabIsRunning}
											/>
										);
									})
								)}
							</div>
						</ConversationEmptyState>
					) : (
						lines.map((line) => {
							if (line.kind === "user") {
								return (
									<Message key={line.id} from="user">
										<MessageContent>
											<MessageResponse>{line.text}</MessageResponse>
										</MessageContent>
										{/* Align under user bubble (Message is full-width) */}
										<MessageActions className="-mt-1 ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
											<MessageAction
												tooltip={t("copy")}
												label={t("copy")}
												onClick={() => void copyText(line.text)}
											>
												<CopyIcon className="size-3.5" />
											</MessageAction>
										</MessageActions>
									</Message>
								);
							}
							if (line.kind === "agent") {
								const hasReasoning =
									Boolean(line.reasoning?.trim()) ||
									Boolean(line.reasoningStreaming);
								const tools = line.tools ?? [];
								const plan = line.plan ?? [];
								const planStreaming =
									Boolean(line.streaming) &&
									plan.some((p) => p.status !== "completed");
								return (
									<div key={line.id} className="flex w-full flex-col gap-2">
										<Message from="assistant">
											<MessageContent>
												<p className="mb-1 font-medium text-muted-foreground text-xs">
													{selected?.name ?? t("defaultName")}
												</p>
												{hasReasoning ? (
													<Reasoning
														className="mb-2"
														isStreaming={Boolean(line.reasoningStreaming)}
													>
														<ReasoningTrigger />
														<ReasoningContent>
															{line.reasoning ?? ""}
														</ReasoningContent>
													</Reasoning>
												) : null}
												{plan.length > 0 ? (
													<Plan
														className="mb-2"
														defaultOpen
														isStreaming={planStreaming}
													>
														<PlanHeader>
															<div className="min-w-0 flex-1 space-y-1">
																<PlanTitle>{t("plan.title")}</PlanTitle>
																<PlanDescription>
																	{t("plan.steps", {
																		completed: plan.filter(
																			(p) => p.status === "completed",
																		).length,
																		total: plan.length,
																	})}
																</PlanDescription>
															</div>
															<PlanAction>
																<PlanTrigger />
															</PlanAction>
														</PlanHeader>
														<PlanContent className="space-y-2 pt-0">
															{plan.map((entry) => (
																<div
																	key={`${entry.status}:${entry.priority}:${entry.content}`}
																	className="flex items-start gap-2 text-sm"
																>
																	<span
																		className={cn(
																			"mt-1 size-1.5 shrink-0 rounded-full",
																			entry.status === "completed" &&
																				"bg-emerald-500",
																			entry.status === "in_progress" &&
																				"bg-amber-500",
																			entry.status === "pending" &&
																				"bg-muted-foreground/40",
																		)}
																	/>
																	<span
																		className={cn(
																			entry.status === "completed" &&
																				"text-muted-foreground line-through",
																		)}
																	>
																		{entry.content}
																	</span>
																</div>
															))}
														</PlanContent>
													</Plan>
												) : null}
												{tools.map((tool) => {
													const state = toolPartState(tool.status);
													return (
														<Tool key={tool.id} defaultOpen={false}>
															<ToolHeader
																title={tool.title || t("tool.defaultTitle")}
																type={`tool-${tool.kind}`}
																state={state}
															/>
															<ToolContent>
																{tool.input !== undefined ? (
																	<ToolInput input={tool.input} />
																) : null}
																<ToolOutput
																	output={tool.output}
																	errorText={
																		tool.status === "failed"
																			? t("tool.failed")
																			: undefined
																	}
																/>
															</ToolContent>
														</Tool>
													);
												})}
												{line.text ? (
													<div className="min-w-0">
														<MessageResponse
															isAnimating={Boolean(
																line.streaming && line.text.length > 0,
															)}
														>
															{line.text}
														</MessageResponse>
														{!line.streaming &&
														line.sources &&
														line.sources.length > 0 ? (
															<span className="mt-1 inline-flex items-center">
																<InlineCitation>
																	<InlineCitationCard>
																		<InlineCitationCardTrigger
																			sources={line.sources}
																		/>
																		<InlineCitationCardBody>
																			<InlineCitationCarousel>
																				<InlineCitationCarouselHeader>
																					<InlineCitationCarouselPrev />
																					<InlineCitationCarouselNext />
																					<InlineCitationCarouselIndex />
																				</InlineCitationCarouselHeader>
																				<InlineCitationCarouselContent>
																					{line.sources.map((s) => (
																						<InlineCitationCarouselItem key={s}>
																							<InlineCitationSource
																								title={
																									s.split(/[/\\]/).pop() || s
																								}
																								url={s}
																								description={
																									/^https?:\/\//i.test(s)
																										? undefined
																										: t("citation.vaultPath")
																								}
																							/>
																						</InlineCitationCarouselItem>
																					))}
																				</InlineCitationCarouselContent>
																			</InlineCitationCarousel>
																		</InlineCitationCardBody>
																	</InlineCitationCard>
																</InlineCitation>
															</span>
														) : null}
													</div>
												) : line.streaming &&
													!hasReasoning &&
													tools.length === 0 &&
													plan.length === 0 ? (
													<Shimmer className="text-sm">{t("thinking")}</Shimmer>
												) : null}
											</MessageContent>
											{!line.streaming && line.text ? (
												<MessageActions className="-mt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
													<MessageAction
														tooltip={t("copy")}
														label={t("copy")}
														onClick={() => void copyText(line.text)}
													>
														<CopyIcon className="size-3.5" />
													</MessageAction>
												</MessageActions>
											) : null}
										</Message>
										{line.sources && line.sources.length > 0 ? (
											<Sources>
												<SourcesTrigger count={line.sources.length} />
												<SourcesContent>
													{line.sources.map((s) => (
														<Source
															key={s}
															title={s}
															href={`#${encodeURIComponent(s)}`}
														/>
													))}
												</SourcesContent>
											</Sources>
										) : null}
									</div>
								);
							}
							if (line.kind === "error") {
								return (
									<p
										key={line.id}
										className="px-1 text-center text-destructive text-xs"
									>
										{line.text}
									</p>
								);
							}
							return (
								<Checkpoint key={line.id} className="my-1 px-1">
									<CheckpointIcon />
									<CheckpointTrigger
										className="h-auto px-1 py-0.5 text-muted-foreground text-xs"
										variant="ghost"
										tooltip={line.text}
									>
										{line.text}
									</CheckpointTrigger>
								</Checkpoint>
							);
						})
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<div className="shrink-0 space-y-2 border-t bg-muted/10 p-3">
				{lines.length > 0 && !activeTabIsRunning ? (
					<Suggestions>
						{SUGGESTION_KEYS.map((key) => {
							const label = t(`suggestions.${key}`);
							return (
								<Suggestion
									key={key}
									suggestion={label}
									onClick={(v) => void send(v)}
									disabled={activeTabIsRunning}
								/>
							);
						})}
					</Suggestions>
				) : null}
				<PromptInput
					className="w-full rounded-xl border-border bg-background shadow-none"
					inputGroupClassName="overflow-visible"
					onSubmit={({ text }) => {
						if (!activeTabIsRunning && !submittingRef.current) {
							void send(text);
							setComposerText("");
						}
					}}
				>
					<PromptInputBody>
						<div className="relative flex min-h-[154px] w-full flex-col px-3 pt-3">
							{contextPaths.length > 0 ? (
								<div className="mb-2 flex flex-wrap gap-1.5">
									{contextPaths.map((path) => (
										<button
											key={path}
											type="button"
											className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-muted/20 px-2 text-foreground text-xs transition-colors hover:bg-muted"
											onClick={() => removeContextPath(path)}
											title={t("composer.removeContext", { path })}
										>
											<FileText className="size-3.5 shrink-0 text-muted-foreground" />
											<span className="truncate">{path.split("/").at(-1)}</span>
											<X className="size-3 shrink-0 text-muted-foreground" />
										</button>
									))}
								</div>
							) : null}
							{selectedSkills.length > 0 ? (
								<div className="mb-2 flex flex-wrap gap-1.5">
									{selectedSkills.map((skill) => (
										<button
											key={skill.id}
											type="button"
											className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-muted/20 px-2 text-foreground text-xs transition-colors hover:bg-muted"
											onClick={() =>
												setSelectedSkillIds((prev) =>
													prev.filter((id) => id !== skill.id),
												)
											}
											title={t("composer.removeSkill", { skill: skill.name })}
										>
											<span className="font-mono text-muted-foreground">$</span>
											<span className="truncate">{skill.name}</span>
											<X className="size-3 shrink-0 text-muted-foreground" />
										</button>
									))}
								</div>
							) : null}
							{showMentionMenu ? (
								<div
									id="agent-mention-menu"
									role="listbox"
									className="absolute right-3 bottom-full left-3 z-20 mb-2 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
								>
									{mentionOptions.map((path, index) => (
										<button
											key={path}
											id={`agent-mention-option-${index}`}
											type="button"
											role="option"
											aria-selected={mentionActiveIndex === index}
											className={cn(
												"flex w-full items-center gap-2 rounded-md border-l-2 border-transparent px-2 py-1.5 text-left text-sm focus-visible:outline-none",
												mentionActiveIndex === index
													? "border-primary bg-muted"
													: "hover:bg-muted/70",
											)}
											onMouseEnter={() => setMentionActiveIndex(index)}
											onClick={() => attachMention(path)}
										>
											<FileText className="size-3.5 shrink-0 text-muted-foreground" />
											<span className="truncate">{path}</span>
										</button>
									))}
								</div>
							) : null}
							{showSkillMenu ? (
								<div
									id="agent-skill-menu"
									role="listbox"
									className="absolute right-3 bottom-full left-3 z-20 mb-2 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
								>
									{skillOptions.map((skill, index) => (
										<button
											key={skill.id}
											id={`agent-skill-option-${index}`}
											type="button"
											role="option"
											aria-selected={skillActiveIndex === index}
											className={cn(
												"flex w-full items-center gap-2 rounded-md border-l-2 border-transparent px-2 py-1.5 text-left text-sm focus-visible:outline-none",
												skillActiveIndex === index
													? "border-primary bg-muted"
													: "hover:bg-muted/70",
											)}
											onMouseEnter={() => setSkillActiveIndex(index)}
											onClick={() => attachSkill(skill)}
										>
											<span className="font-mono text-muted-foreground">$</span>
											<span className="min-w-0 flex-1 truncate">
												{skill.name}
											</span>
											{skill.description ? (
												<span className="max-w-40 truncate text-muted-foreground text-xs">
													{skill.description}
												</span>
											) : null}
										</button>
									))}
								</div>
							) : null}
							<PromptInputTextarea
								autoFocus={autoFocus || undefined}
								className="min-h-[82px] px-0 py-1 text-[15px] leading-6 placeholder:text-muted-foreground/80"
								value={composerText}
								onChange={(event) => {
									setComposerText(event.currentTarget.value);
									setComposerMenuDismissed(false);
									setMentionActiveIndex(0);
									setSkillActiveIndex(0);
								}}
								onKeyDown={handleComposerMenuKeyDown}
								aria-expanded={showMentionMenu || showSkillMenu}
								aria-autocomplete="list"
								aria-controls={
									showMentionMenu
										? "agent-mention-menu"
										: showSkillMenu
											? "agent-skill-menu"
											: undefined
								}
								aria-activedescendant={
									showMentionMenu
										? `agent-mention-option-${mentionActiveIndex}`
										: showSkillMenu
											? `agent-skill-option-${skillActiveIndex}`
											: undefined
								}
								role="combobox"
								placeholder={
									activeTabIsRunning
										? t("composer.interruptHint")
										: t("composer.placeholder")
								}
							/>
						</div>
					</PromptInputBody>
					<PromptInputFooter className="gap-2 px-3 pb-2.5">
						<PromptInputTools className="gap-1.5">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<PromptInputButton
										type="button"
										className="h-7 max-w-[10rem] gap-1 px-1.5 text-xs font-medium text-muted-foreground"
										disabled={activeTabIsRunning || models.length === 0}
										tooltip={
											models.length > 0
												? t("models.selectTooltip")
												: t("models.reportedTooltip")
										}
									>
										<span className="truncate text-xs">
											{selectedModelName ??
												(warming ? t("models.loading") : t("models.button"))}
										</span>
										<ChevronDown className="size-3 shrink-0 opacity-70" />
									</PromptInputButton>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="min-w-44 p-1">
									{models.map((model) => (
										<DropdownMenuItem
											key={model.id}
											className={cn(
												"justify-between rounded-md",
												modelId === model.id && "bg-muted",
											)}
											onSelect={() => pickModel(model.id)}
										>
											<span className="truncate">{model.name}</span>
											{modelId === model.id ? (
												<CheckIcon className="size-3.5 text-muted-foreground" />
											) : null}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
							{isCodexAgent && effortOptionsInDisplayOrder.length > 0 ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<PromptInputButton
											type="button"
											className="h-7 gap-1 px-1.5 text-xs font-medium text-muted-foreground"
											disabled={activeTabIsRunning}
											tooltip={t("composer.effortTooltip")}
										>
											{t("composer.effort.label")}:{" "}
											{formatEffort(reasoningEffort ?? "medium")}
											<ChevronDown className="size-3 shrink-0 opacity-70" />
										</PromptInputButton>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="min-w-28 p-1">
										{effortOptionsInDisplayOrder.map((effort) => (
											<DropdownMenuItem
												key={effort.id}
												className={cn(
													"justify-between rounded-md",
													reasoningEffort === effort.id && "bg-muted",
												)}
												onSelect={() => setReasoningEffort(effort.id)}
											>
												{formatEffort(effort.id)}
												{reasoningEffort === effort.id ? (
													<CheckIcon className="size-3.5 text-muted-foreground" />
												) : null}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
							) : null}
							{activeUsage && activeUsage.size > 0 ? (
								<Context
									usedTokens={activeUsage.used}
									maxTokens={activeUsage.size}
								>
									<ContextTrigger className="h-7 gap-1 px-1.5 text-xs" />
									<ContextContent>
										<ContextContentHeader />
									</ContextContent>
								</Context>
							) : null}
							<PromptInputButton
								type="button"
								className={cn(
									"size-7 text-muted-foreground",
									includeSelectedFile &&
										selectedVaultPath &&
										"bg-muted text-foreground",
								)}
								disabled={!selectedVaultPath || activeTabIsRunning}
								onClick={() => setIncludeSelectedFile((current) => !current)}
								tooltip={t("composer.toggleCurrentFile")}
							>
								<FolderOpen className="size-4" />
							</PromptInputButton>
							{isCodexAgent && fastAvailable ? (
								<PromptInputButton
									type="button"
									className={cn(
										"size-7 text-muted-foreground",
										fastEnabled && "text-amber-500 hover:text-amber-500",
									)}
									aria-pressed={fastEnabled}
									disabled={activeTabIsRunning}
									onClick={() => setFastEnabled((current) => !current)}
									tooltip={t("composer.fastToggle")}
								>
									<Zap
										className={cn(
											"size-3.5",
											fastEnabled &&
												"fill-amber-400 text-amber-500 dark:fill-amber-300 dark:text-amber-300",
										)}
									/>
								</PromptInputButton>
							) : null}
							<div
								className={cn(
									"flex h-7 items-center gap-1.5 px-1.5 text-muted-foreground text-xs font-medium",
									yoloEnabled && "text-orange-700 dark:text-orange-300",
								)}
								title={
									yoloEnabled
										? t("composer.yoloEnabled")
										: t("composer.yoloDisabled")
								}
							>
								<span>{t("composer.yolo")}</span>
								<Switch
									size="sm"
									checked={yoloEnabled}
									disabled={activeTabIsRunning}
									onCheckedChange={(enabled) => {
										setYoloEnabled(enabled);
										if (selectedAgentId) saveYoloPref(selectedAgentId, enabled);
									}}
									aria-label={t("composer.yoloToggle")}
								/>
							</div>
						</PromptInputTools>
						<PromptInputSubmit
							status={
								activeTabIsRunning
									? "streaming"
									: submitting
										? "submitted"
										: "ready"
							}
							onStop={() => void cancelCurrentRun()}
							disabled={
								!activeTabIsRunning && (submitting || !composerText.trim())
							}
						/>
					</PromptInputFooter>
				</PromptInput>
			</div>
		</div>
	);
}
