import { ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { ChatVisualAnnotation } from "@/lib/agent/chat-state";
import { cn } from "@/lib/core/utils";

function imageSrc(annotation: ChatVisualAnnotation): string | null {
	if (!annotation.image.data) return null;
	const mime = annotation.image.mimeType || "image/png";
	return `data:${mime};base64,${annotation.image.data}`;
}

function chipLabel(
	annotation: ChatVisualAnnotation,
	fallback: string,
	pageLabel: string,
): string {
	const comment = annotation.comment.trim();
	if (comment) return comment;
	return `${fallback} · ${pageLabel}`;
}

/**
 * Composer-style chips for visual annotations on a user chat turn.
 * Click opens a dialog with the crop image and the user's comment.
 */
export function ChatVisualAnnotations({
	annotations,
	className,
}: {
	annotations: ChatVisualAnnotation[];
	className?: string;
}) {
	const { t } = useTranslation("agent");
	const [openId, setOpenId] = useState<string | null>(null);
	const open = useMemo(
		() => annotations.find((item) => item.id === openId) ?? null,
		[annotations, openId],
	);
	const openSrc = open ? imageSrc(open) : null;

	if (!annotations.length) return null;

	return (
		<>
			<div className={cn("flex flex-wrap justify-end gap-1.5", className)}>
				{annotations.map((annotation, index) => {
					const pageLabel = t("composer.visualAnnotationPage", {
						page: annotation.page,
					});
					const label = chipLabel(
						annotation,
						t("composer.visualAnnotation"),
						pageLabel,
					);
					const thumb = imageSrc(annotation);
					return (
						<button
							key={annotation.id}
							type="button"
							className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border/80 bg-background/80 px-1.5 pr-2.5 text-foreground text-xs shadow-sm transition-colors hover:bg-muted"
							onClick={() => setOpenId(annotation.id)}
							title={t("composer.visualAnnotationOpen")}
							aria-label={t("composer.visualAnnotationOpenAria", {
								index: index + 1,
								label,
							})}
						>
							{thumb ? (
								<img
									src={thumb}
									alt=""
									className="size-5 shrink-0 rounded object-cover ring-1 ring-border/60"
								/>
							) : (
								<ScanSearch className="size-3.5 shrink-0 text-muted-foreground" />
							)}
							<span className="max-w-[14rem] truncate">{label}</span>
						</button>
					);
				})}
			</div>

			<Dialog
				open={Boolean(open)}
				onOpenChange={(next) => {
					if (!next) setOpenId(null);
				}}
			>
				<DialogContent className="sm:max-w-md" aria-describedby={undefined}>
					{open ? (
						<>
							<DialogHeader>
								<DialogTitle>
									{t("composer.visualAnnotationDetailTitle", {
										index:
											annotations.findIndex((item) => item.id === open.id) + 1,
									})}
								</DialogTitle>
								<DialogDescription>
									{t("composer.visualAnnotationPage", { page: open.page })}
									{open.paperPath ? ` · ${open.paperPath}` : ""}
								</DialogDescription>
							</DialogHeader>
							{openSrc ? (
								<img
									src={openSrc}
									alt={t("composer.visualAnnotationPreviewAlt", {
										page: open.page,
									})}
									className="max-h-[min(60vh,28rem)] w-full rounded-lg border border-border/70 bg-muted/30 object-contain"
								/>
							) : null}
							<div className="space-y-1">
								<p className="font-medium text-muted-foreground text-xs">
									{t("composer.visualAnnotationCommentLabel")}
								</p>
								<p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
									{open.comment.trim() ||
										t("composer.visualAnnotationNoComment")}
								</p>
							</div>
						</>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}

/** Plain-text export of free text + visual comments (copy / edit seed). */
export function formatUserLineForCopy(line: {
	text: string;
	visualAnnotations?: ChatVisualAnnotation[];
}): string {
	const parts: string[] = [];
	const free = line.text.trim();
	if (free) parts.push(free);
	const visuals = line.visualAnnotations ?? [];
	if (visuals.length) {
		parts.push(
			...visuals.map((item, index) => {
				const comment = item.comment.trim();
				return comment
					? `${index + 1}. ${comment}`
					: `${index + 1}. (p.${item.page})`;
			}),
		);
	}
	return parts.join("\n");
}
