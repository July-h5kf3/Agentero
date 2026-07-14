import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import i18n from "./i18n";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<I18nextProvider i18n={i18n}>
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<TooltipProvider delayDuration={300}>
					<App />
				</TooltipProvider>
			</ThemeProvider>
		</I18nextProvider>
	</React.StrictMode>,
);
