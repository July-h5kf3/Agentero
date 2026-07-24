import { PanelsTopLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatShortcut, SHORTCUTS, type ShortcutId } from "@/lib/shortcuts";

/** Display string (⌥⌘S / Ctrl+Alt+S …) for a shortcut id, empty if none. */
function shortcutFor(id: ShortcutId): string {
	const def = SHORTCUTS.find((s) => s.id === id);
	return def ? formatShortcut(def) : "";
}

type LayoutMenuProps = {
	leftSidebarOpen: boolean;
	onToggleLeftSidebar: () => void;
	/** Notes column only applies while a paper PDF/HTML is open. */
	notesAvailable: boolean;
	notesOpen: boolean;
	onToggleNotes: (open?: boolean) => void;
	rightSidebarOpen: boolean;
	onToggleRightSidebar: () => void;
	zenMode: boolean;
	onToggleZen: () => void;
};

/**
 * Centralized panel visibility control (VS Code "Customize Layout" style):
 * one dropdown that reflects and toggles every workbench pane.
 */
export function LayoutMenu({
	leftSidebarOpen,
	onToggleLeftSidebar,
	notesAvailable,
	notesOpen,
	onToggleNotes,
	rightSidebarOpen,
	onToggleRightSidebar,
	zenMode,
	onToggleZen,
}: LayoutMenuProps) {
	const { t } = useTranslation("app");

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={t("titlebar.layout")}
						>
							<PanelsTopLeft className="size-3.5" />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{t("titlebar.layoutHint")}
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel>{t("titlebar.layoutPanels")}</DropdownMenuLabel>
				<DropdownMenuCheckboxItem
					checked={leftSidebarOpen}
					onCheckedChange={() => onToggleLeftSidebar()}
					onSelect={(e) => e.preventDefault()}
				>
					{t("titlebar.layoutLeftSidebar")}
					<DropdownMenuShortcut>
						{shortcutFor("toggleSidebar")}
					</DropdownMenuShortcut>
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={notesOpen}
					disabled={!notesAvailable}
					onCheckedChange={() => onToggleNotes()}
					onSelect={(e) => e.preventDefault()}
				>
					{t("labels.notes")}
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={rightSidebarOpen}
					onCheckedChange={() => onToggleRightSidebar()}
					onSelect={(e) => e.preventDefault()}
				>
					{t("titlebar.layoutRightSidebar")}
					<DropdownMenuShortcut>
						{shortcutFor("toggleChat")}
					</DropdownMenuShortcut>
				</DropdownMenuCheckboxItem>
				<DropdownMenuSeparator />
				<DropdownMenuCheckboxItem
					checked={zenMode}
					onCheckedChange={() => onToggleZen()}
					onSelect={(e) => e.preventDefault()}
				>
					{t("titlebar.enterAgentZen")}
					<DropdownMenuShortcut>
						{shortcutFor("toggleAgentZen")}
					</DropdownMenuShortcut>
				</DropdownMenuCheckboxItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
