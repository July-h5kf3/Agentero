import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initLogger, logger } from "@/lib/logger";
import App from "./App";
import i18n from "./i18n";
import "./index.css";

void initLogger().then(() => {
	logger.info("op start frontend_boot");
});

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
