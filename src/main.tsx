import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initLogger, logger } from "@/lib/logger";
import { ensureSettingsLoaded, loadSettings } from "@/lib/settings";
import App from "./App";
import i18n, { resolveLocale } from "./i18n";
import "./index.css";

async function boot() {
	await initLogger();
	logger.info("op start frontend_boot");

	// Host XDG settings.json (migrates legacy localStorage once).
	await ensureSettingsLoaded();
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
						<App />
						{/* Global error / notice stack (top-right); use notifyError from @/lib/notify */}
						<Toaster />
					</TooltipProvider>
				</ThemeProvider>
			</I18nextProvider>
		</React.StrictMode>,
	);
}

void boot();
