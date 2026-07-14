import {
	Bot,
	Info,
	Keyboard,
	Paintbrush,
	Shield,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AppSettings, ThemePreference } from "@/lib/settings";
import {
	formatShortcut,
	type ShortcutDef,
	shortcutsByGroup,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export type SettingsSection =
	| "general"
	| "appearance"
	| "agent"
	| "keyboard"
	| "privacy"
	| "about";

const NAV: {
	id: SettingsSection;
	label: string;
	icon: typeof Bot;
}[] = [
	{ id: "general", label: "General", icon: SlidersHorizontal },
	{ id: "appearance", label: "Appearance", icon: Paintbrush },
	{ id: "agent", label: "Agent", icon: Bot },
	{ id: "keyboard", label: "Keyboard", icon: Keyboard },
	{ id: "privacy", label: "Privacy", icon: Shield },
	{ id: "about", label: "About", icon: Info },
];

type SettingsWindowProps = {
	open: boolean;
	section: SettingsSection;
	onSectionChange: (section: SettingsSection) => void;
	onClose: () => void;
	settings: AppSettings;
	onChange: (next: AppSettings) => void;
};

export function SettingsWindow({
	open,
	section,
	onSectionChange,
	onClose,
	settings,
	onChange,
}: SettingsWindowProps) {
	const titleId = useId();

	useEffect(() => {
		if (!open) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}, [open]);

	if (!open) return null;

	const patch = (partial: Partial<AppSettings>) =>
		onChange({ ...settings, ...partial });

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-6">
			<button
				type="button"
				className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
				aria-label="Dismiss settings"
				onClick={onClose}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className="relative flex h-[min(560px,calc(100vh-3rem))] w-[min(720px,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-background shadow-2xl ring-1 ring-black/5"
			>
				{/* Sidebar — macOS Settings style */}
				<nav className="flex w-[180px] shrink-0 flex-col border-r bg-muted/40">
					<div className="flex items-center justify-between px-3 pt-3 pb-2">
						<span
							id={titleId}
							className="font-semibold text-[13px] tracking-tight"
						>
							Settings
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label="Close"
							onClick={onClose}
						>
							<X className="size-3.5" />
						</Button>
					</div>
					<ul className="flex flex-1 flex-col gap-0.5 px-2 pb-3">
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
										<span className="truncate">{item.label}</span>
									</button>
								</li>
							);
						})}
					</ul>
				</nav>

				{/* Content */}
				<div className="min-w-0 flex-1 overflow-y-auto">
					<div className="px-6 py-5">
						{section === "general" && (
							<GeneralPane settings={settings} patch={patch} />
						)}
						{section === "appearance" && (
							<AppearancePane settings={settings} patch={patch} />
						)}
						{section === "agent" && (
							<AgentPane settings={settings} patch={patch} />
						)}
						{section === "keyboard" && <KeyboardPane />}
						{section === "privacy" && (
							<PrivacyPane settings={settings} patch={patch} />
						)}
						{section === "about" && <AboutPane />}
					</div>
				</div>
			</div>
		</div>
	);
}

function PageTitle({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<div className="mb-4">
			<h2 className="font-semibold text-lg tracking-tight">{title}</h2>
			{description ? (
				<p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
			) : null}
		</div>
	);
}

function SettingsGroup({
	children,
	footer,
}: {
	children: ReactNode;
	footer?: string;
}) {
	return (
		<div className="mb-5">
			<div className="overflow-hidden rounded-xl border bg-card">
				{children}
			</div>
			{footer ? (
				<p className="mt-1.5 px-1 text-muted-foreground text-xs leading-relaxed">
					{footer}
				</p>
			) : null}
		</div>
	);
}

