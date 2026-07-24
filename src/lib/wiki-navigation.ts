export function normalizeWikiAnchorText(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

type HeadingEntry = { level: number; text: string };

/** Find a heading by its full Obsidian heading path, not only its leaf text. */
export function findWikiHeadingIndex(
	headings: HeadingEntry[],
	fragmentPath: string[],
): number {
	const target = fragmentPath.map(normalizeWikiAnchorText);
	const stack: string[] = [];
	for (const [index, heading] of headings.entries()) {
		stack.length = Math.max(0, heading.level - 1);
		stack[heading.level - 1] = normalizeWikiAnchorText(heading.text);
		const current = stack.slice(0, heading.level);
		if (
			target.length === 1
				? current.at(-1) === target[0]
				: current.length === target.length &&
					current.every((part, pathIndex) => part === target[pathIndex])
		) {
			return index;
		}
	}
	return -1;
}

export function hasWikiBlockAnchor(text: string, id: string): boolean {
	return normalizeWikiAnchorText(text).endsWith(`^${id}`);
}
