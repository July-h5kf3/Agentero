import { BookCheck, ScanSearch } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { Citation } from "@/lib/paper/refs";

const CARD_WIDTH = 300;
const CARD_ESTIMATED_HEIGHT = 116;

export function PdfCitationPreview({
	screen,
	marker,
	citation,
	onOpenReferences,
	onPointerEnter,
	onPointerLeave,
}: {
	screen: { x: number; y: number };
	marker: string;
	citation: Citation | null;
	onOpenReferences: () => void;
	onPointerEnter: () => void;
	onPointerLeave: () => void;
}) {
	const { t } = useTranslation("viewer");
	const viewportWidth =
		typeof window === "undefined" ? 1200 : window.innerWidth;
	const viewportHeight =
		typeof window === "undefined" ? 800 : window.innerHeight;
	const left = Math.min(
		Math.max(12, screen.x),
		viewportWidth - CARD_WIDTH - 12,
	);
	const top = Math.min(
		Math.max(12, screen.y),
		viewportHeight - CARD_ESTIMATED_HEIGHT - 12,
	);
	const metadata = citation?.metadata;
	const meta = [
		metadata?.authors?.length
			? metadata.authors.length > 1
				? `${metadata.authors[0]} et al.`
				: metadata.authors[0]
			: null,
		metadata?.year != null ? String(metadata.year) : null,
		metadata?.venue || null,
	].filter(Boolean) as string[];
	const title =
		metadata?.title ??
		citation?.raw ??
		citation?.rawKey ??
		t("references.previewUnresolved");

	return (
		<div
			role="dialog"
			aria-label={t("references.previewLabel", { marker })}
			className="fixed z-50 w-[300px] rounded-xl border border-border/80 bg-background/98 p-3 shadow-xl ring-1 ring-black/5 backdrop-blur-sm dark:ring-white/10"
			style={{ left, top }}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
		>
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="font-medium text-[11px] text-muted-foreground tabular-nums">
							{citation?.display ?? marker}
						</span>
						{citation?.localMatch ? (
							<BookCheck
								className="size-3.5 text-emerald-600 dark:text-emerald-500"
								aria-label={t("references.inLibrary")}
							/>
						) : null}
					</div>
					<p className="mt-1 line-clamp-2 text-[13px] leading-snug">{title}</p>
					{meta.length > 0 ? (
						<p className="mt-1 truncate text-[11px] text-muted-foreground">
							{meta.join(" · ")}
						</p>
					) : null}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="shrink-0"
					aria-label={t("references.inspect")}
					title={t("references.inspect")}
					onClick={onOpenReferences}
				>
					<ScanSearch className="size-4" />
				</Button>
			</div>
		</div>
	);
}
