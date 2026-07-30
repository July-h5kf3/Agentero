import { BookOpen, FileText, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { bridgeRpc } from "@/lib/bridge/client";
import { loadBridgePaperPdf } from "@/lib/bridge/pdf";
import { cn } from "@/lib/core/utils";
import type { PaperMetadata } from "@/lib/paper/types";

const MobilePdfViewer = lazy(() =>
	import("@/components/viewer/embed/pdf-viewer").then((module) => ({
		default: module.PdfViewer,
	})),
);

export function MobileReaderPage({ paper }: { paper: PaperMetadata }) {
	const { t } = useTranslation("mobile");
	const [notes, setNotes] = useState("");
	const [saving, setSaving] = useState(false);
	const [mode, setMode] = useState<"pdf" | "notes">("pdf");
	const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
	const [pdfError, setPdfError] = useState<string | null>(null);

	useEffect(() => {
		setNotes("");
		setPdfBytes(null);
		setPdfError(null);
		if (!paper.path) return;
		let active = true;
		void bridgeRpc<string>("vault_read_text", {
			path: `${paper.path}/NOTES.md`,
		})
			.then((content) => active && setNotes(content))
			.catch(() => undefined);
		void loadBridgePaperPdf(paper.path)
			.then((blob) => blob.arrayBuffer())
			.then((bytes) => active && setPdfBytes(bytes))
			.catch((error) => {
				if (!active) return;
				setPdfError(
					error instanceof Error ? error.message : t("reader.pdfUnavailable"),
				);
			});
		return () => {
			active = false;
		};
	}, [paper.path, t]);

	const save = async () => {
		if (!paper.path) return;
		setSaving(true);
		try {
			await bridgeRpc("vault_write_text", {
				path: `${paper.path}/NOTES.md`,
				content: notes,
			});
		} finally {
			setSaving(false);
		}
	};
	const pdf = (
		<MobilePdfPreview
			bytes={pdfBytes}
			error={pdfError}
			docId={`bridge:${paper.id}`}
			paperPath={paper.path ?? null}
		/>
	);
	const notesEditor = (
		<div className="flex min-h-0 flex-1 flex-col">
			<Textarea
				value={notes}
				onChange={(event) => setNotes(event.target.value)}
				className="min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-sm shadow-none focus-visible:ring-0 md:px-6"
			/>
			<footer className="flex justify-end border-t px-4 py-3 md:px-6">
				<Button size="sm" disabled={saving} onClick={() => void save()}>
					{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
					{saving ? t("reader.saving") : t("reader.save")}
				</Button>
			</footer>
		</div>
	);
	return (
		<section className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center justify-end border-b px-4 py-2 md:px-6">
				<div className="flex shrink-0 border bg-muted p-0.5 md:hidden">
					<button
						type="button"
						aria-label={t("reader.pdf")}
						aria-pressed={mode === "pdf"}
						onClick={() => setMode("pdf")}
						className={cn(
							"grid size-8 place-items-center",
							mode === "pdf" && "bg-background shadow-sm",
						)}
					>
						<BookOpen className="size-4" />
					</button>
					<button
						type="button"
						aria-label={t("reader.notes")}
						aria-pressed={mode === "notes"}
						onClick={() => setMode("notes")}
						className={cn(
							"grid size-8 place-items-center",
							mode === "notes" && "bg-background shadow-sm",
						)}
					>
						<FileText className="size-4" />
					</button>
				</div>
			</div>
			<div className="min-h-0 flex-1 md:hidden">
				{mode === "pdf" ? pdf : notesEditor}
			</div>
			<div className="hidden min-h-0 flex-1 md:grid md:grid-cols-2 md:divide-x">
				{pdf}
				{notesEditor}
			</div>
		</section>
	);
}

function MobilePdfPreview({
	bytes,
	error,
	docId,
	paperPath,
}: {
	bytes: ArrayBuffer | null;
	error: string | null;
	docId: string;
	paperPath: string | null;
}) {
	const { t } = useTranslation("mobile");
	if (error) {
		return (
			<div className="grid h-full place-items-center p-6 text-center text-muted-foreground text-sm">
				{error || t("reader.pdfUnavailable")}
			</div>
		);
	}
	if (!bytes) {
		return (
			<div className="grid h-full place-items-center gap-2 text-muted-foreground text-sm">
				<LoaderCircle className="size-5 animate-spin" />
				{t("reader.loadingPdf")}
			</div>
		);
	}
	return (
		<div className="h-full min-h-0">
			<Suspense
				fallback={
					<div className="grid h-full place-items-center">
						<LoaderCircle className="size-5 animate-spin text-muted-foreground" />
					</div>
				}
			>
				<MobilePdfViewer
					source={null}
					sourceBytes={bytes}
					docId={docId}
					paperRelPath={paperPath}
					className="h-full"
				/>
			</Suspense>
		</div>
	);
}
