import { Languages, MinusIcon, Trash2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { SelectionCard } from "@/components/viewer/pdf-ask/selection-card";

export type TranslateCardProps = {
	screen: { x: number; y: number };
	/** Source quote (optional header context) */
	quote?: string;
	/** Translation text (may stream in) */
	result: string;
	streaming: boolean;
	error: string | null;
	/** Hide card; pin remains for reopen */
	onHide: () => void;
	/** Delete persisted translate record + pin */
	onDelete: () => void;
	onPointerEnter?: () => void;
	onPointerLeave?: () => void;
};

/**
 * PDF selection translation — shared SelectionCard shell with hide/delete
 * (same persistence model as ask: hide keeps pin, delete removes record).
 */
export function TranslateCard({
	screen,
	quote,
	result,
	streaming,
	error,
	onHide,
	onDelete,
	onPointerEnter,
	onPointerLeave,
}: TranslateCardProps) {
	const { t } = useTranslation("viewer");
	const showResult = result.trim().length > 0;
	const showLoading = streaming && !showResult;

	return (
		<SelectionCard
			screen={screen}
			width={320}
			height={360}
			lockHeight
			title={t("selection.translateTitle")}
			icon={Languages}
			ariaLive="polite"
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			actions={[
				{
					label: t("selection.translateDelete"),
					onClick: onDelete,
					icon: <Trash2Icon className="size-3.5" />,
					destructive: true,
				},
				{
					label: t("selection.translateHide"),
					onClick: onHide,
					icon: <MinusIcon className="size-3.5" />,
				},
			]}
			bodyClassName="gap-2 px-3 py-2.5"
		>
			{quote?.trim() ? (
				<blockquote className="agentero-scroll max-h-16 shrink-0 overflow-y-auto border-border/70 border-l-2 pl-2 text-muted-foreground text-xs leading-relaxed">
					{quote.trim()}
				</blockquote>
			) : null}

			{showLoading ? (
				<Shimmer className="text-sm" as="p">
					{t("selection.translating")}
				</Shimmer>
			) : null}

			{showResult ? (
				<p className="min-w-0 whitespace-pre-wrap break-words text-[13px] text-foreground leading-relaxed">
					{result}
				</p>
			) : null}

			{!showLoading && !showResult && !error ? (
				<p className="text-muted-foreground text-xs">
					{t("selection.translating")}
				</p>
			) : null}

			{error ? (
				<p className="text-destructive text-xs" role="alert">
					{error}
				</p>
			) : null}
		</SelectionCard>
	);
}
