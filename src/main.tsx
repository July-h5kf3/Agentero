import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PdfEngineHost } from "@/components/viewer/embed/engine-provider";
import { initLogger, logger } from "@/lib/core/logger";
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

async function boot() {
	await initLogger();
	logger.info("op start frontend_boot");

	// Host XDG settings.json (migrates legacy localStorage once).
	await ensureSettingsLoaded();
	initSettingsSync();
	applyUiTheme(loadSettings().uiTheme);
	subscribeSettings((s) => applyUiTheme(s.uiTheme));
	const locale = resolveLocale(loadSettings().locale);
	await i18n.changeLanguage(locale);
	if (typeof document !== "undefined") {
		document.documentElement.lang = locale;
	}

	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
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
