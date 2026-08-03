/**
 * App shell UI state (zustand vanilla): side rails, zen modes, palette and
 * dialog visibility, and one-shot open signals. Signal bumps only re-render
 * their subscribers instead of the whole App.
 */

import { createStore } from "zustand/vanilla";
import type { SkillDiscovery } from "@/lib/paper/lookup";
import type { PaletteMode } from "@/lib/shell/commands/types";

export type RightSidebarTab =
	| "agent"
	| "backlinks"
	| "annotations"
	| "references";

/** Crop + multi-turn payload when opening a visual-trace pin in Agent. */
export type AgentSessionOpenVisualTrace = {
	/** Stable mark id (product session key). */
	traceId: string;
	page: number;
	comment: string;
	paperPath?: string;
	image?: { data: string; mimeType: string };
	messages: Array<{
		id: string;
		role: "user" | "assistant";
		content: string;
		createdAt: string;
		agentSessionId?: string;
	}>;
	status?: "running" | "completed" | "failed";
};

/** One-shot request to open a specific Agent session from PDF pins. */
export type AgentSessionOpenRequest = {
	/** Monotonic id so identical payloads still re-trigger. */
	nonce: number;
	agentId: string;
	/** Agentero runtime/event session id from runOnce. */
	runtimeSessionId: string;
	/** ACP provider session id when available. */
	providerSessionId?: string;
	messageId?: string;
	title?: string;
	/** Original user prompt / display text. */
	prompt?: string;
	/** Local answer fallback when provider history cannot be loaded. */
	answerSnapshot?: string;
	/**
	 * Full visual-trace transcript for Open in Agent.
	 * Prefer this over prompt+answerSnapshot alone (multi-turn + image chip).
	 */
	visualTrace?: AgentSessionOpenVisualTrace;
	/** Absolute paper path for mark finalizers on follow-up turns. */
	paperAbsPath?: string;
};

type UiStore = {
	sidebarCollapsed: boolean;
	/** Right sidebar (⌘L): Agent (default) or Backlinks with Graph below. */
	rightSidebarOpen: boolean;
	rightSidebarTab: RightSidebarTab;
	/** Agent zen mode: hide vault chrome, full-width Agent chat. */
	agentZenMode: boolean;
	/** Immersive full-window PDF reading. */
	pdfZenMode: boolean;
	/** Keep AgentPanel mounted across sidebar ↔ zen so chat history survives. */
	agentPanelMounted: boolean;
	/** Increment to open magic-wand popover (⇧⌘I). */
	lookupOpenSignal: number;
	/** Zotero one-click migration dialog. */
	zoteroOpen: boolean;
	commandOpen: boolean;
	commandMode: PaletteMode;
	settingsOpen: boolean;
	skillImportDraft: SkillDiscovery[] | null;
	/** PDF visual-trace → Agent session open (consumed once). */
	agentSessionOpenRequest: AgentSessionOpenRequest | null;
};

export const uiStore = createStore<UiStore>(() => ({
	sidebarCollapsed: false,
	rightSidebarOpen: false,
	rightSidebarTab: "agent",
	agentZenMode: false,
	pdfZenMode: false,
	agentPanelMounted: false,
	lookupOpenSignal: 0,
	zoteroOpen: false,
	commandOpen: false,
	commandMode: "go",
	settingsOpen: false,
	skillImportDraft: null,
	agentSessionOpenRequest: null,
}));

export function setSidebarCollapsedState(collapsed: boolean): void {
	uiStore.setState({ sidebarCollapsed: collapsed });
}

export function setRightSidebarOpenState(open: boolean): void {
	uiStore.setState({ rightSidebarOpen: open });
}

export function setRightSidebarTab(tab: RightSidebarTab): void {
	uiStore.setState({ rightSidebarTab: tab });
}

export function setAgentZenMode(zen: boolean): void {
	uiStore.setState({ agentZenMode: zen });
}

export function setPdfZenMode(zen: boolean): void {
	uiStore.setState({ pdfZenMode: zen });
}

export function setAgentPanelMounted(mounted: boolean): void {
	uiStore.setState({ agentPanelMounted: mounted });
}

export function bumpLookupOpenSignal(): void {
	uiStore.setState((s) => ({ lookupOpenSignal: s.lookupOpenSignal + 1 }));
}

