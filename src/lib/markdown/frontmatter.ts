/**
 * Helpers for YAML frontmatter that lives outside the Plate AST.
 * The editor keeps the block as a string and re-attaches it on save
 * (see {@link splitFrontmatter} / {@link joinFrontmatter}).
 */

/** Strip `---` fences; empty when there is no frontmatter block. */
export function frontmatterInterior(block: string): string {
	const trimmed = block.trim();
	if (!trimmed) return "";
	const lines = trimmed.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return trimmed;
	// Drop opening fence.
	lines.shift();
	// Drop closing fence when present.
	const close = lines.findIndex(
		(line) => line.trim() === "---" || line.trim() === "...",
	);
	if (close >= 0) lines.splice(close);
	// Preserve interior indentation/newlines; only trim a single trailing blank.
	return lines.join("\n").replace(/\n+$/, "");
}

/**
 * Build a disk-ready frontmatter block from the YAML interior (no fences).
 * Empty / whitespace-only interior yields `""` (no frontmatter).
 */
export function wrapFrontmatter(interior: string): string {
	const body = interior.replace(/^\uFEFF/, "").replace(/\s+$/, "");
	if (!body.trim()) return "";
	return `---\n${body}\n---\n`;
}

/** Count top-level `key:` lines for the collapsed Properties badge. */
export function countFrontmatterProperties(interior: string): number {
	let count = 0;
	for (const line of interior.split(/\r?\n/)) {
		// Skip list items, comments, and blank lines.
		if (!line.trim() || /^\s/.test(line) || line.trimStart().startsWith("#")) {
			continue;
		}
		if (/^[^:\s][^:]*:\s*/.test(line.trim())) count += 1;
	}
	return count;
}
