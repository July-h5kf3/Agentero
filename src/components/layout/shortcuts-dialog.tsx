import { useTranslation } from "react-i18next";

import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useOverlayRegistration } from "@/hooks/use-overlay-registration";
import {
	formatShortcut,
	type ShortcutDef,
	type ShortcutGroup,
	shortcutsByGroup,
} from "@/lib/shortcuts";

const GROUP_KEY: Record<ShortcutGroup, "app" | "vault" | "navigation"> = {
	App: "app",
	Vault: "vault",
	Navigation: "navigation",
};

/** Quick keyboard-shortcut cheat sheet (opened with ⌘/); mirrors Settings. */
export function ShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { t } = useTranslation(["shortcuts", "settings"]);
	const groups = shortcutsByGroup();

	useOverlayRegistration("shortcuts", open, () => onOpenChange(false));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t("settings:keyboard.title")}</DialogTitle>
				</DialogHeader>
				<div className="agentero-scroll -mr-2 max-h-[70vh] overflow-y-auto pr-2">
					{groups.map(({ group, items }) => (
						<div key={group} className="mb-4">
							<p className="mb-1.5 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
								{t(`shortcuts:groups.${GROUP_KEY[group]}`)}
							</p>
							<div className="overflow-hidden rounded-lg border">
								{items.map((def) => (
									<ShortcutRow key={def.id} def={def} />
								))}
							</div>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function ShortcutRow({ def }: { def: ShortcutDef }) {
	const { t } = useTranslation("shortcuts");
	return (
		<div className="flex items-center justify-between gap-4 border-b px-3 py-2 last:border-b-0">
			<span className="text-[13px]">{t(`labels.${def.id}`)}</span>
			<kbd className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-medium font-sans text-[12px] text-foreground tracking-wide">
				{formatShortcut(def)}
			</kbd>
		</div>
	);
}
