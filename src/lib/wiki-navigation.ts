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

export type WikiBlockIdRange = {
	start: number;
	end: number;
};

/** Locate a valid Obsidian block ID at the end of a rendered text leaf. */
export function findWikiBlockIdRange(text: string): WikiBlockIdRange | null {
	const match = text.match(/(?:^|\s)(\^[\p{L}\p{N}-]+)\s*$/u);
	const marker = match?.[1];
	if (!match || !marker || match.index === undefined) return null;
	const start = match.index + match[0].indexOf(marker);
	return { start, end: start + marker.length };
}

export function hasWikiBlockAnchor(text: string, id: string): boolean {
	const range = findWikiBlockIdRange(text);
	return range ? text.slice(range.start + 1, range.end) === id : false;
}
