/**
 * Normalize common LaTeX shapes in agent/markdown text so Streamdown + KaTeX
 * (remark-math) can render them.
 *
 * remark-math only sees `$…$` / `$$…$$` (and we enable single-dollar). Models
 * often emit:
 * - bare TeX: `\pi_\theta`
 * - TeX delimiters: `\(...\)` / `\[...\]`
 * without dollar wrapping. Bare `_` also breaks GFM emphasis, so wrapping helps
 * both rendering and layout.
 */

/** Fenced code, inline code, or existing dollar math — leave untouched. */
const PROTECTED =
	/```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$(?:\\\$|[^$\n])+\$/g;

/** `\(...\)` inline and `\[...\]` display (non-greedy, allows nested `\cmd`). */
const TEX_DISPLAY = /\\\[([\s\S]*?)\\\]/g;
const TEX_INLINE = /\\\(([\s\S]*?)\\\)/g;

/**
 * Bare command with at least one subscript/superscript, e.g. `\pi_\theta`,
 * `\alpha^{2}`, `x_\mathrm{t}`-style `\\mathrm{t}` scripts.
 */
const BARE_SCRIPTED =
	/(?<![$\\])\\[a-zA-Z]+(?:\{[^{}]*\})*(?:[_^](?:\{[^{}]*\}|\\[a-zA-Z]+(?:\{[^{}]*\})*|[A-Za-z0-9]+))+/g;

/**
 * Bare command with brace args only, e.g. `\frac{a}{b}`, `\mathcal{L}`.
 * Requires at least one `{…}` to avoid wrapping plain `\pi` or `\n`.
 */
const BARE_BRACED = /(?<![$\\])\\[a-zA-Z]+(?:\{[^{}]*\})+/g;

function transformMathRegion(text: string): string {
	if (!text.includes("\\")) return text;

	let out = text
		.replace(TEX_DISPLAY, (_m, body: string) => `$$${body}$$`)
		.replace(TEX_INLINE, (_m, body: string) => `$${body}$`);

	out = out.replace(BARE_SCRIPTED, (match) => `$${match}$`);
	out = out.replace(BARE_BRACED, (match) => {
		// Already wrapped by scripted pass or adjacent `$`.
		return match.startsWith("$") ? match : `$${match}$`;
	});

	return out;
}

/** Prepare markdown so KaTeX can render common agent LaTeX forms. */
export function normalizeMarkdownMath(source: string): string {
	if (!source?.includes("\\")) return source;

	let result = "";
	let last = 0;
	for (const match of source.matchAll(PROTECTED)) {
		const start = match.index ?? 0;
		if (start > last) {
			result += transformMathRegion(source.slice(last, start));
		}
		result += match[0];
		last = start + match[0].length;
	}
	if (last < source.length) {
		result += transformMathRegion(source.slice(last));
	}
	return result;
}
