import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	PageTitle,
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import type { SettingsHostContext } from "@/components/settings/types";
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
import { notifyError } from "@/lib/core/notify";
import { isTauri } from "@/lib/core/tauri";
import {
	PAPER_TREE_LABEL_MODES,
	PAPER_TREE_SORT_MODES,
	type PaperTreeLabelMode,
	type PaperTreeSortMode,
} from "@/lib/paper";
import {
	type ConnectorStatus,
	connectorGetStatus,
	connectorSetEnabled,
	connectorSetPort,
} from "@/lib/paper/import/connector";
import {
	type AppSettings,
	AUTO_UPDATE_INTERNAL_LINKS,
	type AutoUpdateInternalLinks,
	DEFAULT_TRANSLATOR_BASE_URL,
} from "@/lib/settings";

export function GeneralPane({
	settings,
	patch,
	hostContext,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
	hostContext: SettingsHostContext;
}) {
	const { t } = useTranslation("settings");
	return (
		<>
			<PageTitle title={t("general.title")} />
			{hostContext.kind === "remote" ? (
				<p className="mb-3 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-muted-foreground text-xs leading-relaxed">
					{t("host.remoteContextHint", {
						host: hostContext.label,
						path: hostContext.remotePath || "—",
					})}
				</p>
			) : null}
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
				<SettingsRow label={t("general.paperTreeLabelMode.label")}>
					<Select
						value={settings.paperTreeLabelMode}
						onValueChange={(v) =>
							patch({ paperTreeLabelMode: v as PaperTreeLabelMode })
						}
					>
						<SelectTrigger size="sm" className="min-w-[180px] max-w-[240px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAPER_TREE_LABEL_MODES.map((mode) => (
								<SelectItem key={mode} value={mode}>
									{t(`general.paperTreeLabelMode.${mode}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("general.paperTreeSortMode.label")}>
					<Select
						value={settings.paperTreeSortMode}
						onValueChange={(v) =>
							patch({ paperTreeSortMode: v as PaperTreeSortMode })
						}
					>
						<SelectTrigger size="sm" className="min-w-[180px] max-w-[240px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAPER_TREE_SORT_MODES.map((mode) => (
								<SelectItem key={mode} value={mode}>
									{t(`general.paperTreeSortMode.${mode}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow
					label={t("general.autoUpdateInternalLinks.label")}
					description={t("general.autoUpdateInternalLinks.hint")}
				>
					<Select
						value={settings.autoUpdateInternalLinks}
						onValueChange={(value) =>
							patch({
								autoUpdateInternalLinks: value as AutoUpdateInternalLinks,
							})
						}
					>
						<SelectTrigger size="sm" className="min-w-[180px] max-w-[240px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{AUTO_UPDATE_INTERNAL_LINKS.map((mode) => (
								<SelectItem key={mode} value={mode}>
									{t(`general.autoUpdateInternalLinks.${mode}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
			</SettingsGroup>
			<p className="px-0.5 text-muted-foreground text-xs leading-relaxed">
				{t("general.paperTreeLabelMode.hint")}
			</p>
			<p className="px-0.5 text-muted-foreground text-xs leading-relaxed">
				{t("general.paperTreeSortMode.hint")}
			</p>
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
			<SettingsGroup>
				<SettingsRow
					label={t("general.batchImportConcurrency.label")}
					htmlFor="batch-import-concurrency"
					description={t("general.batchImportConcurrency.hint")}
				>
					<Input
						id="batch-import-concurrency"
						type="number"
						min={1}
						max={10}
						step={1}
						value={settings.batchImportConcurrency}
						onChange={(e) => {
							const v = Number.parseInt(e.target.value, 10);
							if (Number.isNaN(v)) return;
							patch({
								batchImportConcurrency: Math.max(1, Math.min(10, v)),
							});
						}}
						className="h-8 w-20 tabular-nums"
					/>
				</SettingsRow>
				<SettingsRow
					label={t("general.citationOnline.label")}
					htmlFor="citation-online"
					description={t("general.citationOnline.hint")}
				>
					<Switch
						id="citation-online"
						checked={settings.citationOnlineEnabled}
						onCheckedChange={(v) => patch({ citationOnlineEnabled: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
			<ConnectorSettingsBlock settings={settings} patch={patch} />
			<RemoteCacheSettingsBlock />
		</>
	);
}

function formatBytes(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "0 B";
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function RemoteCacheSettingsBlock() {
	const { t } = useTranslation("settings");
	const [stats, setStats] = useState<{
		bytes: number;
		files: number;
		maxBytes: number;
	} | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		if (!isTauri()) return;
		try {
			const { remoteCacheStats } = await import(
				"@/lib/vault/remote/remote-vault"
			);
			const s = await remoteCacheStats();
			setStats({ bytes: s.bytes, files: s.files, maxBytes: s.maxBytes });
		} catch {
			setStats(null);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const onClear = async () => {
		if (!isTauri() || busy) return;
		setBusy(true);
		try {
			const { remoteCacheClear } = await import(
				"@/lib/vault/remote/remote-vault"
			);
			await remoteCacheClear();
			await refresh();
		} catch (e) {
			notifyError(
				e instanceof Error ? e.message : t("general.remoteCache.clearFailed"),
			);
		} finally {
			setBusy(false);
		}
	};

	const sizeLine = stats
		? t("general.remoteCache.size", {
				used: formatBytes(stats.bytes),
				files: stats.files,
				max: formatBytes(stats.maxBytes),
			})
		: t("general.remoteCache.sizeUnknown");

	return (
		<div className="mt-4">
			<p className="mb-2 px-0.5 font-medium text-[13px]">
				{t("general.remoteCache.section")}
			</p>
			<SettingsGroup>
				<SettingsRow label={t("general.remoteCache.label")}>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8"
						disabled={busy || !isTauri()}
						onClick={() => void onClear()}
					>
						{busy
							? t("general.remoteCache.clearing")
							: t("general.remoteCache.clear")}
					</Button>
				</SettingsRow>
			</SettingsGroup>
			<p className="mt-2 px-0.5 text-muted-foreground text-xs leading-relaxed">
				{t("general.remoteCache.hint")}
			</p>
			<p className="px-0.5 font-mono text-[11px] text-muted-foreground leading-relaxed">
				{sizeLine}
			</p>
		</div>
	);
}

function ConnectorSettingsBlock({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation("settings");
	const [status, setStatus] = useState<ConnectorStatus | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		if (!isTauri()) return;
		try {
			setStatus(await connectorGetStatus());
		} catch {
			// ignore probe failures in settings
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
			const { listen } = await import("@tauri-apps/api/event");
			if (cancelled) return;
			unsubs.push(
				await listen<ConnectorStatus>("connector:status", (e) => {
					setStatus(e.payload);
				}),
			);
		})();
		return () => {
			cancelled = true;
			for (const u of unsubs) u();
		};
	}, []);

	const onToggle = async (enabled: boolean) => {
		patch({ connectorEnabled: enabled });
		if (!isTauri()) return;
		setBusy(true);
		try {
			const next = await connectorSetEnabled(enabled);
			setStatus(next);
			if (enabled && next.lastError) {
				notifyError(next.lastError);
			}
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
			patch({ connectorEnabled: false });
		} finally {
			setBusy(false);
		}
	};

	const onPortBlur = async (value: string) => {
		const port = Number.parseInt(value, 10);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			notifyError(t("general.connector.invalidPort"));
			return;
		}
		patch({ connectorPort: port });
		if (!isTauri()) return;
		try {
			setStatus(await connectorSetPort(port));
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		}
	};

	const statusLine = (() => {
		if (!isTauri()) return t("general.connector.desktopOnly");
		if (!status) {
			return settings.connectorEnabled
				? t("general.connector.statusStarting")
				: t("general.connector.statusOff");
		}
		if (status.lastError) {
			return t("general.connector.statusError", {
				message: status.lastError,
			});
		}
		if (status.listening) {
			const base = t("general.connector.statusListening", {
				address: status.boundAddress ?? `127.0.0.1:${status.port}`,
			});
			if (!status.vaultPath) {
				return `${base} · ${t("general.connector.statusNoVault")}`;
			}
			return base;
		}
		if (settings.connectorEnabled) {
			return t("general.connector.statusStarting");
		}
		return t("general.connector.statusOff");
	})();

	return (
		<>
			<SettingsGroup>
				<SettingsRow
					label={t("general.connector.label")}
					htmlFor="connector-enabled"
				>
					<Switch
						id="connector-enabled"
						checked={settings.connectorEnabled}
						disabled={busy}
						onCheckedChange={(v) => void onToggle(v)}
					/>
				</SettingsRow>
				<SettingsRow
					label={t("general.connector.portLabel")}
					htmlFor="connector-port"
				>
					<Input
						id="connector-port"
						type="number"
						min={1}
						max={65535}
						className="h-8 w-28"
						defaultValue={settings.connectorPort}
						onBlur={(e) => void onPortBlur(e.currentTarget.value)}
						disabled={busy}
					/>
				</SettingsRow>
			</SettingsGroup>
			<p className="px-0.5 text-muted-foreground text-xs leading-relaxed">
				{t("general.connector.hint")}
			</p>
			<p className="px-0.5 font-mono text-[11px] text-muted-foreground leading-relaxed">
				{statusLine}
			</p>
		</>
	);
}
