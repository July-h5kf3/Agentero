import { createContext, useContext } from "react";

import type { WikiNavTarget } from "@/lib/wiki/api";

export type WikiNavContextValue = {
	onWikiNavigate: (nav: WikiNavTarget) => void;
	/** Vault-relative Markdown paths, used to resolve `[[wikilink]]` targets. */
	mdFiles?: string[];
};

export const WikiNavContext = createContext<WikiNavContextValue | null>(null);

export function useWikiNav(): WikiNavContextValue | null {
	return useContext(WikiNavContext);
}
