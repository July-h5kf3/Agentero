import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsSection } from "@/components/settings/types";
import { WindowControls } from "@/components/shell/window-controls";
import { isMacOS, isTauri } from "@/lib/core/tauri";
import { cn } from "@/lib/core/utils";
import {
	ensureSettingsLoaded,
	loadSettings,
	saveSettingsAsync,
	subscribeSettings,
} from "@/lib/settings";
import { SettingsContent } from "./settings-content";

function readSearchParams() {
	const params = new URLSearchParams(window.location.search);
	const section = (params.get("section") ?? "general") as SettingsSection;
	const vaultPath = params.get("vault_path");
	return { section, vaultPath };
}

function closeCurrentWindow() {
	void (async () => {
		if (!isTauri()) return;
		try {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			await getCurrentWindow().close();
		} catch (e) {
			console.warn("[settings-native-root] close failed", e);
		}
	})();
}

/**
 * Native Settings window chrome + content.
 *
 * Loaded by `main.tsx` when `?window=settings` is present. It does not mount
 * the full `App`, so the second webview stays lightweight.
 */
export function SettingsNativeRoot() {
	const { t } = useTranslation(["settings", "app"]);
	const [{ section, vaultPath }, setSearchParams] = useState(readSearchParams);
	const [settings, setSettings] = useState(loadSettings);
	const isMac = useMemo(() => isMacOS(), []);

	useEffect(() => {
		let cancelled = false;
		void ensureSettingsLoaded().then(() => {
			if (!cancelled) setSettings(loadSettings());
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		return subscribeSettings((next) => {
			setSettings(next);
		});
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const isComma = event.key === "," || event.code === "Comma";
			const isEsc = event.key === "Escape";
			const metaOrCtrl = event.metaKey || event.ctrlKey;
			if (
				isEsc ||
				(isComma && metaOrCtrl && !event.altKey && !event.shiftKey)
			) {
				event.preventDefault();
				closeCurrentWindow();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const handleSectionChange = useCallback((next: SettingsSection) => {
		setSearchParams((prev) => ({ ...prev, section: next }));
		const url = new URL(window.location.href);
		url.searchParams.set("section", next);
		window.history.replaceState(null, "", url.toString());
	}, []);

	const handleChange = useCallback(async (next: typeof settings) => {
		setSettings(next);
		try {
			await saveSettingsAsync(next);
		} catch (e) {
			console.warn("[settings-native-root] save failed", e);
		}
	}, []);

	return (
		<div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
			{/* Window chrome */}
			<header
				className={cn(
					"flex h-8 shrink-0 items-center border-b select-none",
					isMac && "bg-muted/40",
				)}
			>
				{isMac ? (
					<div
						className="w-[92px] shrink-0 self-stretch"
						data-tauri-drag-region
					/>
				) : (
					<div
						className="flex flex-1 items-center gap-1.5 px-2"
						data-tauri-drag-region
					>
						<Settings className="size-3.5 text-muted-foreground" />
						<span className="text-[13px] font-medium">{t("title")}</span>
					</div>
				)}
				{!isMac && <WindowControls />}
			</header>

			{/* Content */}
			<div className="flex min-h-0 flex-1">
				<SettingsContent
					section={section}
					onSectionChange={handleSectionChange}
					settings={settings}
					onChange={handleChange}
					vaultPath={vaultPath}
				/>
			</div>
		</div>
	);
}
