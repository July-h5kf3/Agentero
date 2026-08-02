import {
	Check,
	Loader2,
	Plus,
	RefreshCw,
	Terminal,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AgentCommonRows,
	AgentProxyRow,
} from "@/components/settings/agent-common-rows";
import { AgentModelPicker } from "@/components/settings/agent-model-picker";
import {
	catalogNeedsProbe,
	catalogProbeKey,
	catalogStatusTone,
	customProbeKey,
	ProbingBadge,
	patchCatalogProbe,
	patchCustomProbe,
	StatusBadge,
} from "@/components/settings/panes/agent-catalog";
import {
	PageTitle,
	SettingsGroup,
} from "@/components/settings/settings-layout";
import type { SettingsHostContext } from "@/components/settings/types";
import { useProbingKeys } from "@/components/settings/use-probing-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	type AgentTemplate,
	acpStatusLabel,
	type CatalogEntry,
	type CatalogScanResponse,
	ensureCatalogAgent,
	isAgentAuthFailure,
	listAgents,
	openInstallTerminal,
	type ProbeResult,
	probeAgent,
	probeCatalogAgent,
	removeAgent,
	scanCatalog,
	setAgentProxy,
	upsertAgent,
} from "@/lib/agent";
import { notifyError } from "@/lib/core/notify";
import { isTauri } from "@/lib/core/tauri";
import { cn } from "@/lib/core/utils";
import type { AppSettings } from "@/lib/settings";
import {
	remoteAgentOpenInstallTerminal,
	remoteAgentProbe,
	remoteAgentScan,
} from "@/lib/vault/remote/remote-vault";

