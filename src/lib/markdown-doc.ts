const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export type MarkdownDoc = {
	/** Leading YAML frontmatter block, verbatim (incl. delimiters and trailing newline). Empty when absent. */
	frontmatter: string;
	/** Markdown body after the frontmatter. */
	body: string;
};

/**
 * Split a leading YAML frontmatter block (`---\n...\n---`) from a Markdown
 * document. The frontmatter is preserved byte-exact so it can be re-attached on
 * save without going through the Plate round-trip.
 */
export function splitFrontmatter(md: string): MarkdownDoc {
	if (!md.startsWith("---")) return { frontmatter: "", body: md };
	const match = FRONTMATTER_RE.exec(md);
	if (!match) return { frontmatter: "", body: md };
	return { frontmatter: match[0], body: md.slice(match[0].length) };
}

/** Re-attach a preserved frontmatter block to a serialized body. */
export function joinFrontmatter(frontmatter: string, body: string): string {
	return frontmatter ? frontmatter + body : body;
}
