import { Circle } from "lucide-react";
import type { ReactNode } from "react";
import type { BridgeClientStatus } from "@/lib/bridge/client";
import { cn } from "@/lib/core/utils";

export function MobileHeader({
	title,
	status,
	statusLabel,
	brand,
	leading,
	trailing,
}: {
	title: string;
	status: BridgeClientStatus;
	statusLabel: string;
	brand: ReactNode;
	leading?: ReactNode;
	trailing?: ReactNode;
}) {
	return (
		<header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-3 md:px-6">
			{leading}
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<div className="md:hidden">{brand}</div>
				<span className="truncate font-semibold text-sm">{title}</span>
				<Circle
					className={cn(
						"size-2 shrink-0 fill-current",
						status.connected ? "text-emerald-500" : "text-muted-foreground",
					)}
					aria-label={statusLabel}
				/>
			</div>
			{trailing}
		</header>
	);
}
