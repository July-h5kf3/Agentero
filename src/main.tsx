import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PdfEngineHost } from "@/components/viewer/embed/engine-provider";
import { initLogger, logger } from "@/lib/core/logger";
import { notifyAction, notifyError } from "@/lib/core/notify";
import { initAutoHideScrollbars } from "@/lib/core/scrollbars";
import { isTauri } from "@/lib/core/tauri";
import {
	ensureSettingsLoaded,
	initSettingsSync,
	loadSettings,
	subscribeSettings,
} from "@/lib/settings";
import { applyUiTheme } from "@/lib/ui/theme";
import { checkForUpdate, installAvailableUpdate } from "@/lib/update";
import i18n, { resolveLocale } from "./i18n";
import "./index.css";
// KaTeX CSS must load with the main bundle: lazy-loaded editors are not the
// only consumers (Streamdown in the Agent panel renders math too).
import "katex/dist/katex.min.css";

const searchParams = new URLSearchParams(window.location.search);
const isSettingsWindow = searchParams.get("window") === "settings";

async function boot() {
	await initLogger();
	logger.info("op start frontend_boot");

	// Host XDG settings.json (migrates legacy localStorage once).
	await ensureSettingsLoaded();
	initSettingsSync();
	await applyUiTheme(loadSettings().uiTheme).catch((e) => {
		console.warn("[theme] failed to apply initial UI theme", e);
	});
	subscribeSettings((s) => {
		void applyUiTheme(s.uiTheme);
	});
	initAutoHideScrollbars();
	const locale = resolveLocale(loadSettings().locale);
	await i18n.changeLanguage(locale);
	if (typeof document !== "undefined") {
		document.documentElement.lang = locale;
	}

	const root = document.getElementById("root") as HTMLElement;
	if (isSettingsWindow) {
		const { SettingsNativeRoot } = await import(
			"@/components/settings/settings-native-root"
		);
		ReactDOM.createRoot(root).render(
			<React.StrictMode>
				<I18nextProvider i18n={i18n}>
					<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
						<TooltipProvider delayDuration={300}>
							<SettingsNativeRoot />
							{/* Global error / notice stack (top-right); use notifyError from @/lib/notify */}
							<Toaster />
						</TooltipProvider>
					</ThemeProvider>
				</I18nextProvider>
			</React.StrictMode>,
		);
		return;
	}

	// Lazy-load the full app so the settings window (which returns above) never
	// downloads/parses the heavyweight workspace bundle.
	const { default: App } = await import("./App");
	ReactDOM.createRoot(root).render(
		<React.StrictMode>
			<I18nextProvider i18n={i18n}>
				<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
					<TooltipProvider delayDuration={300}>
						<PdfEngineHost>
							<App />
						</PdfEngineHost>
						{/* Global error / notice stack (top-right); use notifyError from @/lib/notify */}
						<Toaster />
					</TooltipProvider>
				</ThemeProvider>
			</I18nextProvider>
		</React.StrictMode>,
	);
	void checkForStartupUpdate();
}

/** A single main window owns the background update notification. */
async function checkForStartupUpdate(): Promise<void> {
	if (!isTauri()) return;
	try {
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		if (getCurrentWindow().label !== "main") return;
		const update = await checkForUpdate();
		if (update.phase !== "available" || !update.availableVersion) return;
		notifyAction(
			i18n.t("settings:about.update.toastTitle", {
				version: update.availableVersion,
			}),
			{
				id: "app-update-available",
				description: i18n.t("settings:about.update.toastDescription"),
				actionLabel: i18n.t("settings:about.update.downloadInstall"),
				onAction: () => {
					void installAvailableUpdate().then((next) => {
						if (next.phase === "error") {
							notifyError(i18n.t("settings:about.update.installFailed"));
						}
					});
				},
			},
		);
	} catch (error) {
		logger.warn("op end updater_startup_check ok=false", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

void boot().catch((e) => {
	// A failed boot used to leave an empty <body> with no key handlers, so the
	// window (especially the separate Settings webview) looked blank and could
	// not be dismissed from the keyboard. Surface the error and wire Esc/⌘W so
	// the window is always closable.
	console.error("[boot] failed", e);
	const root = document.getElementById("root");
	if (root) {
		root.textContent = `Failed to start: ${e instanceof Error ? e.message : String(e)}`;
		root.setAttribute(
			"style",
			"padding:24px;font:13px system-ui;white-space:pre-wrap;",
		);
	}
	window.addEventListener("keydown", (event) => {
		const quit =
			event.key === "Escape" ||
			((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w");
		if (!quit) return;
		void import("@tauri-apps/api/window")
			.then(({ getCurrentWindow }) => getCurrentWindow().close())
			.catch(() => undefined);
	});
});
