import { Check, FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOverlayRegistration } from "@/hooks/use-overlay-registration";
import { usePapersOrgFolders } from "@/hooks/use-papers-org-folders";
import { normalizePath } from "@/lib/core/path";
import { cn } from "@/lib/core/utils";
import type { FileNode } from "@/lib/vault";

/**
 * Destination picker for batch-moving papers into a `papers/` subfolder.
 * Lists existing org folders (excluding paper folders and the moved items) and
 * offers a "new folder" path. The Host validates + performs the actual move.
 */
export function MovePapersDialog({
	open,
	onOpenChange,
	nodes,
	vaultPath,
	count,
	sourcePaths,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	nodes: FileNode[];
	vaultPath: string | null;
	count: number;
	sourcePaths: string[];
	onConfirm: (destParentRel: string) => void;
}) {
	const { t } = useTranslation("sidebar");
	const [selected, setSelected] = useState("papers");
	const [newFolder, setNewFolder] = useState("");

	useOverlayRegistration("move-papers", open, () => onOpenChange(false));

	// Reset the form each time the dialog opens.
	useEffect(() => {
		if (open) {
			setSelected("papers");
			setNewFolder("");
		}
	}, [open]);

	/** Existing org folders under papers/ (papers root first), minus the sources. */
	const folders = usePapersOrgFolders(vaultPath, nodes, sourcePaths);

	const typed = newFolder.trim();
	const dest = typed
		? normalizePath(typed.startsWith("papers") ? typed : `papers/${typed}`)
		: selected;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="flex max-h-[80vh] flex-col sm:max-w-md"
				aria-describedby={undefined}
			>
				<DialogHeader>
					<DialogTitle>{t("fileTree.moveDialog.title", { count })}</DialogTitle>
				</DialogHeader>

				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
					<div className="space-y-1.5">
						<Label className="text-xs">
							{t("fileTree.moveDialog.existing")}
						</Label>
						<ScrollArea className="h-48 rounded-md border">
							<div className="space-y-0.5 p-1.5">
								{folders.map((rel) => {
									const active = !typed && selected === rel;
									return (
										<button
											key={rel}
											type="button"
											className={cn(
												"flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors hover:bg-accent",
												active && "bg-muted",
											)}
											onClick={() => {
												setSelected(rel);
												setNewFolder("");
											}}
										>
											<span className="flex-1 truncate">
												{rel === "papers"
													? t("fileTree.moveDialog.papersRoot")
													: rel}
											</span>
											{active ? (
												<Check className="size-3.5 shrink-0 text-primary" />
											) : null}
										</button>
									);
								})}
							</div>
						</ScrollArea>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="move-new-folder" className="text-xs">
							{t("fileTree.moveDialog.newFolder")}
						</Label>
						<div className="relative">
							<FolderPlus className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
							<Input
								id="move-new-folder"
								value={newFolder}
								onChange={(e) => setNewFolder(e.target.value)}
								placeholder={t("fileTree.moveDialog.newFolderHint")}
								className="pl-8"
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(false)}
					>
						{t("fileTree.moveDialog.cancel")}
					</Button>
					<Button
						type="button"
						disabled={!dest.startsWith("papers")}
						onClick={() => onConfirm(dest)}
					>
						{t("fileTree.moveDialog.confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
