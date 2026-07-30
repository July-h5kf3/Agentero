import { Bot, Library } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/core/utils";

export type MobileTab = "library" | "agent";

const TABS: Array<{ id: MobileTab; icon: typeof Library }> = [
	{ id: "library", icon: Library },
	{ id: "agent", icon: Bot },
];

export function MobileNav({
	tab,
	onTab,
	variant = "rail",
}: {
	tab: MobileTab;
	onTab: (tab: MobileTab) => void;
	variant?: "rail" | "sidebar";
}) {
	const { t } = useTranslation("mobile");
	const sidebar = variant === "sidebar";

	return (
		<nav
			aria-label={t("tabs.navigation")}
			className={cn("flex gap-1", sidebar ? "flex-col" : "mt-10 flex-col")}
		>
			{TABS.map(({ id, icon: Icon }) => (
				<button
					key={id}
					type="button"
					onClick={() => onTab(id)}
					className={cn(
						"flex items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
						sidebar
							? "h-11 w-full gap-3 px-3 text-sm"
							: "size-10 justify-center px-0",
						tab === id
							? "bg-muted/80 font-medium text-foreground"
							: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
					)}
					aria-current={tab === id ? "page" : undefined}
				>
					<Icon
						className="size-5 shrink-0"
						strokeWidth={tab === id ? 2.25 : 2}
					/>
					{sidebar ? <span>{t(`tabs.${id}`)}</span> : null}
				</button>
			))}
		</nav>
	);
}
