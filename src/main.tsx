import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PdfEngineHost } from "@/components/viewer/embed/engine-provider";
import { initLogger, logger } from "@/lib/core/logger";
import { initAutoHideScrollbars } from "@/lib/core/scrollbars";
import {
	ensureSettingsLoaded,
	initSettingsSync,
	loadSettings,
	subscribeSettings,
} from "@/lib/settings";
import { applyUiTheme } from "@/lib/ui/theme";
import App from "./App";
import i18n, { resolveLocale } from "./i18n";
import "./index.css";

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
}

void boot();
