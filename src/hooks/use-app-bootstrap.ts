/**
 * App bootstrap effects: store seeding, theme / locale / uiScale application,
 * restored-vault validation, per-vault side effects (tree, library, skills),
 * and the native settings-window closed listener.
 */

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useSettings, useVaultStore } from "@/hooks/use-app-stores";
import i18n, { resolveLocale } from "@/i18n";
import { isTauri } from "@/lib/core/tauri";
import { refreshLibrary } from "@/lib/paper/library-store";
import { initSettingsStore } from "@/lib/settings/react-store";
import { setSettingsOpenState } from "@/lib/shell/ui-store";
import { seedVaultSkills, validateRestoredVault } from "@/lib/vault/actions";
import {
	initVaultStore,
	refreshTree,
	setTree,
	setTreeLoading,
} from "@/lib/vault/store";
import { initWorkspaceStore } from "@/lib/workspace/store";

export function useAppBootstrap(): void {
	const { setTheme } = useTheme();

	// Seed stores from persisted state on first render (after settings boot).
	useState(() => {
		initSettingsStore();
		initVaultStore();
		initWorkspaceStore();
		return null;
	});

	const theme = useSettings((s) => s.theme);
	const locale = useSettings((s) => s.locale);
	const uiScale = useSettings((s) => s.uiScale);
	const vaultPath = useVaultStore((s) => s.vaultPath);

	useEffect(() => {
		setTheme(theme);
	}, [theme, setTheme]);

	useEffect(() => {
		const resolved = resolveLocale(locale);
		void i18n.changeLanguage(resolved);
		if (typeof document !== "undefined") {
			document.documentElement.lang = resolved;
		}
		if (!isTauri()) return;
		void (async () => {
			try {
				const { invoke } = await import("@tauri-apps/api/core");
				await invoke("set_locale", { locale: resolved });
			} catch {
				// Native menu keeps its previous locale; non-fatal.
			}
		})();
	}, [locale]);

	useEffect(() => {
		if (typeof document === "undefined") return;
		document.documentElement.style.fontSize = `${16 * uiScale}px`;
		// Note: macOS traffic lights are positioned at build-time; Tauri v2 does
		// not expose a runtime setter for the main window's traffic lights.
	}, [uiScale]);

	// Validate the restored local Vault before restoring its tree and tabs.
	useEffect(() => {
		validateRestoredVault();
	}, []);

	// Per-vault side effects: tree reload, library rows, bundled-skill seeding.
	useEffect(() => {
		if (!vaultPath) {
			setTree([]);
			setTreeLoading(false);
			void refreshLibrary();
			return;
		}
		void refreshTree(vaultPath);
		void refreshLibrary();
		seedVaultSkills(vaultPath);
	}, [vaultPath]);

	// Mirror the native settings window's lifecycle into the ui store.
	useEffect(() => {
		if (!isTauri()) return;
		let unlisten: (() => void) | undefined;
		void (async () => {
			const { listen } = await import("@tauri-apps/api/event");
			unlisten = await listen("settings_window_closed", () => {
				setSettingsOpenState(false);
			});
		})();
		return () => {
			unlisten?.();
		};
	}, []);
}
