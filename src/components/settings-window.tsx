import {
	Bot,
	Info,
	Keyboard,
	Loader2,
	Paintbrush,
	Plus,
	RefreshCw,
	Shield,
	SlidersHorizontal,
	Trash2,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	type AgentTemplate,
	acpStatusLabel,
	type CatalogEntry,
	type CatalogScanResponse,
	ensureCatalogAgent,
	probeAgent,
	probeCatalogAgent,
	removeAgent,
	scanCatalog,
	setAgentEnabled,
	setAgentProxy,
	upsertAgent,
} from "@/lib/agent";
import { revealInOsLabelKey } from "@/lib/reveal";
import {
	type AppSettings,
	DEFAULT_TRANSLATOR_BASE_URL,
	type LocalePreference,
	type ThemePreference,
} from "@/lib/settings";
import {
	formatShortcut,
	type ShortcutDef,
	type ShortcutGroup,
	shortcutsByGroup,
} from "@/lib/shortcuts";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export type SettingsSection =
	| "general"
	| "appearance"
	| "agent"
	| "keyboard"
	| "privacy"
	| "about";

const NAV: {
	id: SettingsSection;
	icon: typeof Bot;
}[] = [
	{ id: "general", icon: SlidersHorizontal },
	{ id: "appearance", icon: Paintbrush },
	{ id: "agent", icon: Bot },
	{ id: "keyboard", icon: Keyboard },
	{ id: "privacy", icon: Shield },
	{ id: "about", icon: Info },
];

const GROUP_KEY: Record<ShortcutGroup, "app" | "navigation" | "vault"> = {
	App: "app",
	Navigation: "navigation",
	Vault: "vault",
};

type SettingsWindowProps = {
	open: boolean;
	section: SettingsSection;
	onSectionChange: (section: SettingsSection) => void;
	onClose: () => void;
	settings: AppSettings;
	onChange: (next: AppSettings) => void;
};

export function SettingsWindow({
	open,
	section,
	onSectionChange,
	onClose,
	settings,
	onChange,
}: SettingsWindowProps) {
	const { t } = useTranslation(["settings", "common"]);
	const titleId = useId();

	useEffect(() => {
		if (!open) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}, [open]);

	if (!open) return null;

	const patch = (partial: Partial<AppSettings>) =>
		onChange({ ...settings, ...partial });

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-6">
			<button
				type="button"
				className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
				aria-label={t("dismiss")}
				onClick={onClose}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className="relative flex h-[min(560px,calc(100vh-3rem))] w-[min(720px,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-background shadow-2xl ring-1 ring-black/5"
			>
				{/* Sidebar — macOS Settings style */}
				<nav className="flex w-[180px] shrink-0 flex-col border-r bg-muted/40">
					<div className="flex items-center justify-between px-3 pt-3 pb-2">
						<span
							id={titleId}
							className="font-semibold text-[13px] tracking-tight"
						>
							{t("title")}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={t("common:close")}
							onClick={onClose}
						>
							<X className="size-3.5" />
						</Button>
					</div>
					<ul className="flex flex-1 flex-col gap-0.5 px-2 pb-3">
						{NAV.map((item) => {
							const Icon = item.icon;
							const active = section === item.id;
							return (
								<li key={item.id}>
									<button
										type="button"
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors",
											"hover:bg-black/5 dark:hover:bg-white/10",
											active &&
												"bg-primary text-primary-foreground hover:bg-primary dark:hover:bg-primary",
										)}
										aria-current={active ? "page" : undefined}
										onClick={() => onSectionChange(item.id)}
									>
										<Icon className="size-3.5 shrink-0 opacity-90" />
										<span className="truncate">{t(`nav.${item.id}`)}</span>
									</button>
								</li>
							);
						})}
					</ul>
				</nav>

				{/* Content */}
				<div className="min-w-0 flex-1 overflow-y-auto">
					<div className="px-6 py-5">
						{section === "general" && (
							<GeneralPane settings={settings} patch={patch} />
						)}
						{section === "appearance" && (
							<AppearancePane settings={settings} patch={patch} />
						)}
						{section === "agent" && (
							<AgentPane settings={settings} patch={patch} />
						)}
						{section === "keyboard" && <KeyboardPane />}
						{section === "privacy" && (
							<PrivacyPane settings={settings} patch={patch} />
						)}
						{section === "about" && <AboutPane />}
					</div>
				</div>
			</div>
		</div>
	);
}

