/**
 * In-app rename dialog (WebView JavaScript prompts are not portable).
 * Self-subscribes to the wiki store; confirm runs the link-aware rename.
 */

import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWikiStore } from "@/hooks/use-app-stores";
import { useOverlayRegistration } from "@/hooks/use-overlay-registration";
import { confirmRenamePath } from "@/lib/vault/actions";
import { setRenameDraft, setRenameError, wikiStore } from "@/lib/wiki/store";

function closeIfIdle() {
	if (wikiStore.getState().renameBusy) return;
	setRenameDraft(null);
	setRenameError(null);
}

export function RenamePathDialog() {
	const { t } = useTranslation(["sidebar"]);
	const renameDraft = useWikiStore((s) => s.renameDraft);
	const renameBusy = useWikiStore((s) => s.renameBusy);
	const renameError = useWikiStore((s) => s.renameError);
	useOverlayRegistration("rename-path", renameDraft !== null, closeIfIdle);

	return (
		<Dialog
			open={renameDraft !== null}
			onOpenChange={(open) => {
				if (!open) closeIfIdle();
			}}
		>
			<DialogContent showCloseButton={!renameBusy} className="sm:max-w-sm">
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void confirmRenamePath();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{t("sidebar:fileTree.renameDialogTitle", {
								name: renameDraft?.currentName ?? "",
							})}
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-1.5">
						<label
							htmlFor="rename-path-name"
							className="block pt-2 font-medium text-sm"
						>
							{t("sidebar:fileTree.renameNameLabel")}
						</label>
						<Input
							id="rename-path-name"
							autoFocus
							value={renameDraft?.value ?? ""}
							disabled={renameBusy}
							onFocus={(event) => event.currentTarget.select()}
							onChange={(event) => {
								const value = event.target.value;
								setRenameDraft((current) =>
									current ? { ...current, value } : current,
								);
								if (wikiStore.getState().renameError) setRenameError(null);
							}}
						/>
						{renameError ? (
							<p className="text-destructive text-xs" role="alert">
								{renameError}
							</p>
						) : null}
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={renameBusy}
							onClick={() => {
								setRenameDraft(null);
								setRenameError(null);
							}}
						>
							{t("sidebar:fileTree.renameCancel")}
						</Button>
						<Button
							type="submit"
							disabled={renameBusy || !renameDraft?.value.trim()}
						>
							{renameBusy ? <Loader2 className="animate-spin" /> : null}
							{t("sidebar:fileTree.renameConfirm")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
