import { createContext, useContext } from "react";

import type { WikiNavTarget } from "@/lib/wiki";

export type WikiNavContextValue = {
	onWikiNavigate: (nav: WikiNavTarget) => void;
};

export const WikiNavContext = createContext<WikiNavContextValue | null>(null);

export function useWikiNav(): WikiNavContextValue | null {
	return useContext(WikiNavContext);
}