export function AgentPane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation(["settings", "agent", "common"]);
	const [catalog, setCatalog] = useState<CatalogScanResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [adding, setAdding] = useState(false);
	const [formName, setFormName] = useState(() => t("agent.form.defaultName"));
	const [formCommand, setFormCommand] = useState("");
	const [formArgs, setFormArgs] = useState("");
	const [proxyEnabled, setProxyEnabled] = useState(false);
	const [proxyUrl, setProxyUrl] = useState("http://127.0.0.1:7890");
	const { probingKeys, setProbingKeys, clearProbingKey, clearAllProbingKeys } =
		useProbingKeys();
	const autoProbedRef = useRef(false);

	// PDF Ask agent/model (same listAgents registry as Translate → Agent)
	const [pdfAskRegistry, setPdfAskRegistry] = useState<Awaited<
		ReturnType<typeof listAgents>
	> | null>(null);
	const pdfAsk = settings.pdfAsk;
	const pdfAskValue = useMemo(
		() => ({ agentId: pdfAsk.agentId, modelId: pdfAsk.modelId }),
		[pdfAsk.agentId, pdfAsk.modelId],
	);
	const onPdfAskChange = useCallback(
		(next: { agentId: string; modelId: string }) => {
			patch({ pdfAsk: { ...settings.pdfAsk, ...next } });
		},
		[patch, settings.pdfAsk],
	);

	/** Scan only — does not toggle busy; callers own the loading flag. */
	const scanOnce =
		useCallback(async (): Promise<CatalogScanResponse | null> => {
			if (!isTauri()) {
				notifyError(t("agent.desktopOnly"));
				return null;
			}
			try {
				const scan = await scanCatalog();
				setCatalog(scan);
				setProxyEnabled(scan.proxyEnabled);
				setProxyUrl(scan.proxyUrl || "http://127.0.0.1:7890");
				return scan;
			} catch (e) {
				notifyError(e instanceof Error ? e.message : String(e));
				return null;
			}
		}, [t]);

	/**
	 * Parallel ACP probe. Soft open skips already-ready rows; force re-probes all
	 * installed. Badge updates from ProbeResult (no per-row full catalog rescan).
	 */
	const probeInstalled = useCallback(
		async (scan: CatalogScanResponse, force: boolean) => {
			if (!isTauri()) return;
			const candidates = scan.entries.filter((e) =>
				catalogNeedsProbe(e, force),
			);
			const custom = scan.customAgents.filter(
				(a) => a.available && (force || a.lastProbeOk !== true),
			);
			if (candidates.length === 0 && custom.length === 0) {
				clearAllProbingKeys();
				return;
			}

			setProbingKeys(
				new Set([
					...candidates.map((e) => catalogProbeKey(e.templateId)),
					...custom.map((a) => customProbeKey(a.id)),
				]),
			);

			await Promise.allSettled([
				...candidates.map(async (entry) => {
					const key = catalogProbeKey(entry.templateId);
					try {
						const result = await probeCatalogAgent(entry.templateId);
						setCatalog((prev) =>
							prev ? patchCatalogProbe(prev, entry.templateId, result) : prev,
						);
					} catch (e) {
						const err = e instanceof Error ? e.message : String(e);
						setCatalog((prev) =>
							prev
								? patchCatalogProbe(prev, entry.templateId, {
										agentId: entry.registeredId ?? entry.templateId,
										available: false,
										error: err,
									})
								: prev,
						);
					} finally {
						clearProbingKey(key);
					}
				}),
				...custom.map(async (agent) => {
					const key = customProbeKey(agent.id);
					try {
						const result = await probeAgent(agent.id);
						setCatalog((prev) =>
							prev ? patchCustomProbe(prev, agent.id, result) : prev,
						);
					} catch (e) {
						const err = e instanceof Error ? e.message : String(e);
						setCatalog((prev) =>
							prev
								? patchCustomProbe(prev, agent.id, {
										agentId: agent.id,
										available: false,
										error: err,
									})
								: prev,
						);
					} finally {
						clearProbingKey(key);
					}
				}),
			]);
		},
		[clearProbingKey, clearAllProbingKeys, setProbingKeys],
	);

	/**
	 * PATH scan → parallel probe → one reconcile scan.
	 * `force`: Refresh / proxy change re-probe everything; open page skips ready.
	 */
	const rescanAndProbe = useCallback(
		async (force = false) => {
			if (!isTauri()) {
				notifyError(t("agent.desktopOnly"));
				return;
			}
			setLoading(true);
			try {
				const scan = await scanOnce();
				if (scan) {
					await probeInstalled(scan, force);
					await scanOnce();
				}
			} finally {
				setLoading(false);
				clearAllProbingKeys();
			}
		},
		[probeInstalled, scanOnce, t, clearAllProbingKeys],
	);

	// Open once: soft probe (skip ready). Refresh / proxy use force=true.
	useEffect(() => {
		if (autoProbedRef.current) return;
		autoProbedRef.current = true;
		void rescanAndProbe(false);
	}, [rescanAndProbe]);

	const refreshPdfAskRegistry = useCallback(async () => {
		if (!isTauri()) {
			setPdfAskRegistry(null);
			return;
		}
		try {
			setPdfAskRegistry(await listAgents());
		} catch {
			setPdfAskRegistry(null);
		}
	}, []);

	// Registry for PDF Ask agent/model selects (refresh when catalog changes)
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-load after rescan/probe updates catalog
	useEffect(() => {
		void refreshPdfAskRegistry();
	}, [catalog, refreshPdfAskRegistry]);

	/**
	 * Persist proxy then force re-probe (host clears last_probe_* on change).
	 * Proxy switch stays enabled during the batch.
	 */
	const saveProxySettings = async (enabled: boolean, url: string) => {
		if (!isTauri()) return;
		setLoading(true);
		try {
			const saved = await setAgentProxy(enabled, url);
			setProxyEnabled(saved.proxyEnabled);
			setProxyUrl(saved.proxyUrl || "http://127.0.0.1:7890");
			const scan = await scanOnce();
			if (scan) {
				await probeInstalled(scan, true);
				await scanOnce();
			}
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
			await scanOnce();
		} finally {
			setLoading(false);
			clearAllProbingKeys();
		}
	};

	const onToggleProxy = async (v: boolean) => {
		setProxyEnabled(v);
		await saveProxySettings(v, proxyUrl);
	};

	const onCommitProxyUrl = async () => {
		await saveProxySettings(proxyEnabled, proxyUrl);
	};

	const onRescanAndProbe = async () => {
		await rescanAndProbe(true);
	};

	const onUseDefault = async (entry: CatalogEntry) => {
		if (!isTauri()) return;
		setLoading(true);
		try {
			await ensureCatalogAgent(entry.templateId, true);
			await scanOnce();
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	const onInstallAdapter = async (entry: CatalogEntry) => {
		if (!isTauri()) return;
		try {
			await openInstallTerminal(entry.templateId);
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		}
	};

	const onRemove = async (id: string) => {
		if (!isTauri()) return;
		setLoading(true);
		try {
			await removeAgent(id);
			await scanOnce();
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	const onAddCustom = async () => {
		if (!isTauri()) return;
		setLoading(true);
		try {
			const args = formArgs.trim().split(/\s+/).filter(Boolean);
			await upsertAgent({
				name: formName.trim() || formCommand,
				template: "custom" as AgentTemplate,
				command: formCommand.trim(),
				args,
				setDefault: true,
			});
			setAdding(false);
			setFormCommand("");
			setFormArgs("");
			const scan = await scanOnce();
			if (scan) {
				await probeInstalled(scan, true);
				await scanOnce();
			}
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
			clearAllProbingKeys();
		}
	};

	const entries = catalog?.entries ?? [];
	const customAgents = catalog?.customAgents ?? [];
	const busy = loading;

	return (
		<>
			<PageTitle title={t("agent.title")} />
			<SettingsGroup>
				<AgentCommonRows settings={settings} patch={patch} />
				<AgentProxyRow
					htmlFor="agent-proxy-enabled"
					label={t("agent.proxy.label")}
					proxyUrl={proxyUrl}
					proxyEnabled={proxyEnabled}
					onProxyUrlChange={setProxyUrl}
					onCommitProxyUrl={() => void onCommitProxyUrl()}
					onToggleProxy={(v) => void onToggleProxy(v)}
				/>
			</SettingsGroup>

			<SettingsGroup>
				<div className="flex flex-col gap-1.5 px-3.5 py-2.5">
					<Label
						htmlFor="agent-personal-prompt"
						className="font-normal text-[13px]"
					>
						{t("agent.personalPrompt.label")}
					</Label>
					<Textarea
						id="agent-personal-prompt"
						value={settings.agentPersonalPrompt}
						onChange={(e) =>
							patch({
								agentPersonalPrompt: e.target.value.slice(0, 8000),
							})
						}
						onBlur={() => {
							const trimmed = settings.agentPersonalPrompt.trim();
							if (trimmed !== settings.agentPersonalPrompt) {
								patch({ agentPersonalPrompt: trimmed });
							}
						}}
						placeholder={t("agent.personalPrompt.placeholder")}
						rows={4}
						className="min-h-[88px] resize-y text-xs placeholder:text-muted-foreground/50"
						spellCheck={true}
					/>
				</div>
			</SettingsGroup>

			<p className="mb-1.5 mt-4 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{t("agent.pdfAsk.section")}
			</p>
			<SettingsGroup>
				<AgentModelPicker
					value={pdfAskValue}
					onChange={onPdfAskChange}
					registry={pdfAskRegistry}
					agentLabel={t("agent.pdfAsk.agentId.label")}
					modelLabel={t("agent.pdfAsk.modelId.label")}
					followDefaultLabel={t("agent.pdfAsk.agentId.followDefault")}
					followDefaultNamedLabel={(name) =>
						t("agent.pdfAsk.agentId.followDefaultNamed", { name })
					}
					followModelLabel={t("agent.pdfAsk.modelId.followAgent")}
					emptyState={
						<p className="px-3 py-2 text-muted-foreground text-xs">
							{t("agent.pdfAsk.agentId.empty")}
						</p>
					}
				/>
			</SettingsGroup>

			{!isTauri() ? (
				<p className="mb-3 text-muted-foreground text-xs">
					{t("agent.desktopHint")}
				</p>
			) : null}

			<div className="mb-2 flex items-center justify-between gap-2">
				<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					{t("agent.commonAgents")}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={t("agent.probe")}
					title={t("agent.probe")}
					disabled={busy || !isTauri()}
					onClick={() => void onRescanAndProbe()}
				>
					{/* Loader2 while busy — avoid RefreshCw+spin (looks like two arrows, one stuck). */}
					{busy ? (
						<Loader2 className="size-3.5 animate-spin" aria-hidden />
					) : (
						<RefreshCw className="size-3.5" aria-hidden />
					)}
				</Button>
			</div>

			<SettingsGroup>
				{entries.length === 0 && busy ? (
					<div className="flex items-center gap-2 px-3.5 py-4 text-muted-foreground text-xs">
						<Loader2 className="size-3.5 animate-spin" aria-hidden />
						{t("agent.scanning")}
					</div>
				) : null}
				{entries.map((entry) => {
					const canUse =
						entry.binaryAvailable ||
						entry.acpCommandAvailable ||
						entry.acpStatus === "ready";
					const showInstall = Boolean(entry.offerInstall);
					const notInstalled = !entry.binaryAvailable;
					// Mid-probe or host-cleared not-probed while a batch is running.
					const isProbing =
						probingKeys.has(catalogProbeKey(entry.templateId)) ||
						(entry.acpStatus === "not-probed" &&
							(loading || probingKeys.size > 0));
					return (
						<div
							key={entry.templateId}
							className={cn(
								"flex items-center justify-between gap-3 border-b py-2.5 pr-1.5 pl-3.5 last:border-b-0",
								notInstalled && "opacity-50",
							)}
						>
							<div className="flex min-w-0 flex-1 items-center gap-4">
								<span
									className={cn(
										"w-24 shrink-0 truncate font-medium text-[13px]",
										notInstalled && "text-muted-foreground",
									)}
								>
									{entry.name}
								</span>
								<div className="flex min-w-0 flex-wrap items-center gap-1.5">
									{entry.binaryAvailable ? (
										<StatusBadge tone="ok">
											{t("agent.badges.installed")}
										</StatusBadge>
									) : (
										<StatusBadge tone="muted">
											{t("agent.badges.notInstalled")}
										</StatusBadge>
									)}
									{isProbing ? (
										<ProbingBadge label={t("agent.probing")} />
									) : entry.acpStatus !== "missing" ? (
										<StatusBadge
											tone={catalogStatusTone(
												entry.acpStatus,
												entry.lastProbeError,
											)}
											title={
												entry.lastProbeError ?? entry.acpAgentName ?? undefined
											}
										>
											{acpStatusLabel(entry.acpStatus, entry.lastProbeError)}
										</StatusBadge>
									) : null}
									{showInstall ? (
										<StatusBadge tone="warn">
											{t("agent.badges.adapterMissing")}
										</StatusBadge>
									) : null}
								</div>
							</div>
							{/* Fixed action slot so icon-only rows align with “Use default” */}
							<div
								className={cn(
									"flex h-7 shrink-0 items-center justify-center gap-1",
									showInstall ? "min-w-0" : "w-20",
								)}
							>
								{showInstall ? (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="h-7 gap-1 px-2 text-xs"
										aria-label={t("agent.installAdapterAria", {
											name: entry.name,
										})}
										title={
											entry.installCommand
												? t("agent.installAdapterTitle", {
														command: entry.installCommand,
													})
												: t("agent.installAdapter")
										}
										disabled={busy || !isTauri()}
										onClick={() => void onInstallAdapter(entry)}
									>
										<Terminal className="size-3" />
										{t("agent.installAdapter")}
									</Button>
								) : null}
								{entry.isDefault ? (
									<span
										className="flex size-7 items-center justify-center text-primary"
										title={t("agent.badges.default")}
										role="img"
										aria-label={t("agent.badges.default")}
									>
										<Check className="size-4" aria-hidden />
									</span>
								) : canUse && !showInstall ? (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 shrink-0 px-2 text-xs"
										onClick={() => void onUseDefault(entry)}
									>
										{t("agent.useDefault")}
									</Button>
								) : null}
							</div>
						</div>
					);
				})}
				{customAgents.map((agent) => {
					const isDefault = catalog?.defaultId === agent.id;
					const notProbedYet = agent.available && agent.lastProbeOk == null;
					const isProbing =
						probingKeys.has(customProbeKey(agent.id)) ||
						(notProbedYet && (loading || probingKeys.size > 0));
					return (
						<div
							key={agent.id}
							className="flex items-center justify-between gap-3 border-b py-2.5 pr-1.5 pl-3.5 last:border-b-0"
						>
							<div className="flex min-w-0 flex-1 items-center gap-4">
								<span className="w-24 shrink-0 truncate font-medium text-[13px]">
									{agent.name}
								</span>
								<div className="flex min-w-0 flex-wrap items-center gap-1.5">
									{isDefault ? (
										<StatusBadge tone="primary">
											{t("agent.badges.default")}
										</StatusBadge>
									) : null}
									{isProbing ? (
										<ProbingBadge label={t("agent.probing")} />
									) : agent.lastProbeOk === true ? (
										<StatusBadge tone="ok">
											{t("agent:acpStatus.ready")}
										</StatusBadge>
									) : agent.lastProbeOk === false ? (
										<StatusBadge
											tone={
												isAgentAuthFailure(agent.lastProbeError)
													? "warn"
													: "err"
											}
											title={agent.lastProbeError ?? undefined}
										>
											{isAgentAuthFailure(agent.lastProbeError)
												? t("agent:acpStatus.notLoggedIn")
												: t("agent:acpStatus.failed")}
										</StatusBadge>
									) : notProbedYet ? (
										<ProbingBadge label={t("agent.probing")} />
									) : (
										<StatusBadge tone="muted">
											{t("agent:acpStatus.notInstalled")}
										</StatusBadge>
									)}
								</div>
							</div>
							<div className="flex h-7 w-20 shrink-0 items-center justify-center gap-1">
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="size-7"
									aria-label={t("common:remove")}
									onClick={() => void onRemove(agent.id)}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						</div>
					);
				})}
				{/* Custom entry row — same row style as catalog agents; + expands the form */}
				<div className="flex items-center justify-between gap-3 border-b py-2.5 pr-1.5 pl-3.5 last:border-b-0">
					<div className="flex min-w-0 flex-1 items-center gap-4">
						<span className="w-24 shrink-0 truncate font-medium text-[13px]">
							{t("agent.custom")}
						</span>
					</div>
					<div className="flex h-7 w-20 shrink-0 items-center justify-center gap-1">
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="size-7"
							disabled={!isTauri()}
							aria-label={adding ? t("common:cancel") : t("agent.addCustom")}
							title={adding ? t("common:cancel") : t("agent.addCustom")}
							onClick={() => setAdding((v) => !v)}
						>
							{adding ? (
								<X className="size-3.5" aria-hidden />
							) : (
								<Plus className="size-3.5" aria-hidden />
							)}
						</Button>
					</div>
				</div>
				{adding ? (
					<div className="space-y-2.5 border-b px-3.5 py-3 last:border-b-0">
						<div className="space-y-1">
							<Label className="font-normal text-[13px]">
								{t("agent.form.name")}
							</Label>
							<Input
								value={formName}
								onChange={(e) => setFormName(e.target.value)}
								spellCheck={false}
							/>
						</div>
						<div className="space-y-1">
							<Label className="font-normal text-[13px]">
								{t("agent.form.command")}
							</Label>
							<Input
								value={formCommand}
								onChange={(e) => setFormCommand(e.target.value)}
								placeholder="opencode"
								spellCheck={false}
								autoComplete="off"
							/>
						</div>
						<div className="space-y-1">
							<Label className="font-normal text-[13px]">
								{t("agent.form.args")}
							</Label>
							<Input
								value={formArgs}
								onChange={(e) => setFormArgs(e.target.value)}
								placeholder="acp"
								spellCheck={false}
								autoComplete="off"
							/>
						</div>
						<div className="flex justify-end gap-1.5 pt-1">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setAdding(false)}
							>
								{t("common:cancel")}
							</Button>
							<Button
								type="button"
								size="sm"
								disabled={!formCommand.trim() || loading}
								onClick={() => void onAddCustom()}
							>
								{t("common:save")}
							</Button>
						</div>
					</div>
				) : null}
			</SettingsGroup>
			<p className="mt-2 mb-3 px-0.5 text-muted-foreground text-xs leading-relaxed">
				{t("agent.commonAgentsHint")}
			</p>
		</>
	);
}

/**
 * Agent settings when the active vault is remote: discover + ACP probe run on the
 * SSH host (not this machine). App-level prefs (permission, language) still apply.
 */
export function RemoteAgentPane({
	settings,
	patch,
	hostContext,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
	hostContext: Extract<SettingsHostContext, { kind: "remote" }>;
}) {
	const { t } = useTranslation(["settings", "agent", "common"]);
	const [entries, setEntries] = useState<CatalogEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const { probingKeys, setProbingKeys, clearProbingKey, clearAllProbingKeys } =
		useProbingKeys();
	const [proxyEnabled, setProxyEnabled] = useState(false);
	const [proxyUrl, setProxyUrl] = useState("http://127.0.0.1:7890");
	const sessionId = hostContext.sessionId;

	// Same registry proxy as local Agent settings (injected into remote process env).
	useEffect(() => {
		if (!isTauri()) return;
		let cancelled = false;
		void scanCatalog()
			.then((scan) => {
				if (cancelled) return;
				setProxyEnabled(scan.proxyEnabled);
				setProxyUrl(scan.proxyUrl || "http://127.0.0.1:7890");
			})
			.catch(() => {
				/* ignore */
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const scanOnce = useCallback(async (): Promise<CatalogEntry[] | null> => {
		if (!isTauri()) {
			notifyError(t("agent.desktopOnly"));
			return null;
		}
		try {
			const scan = await remoteAgentScan(sessionId);
			setEntries(scan.entries);
			return scan.entries;
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
			return null;
		}
	}, [sessionId, t]);

	const patchEntryProbe = useCallback(
		(templateId: string, result: ProbeResult) => {
			setEntries((prev) =>
				prev.map((entry) => {
					if (entry.templateId !== templateId) return entry;
					return {
						...entry,
						acpStatus: result.available ? "ready" : "failed",
						acpAgentName: result.agentName ?? null,
						lastProbeError: result.error ?? null,
						lastProbedAt: new Date().toISOString(),
					};
				}),
			);
		},
		[],
	);

	const probeInstalled = useCallback(
		async (list: CatalogEntry[], force: boolean) => {
			if (!isTauri()) return;
			const candidates = list.filter((e) => catalogNeedsProbe(e, force));
			if (candidates.length === 0) {
				clearAllProbingKeys();
				return;
			}
			setProbingKeys(
				new Set(candidates.map((e) => catalogProbeKey(e.templateId))),
			);
			await Promise.allSettled(
				candidates.map(async (entry) => {
					const key = catalogProbeKey(entry.templateId);
					try {
						const result = await remoteAgentProbe(sessionId, entry.templateId);
						patchEntryProbe(entry.templateId, result);
					} catch (e) {
						const err = e instanceof Error ? e.message : String(e);
						patchEntryProbe(entry.templateId, {
							agentId: entry.templateId,
							available: false,
							error: err,
						});
					} finally {
						clearProbingKey(key);
					}
				}),
			);
		},
		[
			sessionId,
			patchEntryProbe,
			clearProbingKey,
			clearAllProbingKeys,
			setProbingKeys,
		],
	);

	const rescanAndProbe = useCallback(
		async (force = false) => {
			if (!isTauri()) {
				notifyError(t("agent.desktopOnly"));
				return;
			}
			setLoading(true);
			try {
				const list = await scanOnce();
				if (list) await probeInstalled(list, force);
			} finally {
				setLoading(false);
				clearAllProbingKeys();
			}
		},
		[probeInstalled, scanOnce, t, clearAllProbingKeys],
	);

	// Soft probe when remote session (or rescan callback) changes.
	useEffect(() => {
		void rescanAndProbe(false);
	}, [rescanAndProbe]);

	const saveProxySettings = async (enabled: boolean, url: string) => {
		if (!isTauri()) return;
		setLoading(true);
		try {
			const saved = await setAgentProxy(enabled, url);
			setProxyEnabled(saved.proxyEnabled);
			setProxyUrl(saved.proxyUrl || "http://127.0.0.1:7890");
			// Proxy is injected into remote agent env — re-probe after change.
			await rescanAndProbe(true);
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	const onToggleProxy = async (v: boolean) => {
		setProxyEnabled(v);
		await saveProxySettings(v, proxyUrl);
	};

	const onCommitProxyUrl = async () => {
		await saveProxySettings(proxyEnabled, proxyUrl);
	};

	const onInstallAdapter = async (entry: CatalogEntry) => {
		if (!isTauri()) return;
		try {
			await remoteAgentOpenInstallTerminal(sessionId, entry.templateId);
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		}
	};

	const busy = loading;

	return (
		<>
			<PageTitle title={t("agent.title")} />
			<p className="mb-3 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-muted-foreground text-xs leading-relaxed">
				{t("agent.remote.banner", {
					host: hostContext.label,
					path: hostContext.remotePath || "—",
				})}
			</p>

			<SettingsGroup>
				<AgentCommonRows settings={settings} patch={patch} idSuffix="-r" />
				<AgentProxyRow
					htmlFor="agent-proxy-enabled-r"
					label={t("agent.proxy.label")}
					proxyUrl={proxyUrl}
					proxyEnabled={proxyEnabled}
					onProxyUrlChange={setProxyUrl}
					onCommitProxyUrl={() => void onCommitProxyUrl()}
					onToggleProxy={(v) => void onToggleProxy(v)}
				/>
				<p className="border-b px-3.5 py-2 text-muted-foreground text-[11px] leading-relaxed last:border-b-0">
					{t("agent.remote.proxyHint")}
				</p>
			</SettingsGroup>

			{!isTauri() ? (
				<p className="mb-3 text-muted-foreground text-xs">
					{t("agent.desktopHint")}
				</p>
			) : null}

			<div className="mb-2 flex items-center justify-between gap-2">
				<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					{t("agent.remote.commonAgents")}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={t("agent.probe")}
					title={t("agent.remote.probeTitle")}
					disabled={busy || !isTauri()}
					onClick={() => void rescanAndProbe(true)}
				>
					{busy ? (
						<Loader2 className="size-3.5 animate-spin" aria-hidden />
					) : (
						<RefreshCw className="size-3.5" aria-hidden />
					)}
				</Button>
			</div>

			<SettingsGroup>
				{entries.length === 0 && busy ? (
					<div className="flex items-center gap-2 px-3.5 py-4 text-muted-foreground text-xs">
						<Loader2 className="size-3.5 animate-spin" aria-hidden />
						{t("agent.scanning")}
					</div>
				) : null}
				{entries.length === 0 && !busy ? (
					<p className="px-3.5 py-3 text-muted-foreground text-xs">
						{t("agent.remote.empty")}
					</p>
				) : null}
				{entries.map((entry) => {
					const showInstall = Boolean(entry.offerInstall);
					const notInstalled =
						!entry.binaryAvailable && !entry.acpCommandAvailable;
					const isProbing =
						probingKeys.has(catalogProbeKey(entry.templateId)) ||
						(entry.acpStatus === "not-probed" &&
							(loading || probingKeys.size > 0) &&
							(entry.binaryAvailable || entry.acpCommandAvailable));
					return (
						<div
							key={entry.templateId}
							className={cn(
								"flex items-center justify-between gap-3 border-b py-2.5 pr-1.5 pl-3.5 last:border-b-0",
								notInstalled && "opacity-50",
							)}
						>
							<div className="flex min-w-0 flex-1 items-center gap-4">
								<span
									className={cn(
										"w-24 shrink-0 truncate font-medium text-[13px]",
										notInstalled && "text-muted-foreground",
									)}
									title={
										entry.lastProbeError || entry.description || entry.name
									}
								>
									{entry.name}
								</span>
								<div className="flex min-w-0 flex-wrap items-center gap-1.5">
									{entry.binaryAvailable ? (
										<StatusBadge tone="ok">
											{t("agent.badges.installed")}
										</StatusBadge>
									) : (
										<StatusBadge tone="muted">
											{t("agent.badges.notInstalled")}
										</StatusBadge>
									)}
									{isProbing ? (
										<ProbingBadge label={t("agent.probing")} />
									) : entry.acpStatus !== "missing" ? (
										<StatusBadge
											tone={catalogStatusTone(
												entry.acpStatus,
												entry.lastProbeError,
											)}
											title={
												entry.lastProbeError ?? entry.acpAgentName ?? undefined
											}
										>
											{acpStatusLabel(entry.acpStatus, entry.lastProbeError)}
										</StatusBadge>
									) : null}
									{showInstall ? (
										<StatusBadge tone="warn">
											{t("agent.badges.adapterMissing")}
										</StatusBadge>
									) : null}
								</div>
							</div>
							<div
								className={cn(
									"flex h-7 shrink-0 items-center justify-center gap-1",
									showInstall ? "min-w-0" : "w-8",
								)}
							>
								{showInstall ? (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="h-7 gap-1 px-2 text-xs"
										aria-label={t("agent.remote.installAdapterAria", {
											name: entry.name,
										})}
										title={
											entry.installCommand
												? t("agent.remote.installAdapterTitle", {
														command: entry.installCommand,
														host: hostContext.label,
													})
												: t("agent.installAdapter")
										}
										disabled={busy || !isTauri()}
										onClick={() => void onInstallAdapter(entry)}
									>
										<Terminal className="size-3" />
										{t("agent.installAdapter")}
									</Button>
								) : null}
							</div>
						</div>
					);
				})}
			</SettingsGroup>
			<p className="mt-2 mb-3 px-0.5 text-muted-foreground text-xs leading-relaxed">
				{t("agent.remote.hint")}
			</p>
		</>
	);
}
