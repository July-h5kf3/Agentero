import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type PdfViewerProps = {
	/** Remote http(s) URL only — PDF.js streams from network, not vault disk */
	source: string | null;
	className?: string;
};

export function PdfViewer({ source, className }: PdfViewerProps) {
	const [numPages, setNumPages] = useState(0);
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const [width, setWidth] = useState(640);

	const remote = source && /^https?:\/\//i.test(source) ? source : null;

	useEffect(() => {
		const el = document.getElementById("motif-pdf-host");
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w) setWidth(Math.max(280, Math.floor(w - 24)));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	if (!remote) {
		return (
			<div
				className={cn(
					"flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm",
					className,
				)}
			>
				No remote PDF URL in metadata.
				<br />
				<span className="mt-1 text-xs">
					Set <code className="text-foreground">pdf_url</code> (e.g. arXiv PDF)
					— Motif does not load local PDF files for preview.
				</span>
			</div>
		);
	}

	return (
		<div
			id="motif-pdf-host"
			className={cn("flex h-full min-h-0 flex-col", className)}
		>
			<div className="flex shrink-0 items-center justify-center gap-2 border-b px-2 py-1.5">
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={page <= 1}
					onClick={() => setPage((p) => Math.max(1, p - 1))}
				>
					Prev
				</Button>
				<span className="min-w-20 text-center text-muted-foreground text-xs">
					{numPages ? `${page} / ${numPages}` : "—"}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={!numPages || page >= numPages}
					onClick={() => setPage((p) => Math.min(numPages, p + 1))}
				>
					Next
				</Button>
			</div>
			<div className="motif-scroll flex min-h-0 flex-1 justify-center bg-muted/20 p-3">
				{error ? (
					<p className="text-destructive text-sm">{error}</p>
				) : (
					<Document
						key={remote}
						file={remote}
						loading={
							<p className="text-muted-foreground text-sm">Loading PDF…</p>
						}
						onLoadSuccess={(doc) => {
							setNumPages(doc.numPages);
							setPage(1);
							setError(null);
						}}
						onLoadError={(err) => {
							setError(err.message || "Failed to load PDF");
						}}
					>
						<Page
							pageNumber={page}
							width={width}
							renderTextLayer
							renderAnnotationLayer
						/>
					</Document>
				)}
			</div>
		</div>
	);
}
