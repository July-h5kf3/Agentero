import {
	Bot,
	Info,
	Keyboard,
	Languages,
	Paintbrush,
	SlidersHorizontal,
	X,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { HostOsIcon, normalizeHostOs } from "@/components/icons/host-os-icon";
import { AboutPane } from "@/components/settings/panes/about-pane";
import {
	AgentPane,
	RemoteAgentPane,
} from "@/components/settings/panes/agent-pane";
import { AppearancePane } from "@/components/settings/panes/appearance-pane";
import { GeneralPane } from "@/components/settings/panes/general-pane";
import { KeyboardPane } from "@/components/settings/panes/keyboard-pane";
import { TranslatePane } from "@/components/settings/panes/translate-pane";
import type {
	SettingsHostContext,
	SettingsSection,
} from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { getPlatformOS, isTauri } from "@/lib/core/tauri";
import { cn } from "@/lib/core/utils";
import type { AppSettings } from "@/lib/settings";
import {
	fetchHostIdentity,
	fetchRemoteHostIdentity,
	getRemoteSessionMeta,
	isRemoteVaultHandle,
	remoteSessionIdFromHandle,
} from "@/lib/vault/remote/remote-vault";

const NAV: {
	id: SettingsSection;
	icon: typeof Bot;
}[] = [
	{ id: "general", icon: SlidersHorizontal },
	{ id: "appearance", icon: Paintbrush },
	{ id: "agent", icon: Bot },
	{ id: "translate", icon: Languages },
	{ id: "keyboard", icon: Keyboard },
	{ id: "about", icon: Info },
];

type SettingsContentProps = {
	section: SettingsSection;
	onSectionChange: (section: SettingsSection) => void;
	settings: AppSettings;
	onChange: (next: AppSettings) => void;
	/** Renders a close (X) button when provided (modal mode). */
	onClose?: () => void;
	/** aria-labelledby id supplied by a dialog wrapper. */
	titleId?: string;
	/** Active vault path — remote handles switch Agent settings to the SSH host. */
	vaultPath?: string | null;
};

/** Settings navigation + panes; used by the native settings window and the modal fallback. */
export function SettingsContent({
	section,
	onSectionChange,
	settings,
	onChange,
	onClose,
	titleId,
	vaultPath = null,
}: SettingsContentProps) {
	const { t } = useTranslation(["settings", "common"]);
	const fallbackTitleId = useId();
	const headingId = titleId ?? fallbackTitleId;
	const [localHostLabel, setLocalHostLabel] = useState(() =>
		t("host.thisComputer"),
	);
	const [localOs, setLocalOs] = useState(() =>
		normalizeHostOs(getPlatformOS()),
	);
	const [remoteOs, setRemoteOs] = useState(() => normalizeHostOs("other"));

	// Keep visited panes mounted (hidden when inactive) so switching sections
	// doesn't unmount/remount them — avoids re-running their load effects
	// (agent list, connector status, cache stats, dynamic imports) and makes
	// section switches instant instead of re-fetching on every visit.
	const [visitedSections, setVisitedSections] = useState<SettingsSection[]>([
		section,
	]);
	useEffect(() => {
		setVisitedSections((prev) =>
			prev.includes(section) ? prev : [...prev, section],
		);
	}, [section]);
	const contentScrollRef = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: section intentionally triggers a scroll-to-top on switch
	useEffect(() => {
		contentScrollRef.current?.scrollTo({ top: 0 });
	}, [section]);

	// Local hostname + OS for the host chip (when vault is local / none).
	useEffect(() => {
		if (!isTauri()) return;
		let cancelled = false;
		void fetchHostIdentity()
			.then((h) => {
				if (cancelled) return;
				if (h.label.trim()) setLocalHostLabel(h.label.trim());
				setLocalOs(normalizeHostOs(h.os));
			})
			.catch(() => {
				/* keep fallback */
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const hostContext = useMemo((): SettingsHostContext => {
		if (vaultPath && isRemoteVaultHandle(vaultPath)) {
			const sessionId = remoteSessionIdFromHandle(vaultPath);
			const meta = getRemoteSessionMeta();
			if (sessionId && meta && meta.sessionId === sessionId) {
				const label =
					meta.host.trim() ||
					meta.displayName.split(":")[0]?.trim() ||
					t("host.remote");
				return {
					kind: "remote",
					label,
					sessionId,
					host: meta.host,
					remotePath: meta.remotePath,
				};
			}
			if (sessionId) {
				return {
					kind: "remote",
					label: t("host.remote"),
					sessionId,
					host: "",
					remotePath: "",
				};
			}
		}
		return { kind: "local", label: localHostLabel };
	}, [vaultPath, localHostLabel, t]);

	// Remote OS via uname -s (for brand icon on remote host chip).
	useEffect(() => {
		if (!isTauri() || hostContext.kind !== "remote") {
			return;
		}
		let cancelled = false;
		setRemoteOs(normalizeHostOs("other"));
		void fetchRemoteHostIdentity(hostContext.sessionId)
			.then((info) => {
				if (!cancelled) setRemoteOs(normalizeHostOs(info.os));
			})
			.catch(() => {
				if (!cancelled) setRemoteOs(normalizeHostOs("other"));
			});
		return () => {
			cancelled = true;
		};
	}, [hostContext]);

	const hostOs = hostContext.kind === "remote" ? remoteOs : localOs;

	const patch = useCallback(
		(partial: Partial<AppSettings>) => onChange({ ...settings, ...partial }),
		[onChange, settings],
	);

	return (
		<>
			{/* Sidebar — macOS Settings style */}
			<nav className="flex w-[180px] shrink-0 flex-col border-r bg-muted/40">
				{/* Modal fallback only: native window already shows the title in its title bar. */}
				{onClose ? (
					<div className="flex items-center justify-between gap-1 px-3 pt-3 pb-2">
						<span
							id={headingId}
							className="font-semibold text-[13px] leading-none tracking-tight"
						>
							{t("title")}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="shrink-0"
							aria-label={t("common:close")}
							onClick={onClose}
						>
							<X className="size-3.5" />
						</Button>
					</div>
				) : null}
				<ul
					className={cn(
						"agentero-scroll flex min-h-0 flex-1 flex-col gap-0.5 px-2 pb-2",
						!onClose && "pt-3",
					)}
				>
					{NAV.map((item) => {
						const Icon = item.icon;
						const active = section === item.id;
						return (
							<li key={item.id}>
								<button
									type="button"
									className={cn(
										"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors",
										"hover:bg-black/5 dark:hover:bg-white/10",
										active &&
											"bg-primary text-primary-foreground hover:bg-primary dark:hover:bg-primary",
									)}
									aria-current={active ? "page" : undefined}
									onClick={() => onSectionChange(item.id)}
								>
									<Icon className="size-3.5 shrink-0 opacity-90" />
									<span className="truncate">{t(`nav.${item.id}`)}</span>
								</button>
							</li>
						);
					})}
				</ul>
				{/* Host context — pinned to sidebar footer */}
				<div
					className="mt-auto flex items-center gap-1.5 border-t px-3 py-2.5 text-muted-foreground"
					title={
						hostContext.kind === "remote"
							? t("host.remoteTooltip", {
									host: hostContext.label,
									path: hostContext.remotePath || "—",
								})
							: t("host.localTooltip", { name: hostContext.label })
					}
				>
					<span className="inline-flex size-3.5 shrink-0 items-center justify-center">
						<HostOsIcon
							os={hostOs}
							className="block size-3.5"
							title={
								hostOs === "macos"
									? "macOS"
									: hostOs === "windows"
										? "Windows"
										: hostOs === "linux"
											? "Linux"
											: undefined
							}
						/>
					</span>
					<span className="min-w-0 truncate text-[12px] leading-none">
						{hostContext.label}
					</span>
				</div>
			</nav>

			{/* Content */}
			<div ref={contentScrollRef} className="agentero-scroll min-w-0 flex-1">
				<div className="px-6 py-5">
					{visitedSections.includes("general") && (
						<div hidden={section !== "general"}>
							<GeneralPane
								settings={settings}
								patch={patch}
								hostContext={hostContext}
							/>
						</div>
					)}
					{visitedSections.includes("appearance") && (
						<div hidden={section !== "appearance"}>
							<AppearancePane
								theme={settings.theme}
								uiTheme={settings.uiTheme}
								locale={settings.locale}
								uiScale={settings.uiScale}
								editorFontSize={settings.editorFontSize}
								showEditorToolbar={settings.showEditorToolbar}
								patch={patch}
							/>
						</div>
					)}
					{visitedSections.includes("agent") && (
						<div hidden={section !== "agent"}>
							{hostContext.kind === "remote" ? (
								<RemoteAgentPane
									settings={settings}
									patch={patch}
									hostContext={hostContext}
								/>
							) : (
								<AgentPane settings={settings} patch={patch} />
							)}
						</div>
					)}
					{visitedSections.includes("translate") && (
						<div hidden={section !== "translate"}>
							<TranslatePane
								settings={settings}
								patch={patch}
								onOpenAgentSettings={() => onSectionChange("agent")}
							/>
						</div>
					)}
					{visitedSections.includes("keyboard") && (
						<div hidden={section !== "keyboard"}>
							<KeyboardPane />
						</div>
					)}
					{visitedSections.includes("about") && (
						<div hidden={section !== "about"}>
							<AboutPane />
						</div>
					)}
				</div>
			</div>
		</>
	);
}
