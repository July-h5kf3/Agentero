import type { Window } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { isTauri } from "@/lib/core/tauri";

/**
 * Custom caption buttons (minimize / maximize / close) for the frameless
 * title bar on non-macOS desktop platforms.
 *
 * macOS keeps its native traffic lights via the Overlay title bar, so App only
 * renders this on Windows / Linux where the window is created without native
 * decorations (see `window_new` / setup in the Tauri host).
 */
export function WindowControls() {
	const { t } = useTranslation("app");
	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		if (!isTauri()) return;
		let cancelled = false;
		let unlisten: (() => void) | undefined;
		void (async () => {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			const win = getCurrentWindow();
			const sync = async () => {
				try {
					setMaximized(await win.isMaximized());
				} catch {
					// window state is best-effort; ignore
				}
			};
			await sync();
			const un = await win.onResized(() => {
				void sync();
			});
			if (cancelled) {
				un();
				return;
			}
			unlisten = un;
		})();
		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, []);

	const withWindow = (action: (win: Window) => Promise<void>) => {
		void (async () => {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			try {
				await action(getCurrentWindow());
			} catch {
				// ignore — window op unavailable outside the desktop app
			}
		})();
	};

	return (
		<div className="flex shrink-0 items-center gap-0.5 pr-1 pl-1">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={t("titlebar.minimize")}
						onClick={() => withWindow((w) => w.minimize())}
					>
						<Minus className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">{t("titlebar.minimize")}</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={
							maximized ? t("titlebar.restore") : t("titlebar.maximize")
						}
						onClick={() => withWindow((w) => w.toggleMaximize())}
					>
						{maximized ? (
							<Copy className="size-3" />
						) : (
							<Square className="size-3" />
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{maximized ? t("titlebar.restore") : t("titlebar.maximize")}
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={t("titlebar.close")}
						className="hover:bg-destructive hover:text-white dark:hover:bg-destructive dark:hover:text-white"
						onClick={() => withWindow((w) => w.close())}
					>
						<X className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">{t("titlebar.close")}</TooltipContent>
			</Tooltip>
		</div>
	);
}
