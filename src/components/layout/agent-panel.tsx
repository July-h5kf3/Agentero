import type { ToolUIPart } from "ai";
import {
	Check,
	CheckIcon,
	ChevronDown,
	CopyIcon,
	Loader2,
	X,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
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
	Task,
	TaskContent,
	TaskItem,
	TaskTrigger,
} from "@/components/ai-elements/task";
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
	type AgentListResponse,
	type AgentModelChoice,
	type AgentPlanEntry,
	type CatalogScanResponse,
	ensureCatalogAgent,
	listAgents,
	listenAgentCompleted,
	listenAgentFailed,
	listenAgentModels,
	listenAgentPlan,
	listenAgentStream,
	listenAgentTool,
	listenAgentUsage,
	loadModelCatalog,
	loadModelPref,
	runOnce,
	saveModelCatalog,
	saveModelPref,
	scanCatalog,
	setDefaultAgent,
	warmAgent,
} from "@/lib/agent";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";

type AgentPanelProps = {
	vaultPath: string | null;
	className?: string;
	headerActions?: ReactNode;
	onClose?: () => void;
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

let chatLineSeq = 0;
function nextLineId(prefix: string) {
	chatLineSeq += 1;
	return `${prefix}-${chatLineSeq}`;
}

/** Empty-state suggestion chips — one per row (3 lines). */
const SUGGESTIONS = [
	"Summarize the open paper",
	"List key claims and evidence",
	"Find related notes in this vault",
];

type AgentOption = {
	key: string;
	id: string | null;
	templateId: string | null;
	name: string;
	available: boolean;
	isDefault: boolean;
	source: "registry" | "catalog";
};

function buildOptions(
	registry: AgentListResponse | null,
	catalog: CatalogScanResponse | null,
): AgentOption[] {
	const options: AgentOption[] = [];
	const seenIds = new Set<string>();

	if (catalog) {
		for (const e of catalog.entries) {
			const id = e.registeredId ?? null;
			if (id) seenIds.add(id);
			options.push({
				key: `catalog:${e.templateId}`,
				id,
				templateId: e.templateId,
				name: e.name,
				available:
					e.acpStatus === "ready" || e.binaryAvailable || e.acpCommandAvailable,
				isDefault: e.isDefault,
				source: "catalog",
			});
		}
		for (const a of catalog.customAgents) {
			if (seenIds.has(a.id)) continue;
			seenIds.add(a.id);
			options.push({
				key: `reg:${a.id}`,
				id: a.id,
				templateId: null,
				name: a.name,
				available: a.available || a.lastProbeOk === true,
				isDefault: catalog.defaultId === a.id,
				source: "registry",
			});
		}
	}

	if (registry) {
		for (const a of registry.agents) {
			if (seenIds.has(a.id)) continue;
			seenIds.add(a.id);
			options.push({
				key: `reg:${a.id}`,
				id: a.id,
				templateId: null,
				name: a.name,
				available: a.available || a.lastProbeOk === true,
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
	if (selectedId) {
		const byId = options.find((o) => o.id === selectedId);
		if (byId) return byId;
	}
	const def = options.find((o) => o.isDefault);
	if (def) return def;
	if (registry?.defaultId) {
		return options.find((o) => o.id === registry.defaultId);
	}
	return options.find((o) => o.available) ?? options[0];
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
		title: patch.title ?? prev?.title ?? "Tool",
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

export function AgentPanel({
	vaultPath,
	className,
	headerActions,
	onClose,
	autoFocus = false,
	title = "Chat",
}: AgentPanelProps) {
	const [registry, setRegistry] = useState<AgentListResponse | null>(null);
	const [catalog, setCatalog] = useState<CatalogScanResponse | null>(null);
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [lines, setLines] = useState<ChatLine[]>([]);
	const [busy, setBusy] = useState(false);
	const [switching, setSwitching] = useState(false);
	const [usage, setUsage] = useState<{ used: number; size: number } | null>(
		null,
	);
	const [modelOpen, setModelOpen] = useState(false);
	const [models, setModels] = useState<AgentModelChoice[]>([]);
	const [modelId, setModelId] = useState<string | null>(null);
	const [warming, setWarming] = useState(false);
	const activeSessionRef = useRef<string | null>(null);
	const selectedAgentIdRef = useRef<string | null>(null);
	const warmGenRef = useRef(0);

	const applyModelsEvent = useCallback(
		(ev: {
			agentId: string;
			configId: string;
			currentId: string;
			models: AgentModelChoice[];
		}) => {
			if (ev.models.length === 0) return;
			saveModelCatalog(ev.agentId, {
				configId: ev.configId,
				currentId: ev.currentId,
				models: ev.models,
			});
			const cur = selectedAgentIdRef.current;
			if (cur && cur !== ev.agentId) return;
			setModels(ev.models);
			setModelId((prev) => {
				const pref = loadModelPref(ev.agentId);
				if (pref && ev.models.some((m) => m.id === pref)) return pref;
				if (prev && ev.models.some((m) => m.id === prev)) return prev;
				return ev.currentId || ev.models[0]?.id || null;
			});
		},
		[],
	);

	const refresh = useCallback(async () => {
		if (!isTauri()) return;
		try {
			const [list, scan] = await Promise.all([listAgents(), scanCatalog()]);
			setRegistry(list);
			setCatalog(scan);
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
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Restore last model catalog / preference for the selected agent.
	useEffect(() => {
		selectedAgentIdRef.current = selectedAgentId;
		if (!selectedAgentId) {
			setModels([]);
			setModelId(null);
			return;
		}
		const catalog = loadModelCatalog(selectedAgentId);
		const pref = loadModelPref(selectedAgentId);
		if (catalog?.models.length) {
			setModels(catalog.models);
			const preferred =
				(pref && catalog.models.some((m) => m.id === pref) && pref) ||
				catalog.currentId ||
				catalog.models[0]?.id ||
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

		void (async () => {
			const u1 = await listenAgentStream((ev) => {
				const cur = activeSessionRef.current;
				if (cur && cur !== ev.sessionId) return;
				const streamKind = ev.kind ?? "message";
				setLines((prev) => {
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
				const cur = activeSessionRef.current;
				if (cur && cur !== ev.sessionId) return;
				setLines((prev) => {
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
				const cur = activeSessionRef.current;
				if (cur && cur !== ev.sessionId) return;
				setLines((prev) => {
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
				const cur = activeSessionRef.current;
				if (cur && cur !== ev.sessionId) return;
				if (ev.size > 0) setUsage({ used: ev.used, size: ev.size });
			});
			const uModels = await listenAgentModels((ev) => {
				applyModelsEvent(ev);
			});
			const u2 = await listenAgentCompleted((ev) => {
				if (
					activeSessionRef.current &&
					activeSessionRef.current !== ev.sessionId
				) {
					return;
				}
				setBusy(false);
				activeSessionRef.current = null;
				setLines((prev) => {
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
						next[next.length - 1] = {
							...last,
							text,
							reasoning,
							reasoningStreaming: false,
							sources: ev.sources,
							streaming: false,
						};
						return next;
					}
					return prev;
				});
			});
			const u3 = await listenAgentFailed((ev) => {
				if (
					activeSessionRef.current &&
					activeSessionRef.current !== ev.sessionId
				) {
					return;
				}
				setBusy(false);
				activeSessionRef.current = null;
				setLines((prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === "agent" && last.streaming) {
						next.pop();
					}
					return [
						...next,
						{ id: nextLineId("err"), kind: "error", text: ev.error },
					];
				});
			});

			if (cancelled) {
				u1();
				uTool();
				uPlan();
				uUsage();
				uModels();
				u2();
				u3();
				return;
			}
			unsubs.push(u1, uTool, uPlan, uUsage, uModels, u2, u3);
		})();

		return () => {
			cancelled = true;
			for (const u of unsubs) u();
		};
	}, [applyModelsEvent]);

	const options = buildOptions(registry, catalog);
	const selected = resolveSelected(options, selectedAgentId, registry);

	const modelGroups = useMemo(() => {
		const groups = new Map<string, AgentModelChoice[]>();
		for (const m of models) {
			const g = m.group?.trim() || "Models";
			const list = groups.get(g) ?? [];
			list.push(m);
			groups.set(g, list);
		}
		return [...groups.entries()];
	}, [models]);

	const selectedModelName = useMemo(() => {
		if (!modelId) return null;
		return models.find((m) => m.id === modelId)?.name ?? modelId;
	}, [modelId, models]);

	const pickModel = (id: string) => {
		setModelId(id);
		setModelOpen(false);
		if (selectedAgentId) saveModelPref(selectedAgentId, id);
	};

	const selectAgent = async (opt: AgentOption) => {
		if (!isTauri() || switching || busy) return;
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
					text: `Switched to ${opt.name}`,
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
		if (!text || busy) return;
		if (!isTauri()) {
			setLines((p) => [
				...p,
				{
					id: nextLineId("err"),
					kind: "error",
					text: "Open the desktop app to run agents.",
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
					text: "No available agent. Open Settings → Agent to configure one.",
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
					text: `${selected?.name ?? "Agent"} is not available. Pick another or open Settings → Agent.`,
				},
			]);
			return;
		}

		setLines((p) => [...p, { id: nextLineId("user"), kind: "user", text }]);
		setBusy(true);
		try {
			const accepted = await runOnce({
				agentId,
				prompt: text,
				vaultPath: vaultPath ?? undefined,
				workflow: "free",
				modelId: modelId ?? undefined,
			});
			activeSessionRef.current = accepted.sessionId;
			setLines((p) => [
				...p,
				{
					id: nextLineId("agent"),
					kind: "agent",
					text: "",
					streaming: true,
					tools: [],
					plan: [],
				},
			]);
		} catch (e) {
			setBusy(false);
			setLines((p) => [
				...p,
				{
					id: nextLineId("err"),
					kind: "error",
					text: e instanceof Error ? e.message : String(e),
				},
			]);
		}
	};

	const labelName = selected?.name ?? "not configured";
	const labelMissing = selected && !selected.available;

	return (
		<div
			className={cn("flex h-full min-h-0 flex-col bg-background", className)}
		>
			<div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
				<div className="flex min-w-0 flex-1 items-center gap-1.5">
					<span className="shrink-0 font-medium text-sm">{title}</span>
					<span className="shrink-0 text-muted-foreground text-xs">·</span>
					<DropdownMenu>
						<DropdownMenuTrigger asChild disabled={busy || switching}>
							<button
								type="button"
								className={cn(
									"inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-md px-1 py-0.5 text-left outline-none",
									"font-normal text-muted-foreground text-xs",
									"hover:bg-muted hover:text-foreground",
									"focus-visible:ring-1 focus-visible:ring-ring",
									"disabled:opacity-50",
								)}
								aria-label="Switch ACP agent"
							>
								<span className="truncate">
									{labelName}
									{labelMissing ? " (missing)" : ""}
								</span>
								<ChevronDown className="size-3 shrink-0 opacity-70" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="min-w-[200px]">
							<DropdownMenuLabel className="text-muted-foreground text-xs">
								ACP backend
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							{options.length === 0 ? (
								<div className="px-2 py-1.5 text-muted-foreground text-xs">
									No agents. Configure in Settings.
								</div>
							) : (
								options.map((opt) => {
									const isActive =
										selected?.key === opt.key ||
										(opt.id !== null && opt.id === selectedAgentId);
									return (
										<DropdownMenuItem
											key={opt.key}
											disabled={!opt.available && !opt.id}
											className="flex items-center justify-between gap-2"
											onSelect={() => void selectAgent(opt)}
										>
											<span className="min-w-0 truncate">
												{opt.name}
												{!opt.available ? (
													<span className="text-muted-foreground">
														{" "}
														· unavailable
													</span>
												) : null}
											</span>
											{isActive ? (
												<Check className="size-3.5 shrink-0 opacity-80" />
											) : null}
										</DropdownMenuItem>
									);
								})
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				{usage && usage.size > 0 ? (
					<Context usedTokens={usage.used} maxTokens={usage.size}>
						<ContextTrigger className="h-7 gap-1 px-1.5 text-xs" />
						<ContextContent>
							<ContextContentHeader />
						</ContextContent>
					</Context>
				) : null}
				{busy || switching || warming ? (
					<Loader2 className="size-3.5 shrink-0 animate-spin opacity-70" />
				) : null}
				{headerActions}
				{onClose ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Close chat"
						onClick={onClose}
					>
						<X className="size-3.5" />
					</Button>
				) : null}
			</div>

			<Conversation className="min-h-0">
				<ConversationContent>
					{lines.length === 0 ? (
						<ConversationEmptyState
							title="Chat with your vault"
							description="Messages go to your ACP agent. Click the agent name above to switch backends."
						>
							<div className="mt-4 flex w-full max-w-sm flex-col items-stretch gap-2">
								{busy ? (
									<Shimmer className="text-center text-sm">
										Waiting for agent…
									</Shimmer>
								) : (
									SUGGESTIONS.map((s) => (
										<Suggestion
											key={s}
											suggestion={s}
											className="h-auto w-full justify-start whitespace-normal rounded-lg px-3 py-2.5 text-left"
											onClick={(v) => void send(v)}
											disabled={busy}
										/>
									))
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
										<MessageActions>
											<MessageAction
												tooltip="Copy"
												label="Copy"
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
													{selected?.name ?? "Agent"}
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
																<PlanTitle>Plan</PlanTitle>
																<PlanDescription>
																	{`${plan.filter((p) => p.status === "completed").length}/${plan.length} steps`}
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
												{tools.map((t) => {
													const state = toolPartState(t.status);
													return (
														<Tool
															key={t.id}
															defaultOpen={
																state !== "output-available" &&
																state !== "output-error"
															}
														>
															<ToolHeader
																title={t.title}
																type={`tool-${t.kind}`}
																state={state}
															/>
															<ToolContent>
																{t.input !== undefined ? (
																	<ToolInput input={t.input} />
																) : null}
																<ToolOutput
																	output={t.output}
																	errorText={
																		t.status === "failed"
																			? "Tool failed"
																			: undefined
																	}
																/>
															</ToolContent>
														</Tool>
													);
												})}
												{tools.length > 0 ? (
													<Task className="mb-2" defaultOpen={false}>
														<TaskTrigger
															title={`${tools.length} tool call(s)`}
														/>
														<TaskContent>
															{tools.map((t) => (
																<TaskItem key={t.id}>
																	{t.title} · {t.status}
																</TaskItem>
															))}
														</TaskContent>
													</Task>
												) : null}
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
																										: "Vault path referenced by agent"
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
													<Shimmer className="text-sm">Thinking…</Shimmer>
												) : null}
											</MessageContent>
											{!line.streaming && line.text ? (
												<MessageActions>
													<MessageAction
														tooltip="Copy"
														label="Copy"
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

			{lines.length > 0 && !busy ? (
				<div className="shrink-0 border-t px-3 pt-2">
					<Suggestions>
						{SUGGESTIONS.map((s) => (
							<Suggestion
								key={s}
								suggestion={s}
								onClick={(v) => void send(v)}
								disabled={busy}
							/>
						))}
					</Suggestions>
				</div>
			) : null}

			<div className="shrink-0 border-t p-3">
				<PromptInput
					className="w-full"
					onSubmit={({ text }) => {
						void send(text);
					}}
				>
					<PromptInputBody>
						<PromptInputTextarea
							autoFocus={autoFocus || undefined}
							placeholder=""
							disabled={busy}
						/>
					</PromptInputBody>
					<PromptInputFooter>
						<PromptInputTools>
							<ModelSelector open={modelOpen} onOpenChange={setModelOpen}>
								<ModelSelectorTrigger asChild>
									<PromptInputButton
										type="button"
										className="max-w-[10rem] gap-1 px-2"
										disabled={busy}
										tooltip={
											models.length > 0
												? "Select model (ACP)"
												: "Models appear after your agent reports them"
										}
									>
										<span className="truncate text-xs">
											{selectedModelName ?? (warming ? "Loading…" : "Model")}
										</span>
										<ChevronDown className="size-3 shrink-0 opacity-70" />
									</PromptInputButton>
								</ModelSelectorTrigger>
								<ModelSelectorContent title="Select model">
									<ModelSelectorInput placeholder="Search models…" />
									<ModelSelectorList>
										<ModelSelectorEmpty>
											{models.length === 0
												? "No models yet. Run once so the ACP agent can advertise models."
												: "No match."}
										</ModelSelectorEmpty>
										{modelGroups.map(([group, items]) => (
											<ModelSelectorGroup key={group} heading={group}>
												{items.map((m) => (
													<ModelSelectorItem
														key={m.id}
														value={`${m.name} ${m.id}`}
														onSelect={() => pickModel(m.id)}
													>
														<ModelSelectorName>{m.name}</ModelSelectorName>
														{modelId === m.id ? (
															<CheckIcon className="ml-auto size-4 opacity-70" />
														) : null}
													</ModelSelectorItem>
												))}
											</ModelSelectorGroup>
										))}
									</ModelSelectorList>
								</ModelSelectorContent>
							</ModelSelector>
						</PromptInputTools>
						<PromptInputSubmit
							status={busy ? "streaming" : "ready"}
							disabled={busy}
						/>
					</PromptInputFooter>
				</PromptInput>
			</div>
		</div>
	);
}
