import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type PdfViewerProps = {
	/** Remote http(s) URL only — PDF.js streams from network, not vault disk */
	source: string | null;
	className?: string;
};

export function PdfViewer({ source, className }: PdfViewerProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [numPages, setNumPages] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [width, setWidth] = useState(640);

	const remote = source && /^https?:\/\//i.test(source) ? source : null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-bind observer when remote viewer mounts
	useEffect(() => {
		const el = hostRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w) setWidth(Math.max(280, Math.floor(w - 24)));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [remote]);

	if (!remote) {
		return (
			<div
				className={cn(
					"flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm",
					className,
				)}
			>
				No paper available.
			</div>
		);
	}

	return (
		<div
			ref={hostRef}
			id="motif-pdf-host"
			className={cn("flex h-full min-h-0 flex-col", className)}
		>
			<div className="motif-scroll min-h-0 flex-1 bg-muted/20">
				{error ? (
					<p className="p-6 text-destructive text-sm">{error}</p>
				) : (
					<Document
						key={remote}
						file={remote}
						loading={
							<p className="p-6 text-center text-muted-foreground text-sm">
								Loading PDF…
							</p>
						}
						onLoadSuccess={(doc) => {
							setNumPages(doc.numPages);
							setError(null);
						}}
						onLoadError={(err) => {
							setError(err.message || "Failed to load PDF");
						}}
						className="flex flex-col items-center gap-3 px-3 py-3"
					>
						{Array.from({ length: numPages }, (_, i) => i + 1).map(
							(pageNumber) => (
								<div
									key={`${remote}-p${pageNumber}`}
									className="overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10"
								>
									<Page
										pageNumber={pageNumber}
										width={width}
										renderTextLayer
										renderAnnotationLayer
										loading={
											<div
												className="bg-muted/40"
												style={{ width, height: width * 1.3 }}
											/>
										}
									/>
								</div>
							),
						)}
					</Document>
				)}
			</div>
		</div>
	);
}
