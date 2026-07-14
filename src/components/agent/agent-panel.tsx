import { Check, ChevronDown, Loader2, Send, X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
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
	/** Called when user closes the chat sidebar */
	onClose?: () => void;
	/** Autofocus the prompt when panel mounts / becomes visible */
	autoFocus?: boolean;
	title?: string;
};

type ChatLine =
	| { kind: "user"; text: string }
	| { kind: "agent"; text: string; sources?: string[]; streaming?: boolean }
	| { kind: "error"; text: string }
	| { kind: "system"; text: string };

type AgentOption = {
	/** Stable key for React */
	key: string;
	/** Registry id when registered */
	id: string | null;
	/** Catalog template id when from catalog */
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

	// Prefer catalog entries (common agents) with current probe/PATH status.
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

	// Fallback / merge any registry-only agents not already listed.
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
	const [prompt, setPrompt] = useState("");
	const [lines, setLines] = useState<ChatLine[]>([]);
	const [busy, setBusy] = useState(false);
	const [switching, setSwitching] = useState(false);
	const activeSessionRef = useRef<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

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
		if (autoFocus) {
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [autoFocus]);

	useEffect(() => {
		if (!isTauri()) return;
		let unsubs: Array<() => void> = [];
		void (async () => {
			const u1 = await listenAgentStream((ev) => {
				const cur = activeSessionRef.current;
				if (cur && cur !== ev.sessionId) return;
				if (!cur) activeSessionRef.current = ev.sessionId;
				setLines((prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.kind === "agent" && last.streaming) {
						next[next.length - 1] = {
							...last,
							text: last.text + ev.chunk,
						};
					} else {
						next.push({ kind: "agent", text: ev.chunk, streaming: true });
					}
					return next;
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
						next[next.length - 1] = {
							kind: "agent",
							text: ev.content || last.text,
							sources: ev.sources,
							streaming: false,
						};
					} else {
						next.push({
							kind: "agent",
							text: ev.content || "(empty response)",
							sources: ev.sources,
						});
					}
					return next;
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
				setLines((prev) => [...prev, { kind: "error", text: ev.error }]);
			});
			unsubs = [u1, u2, u3];
		})();
		return () => {
			for (const u of unsubs) u();
		};
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
		void lines;
	});

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
					kind: "system",
					text: `Switched to ${opt.name}`,
				},
			]);
		} catch (e) {
			setLines((p) => [
				...p,
				{
					kind: "error",
					text: e instanceof Error ? e.message : String(e),
				},
			]);
		} finally {
			setSwitching(false);
		}
	};

	const send = async () => {
		const text = prompt.trim();
		if (!text || busy) return;
		if (!isTauri()) {
			setLines((p) => [
				...p,
				{ kind: "error", text: "Open the desktop app to run agents." },
			]);
			return;
		}

		let agentId = selected?.id ?? registry?.defaultId ?? null;
		// Lazily register catalog agent on first send if needed.
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
						kind: "error",
						text: e instanceof Error ? e.message : String(e),
					},
				]);
				return;
			}
		}

		if (!agentId || (selected && !selected.available && !selected.id)) {
			setLines((p) => [
				...p,
				{
					kind: "system",
					text: "No available agent. Open Settings → Agent to configure one.",
				},
			]);
			return;
		}

		// Prefer available flag; still try if user selected a ready agent.
		const agentOk =
			!selected ||
			selected.available ||
			registry?.agents.some((a) => a.id === agentId && a.available);
		if (!agentOk) {
			setLines((p) => [
				...p,
				{
					kind: "system",
					text: `${selected?.name ?? "Agent"} is not available. Pick another or open Settings → Agent.`,
				},
			]);
			return;
		}

		setPrompt("");
		setLines((p) => [...p, { kind: "user", text }]);
		setBusy(true);
		try {
			const accepted = await runOnce({
				agentId,
				prompt: text,
				vaultPath: vaultPath ?? undefined,
				workflow: "free",
			});
			activeSessionRef.current = accepted.sessionId;
			setLines((p) => [...p, { kind: "agent", text: "", streaming: true }]);
		} catch (e) {
			setBusy(false);
			setLines((p) => [
				...p,
				{ kind: "error", text: e instanceof Error ? e.message : String(e) },
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
							<DropdownMenuLabel className="text-xs text-muted-foreground">
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

			<div
				ref={scrollRef}
				className="motif-scroll min-h-0 flex-1 space-y-3 p-3"
			>
				{lines.length === 0 ? (
					<p className="text-muted-foreground text-xs leading-relaxed">
						Chat with your ACP agent about this vault. Click the agent name
						above to switch backends.
					</p>
				) : null}
				{lines.map((line, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: chat stream
					<div key={i} className="text-[13px] leading-relaxed">
						{line.kind === "user" ? (
							<div className="rounded-lg bg-primary/10 px-2.5 py-1.5">
								<span className="font-medium text-xs opacity-70">You</span>
								<p className="whitespace-pre-wrap">{line.text}</p>
							</div>
						) : null}
						{line.kind === "agent" ? (
							<div className="rounded-lg border bg-card px-2.5 py-1.5">
								<span className="font-medium text-xs opacity-70">
									{selected?.name ?? "Agent"}
								</span>
								<p className="whitespace-pre-wrap">
									{line.text || (line.streaming ? "…" : "")}
								</p>
								{line.sources && line.sources.length > 0 ? (
									<ul className="mt-2 border-t pt-1.5 text-[11px] text-muted-foreground">
										{line.sources.map((s) => (
											<li key={s} className="truncate font-mono">
												{s}
											</li>
										))}
									</ul>
								) : null}
							</div>
						) : null}
						{line.kind === "error" ? (
							<p className="text-destructive text-xs">{line.text}</p>
						) : null}
						{line.kind === "system" ? (
							<p className="text-muted-foreground text-xs">{line.text}</p>
						) : null}
					</div>
				))}
			</div>

			<form
				className="flex shrink-0 gap-1.5 border-t p-2"
				onSubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<input
					ref={inputRef}
					className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					placeholder={
						selected?.available || selected?.id
							? `Message ${selected?.name ?? "agent"}…`
							: "Configure an agent in Settings…"
					}
					disabled={busy}
				/>
				<Button
					type="submit"
					size="icon-xs"
					disabled={busy || !prompt.trim()}
					aria-label="Send"
				>
					{busy ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Send className="size-3.5" />
					)}
				</Button>
			</form>
		</div>
	);
}
