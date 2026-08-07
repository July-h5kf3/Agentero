/**
 * Parse `{paper}/Annotation.md` produced by the equation-annotation skill.
 *
 * Expected shape (Chinese defaults; English headers also accepted):
 *
 * ```md
 * | 符号 | 含义 | 通俗理解 |
 * | --- | --- | --- |
 * | $Q$ | 查询矩阵 | |
 * ```
 */

export type EquationSymbol = {
	/** Cell text as written (often `$…$`). */
	symbol: string;
	/** Definition / meaning column. */
	meaning: string;
	/** Optional plain-language column. */
	plain?: string;
};

/** Strip YAML frontmatter (`---` … `---`) if present. */
export function stripYamlFrontmatter(source: string): string {
	const text = source.replace(/^\uFEFF/, "");
	if (!text.startsWith("---")) return text;
	const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	if (!match) return text;
	return text.slice(match[0].length);
}

/** Split a GFM table row into trimmed cells. */
export function splitMarkdownTableRow(line: string): string[] | null {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) return null;
	// Require a leading or trailing pipe so plain prose with | is less noisy.
	if (!trimmed.startsWith("|") && !trimmed.endsWith("|")) return null;
	const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
	return body.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
	if (cells.length === 0) return false;
	return cells.every((cell) => {
		const c = cell.replace(/\s/g, "");
		return c.length > 0 && /^:?-{1,}:?$/.test(c);
	});
}

function normalizeHeader(cell: string): string {
	return cell.trim().toLowerCase().replace(/\s+/g, "");
}

/** True when the first column looks like a symbol / notation glossary header. */
export function isSymbolTableHeader(cells: string[]): boolean {
	if (cells.length < 2) return false;
	const h0 = normalizeHeader(cells[0] ?? "");
	return /^(符号|symbol|symbols|var|variable|variables|变量|notation|notations)$/.test(
		h0,
	);
}

function columnIndex(
	headers: string[],
	patterns: RegExp[],
	fallback: number,
): number {
	for (let i = 0; i < headers.length; i++) {
		const h = normalizeHeader(headers[i] ?? "");
		if (patterns.some((re) => re.test(h))) return i;
	}
	return fallback;
}

/**
 * Strip surrounding `$…$` / `$$…$$` so KaTeX can render the TeX body.
 * Leaves bare text (e.g. `Q`, `\alpha`) unchanged.
 */
export function symbolTexSource(symbol: string): string {
	const s = symbol.trim();
	const display = s.match(/^\$\$([\s\S]+)\$\$$/);
	if (display?.[1] != null) return display[1].trim();
	const inline = s.match(/^\$([\s\S]+)\$$/);
	if (inline?.[1] != null) return inline[1].trim();
	return s;
}

/** Dedupe key: strip math delimiters and collapse whitespace. */
function symbolKey(symbol: string): string {
	return symbolTexSource(symbol).replace(/\s+/g, "").toLowerCase();
}

/**
 * Extract symbol glossary rows from Annotation.md (or any markdown with the
 * same table shape). Multiple matching tables are concatenated; later
 * duplicates of the same symbol are skipped.
 */
export function parseAnnotationMd(source: string): EquationSymbol[] {
	if (!source?.trim()) return [];
	const body = stripYamlFrontmatter(source);
	const lines = body.split(/\r?\n/);
	const out: EquationSymbol[] = [];
	const seen = new Set<string>();

	let i = 0;
	while (i < lines.length) {
		const header = splitMarkdownTableRow(lines[i] ?? "");
		if (!header || !isSymbolTableHeader(header)) {
			i += 1;
			continue;
		}
		const sep = splitMarkdownTableRow(lines[i + 1] ?? "");
		if (!sep || !isSeparatorRow(sep)) {
			i += 1;
			continue;
		}

		const meaningIdx = columnIndex(
			header,
			[/含义/, /meaning/, /definition/, /说明/, /释义/, /desc/],
			1,
		);
		const plainIdx = columnIndex(
			header,
			[/通俗/, /plain/, /intuition/, /everyday/, /通俗理解/, /notes?/],
			-1,
		);

		i += 2; // skip header + separator
		while (i < lines.length) {
			const cells = splitMarkdownTableRow(lines[i] ?? "");
			if (!cells) break;
			if (isSeparatorRow(cells)) {
				i += 1;
				continue;
			}
			// New header-looking row → end current table (outer loop will re-read).
			if (isSymbolTableHeader(cells)) break;

			const symbol = (cells[0] ?? "").trim();
			if (!symbol) {
				i += 1;
				continue;
			}
			const key = symbolKey(symbol);
			if (!key || seen.has(key)) {
				i += 1;
				continue;
			}
			seen.add(key);

			const meaning = (cells[meaningIdx] ?? "").trim();
			const plain =
				plainIdx >= 0 ? (cells[plainIdx] ?? "").trim() || undefined : undefined;
			out.push({ symbol, meaning, plain });
			i += 1;
		}
	}

	return out;
}