function PageTitle({ title }: { title: string }) {
	return <h2 className="mb-4 font-semibold text-lg tracking-tight">{title}</h2>;
}

function SettingsGroup({ children }: { children: ReactNode }) {
	return (
		<div className="mb-5">
			<div className="overflow-hidden rounded-xl border bg-card">
				{children}
			</div>
		</div>
	);
}

function SettingsRow({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 border-b px-3.5 py-2.5 last:border-b-0">
			<Label htmlFor={htmlFor} className="min-w-0 font-normal text-[13px]">
				{label}
			</Label>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

function GeneralPane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation("settings");
	return (
		<>
			<PageTitle title={t("general.title")} />
			<SettingsGroup>
				<SettingsRow
					label={t("general.restoreVault.label")}
					htmlFor="restore-vault"
				>
					<Switch
						id="restore-vault"
						checked={settings.restoreLastVault}
						onCheckedChange={(v) => patch({ restoreLastVault: v })}
					/>
				</SettingsRow>
				<SettingsRow
					label={t("general.confirmClose.label")}
					htmlFor="confirm-close"
				>
					<Switch
						id="confirm-close"
						checked={settings.confirmBeforeClose}
						onCheckedChange={(v) => patch({ confirmBeforeClose: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup>
				<div className="flex flex-col gap-1.5 border-b px-3.5 py-2.5 last:border-b-0">
					<Label
						htmlFor="translator-base-url"
						className="font-normal text-[13px]"
					>
						{t("general.translatorBaseUrl.label")}
					</Label>
					<Input
						id="translator-base-url"
						value={settings.translatorBaseUrl}
						onChange={(e) => patch({ translatorBaseUrl: e.target.value })}
						onBlur={() => {
							const trimmed = settings.translatorBaseUrl
								.trim()
								.replace(/\/+$/, "");
							if (!trimmed) {
								patch({ translatorBaseUrl: DEFAULT_TRANSLATOR_BASE_URL });
							} else if (trimmed !== settings.translatorBaseUrl) {
								patch({ translatorBaseUrl: trimmed });
							}
						}}
						placeholder={DEFAULT_TRANSLATOR_BASE_URL}
						className="h-8 font-mono text-xs"
						spellCheck={false}
						autoComplete="off"
					/>
				</div>
			</SettingsGroup>
			<p className="px-0.5 text-muted-foreground text-xs leading-relaxed">
				{t("general.translatorBaseUrl.hint")}
			</p>
		</>
	);
}

function AppearancePane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation("settings");
	const { setTheme } = useTheme();
	const fontId = useId();

	const setThemePref = (theme: ThemePreference) => {
		patch({ theme });
		setTheme(theme);
	};

	return (
		<>
			<PageTitle title={t("appearance.title")} />
			<SettingsGroup>
				<SettingsRow label={t("appearance.themeLabel")}>
					<Select
						value={settings.theme}
						onValueChange={(v) => setThemePref(v as ThemePreference)}
					>
						<SelectTrigger size="sm" className="min-w-[120px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="system">
								{t("appearance.theme.system")}
							</SelectItem>
							<SelectItem value="light">
								{t("appearance.theme.light")}
							</SelectItem>
							<SelectItem value="dark">{t("appearance.theme.dark")}</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("appearance.languageLabel")}>
					<Select
						value={settings.locale}
						onValueChange={(v) => patch({ locale: v as LocalePreference })}
					>
						<SelectTrigger size="sm" className="min-w-[120px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="system">
								{t("appearance.language.system")}
							</SelectItem>
							<SelectItem value="en">{t("appearance.language.en")}</SelectItem>
							<SelectItem value="zh-CN">
								{t("appearance.language.zhCN")}
							</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("appearance.fontSize.label")} htmlFor={fontId}>
					<div className="flex items-center gap-2">
						<input
							id={fontId}
							type="range"
							min={12}
							max={20}
							step={1}
							value={settings.editorFontSize}
							onChange={(e) =>
								patch({ editorFontSize: Number(e.target.value) })
							}
							className="w-28 accent-primary"
						/>
						<span className="w-12 text-right text-muted-foreground text-xs tabular-nums">
							{t("appearance.fontSize.value", {
								size: settings.editorFontSize,
							})}
						</span>
					</div>
				</SettingsRow>
				<SettingsRow
					label={t("appearance.lineNumbers.label")}
					htmlFor="line-numbers"
				>
					<Switch
						id="line-numbers"
						checked={settings.showLineNumbers}
						onCheckedChange={(v) => patch({ showLineNumbers: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

function StatusBadge({
	tone,
	children,
}: {
	tone: "ok" | "warn" | "err" | "muted" | "primary";
	children: ReactNode;
}) {
	return (
		<span
			className={cn(
				"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
				tone === "ok" &&
					"bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
				tone === "warn" && "bg-amber-500/15 text-amber-800 dark:text-amber-400",
				tone === "err" && "bg-destructive/15 text-destructive",
				tone === "muted" && "bg-muted text-muted-foreground",
				tone === "primary" && "bg-primary/10 text-primary",
			)}
		>
			{children}
		</span>
	);
}

function catalogStatusTone(
	status: CatalogEntry["acpStatus"],
): "ok" | "warn" | "err" | "muted" {
	switch (status) {
		case "ready":
			return "ok";
		case "failed":
			return "err";
		case "not-probed":
			return "warn";
		case "missing":
			return "muted";
	}
}

function AgentPane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation(["settings", "agent", "common"]);
	const [catalog, setCatalog] = useState<CatalogScanResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [probing, setProbing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [formName, setFormName] = useState(() => t("agent.form.defaultName"));
	const [formCommand, setFormCommand] = useState("");
	const [formArgs, setFormArgs] = useState("");
	const [proxyEnabled, setProxyEnabled] = useState(false);
	const [proxyUrl, setProxyUrl] = useState("http://127.0.0.1:7890");
	const autoProbedRef = useRef(false);

	const refresh = useCallback(async (): Promise<CatalogScanResponse | null> => {
		if (!isTauri()) {
			setError(t("agent.desktopOnly"));
			return null;
		}
		setLoading(true);
		setError(null);
		try {
			const scan = await scanCatalog();
			setCatalog(scan);
			setProxyEnabled(scan.proxyEnabled);
			setProxyUrl(scan.proxyUrl || "http://127.0.0.1:7890");
			return scan;
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			return null;
		} finally {
			setLoading(false);
		}
	}, [t]);

	const probeInstalled = useCallback(
		async (scan: CatalogScanResponse) => {
			if (!isTauri()) return;
			const candidates = scan.entries.filter(
				(e) => e.binaryAvailable || e.acpCommandAvailable,
			);
			const custom = scan.customAgents.filter((a) => a.available);
			if (candidates.length === 0 && custom.length === 0) return;

			setProbing(true);
			setError(null);
			try {
				await Promise.allSettled([
					...candidates.map((entry) => probeCatalogAgent(entry.templateId)),
					...custom.map((agent) => probeAgent(agent.id)),
				]);
				await refresh();
			} finally {
				setProbing(false);
			}
		},
		[refresh],
	);

	useEffect(() => {
		if (autoProbedRef.current) return;
		autoProbedRef.current = true;
		void (async () => {
			const scan = await refresh();
			if (scan) await probeInstalled(scan);
		})();
	}, [refresh, probeInstalled]);

	const onToggleEnabled = async (v: boolean) => {
		patch({ agentEnabled: v });
		if (!isTauri()) return;
		try {
			await setAgentEnabled(v);
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const saveProxySettings = async (enabled: boolean, url: string) => {
		if (!isTauri()) return;
		setLoading(true);
		setError(null);
		try {
			const saved = await setAgentProxy(enabled, url);
			setProxyEnabled(saved.proxyEnabled);
			setProxyUrl(saved.proxyUrl);
			const scan = await refresh();
			if (scan) await probeInstalled(scan);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
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

	const onRescanAndProbe = async () => {
		const scan = await refresh();
		if (scan) await probeInstalled(scan);
	};

	const onUseDefault = async (entry: CatalogEntry) => {
		if (!isTauri()) return;
		setError(null);
		try {
			await ensureCatalogAgent(entry.templateId, true);
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const onRemove = async (id: string) => {
		if (!isTauri()) return;
		try {
			await removeAgent(id);
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const onAddCustom = async () => {
		if (!isTauri()) return;
		setLoading(true);
		setError(null);
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
			const scan = await refresh();
			if (scan) await probeInstalled(scan);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	const entries = catalog?.entries ?? [];
	const customAgents = catalog?.customAgents ?? [];
	const busy = loading || probing;

	return (
		<>
			<PageTitle title={t("agent.title")} />
			<SettingsGroup>
				<SettingsRow label={t("agent.enable.label")} htmlFor="agent-enabled">
					<Switch
						id="agent-enabled"
						checked={settings.agentEnabled}
						onCheckedChange={(v) => void onToggleEnabled(v)}
					/>
				</SettingsRow>
				<SettingsRow
					label={t("agent.proxy.label")}
					htmlFor="agent-proxy-enabled"
				>
					<div className="flex items-center gap-2">
						<Input
							value={proxyUrl}
							onChange={(e) => setProxyUrl(e.target.value)}
							onBlur={() => void onCommitProxyUrl()}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.currentTarget.blur();
								}
							}}
							placeholder="http://127.0.0.1:7890"
							spellCheck={false}
							autoComplete="off"
							disabled={!proxyEnabled || busy || !isTauri()}
							className="h-8 w-48 text-xs"
						/>
						<Switch
							id="agent-proxy-enabled"
							checked={proxyEnabled}
							disabled={busy || !isTauri()}
							onCheckedChange={(v) => void onToggleProxy(v)}
						/>
					</div>
				</SettingsRow>
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
					<RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
				</Button>
			</div>

			<SettingsGroup>
				{entries.length === 0 && busy ? (
					<div className="flex items-center gap-2 px-3.5 py-4 text-muted-foreground text-xs">
						<Loader2 className="size-3.5 animate-spin" />
						{probing ? t("agent.probing") : t("agent.scanning")}
					</div>
				) : null}
				{entries.map((entry) => {
					const canUse =
						entry.binaryAvailable ||
						entry.acpCommandAvailable ||
						entry.acpStatus === "ready";
					return (
						<div
							key={entry.templateId}
							className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5 last:border-b-0"
						>
							<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
								<span className="font-medium text-[13px]">{entry.name}</span>
								{entry.isDefault ? (
									<StatusBadge tone="primary">
										{t("agent.badges.default")}
									</StatusBadge>
								) : null}
								<StatusBadge tone={catalogStatusTone(entry.acpStatus)}>
									{acpStatusLabel(entry.acpStatus)}
								</StatusBadge>
								{entry.binaryAvailable ? (
									<StatusBadge tone="ok">
										{t("agent.badges.installed")}
									</StatusBadge>
								) : (
									<StatusBadge tone="muted">
										{t("agent.badges.notOnPath")}
									</StatusBadge>
								)}
							</div>
							{!entry.isDefault && canUse ? (
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
					);
				})}
			</SettingsGroup>

			<div className="mb-2 flex items-center justify-between gap-2">
				<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					{t("agent.custom")}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={t("agent.addCustom")}
					disabled={!isTauri()}
					onClick={() => setAdding((v) => !v)}
				>
					<Plus className="size-3.5" />
				</Button>
			</div>

			{customAgents.length > 0 ? (
				<SettingsGroup>
					{customAgents.map((agent) => {
						const isDefault = catalog?.defaultId === agent.id;
						return (
							<div
								key={agent.id}
								className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5 last:border-b-0"
							>
								<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
									<span className="font-medium text-[13px]">{agent.name}</span>
									{isDefault ? (
										<StatusBadge tone="primary">
											{t("agent.badges.default")}
										</StatusBadge>
									) : null}
									{agent.lastProbeOk === true ? (
										<StatusBadge tone="ok">
											{t("agent:acpStatus.ready")}
										</StatusBadge>
									) : agent.lastProbeOk === false ? (
										<StatusBadge tone="err">
											{t("agent:acpStatus.failed")}
										</StatusBadge>
									) : agent.available ? (
										<StatusBadge tone="warn">
											{t("agent:acpStatus.notProbed")}
										</StatusBadge>
									) : (
										<StatusBadge tone="muted">
											{t("agent:acpStatus.notInstalled")}
										</StatusBadge>
									)}
								</div>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label={t("common:remove")}
									onClick={() => void onRemove(agent.id)}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						);
					})}
				</SettingsGroup>
			) : null}

			{adding ? (
				<SettingsGroup>
					<div className="space-y-2.5 px-3.5 py-3">
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
				</SettingsGroup>
			) : null}

			{error ? (
				<p className="mt-1 px-1 text-destructive text-xs">{error}</p>
			) : null}
		</>
	);
}

function KeyboardPane() {
	const { t } = useTranslation(["settings", "shortcuts"]);
	const groups = shortcutsByGroup();

	return (
		<>
			<PageTitle title={t("keyboard.title")} />
			{groups.map(({ group, items }) => (
				<div key={group} className="mb-5">
					<p className="mb-1.5 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
						{t(`shortcuts:groups.${GROUP_KEY[group]}`)}
					</p>
					<SettingsGroup>
						{items.map((item) => (
							<ShortcutRow key={item.id} def={item} />
						))}
					</SettingsGroup>
				</div>
			))}
		</>
	);
}

function ShortcutRow({ def }: { def: ShortcutDef }) {
	const { t } = useTranslation(["shortcuts", "sidebar"]);
	// "Show in Finder" is macOS wording; use the platform-specific file-manager name.
	const label =
		def.id === "revealInFinder"
			? t(`sidebar:${revealInOsLabelKey()}`)
			: t(`labels.${def.id}`);
	return (
		<div className="flex items-center justify-between gap-4 border-b px-3.5 py-2.5 last:border-b-0">
			<span className="text-[13px]">{label}</span>
			<kbd className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-medium font-sans text-[12px] text-foreground tracking-wide">
				{formatShortcut(def)}
			</kbd>
		</div>
	);
}

function PrivacyPane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation("settings");
	return (
		<>
			<PageTitle title={t("privacy.title")} />
			<SettingsGroup>
				<SettingsRow label={t("privacy.analytics.label")} htmlFor="analytics">
					<Switch
						id="analytics"
						checked={settings.analyticsEnabled}
						onCheckedChange={(v) => patch({ analyticsEnabled: v })}
					/>
				</SettingsRow>
				<SettingsRow label={t("privacy.crash.label")} htmlFor="crash">
					<Switch
						id="crash"
						checked={settings.shareCrashReports}
						onCheckedChange={(v) => patch({ shareCrashReports: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

function AboutPane() {
	const { t } = useTranslation("settings");
	return (
		<>
			<PageTitle title={t("about.title")} />
			<SettingsGroup>
				<div className="space-y-1 px-3.5 py-4 text-center">
					<p className="font-semibold text-base tracking-tight">Motif</p>
					<p className="text-muted-foreground text-sm">
						{t("about.version", { version: "0.1.0" })}
					</p>
					<p className="pt-2 text-muted-foreground text-xs leading-relaxed">
						{t("about.tagline")}
					</p>
				</div>
			</SettingsGroup>
		</>
	);
}
