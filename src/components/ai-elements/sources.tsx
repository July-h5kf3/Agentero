"use client";

import { BookIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/core/utils";

export type SourcesProps = ComponentProps<"div">;

export const Sources = ({ className, ...props }: SourcesProps) => (
	<Collapsible
		className={cn("not-prose mb-4 text-primary text-xs", className)}
		{...props}
	/>
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
	count: number;
};

export const SourcesTrigger = ({
	className,
	count,
	children,
	...props
}: SourcesTriggerProps) => {
	const { t } = useTranslation("aiElements");

	return (
		<CollapsibleTrigger
			className={cn("flex items-center gap-2", className)}
			{...props}
		>
			{children ?? (
				<>
					<p className="font-medium">{t("sources.used", { count })}</p>
					<ChevronDownIcon className="h-4 w-4" />
				</>
			)}
		</CollapsibleTrigger>
	);
};

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
	className,
	...props
}: SourcesContentProps) => (
	<CollapsibleContent
		className={cn(
			"mt-3 flex w-fit flex-col gap-2",
			"data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
			className,
		)}
		{...props}
	/>
);

export type SourceProps = ComponentProps<"a">;

export const Source = ({
	href,
	title,
	children,
	className,
	onClick,
	...props
}: SourceProps) => {
	const isExternal = Boolean(href && /^https?:\/\//i.test(href));

	return (
		<a
			className={cn(
				"flex items-center gap-2 rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
				onClick || href ? "cursor-pointer" : undefined,
				className,
			)}
			href={href ?? "#"}
			rel={isExternal ? "noreferrer" : undefined}
			target={isExternal ? "_blank" : undefined}
			onClick={(event) => {
				// Vault paths / app navigation: parent handles open; prevent hash jump.
				if (onClick) {
					event.preventDefault();
					onClick(event);
				}
			}}
			{...props}
		>
			{children ?? (
				<>
					<BookIcon className="h-4 w-4 shrink-0" />
					<span className="block min-w-0 truncate font-medium">{title}</span>
				</>
			)}
		</a>
	);
};
