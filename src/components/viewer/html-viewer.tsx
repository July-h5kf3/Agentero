import { useTranslation } from "react-i18next";

import { isArxivHostedUrl } from "@/lib/arxiv";
import { cn } from "@/lib/utils";

type HtmlViewerProps = {
	/** Remote URL only — streamed in a sandboxed iframe (no local download) */
	srcUrl?: string | null;
	className?: string;
};

/**
 * HTML paper viewer — remote URL in a separate sandboxed iframe.
 * Does not fetch or cache HTML into the vault.
 */
export function HtmlViewer({ srcUrl, className }: HtmlViewerProps) {
	const { t } = useTranslation("viewer");
	if (!srcUrl || !/^https?:\/\//i.test(srcUrl)) {
		return (
			<div
				className={cn(
					"flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm",
					className,
				)}
			>
				{t("html.empty")}
			</div>
		);
	}

	const trusted = isArxivHostedUrl(srcUrl);
	const sandbox = trusted
		? "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
		: "allow-popups allow-popups-to-escape-sandbox";

	return (
		<div
			className={cn(
				"relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-background",
				className,
			)}
		>
			<iframe
				title={t("html.sandboxTitle")}
				src={srcUrl}
				sandbox={sandbox}
				referrerPolicy="no-referrer-when-downgrade"
				className="absolute inset-0 block h-full w-full border-0 bg-background"
				style={{ colorScheme: "light dark" }}
			/>
		</div>
	);
}
