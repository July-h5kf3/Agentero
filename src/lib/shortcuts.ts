/**
 * App shortcuts aligned with common macOS / Apple HIG patterns.
 * Display uses Apple symbols: ⌘ ⌥ ⇧ ⌃
 */

export type ShortcutId =
	| "settings"
	| "newWindow"
	| "openVault"
	| "createVault"
	| "refreshTree"
	| "revealInFinder"
	| "deleteTreeItem"
	| "magicWand"
	| "toggleSidebar"
	| "toggleChat"
	| "toggleAgentZen"
	| "closeSheet"
	| "focusSidebar"
	| "focusEditor"
	| "focusNotes";

export type ShortcutGroup = "App" | "Navigation" | "Vault";

export type ShortcutDef = {
	id: ShortcutId;
	/** Grouping label (translated for display via the `shortcuts` namespace) */
	group: ShortcutGroup;
	/** Keys without modifiers, lower-case letter or special */
	key: string;
	meta?: boolean;
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	/** When true, only matches if settings/modal is open */
	whenSettingsOpen?: boolean;
	/** When true, only matches if settings is closed */
	whenSettingsClosed?: boolean;
};

export const SHORTCUTS: ShortcutDef[] = [
	{
		id: "settings",
		group: "App",
		key: ",",
		meta: true,
	},
	{
		id: "closeSheet",
		group: "App",
		key: "Escape",
		whenSettingsOpen: true,
	},
	{
		id: "newWindow",
		group: "App",
		key: "n",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "openVault",
		group: "Vault",
		key: "o",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "createVault",
		group: "Vault",
		key: "n",
		meta: true,
		shift: true,
		whenSettingsClosed: true,
	},
	{
		id: "refreshTree",
		group: "Vault",
		key: "r",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "revealInFinder",
		group: "Vault",
		// ⌥⌘R — reveal selected tree item in Finder / Explorer
		key: "r",
		meta: true,
		alt: true,
		whenSettingsClosed: true,
	},
	{
		id: "deleteTreeItem",
		group: "Vault",
		// ⌘⌫ — delete selected file tree item (with confirm)
		key: "Backspace",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "magicWand",
		group: "Vault",
		// ⇧⌘I — open identifier / magic-wand import popover
		key: "i",
		meta: true,
		shift: true,
		whenSettingsClosed: true,
	},
	{
		id: "toggleSidebar",
		group: "Navigation",
		// Apple Mail / Preview family uses ⌥⌘S; many Mac productivity apps use ⌘B.
		// Prefer ⌥⌘S for platform feel; ⌘B kept as secondary alias in matcher.
		key: "s",
		meta: true,
		alt: true,
		whenSettingsClosed: true,
	},
	{
		id: "toggleChat",
		group: "Navigation",
		key: "l",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "toggleAgentZen",
		group: "Navigation",
		// ⌥⌘Z — agent zen / quest mode (full-screen chat)
		key: "z",
		meta: true,
		alt: true,
		whenSettingsClosed: true,
	},
	{
		id: "focusSidebar",
		group: "Navigation",
		key: "1",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "focusEditor",
		group: "Navigation",
		key: "2",
		meta: true,
		whenSettingsClosed: true,
	},
	{
		id: "focusNotes",
		group: "Navigation",
		key: "3",
		meta: true,
		whenSettingsClosed: true,
	},
];

/** Secondary aliases that still work (documented lightly). */
const ALIASES: Partial<Record<ShortcutId, ShortcutDef[]>> = {
	toggleSidebar: [
		{
			id: "toggleSidebar",
			group: "Navigation",
			key: "b",
			meta: true,
			whenSettingsClosed: true,
		},
	],
};

export function formatShortcut(def: ShortcutDef): string {
	if (def.key === "Escape") return "Esc";

	const isMac =
		typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad|iPod/.test(navigator.platform);

	const parts: string[] = [];
	if (def.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
	if (def.alt) parts.push(isMac ? "⌥" : "Alt");
	if (def.shift) parts.push(isMac ? "⇧" : "Shift");
	if (def.meta) parts.push(isMac ? "⌘" : "Ctrl");

	const keyLabel =
		def.key === ","
			? ","
			: def.key === "Backspace"
				? isMac
					? "⌫"
					: "Backspace"
				: def.key === "Escape"
					? "Esc"
					: def.key.length === 1
						? def.key.toUpperCase()
						: def.key;
	parts.push(keyLabel);
	return parts.join(isMac ? "" : "+");
}

/** Format the primary shortcut for an id (platform-aware) for tooltip interpolation. */
export function formatShortcutById(id: ShortcutId): string {
	const def = SHORTCUTS.find((s) => s.id === id);
	return def ? formatShortcut(def) : "";
}

export function matchShortcut(event: KeyboardEvent, def: ShortcutDef): boolean {
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
	const defKey = def.key.length === 1 ? def.key.toLowerCase() : def.key;
	if (key !== defKey && event.key !== def.key) return false;

	const wantMeta = Boolean(def.meta);
	const wantAlt = Boolean(def.alt);
	const wantShift = Boolean(def.shift);
	const wantCtrl = Boolean(def.ctrl);

	// On Windows/Linux, treat Ctrl as ⌘ equivalent when meta is required.
	const metaOrCtrl = event.metaKey || event.ctrlKey;
	if (wantMeta) {
		if (!metaOrCtrl) return false;
	} else if (event.metaKey) {
		return false;
	}

	if (wantCtrl && !wantMeta && !event.ctrlKey) return false;
	if (wantAlt !== event.altKey) return false;
	if (wantShift !== event.shiftKey) return false;

	// When meta maps to ctrl on non-Mac, ignore pure ctrl-only false positives
	if (!wantMeta && !wantCtrl && event.ctrlKey) return false;

	return true;
}

export function resolveShortcutId(
	event: KeyboardEvent,
	opts: { settingsOpen: boolean },
): ShortcutId | null {
	const candidates = SHORTCUTS.flatMap((def) => {
		const aliases = ALIASES[def.id] ?? [];
		return [def, ...aliases];
	});

	for (const def of candidates) {
		if (def.whenSettingsOpen && !opts.settingsOpen) continue;
		if (def.whenSettingsClosed && opts.settingsOpen) continue;
		if (matchShortcut(event, def)) return def.id;
	}
	return null;
}

export function shortcutsByGroup(): {
	group: ShortcutGroup;
	items: ShortcutDef[];
}[] {
	const order = ["App", "Vault", "Navigation"] as const;
	return order.map((group) => ({
		group,
		items: SHORTCUTS.filter((s) => s.group === group),
	}));
}
