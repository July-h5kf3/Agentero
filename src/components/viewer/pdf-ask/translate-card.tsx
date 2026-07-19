import { Languages, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { SelectionCard } from "@/components/viewer/pdf-ask/selection-card";

export type TranslateCardProps = {
	screen: { x: number; y: number };
	/** Translation text (may stream in) */
	result: string;
	streaming: boolean;
	error: string | null;
	onClose: () => void;
};

/**
 * PDF selection translation — result-only body on the shared SelectionCard shell.
 */
export function TranslateCard({
	screen,
	result,
	streaming,
	error,
	onClose,
}: TranslateCardProps) {
	const { t } = useTranslation("viewer");
	const showResult = result.trim().length > 0;
	const showLoading = streaming && !showResult;

	return (
		<SelectionCard
			screen={screen}
			width={320}
			height={220}
			title={t("selection.translateTitle")}
			icon={Languages}
			ariaLive="polite"
			actions={[
				{
					label: t("selection.translateClose"),
					onClick: onClose,
					icon: <X className="size-3.5" />,
				},
			]}
			bodyClassName="gap-2 px-3 py-2.5"
		>
			{showLoading ? (
				<Shimmer className="text-sm" as="p">
					{t("selection.translating")}
				</Shimmer>
			) : null}

			{showResult ? (
				<p className="whitespace-pre-wrap break-words text-[13px] text-foreground leading-relaxed">
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
