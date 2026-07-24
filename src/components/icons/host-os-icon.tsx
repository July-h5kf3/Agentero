/**
 * OS brand glyphs for the Settings host badge — library icons only (no hand-drawn SVG).
 * Brands: Font Awesome via `react-icons/fa6`; fallback desktop: `FaDisplay`.
 */
import { FaApple, FaDisplay, FaLinux, FaWindows } from "react-icons/fa6";
import { cn } from "@/lib/utils";

export type HostOsKind = "macos" | "windows" | "linux" | "other";

export function normalizeHostOs(raw: string | null | undefined): HostOsKind {
	const v = (raw ?? "").toLowerCase().trim();
	if (v === "macos" || v === "darwin" || v === "mac" || v === "osx")
		return "macos";
	if (v === "windows" || v === "win32" || v === "win") return "windows";
	if (v === "linux") return "linux";
	return "other";
}

type IconProps = {
	os: HostOsKind;
	className?: string;
	/** Accessible label when not purely decorative. */
	title?: string;
};

/** OS mark for Settings host chip (before hostname). */
export function HostOsIcon({ os, className, title }: IconProps) {
	// `block` avoids baseline gap under SVG that misaligns with adjacent text.
	const cls = cn("block size-3.5 shrink-0", className);
	const a11y = title
		? { "aria-label": title, role: "img" as const }
		: { "aria-hidden": true as const };

	switch (os) {
		case "macos":
			return <FaApple className={cls} {...a11y} title={title} />;
		case "windows":
			return <FaWindows className={cls} {...a11y} title={title} />;
		case "linux":
			return <FaLinux className={cls} {...a11y} title={title} />;
		default:
			return <FaDisplay className={cls} {...a11y} title={title} />;
	}
}
