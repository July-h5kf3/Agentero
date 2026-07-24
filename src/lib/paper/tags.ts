import type { PaperMetadata } from "@/lib/paper/types";
import { coercePaperTags } from "@/lib/ui/tag-colors";

export type { PaperTag, PaperTagInput } from "@/lib/ui/tag-colors";

/** Ensure `tags` is a normalized `PaperTag[]`. */
export function withNormalizedTags(meta: PaperMetadata): PaperMetadata {
	return {
		...meta,
		tags: coercePaperTags(meta.tags),
	};
}
