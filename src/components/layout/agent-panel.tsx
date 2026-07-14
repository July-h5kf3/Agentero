import { Check, ChevronDown, Loader2, X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
	Source,
	Sources,
	SourcesContent,
	SourcesTrigger,
} from "@/components/ai-elements/sources";
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
	type CatalogScanResponse,
	ensureCatalogAgent,
	listAgents,
	listenAgentCompleted,
	listenAgentFailed,
	listenAgentStream,
	runOnce,
	scanCatalog,
	setDefaultAgent,
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

type ChatLine =
	| { id: string; kind: "user"; text: string }
	| {
			id: string;
			kind: "agent";
			text: string;
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
	const activeSessionRef = useRef<string | null>(null);

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

	useEffect(() => {
		if (!isTauri()) return;
		let cancelled = false;
		const unsubs: Array<() => void> = [];

		void (async () => {
			const u1 = await listenAgentStream((ev) => {
				const cur = activeSessionRef.current;
				if (cur && cur !== ev.sessionId) return;
				setLines((prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === "agent" && last.streaming) {
						next[next.length - 1] = {
							...last,
							text: last.text + ev.chunk,
						};
						return next;
					}
					return prev;
				});
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
						next[next.length - 1] = {
							...last,
							text,
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
				u2();
				u3();
				return;
			}
			unsubs.push(u1, u2, u3);
		})();

		return () => {
			cancelled = true;
			for (const u of unsubs) u();
		};
	}, []);

	const options = buildOptions(registry, catalog);
	const selected = resolveSelected(options, selectedAgentId, registry);

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
			});
			activeSessionRef.current = accepted.sessionId;
			setLines((p) => [
				...p,
				{
					id: nextLineId("agent"),
					kind: "agent",
					text: "",
					streaming: true,
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
				{busy || switching ? (
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
						/>
					) : (
						lines.map((line) => {
							if (line.kind === "user") {
								return (
									<Message key={line.id} from="user">
										<MessageContent>
											<MessageResponse>{line.text}</MessageResponse>
										</MessageContent>
									</Message>
								);
							}
							if (line.kind === "agent") {
								return (
									<div key={line.id} className="flex w-full flex-col gap-2">
										<Message from="assistant">
											<MessageContent>
												<p className="mb-1 font-medium text-muted-foreground text-xs">
													{selected?.name ?? "Agent"}
												</p>
												<MessageResponse isAnimating={line.streaming}>
													{line.text || (line.streaming ? "…" : "")}
												</MessageResponse>
											</MessageContent>
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
								<p
									key={line.id}
									className="px-1 text-center text-muted-foreground text-xs"
								>
									{line.text}
								</p>
							);
						})
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

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
							placeholder={
								selected?.available || selected?.id
									? `Message ${selected?.name ?? "agent"}…`
									: "Configure an agent in Settings…"
							}
							disabled={busy}
						/>
					</PromptInputBody>
					<PromptInputFooter>
						<PromptInputTools>
							<span className="truncate px-1 text-[11px] text-muted-foreground">
								{selected?.name
									? `↵ send · ⇧↵ newline · ${selected.name}`
									: "↵ send · ⇧↵ newline"}
							</span>
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
