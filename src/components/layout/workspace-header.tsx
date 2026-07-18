import {
	ArrowLeft,
	Bot,
	Focus,
	Link2,
	MessageSquareText,
	PanelLeft,
	PanelRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocumentTabBar } from "@/components/layout/document-tab-bar";
import { LayoutMenu } from "@/components/layout/layout-menu";
import { WindowControls } from "@/components/layout/window-controls";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatShortcutById } from "@/lib/shortcuts";
import type { DocTab } from "@/lib/tabs";
import { cn } from "@/lib/utils";

/** Platform-formatted shortcut chips for title bar tooltips (⌥⌘… on macOS, Ctrl+… elsewhere). */
const SIDEBAR_SHORTCUT = formatShortcutById("toggleSidebar");
const CHAT_SHORTCUT = formatShortcutById("toggleChat");
const ZEN_SHORTCUT = formatShortcutById("toggleAgentZen");

type WorkspaceHeaderProps = {
	isMacDesktop: boolean;
	showWindowControls: boolean;
	agentZenMode: boolean;
	sidebarCollapsed: boolean;
	hasVault: boolean;
	tabs: DocTab[];
	activeTabId: string | null;
	notesEligible: boolean;
	showNotes: boolean;
	rightSidebarOpen: boolean;
	rightSidebarTab: "agent" | "backlinks" | "annotations";
	onExitAgentZen: () => void;
	onToggleSidebar: () => void;
	onSelectTab: (id: string) => void;
	onCloseTab: (id: string) => void;
	onReorderTabs: (fromId: string, toId: string) => void;
	onToggleNotes: (open: boolean) => void;
	onToggleRightSidebar: () => void;
	onToggleAgentZen: () => void;
	onEnterAgentZen: () => void;
	onOpenRightTab: (tab: "agent" | "backlinks" | "annotations") => void;
};

/** Title-bar row: window chrome, sidebar toggles, document tabs, layout + agent controls. */
export function WorkspaceHeader({
	isMacDesktop,
	showWindowControls,
	agentZenMode,
	sidebarCollapsed,
	hasVault,
	tabs,
	activeTabId,
	notesEligible,
	showNotes,
	rightSidebarOpen,
	rightSidebarTab,
	onExitAgentZen,
	onToggleSidebar,
	onSelectTab,
	onCloseTab,
	onReorderTabs,
	onToggleNotes,
	onToggleRightSidebar,
	onToggleAgentZen,
	onEnterAgentZen,
	onOpenRightTab,
}: WorkspaceHeaderProps) {
	const { t } = useTranslation(["app"]);

	return (
		<header className="flex h-8 shrink-0 items-center border-b select-none">
			{/*
			  Traffic lights: x=14, three ~14px buttons + gaps → ends ~68px.
			  Keep extra gap so the sidebar toggle never hugs the lights.
			*/}
			{isMacDesktop ? (
				<div
					className="w-[92px] shrink-0 self-stretch"
					data-tauri-drag-region
				/>
			) : (
				<div className="w-2 shrink-0 self-stretch" data-tauri-drag-region />
			)}
			<TooltipProvider delayDuration={250}>
				{agentZenMode ? (
					<>
						{/* Zen: drag strip + back — chat chrome lives in AgentPanel */}
						<div
							className="min-w-0 flex-1 self-stretch"
							data-tauri-drag-region
						/>
						<div className="flex shrink-0 items-center gap-0.5 pr-2">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={t("titlebar.exitAgentZen")}
										onClick={onExitAgentZen}
									>
										<ArrowLeft className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{t("titlebar.exitAgentZenHint", { shortcut: ZEN_SHORTCUT })}
								</TooltipContent>
							</Tooltip>
						</div>
					</>
				) : (
					<>
						<div className="flex shrink-0 items-center gap-0.5 pr-1">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={
											sidebarCollapsed
												? t("titlebar.showLeftSidebar")
												: t("titlebar.hideLeftSidebar")
										}
										aria-pressed={!sidebarCollapsed}
										onClick={onToggleSidebar}
									>
										<PanelLeft className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{sidebarCollapsed
										? t("titlebar.showSidebarHint", {
												shortcut: SIDEBAR_SHORTCUT,
											})
										: t("titlebar.hideSidebarHint", {
												shortcut: SIDEBAR_SHORTCUT,
											})}
								</TooltipContent>
							</Tooltip>
						</div>
						{/* Document tabs share the title bar row with zen / layout icons */}
						{hasVault && tabs.length ? (
							<DocumentTabBar
								tabs={tabs}
								activeId={activeTabId}
								onSelect={onSelectTab}
								onClose={onCloseTab}
								onReorder={onReorderTabs}
							/>
						) : (
							<div
								className="min-w-0 flex-1 self-stretch"
								data-tauri-drag-region
							/>
						)}
						<div className="flex shrink-0 items-center gap-0.5 pr-2">
							<LayoutMenu
								leftSidebarOpen={!sidebarCollapsed}
								onToggleLeftSidebar={onToggleSidebar}
								notesAvailable={notesEligible}
								notesOpen={showNotes}
								onToggleNotes={onToggleNotes}
								rightSidebarOpen={rightSidebarOpen}
								onToggleRightSidebar={onToggleRightSidebar}
								zenMode={agentZenMode}
								onToggleZen={onToggleAgentZen}
							/>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={t("titlebar.enterAgentZen")}
										aria-pressed={agentZenMode}
										onClick={onEnterAgentZen}
									>
										<Focus className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{t("titlebar.enterAgentZenHint", { shortcut: ZEN_SHORTCUT })}
								</TooltipContent>
							</Tooltip>
							{rightSidebarOpen ? (
								<>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={t("titlebar.agentPanel")}
												aria-pressed={rightSidebarTab === "agent"}
												className={cn(
													rightSidebarTab === "agent" &&
														"bg-muted text-foreground",
												)}
												onClick={() => onOpenRightTab("agent")}
											>
												<Bot className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											{t("labels.agent")}
										</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={t("titlebar.backlinksPanel")}
												aria-pressed={rightSidebarTab === "backlinks"}
												className={cn(
													rightSidebarTab === "backlinks" &&
														"bg-muted text-foreground",
												)}
												onClick={() => onOpenRightTab("backlinks")}
											>
												<Link2 className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											{t("labels.backlinks")}
										</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={t("titlebar.annotationsPanel")}
												aria-pressed={rightSidebarTab === "annotations"}
												className={cn(
													rightSidebarTab === "annotations" &&
														"bg-muted text-foreground",
												)}
												onClick={() => onOpenRightTab("annotations")}
											>
												<MessageSquareText className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											{t("annotations.title", { ns: "viewer" })}
										</TooltipContent>
									</Tooltip>
								</>
							) : null}
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={
											rightSidebarOpen
												? t("titlebar.hideRightSidebar")
												: t("titlebar.showRightSidebar")
										}
										aria-pressed={rightSidebarOpen}
										onClick={onToggleRightSidebar}
									>
										<PanelRight className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{rightSidebarOpen
										? t("titlebar.hideRightSidebarHint", {
												shortcut: CHAT_SHORTCUT,
											})
										: t("titlebar.showRightSidebarHint", {
												shortcut: CHAT_SHORTCUT,
											})}
								</TooltipContent>
							</Tooltip>
						</div>
					</>
				)}
				{showWindowControls ? <WindowControls /> : null}
			</TooltipProvider>
		</header>
	);
}