export function setZoteroOpen(open: boolean): void {
	uiStore.setState({ zoteroOpen: open });
}

export function setCommandOpen(open: boolean): void {
	uiStore.setState({ commandOpen: open });
}

export function setCommandMode(mode: PaletteMode): void {
	uiStore.setState({ commandMode: mode });
}

export function openPalette(mode: PaletteMode): void {
	const { commandOpen, commandMode } = uiStore.getState();
	if (commandOpen && commandMode === mode) {
		uiStore.setState({ commandOpen: false });
		return;
	}
	uiStore.setState({ commandMode: mode, commandOpen: true });
}

export function setSettingsOpenState(open: boolean): void {
	uiStore.setState({ settingsOpen: open });
}

export function setSkillImportDraft(draft: SkillDiscovery[] | null): void {
	uiStore.setState({ skillImportDraft: draft });
}

/**
 * Imperative layout controller registered by the App shell (panel refs and
 * zen-mode resize live in the React layer; plain actions call through here).
 */
export type LayoutController = {
	setLeftCollapsed: (collapsed: boolean) => void;
	setRightCollapsed: (
		collapsed: boolean,
		opts?: { focusAgent?: boolean },
	) => void;
	enterAgentZen: () => void;
	exitAgentZen: () => void;
	enterPdfZen: () => void;
	exitPdfZen: () => void;
	/** Expand the left rail and move focus into it. */
	focusSidebar: () => void;
	focusEditorPane: () => void;
	focusNotesEditor: () => void;
};

let layoutController: LayoutController | null = null;

export function registerLayoutController(next: LayoutController | null): void {
	layoutController = next;
}

export function layout(): LayoutController | null {
	return layoutController;
}

export function toggleSidebar(): void {
	const { agentZenMode, sidebarCollapsed } = uiStore.getState();
	if (agentZenMode) return;
	// React state is source of truth — isCollapsed() can lag at 0px.
	layout()?.setLeftCollapsed(!sidebarCollapsed);
}

/** Title-bar toggle: mounts the Agent panel when opening. */
export function toggleRightSidebar(): void {
	const { agentZenMode, rightSidebarOpen, rightSidebarTab } =
		uiStore.getState();
	if (agentZenMode) return;
	if (!rightSidebarOpen) setAgentPanelMounted(true);
	layout()?.setRightCollapsed(rightSidebarOpen, {
		focusAgent: !rightSidebarOpen && rightSidebarTab === "agent",
	});
}

/** ⌘L — toggle right sidebar (defaults to agent). */
export function toggleChat(): void {
	const { agentZenMode, rightSidebarOpen, rightSidebarTab } =
		uiStore.getState();
	if (agentZenMode) return;
	layout()?.setRightCollapsed(rightSidebarOpen, {
		focusAgent: !rightSidebarOpen && rightSidebarTab === "agent",
	});
}

/**
 * Open right sidebar on a tab (or switch tab if already open).
 * Prefer {@link openLeaf} from `@/lib/shell/leaf` for new call sites that may
 * later use `placement: "window"`.
 */
export function openRightTab(tab: RightSidebarTab): void {
	setRightSidebarTab(tab);
	if (tab === "agent") setAgentPanelMounted(true);
	if (!uiStore.getState().rightSidebarOpen) {
		layout()?.setRightCollapsed(false, { focusAgent: tab === "agent" });
	}
}

let agentSessionOpenNonce = 0;

/** Request Agent panel to open a runtime/provider session (PDF pin click). */
export function requestOpenAgentSession(
	input: Omit<AgentSessionOpenRequest, "nonce">,
): void {
	agentSessionOpenNonce += 1;
	uiStore.setState({
		agentSessionOpenRequest: {
			...input,
			nonce: agentSessionOpenNonce,
		},
	});
	openRightTab("agent");
}

export function clearAgentSessionOpenRequest(): void {
	if (!uiStore.getState().agentSessionOpenRequest) return;
	uiStore.setState({ agentSessionOpenRequest: null });
}

export function toggleAgentZen(): void {
	if (uiStore.getState().agentZenMode) layout()?.exitAgentZen();
	else layout()?.enterAgentZen();
}

export function togglePdfZen(): void {
	if (uiStore.getState().pdfZenMode) layout()?.exitPdfZen();
	else layout()?.enterPdfZen();
}
