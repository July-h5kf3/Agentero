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
				<SettingsRow label={t("general.autoUpdateInternalLinks.label")}>
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
			<ConnectorSettingsBlock settings={settings} patch={patch} />
			<RemoteCacheSettingsBlock />
		</>
	);
}

function RemoteCacheSettingsBlock() {
	const { t } = useTranslation("settings");
	const [busy, setBusy] = useState(false);

	const onClear = async () => {
		if (!isTauri() || busy) return;
		setBusy(true);
		try {
			const { remoteCacheClear } = await import(
				"@/lib/vault/remote/remote-vault"
			);
			await remoteCacheClear();
		} catch (e) {
			notifyError(
				e instanceof Error ? e.message : t("general.remoteCache.clearFailed"),
			);
		} finally {
			setBusy(false);
		}
	};

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
		if (status.listening && !status.vaultPath) {
			return t("general.connector.statusNoVault");
		}
		if (status.listening) {
			return null;
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
					description={t("general.connector.hint")}
				>
					<Switch
						id="connector-enabled"
						checked={settings.connectorEnabled}
						disabled={busy}
						onCheckedChange={(v) => void onToggle(v)}
					/>
				</SettingsRow>
				<SettingsRow
					label={
						<>
							{t("general.connector.portLabel")}
							{status?.listening ? (
								<span
									role="img"
									aria-label="listening"
									className="ml-1.5 inline-block size-2 rounded-full bg-emerald-500 align-middle"
								/>
							) : null}
						</>
					}
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
			{statusLine ? (
				<p className="px-0.5 font-mono text-[11px] text-muted-foreground leading-relaxed">
					{statusLine}
				</p>
			) : null}
		</>
	);
}
