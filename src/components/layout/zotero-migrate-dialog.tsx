import { FolderOpen, Import, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runBackgroundTask } from "@/lib/background-tasks";
import {
	migrateZotero,
	pickZoteroDir,
	scanZotero,
	type ZoteroScan,
} from "@/lib/zotero-migrate";

/**
 * One-click Zotero migration dialog: pick the Zotero data folder, preview the
 * item/PDF counts, choose whether to copy PDFs, then migrate (progress shows in
 * the background-tasks panel).
 */
export function ZoteroMigrateDialog({
	open,
	onOpenChange,
	vaultPath,
	onDone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	vaultPath: string | null;
	onDone: () => void;
}) {
	const { t } = useTranslation(["sidebar", "app"]);
	const [dir, setDir] = useState<string | null>(null);
	const [scan, setScan] = useState<ZoteroScan | null>(null);
	const [scanning, setScanning] = useState(false);
	const [copyPdfs, setCopyPdfs] = useState(true);
	const [parentDir, setParentDir] = useState("papers");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reset = () => {
		setDir(null);
		setScan(null);
		setScanning(false);
		setError(null);
		setBusy(false);
	};

	const handleOpenChange = (next: boolean) => {
		if (busy) return; // don't close mid-migration
		if (!next) reset();
		onOpenChange(next);
	};

	const chooseFolder = async () => {
		setError(null);
		const picked = await pickZoteroDir();
		if (!picked) return;
		setDir(picked);
		setScan(null);
		setScanning(true);
		try {
			setScan(await scanZotero(picked));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setScanning(false);
		}
	};

	const handleMigrate = async () => {
		if (!vaultPath || !dir || !scan) return;
		setBusy(true);
		setError(null);
		try {
			const result = await runBackgroundTask(
				{
					kind: "import",
					title: t("sidebar:zoteroMigrate.task"),
					detail: dir,
				},
				async ({ setDetail }) => {
					setDetail(t("sidebar:zoteroMigrate.migrating"));
					return migrateZotero({
						vaultPath,
						zoteroDir: dir,
						parentDir: parentDir.trim() || "papers",
						copyPdfs,
					});
				},
			);
			onDone();
			if (result.errors.length > 0) {
				setError(
					t("sidebar:zoteroMigrate.doneWithErrors", {
						imported: result.imported,
						errors: result.errors.length,
					}),
				);
				setBusy(false);
			} else {
				onOpenChange(false);
				reset();
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("sidebar:zoteroMigrate.title")}</DialogTitle>
					<DialogDescription>
						{t("sidebar:zoteroMigrate.description")}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-1.5">
						<Button
							type="button"
							variant="outline"
							className="w-full justify-start gap-2"
							onClick={() => void chooseFolder()}
							disabled={busy}
						>
							<FolderOpen className="size-4 shrink-0" />
							<span className="truncate">
								{dir ?? t("sidebar:zoteroMigrate.chooseFolder")}
							</span>
						</Button>
						<p className="px-0.5 text-muted-foreground text-xs">
							{t("sidebar:zoteroMigrate.folderHint")}
						</p>
					</div>

					{scanning ? (
						<p className="flex items-center gap-2 text-muted-foreground text-sm">
							<Loader2 className="size-3.5 animate-spin" />
							{t("sidebar:zoteroMigrate.scanning")}
						</p>
					) : scan ? (
						<p className="text-sm">
							{t("sidebar:zoteroMigrate.scanResult", {
								count: scan.itemCount,
								withPdf: scan.withPdfCount,
							})}
						</p>
					) : null}

					{scan ? (
						<>
							<div className="space-y-1.5">
								<Label htmlFor="zotero-parent" className="text-xs">
									{t("sidebar:zoteroMigrate.targetFolder")}
								</Label>
								<Input
									id="zotero-parent"
									value={parentDir}
									onChange={(e) => setParentDir(e.target.value)}
									disabled={busy}
								/>
							</div>
							<div className="flex items-start gap-2.5">
								<Checkbox
									id="zotero-copy-pdfs"
									checked={copyPdfs}
									onCheckedChange={(v) => setCopyPdfs(v === true)}
									disabled={busy}
									className="mt-0.5"
								/>
								<div className="space-y-0.5">
									<Label
										htmlFor="zotero-copy-pdfs"
										className="font-normal text-sm"
									>
										{t("sidebar:zoteroMigrate.copyPdfs")}
									</Label>
									<p className="text-muted-foreground text-xs">
										{t("sidebar:zoteroMigrate.copyPdfsHint")}
									</p>
								</div>
							</div>
						</>
					) : null}

					{error ? <p className="text-destructive text-xs">{error}</p> : null}
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={() => handleOpenChange(false)}
						disabled={busy}
					>
						{t("sidebar:zoteroMigrate.cancel")}
					</Button>
					<Button
						type="button"
						className="gap-1.5"
						onClick={() => void handleMigrate()}
						disabled={busy || !scan || scan.itemCount === 0 || !vaultPath}
					>
						{busy ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<Import className="size-3.5" />
						)}
						{t("sidebar:zoteroMigrate.migrate")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