function SettingsRow({
	label,
	description,
	htmlFor,
	children,
}: {
	label: string;
	description?: string;
	htmlFor?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 border-b px-3.5 py-2.5 last:border-b-0">
			<div className="min-w-0 flex-1">
				<Label htmlFor={htmlFor} className="font-normal text-[13px]">
					{label}
				</Label>
				{description ? (
					<p className="mt-0.5 text-muted-foreground text-xs leading-snug">
						{description}
					</p>
				) : null}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

function GeneralPane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	return (
		<>
			<PageTitle
				title="General"
				description="App behavior and vault defaults."
			/>
			<SettingsGroup footer="Vault path is remembered locally on this device.">
				<SettingsRow
					label="Restore last vault"
					description="Reopen the previous folder on launch."
					htmlFor="restore-vault"
				>
					<Switch
						id="restore-vault"
						checked={settings.restoreLastVault}
						onCheckedChange={(v) => patch({ restoreLastVault: v })}
					/>
				</SettingsRow>
				<SettingsRow
					label="Confirm before quit"
					description="Ask when there may be unsaved changes."
					htmlFor="confirm-close"
				>
					<Switch
						id="confirm-close"
						checked={settings.confirmBeforeClose}
						onCheckedChange={(v) => patch({ confirmBeforeClose: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

function AppearancePane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { setTheme } = useTheme();
	const fontId = useId();

	const setThemePref = (theme: ThemePreference) => {
		patch({ theme });
		setTheme(theme);
	};

	return (
		<>
			<PageTitle title="Appearance" description="Theme and editor look." />
			<SettingsGroup>
				<SettingsRow label="Appearance">
					<Select
						value={settings.theme}
						onValueChange={(v) => setThemePref(v as ThemePreference)}
					>
						<SelectTrigger size="sm" className="min-w-[120px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="system">System</SelectItem>
							<SelectItem value="light">Light</SelectItem>
							<SelectItem value="dark">Dark</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow
					label="Editor font size"
					description={`${settings.editorFontSize} px`}
					htmlFor={fontId}
				>
					<input
						id={fontId}
						type="range"
						min={12}
						max={20}
						step={1}
						value={settings.editorFontSize}
						onChange={(e) => patch({ editorFontSize: Number(e.target.value) })}
						className="w-28 accent-primary"
					/>
				</SettingsRow>
				<SettingsRow
					label="Line numbers"
					description="Show numbers in the source editor."
					htmlFor="line-numbers"
				>
					<Switch
						id="line-numbers"
						checked={settings.showLineNumbers}
						onCheckedChange={(v) => patch({ showLineNumbers: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

function AgentPane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const [showKey, setShowKey] = useState(false);
	const baseId = useId();
	const keyId = useId();
	const modelId = useId();

	return (
		<>
			<PageTitle
				title="Agent"
				description="Bring your own key. Stored only on this device."
			/>
			<SettingsGroup footer="Keys stay in local storage for now; system keychain support comes later.">
				<SettingsRow
					label="Enable Agent"
					description="Allow agent workflows in the vault."
					htmlFor="agent-enabled"
				>
					<Switch
						id="agent-enabled"
						checked={settings.agentEnabled}
						onCheckedChange={(v) => patch({ agentEnabled: v })}
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup>
				<div className="space-y-3 px-3.5 py-3">
					<div className="space-y-1.5">
						<Label htmlFor={baseId} className="font-normal text-[13px]">
							Base URL
						</Label>
						<Input
							id={baseId}
							value={settings.agentBaseUrl}
							disabled={!settings.agentEnabled}
							onChange={(e) => patch({ agentBaseUrl: e.target.value })}
							placeholder="https://api.anthropic.com"
							autoComplete="off"
							spellCheck={false}
						/>
					</div>
					<div className="space-y-1.5">
						<div className="flex items-center justify-between">
							<Label htmlFor={keyId} className="font-normal text-[13px]">
								API Key
							</Label>
							<button
								type="button"
								className="text-muted-foreground text-xs hover:text-foreground"
								onClick={() => setShowKey((s) => !s)}
							>
								{showKey ? "Hide" : "Show"}
							</button>
						</div>
						<Input
							id={keyId}
							type={showKey ? "text" : "password"}
							value={settings.agentApiKey}
							disabled={!settings.agentEnabled}
							onChange={(e) => patch({ agentApiKey: e.target.value })}
							placeholder="sk-…"
							autoComplete="off"
							spellCheck={false}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={modelId} className="font-normal text-[13px]">
							Model
						</Label>
						<Input
							id={modelId}
							value={settings.agentModel}
							disabled={!settings.agentEnabled}
							onChange={(e) => patch({ agentModel: e.target.value })}
							placeholder="claude-sonnet-4-20250514"
							autoComplete="off"
							spellCheck={false}
						/>
					</div>
				</div>
			</SettingsGroup>
		</>
	);
}

function KeyboardPane() {
	const groups = shortcutsByGroup();

	return (
		<>
			<PageTitle
				title="Keyboard"
				description="Shortcuts follow common macOS conventions."
			/>
			{groups.map(({ group, items }) => (
				<div key={group} className="mb-5">
					<p className="mb-1.5 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
						{group}
					</p>
					<SettingsGroup>
						{items.map((item) => (
							<ShortcutRow key={item.id} def={item} />
						))}
					</SettingsGroup>
				</div>
			))}
			<p className="px-1 text-muted-foreground text-xs">
				Sidebar can also be toggled with ⌘B. On Windows / Linux, ⌘ is Ctrl.
			</p>
		</>
	);
}

function ShortcutRow({ def }: { def: ShortcutDef }) {
	return (
		<div className="flex items-center justify-between gap-4 border-b px-3.5 py-2.5 last:border-b-0">
			<span className="text-[13px]">{def.label}</span>
			<kbd className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-medium font-sans text-[12px] text-foreground tracking-wide">
				{formatShortcut(def)}
			</kbd>
		</div>
	);
}

function PrivacyPane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	return (
		<>
			<PageTitle
				title="Privacy"
				description="Local-first by default. Nothing leaves this Mac unless you opt in."
			/>
			<SettingsGroup footer="Analytics and crash reports are off until you enable them.">
				<SettingsRow
					label="Analytics"
					description="Share anonymous usage metrics."
					htmlFor="analytics"
				>
					<Switch
						id="analytics"
						checked={settings.analyticsEnabled}
						onCheckedChange={(v) => patch({ analyticsEnabled: v })}
					/>
				</SettingsRow>
				<SettingsRow
					label="Crash reports"
					description="Send diagnostic data when the app quits unexpectedly."
					htmlFor="crash"
				>
					<Switch
						id="crash"
						checked={settings.shareCrashReports}
						onCheckedChange={(v) => patch({ shareCrashReports: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

function AboutPane() {
	return (
		<>
			<PageTitle title="About" />
			<SettingsGroup>
				<div className="space-y-1 px-3.5 py-4 text-center">
					<p className="font-semibold text-base tracking-tight">Motif</p>
					<p className="text-muted-foreground text-sm">Version 0.1.0</p>
					<p className="pt-2 text-muted-foreground text-xs leading-relaxed">
						Local-first research vault for people and agents.
					</p>
				</div>
			</SettingsGroup>
		</>
	);
}
