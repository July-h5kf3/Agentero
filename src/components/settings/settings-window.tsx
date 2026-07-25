import { useTranslation } from "react-i18next";
import { SettingsContent } from "@/components/settings/settings-content";
import type { SettingsSection } from "@/components/settings/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useOverlayRegistration } from "@/hooks/use-overlay-registration";
import type { AppSettings } from "@/lib/settings";

export { SettingsContent } from "@/components/settings/settings-content";
export type {
	SettingsHostContext,
	SettingsSection,
} from "@/components/settings/types";

type SettingsWindowProps = {
	open: boolean;
	section: SettingsSection;
	onSectionChange: (section: SettingsSection) => void;
	onClose: () => void;
	settings: AppSettings;
	onChange: (next: AppSettings) => void;
	/** Active vault path — remote handles switch Agent settings to the SSH host. */
	vaultPath?: string | null;
};

/** In-app settings modal (overlay); shares SettingsContent with the unused native window root. */
export function SettingsWindow({
	open,
	section,
	onSectionChange,
	onClose,
	settings,
	onChange,
	vaultPath = null,
}: SettingsWindowProps) {
	const { t } = useTranslation("settings");

	useOverlayRegistration("settings", open, onClose);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				showCloseButton={false}
				aria-describedby={undefined}
				className="flex h-[min(560px,calc(100vh-3rem))] w-[min(720px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden bg-background p-0 shadow-2xl sm:max-w-none"
			>
				<DialogTitle className="sr-only">{t("title")}</DialogTitle>
				<SettingsContent
					section={section}
					onSectionChange={onSectionChange}
					onClose={onClose}
					settings={settings}
					onChange={onChange}
					vaultPath={vaultPath}
				/>
			</DialogContent>
		</Dialog>
	);
}
