/**
 * App-level dialogs: Zotero migration, rename, external-rename repair, move
 * papers, local-PDF import confirm, and the command palette. Each subscribes
 * to its own store slice.
 */

import { CommandPalette } from "@/components/dialogs/command-palette";
import { ExternalRenameDialog } from "@/components/dialogs/external-rename-dialog";
import { RenamePathDialog } from "@/components/dialogs/rename-path-dialog";
import { SkillImportDialog } from "@/components/dialogs/skill-import-dialog";
import { ZoteroMigrateDialog } from "@/components/dialogs/zotero-migrate-dialog";
import { ImportLocalPdfDialog } from "@/components/library/import-local-pdf-dialog";
import { MovePapersDialog } from "@/components/library/move-papers-dialog";
import { paletteCommands } from "@/components/shell/palette-commands";
import {
	useLibraryStore,
	useUiStore,
	useVaultStore,
} from "@/hooks/use-app-stores";
import {
	cancelSkillImport,
	confirmImportLocalPdf,
	confirmSkillImport,
	importPdfDialogOpenChange,
} from "@/lib/paper/import-actions";
import { setMovePaths } from "@/lib/paper/library-store";
import { setCommandOpen, setZoteroOpen } from "@/lib/shell/ui-store";
import { movePathsTo, refreshAll } from "@/lib/vault/actions";
import { openPaper, openVaultRel } from "@/lib/workspace/actions";

export function AppDialogs() {
	const vaultPath = useVaultStore((s) => s.vaultPath);
	const tree = useVaultStore((s) => s.tree);
	const zoteroOpen = useUiStore((s) => s.zoteroOpen);
	const commandOpen = useUiStore((s) => s.commandOpen);
	const commandMode = useUiStore((s) => s.commandMode);
	const libraryPapers = useLibraryStore((s) => s.papers);
	const movePaths = useLibraryStore((s) => s.movePaths);
	const importPdfDraft = useLibraryStore((s) => s.importPdfDraft);
	const ioBusy = useLibraryStore((s) => s.ioBusy);
	const skillImportDraft = useUiStore((s) => s.skillImportDraft);

	return (
		<>
			<ZoteroMigrateDialog
				open={zoteroOpen}
				onOpenChange={setZoteroOpen}
				vaultPath={vaultPath}
				onDone={refreshAll}
			/>
			<SkillImportDialog
				discoveries={skillImportDraft}
				onCancel={cancelSkillImport}
				onConfirm={confirmSkillImport}
			/>

			<RenamePathDialog />
			<ExternalRenameDialog />

			<MovePapersDialog
				open={movePaths !== null}
				onOpenChange={(o) => {
					if (!o) setMovePaths(null);
				}}
				nodes={tree}
				vaultPath={vaultPath}
				count={movePaths?.length ?? 0}
				sourcePaths={movePaths ?? []}
				onConfirm={(dest) => {
					const paths = movePaths;
					setMovePaths(null);
					if (paths) void movePathsTo(paths, dest);
				}}
			/>

			<ImportLocalPdfDialog
				open={importPdfDraft !== null}
				onOpenChange={importPdfDialogOpenChange}
				items={importPdfDraft?.items ?? []}
				parentDir={importPdfDraft?.parentDir ?? "papers"}
				onConfirm={confirmImportLocalPdf}
				busy={ioBusy === "import-pdf"}
			/>

			<CommandPalette
				open={commandOpen}
				onOpenChange={setCommandOpen}
				mode={commandMode}
				vaultPath={vaultPath}
				papers={libraryPapers}
				commands={paletteCommands}
				onOpenPaper={(rel) => {
					if (vaultPath)
						openPaper(`${vaultPath.replace(/[\\/]+$/, "")}/${rel}`);
				}}
				onOpenVaultRel={openVaultRel}
			/>
		</>
	);
}
