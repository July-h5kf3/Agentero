import { Circle, LogOut, QrCode, X } from "lucide-react";
import { type TouchEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import agenteroLogo from "@/assets/agentero-logo.svg";
import { MobileNav, type MobileTab } from "@/components/mobile/mobile-nav";
import { Button } from "@/components/ui/button";
import type { BridgeClientStatus } from "@/lib/bridge/client";
import { bridgeDisconnect } from "@/lib/bridge/client";
import { cn } from "@/lib/core/utils";

export function MobileSidebar({
	open,
	tab,
	status,
	onTab,
	onClose,
	onStatus,
	onPairAnother,
}: {
	open: boolean;
	tab: MobileTab;
	status: BridgeClientStatus;
	onTab: (tab: MobileTab) => void;
	onClose: () => void;
	onStatus: (status: BridgeClientStatus) => void;
	onPairAnother: () => void;
}) {
	const { t } = useTranslation("mobile");
	const touchStartRef = useRef<{ x: number; y: number } | null>(null);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose, open]);

	const disconnect = async () => {
		await bridgeDisconnect();
		onStatus({ connected: false, paired: false });
		onClose();
	};

	const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
		const touch = event.touches[0];
		if (touch) {
			touchStartRef.current = { x: touch.clientX, y: touch.clientY };
		}
	};

	const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
		const start = touchStartRef.current;
		touchStartRef.current = null;
		if (!start) return;
		const touch = event.changedTouches[0];
		if (!touch) return;
		const deltaX = touch.clientX - start.x;
		const deltaY = Math.abs(touch.clientY - start.y);
		if (deltaX < -60 && Math.abs(deltaX) > deltaY * 1.25) {
			onClose();
		}
	};

	return (
		<div
			className={cn(
				"fixed inset-0 z-40 transition-[visibility] duration-200",
				open ? "visible" : "invisible",
			)}
			aria-hidden={!open}
		>
			<button
				type="button"
				className={cn(
					"absolute inset-0 bg-black/30 transition-opacity",
					open ? "opacity-100" : "opacity-0",
				)}
				aria-label={t("settings.closeMenu")}
				tabIndex={open ? 0 : -1}
				onClick={onClose}
			/>
			<aside
				className={cn(
					"absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col border-r bg-background pt-[env(safe-area-inset-top)] shadow-xl transition-transform duration-200 ease-out",
					open ? "translate-x-0" : "-translate-x-full",
				)}
				aria-label={t("settings.menu")}
				onTouchStart={handleTouchStart}
				onTouchEnd={handleTouchEnd}
			>
				<header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
					<div className="flex items-center gap-2">
						<img src={agenteroLogo} alt="" className="size-7" />
						<span className="font-semibold text-sm">Agentero</span>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={t("settings.closeMenu")}
						onClick={onClose}
					>
						<X className="size-4" />
					</Button>
				</header>

				<div className="flex-1 overflow-y-auto px-4 py-5">
					<section className="border-b pb-5">
						<MobileNav tab={tab} onTab={onTab} variant="sidebar" />
					</section>
					<section className="pt-5">
						<div className="mb-3 flex items-center justify-between gap-3">
							<h2 className="font-semibold text-lg text-foreground">
								{t("settings.title")}
							</h2>
							<span
								className={cn(
									"flex items-center gap-1.5 rounded-full px-2 py-1 font-medium text-xs",
									status.connected
										? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
										: "bg-muted text-muted-foreground",
								)}
							>
								<Circle
									className={cn(
										"size-2 fill-current",
										status.connected
											? "text-emerald-500"
											: "text-muted-foreground",
									)}
								/>
								{status.connected
									? t("settings.connected")
									: t("settings.offline")}
							</span>
						</div>
						<dl className="divide-y rounded-lg border">
							<div className="flex min-h-14 items-center justify-between gap-4 px-3">
								<dt className="text-foreground text-sm">
									{t("settings.computer")}
								</dt>
								<dd className="max-w-[65%] truncate text-right text-sm">
									{status.hostName ?? "-"}
								</dd>
							</div>
							<div className="flex min-h-14 items-center justify-between gap-4 px-3">
								<dt className="text-foreground text-sm">
									{t("settings.vault")}
								</dt>
								<dd className="max-w-[65%] truncate text-right text-sm">
									{status.vaultName ?? "-"}
								</dd>
							</div>
						</dl>
					</section>
				</div>

				<footer className="space-y-2 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
					<Button
						type="button"
						size="lg"
						className="h-12 w-full justify-start gap-3 rounded-xl px-3"
						onClick={() => {
							onPairAnother();
							onClose();
						}}
					>
						<QrCode className="size-5 text-primary-foreground" />
						<span>{t("settings.addDesktop")}</span>
					</Button>
					<Button
						type="button"
						variant="outline"
						size="lg"
						className="h-12 w-full justify-start gap-3 rounded-xl border-destructive/30 bg-destructive/5 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
						onClick={() => void disconnect()}
					>
						<LogOut className="size-5" />
						<span>{t("settings.disconnect")}</span>
					</Button>
				</footer>
			</aside>
		</div>
	);
}
