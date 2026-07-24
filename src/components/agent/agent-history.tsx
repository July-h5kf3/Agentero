import { History, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { ChatSessionHistoryItem } from "@/lib/agent-chat-state";
import { displayHistoryTitle } from "@/lib/agent-prompt-display";
import { cn } from "@/lib/utils";

export function HistorySessionList({
	sessionHistory,
	activeTabId,
	submitting,
	variant,
	onOpen,
}: {
	sessionHistory: ChatSessionHistoryItem[];
	activeTabId: string;
	submitting: boolean;
	/** `sidebar` = dense multi-line cards; `zen` = single-line quiet list. */
	variant: "sidebar" | "zen";
	onOpen: (item: ChatSessionHistoryItem) => void;
}) {
	const { t } = useTranslation("agent");

	if (sessionHistory.length === 0) {
		return (
			<p
				className={cn(
					variant === "zen"
						? "px-2 py-1.5 text-[12px] text-muted-foreground/55"
						: "px-3 py-4 text-muted-foreground text-sm leading-none",
				)}
			>
				{t("history.empty")}
			</p>
		);
	}

	if (variant === "zen") {
		return (
			<ul className="flex flex-col gap-0.5">
				{sessionHistory.map((item) => {
					const isActive = item.id === activeTabId;
					return (
						<li key={item.id}>
							<button
								type="button"
								disabled={submitting}
								title={item.title}
								onClick={() => onOpen(item)}
								className={cn(
									"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-snug outline-none transition-colors",
									"focus-visible:ring-1 focus-visible:ring-ring",
									"disabled:cursor-not-allowed disabled:opacity-50",
									isActive
										? "bg-background/80 text-foreground shadow-sm"
										: "text-muted-foreground hover:bg-background/50 hover:text-foreground/80",
								)}
							>
								{item.status === "running" ? (
									<span
										className="size-1.5 shrink-0 rounded-full bg-emerald-500/80"
										aria-hidden
									/>
								) : null}
								<span className="min-w-0 flex-1 truncate font-normal">
									{displayHistoryTitle(item.title, item.id.slice(0, 8))}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		);
	}

	return (
		<div className="max-h-72 overflow-y-auto p-1.5">
			{sessionHistory.map((item) => {
				const isActive = item.id === activeTabId;
				return (
					<button
						key={item.id}
						type="button"
						disabled={submitting}
						className={cn(
							"flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
							isActive
								? "bg-muted text-foreground"
								: "hover:bg-muted/70 focus-visible:bg-muted/70",
						)}
						onClick={() => onOpen(item)}
					>
						<span className="text-muted-foreground text-xs leading-none">
							{item.agentName} · {t(`history.status.${item.status}`)} ·{" "}
							{item.id.slice(0, 8)}
						</span>
						<span className="line-clamp-2 font-medium text-sm leading-snug">
							{displayHistoryTitle(item.title, item.id.slice(0, 8))}
						</span>
						<span className="text-muted-foreground text-xs leading-none">
							{item.startedAt}
						</span>
					</button>
				);
			})}
		</div>
	);
}

/** Zen left rail — quiet Quest-style nav. */
export function ZenHistoryRail({
	sessionHistory,
	activeTabId,
	submitting,
	onNewConversation,
	onOpenSession,
}: {
	sessionHistory: ChatSessionHistoryItem[];
	activeTabId: string;
	submitting: boolean;
	onNewConversation: () => void;
	onOpenSession: (item: ChatSessionHistoryItem) => void;
}) {
	const { t } = useTranslation("agent");

	return (
		<aside className="flex w-52 shrink-0 flex-col border-border/40 border-r bg-muted/25 sm:w-56">
			<div className="shrink-0 px-2.5 pt-2.5 pb-1.5">
				<button
					type="button"
					aria-label={t("tabs.new")}
					disabled={submitting}
					onClick={onNewConversation}
					className={cn(
						"flex h-8 w-full items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 text-left text-sm text-foreground/80 shadow-none transition-colors",
						"hover:bg-background hover:text-foreground",
						"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						"disabled:cursor-not-allowed disabled:opacity-50",
					)}
				>
					<Plus className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate font-normal">
						{t("tabs.new")}
					</span>
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
				<p className="px-2 pb-1 pt-2 text-[11px] font-normal tracking-wide text-muted-foreground/70">
					{t("history.label")}
				</p>
				{sessionHistory.length === 0 ? (
					<p className="px-2 py-1.5 text-[12px] text-muted-foreground/55">
						{t("history.empty")}
					</p>
				) : (
					<HistorySessionList
						sessionHistory={sessionHistory}
						activeTabId={activeTabId}
						submitting={submitting}
						variant="zen"
						onOpen={onOpenSession}
					/>
				)}
			</div>
		</aside>
	);
}

/** Sidebar-mode header: new chat + history popover (+ optional actions). */
export function SidebarHistoryTrailing({
	historyOpen,
	onHistoryOpenChange,
	sessionHistory,
	activeTabId,
	submitting,
	headerActions,
	onNewConversation,
	onOpenSession,
}: {
	historyOpen: boolean;
	onHistoryOpenChange: (open: boolean) => void;
	sessionHistory: ChatSessionHistoryItem[];
	activeTabId: string;
	submitting: boolean;
	headerActions?: ReactNode;
	onNewConversation: () => void;
	onOpenSession: (item: ChatSessionHistoryItem) => void;
}) {
	const { t } = useTranslation("agent");

	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label={t("tabs.new")}
				title={t("tabs.new")}
				disabled={submitting}
				onClick={onNewConversation}
			>
				<Plus className="size-4" />
			</Button>
			<Popover open={historyOpen} onOpenChange={onHistoryOpenChange}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 gap-1 px-1.5 font-normal text-muted-foreground text-sm leading-none hover:text-foreground"
						aria-label={t("history.aria")}
						title={t("history.label")}
						disabled={submitting}
					>
						<History className="size-3.5" />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="end" className="w-80 p-0">
					<PopoverHeader className="border-b px-3 py-2">
						<PopoverTitle className="font-medium text-sm leading-none">
							{t("history.title")}
						</PopoverTitle>
						<PopoverDescription className="text-muted-foreground text-sm leading-snug">
							{t("history.description")}
						</PopoverDescription>
					</PopoverHeader>
					{sessionHistory.length === 0 ? (
						<div className="px-3 py-4 text-muted-foreground text-sm leading-none">
							{t("history.empty")}
						</div>
					) : (
						<HistorySessionList
							sessionHistory={sessionHistory}
							activeTabId={activeTabId}
							submitting={submitting}
							variant="sidebar"
							onOpen={onOpenSession}
						/>
					)}
				</PopoverContent>
			</Popover>
			{headerActions}
		</>
	);
}
