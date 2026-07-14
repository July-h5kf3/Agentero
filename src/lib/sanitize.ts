import DOMPurify, { type Config } from "dompurify";

/**
 * Sanitize untrusted HTML before injecting into the DOM
 * (e.g. arXiv HTML fragments, imported HTML, or Markdown-derived HTML).
 *
 * Use this for any path that would otherwise set `innerHTML` /
 * `dangerouslySetInnerHTML`. Prefer iframe/`convertFileSrc` for full
 * remote HTML documents when possible; still sanitize when inlining snippets.
 */
export function sanitizeHtml(dirty: string, config?: Config): string {
	return DOMPurify.sanitize(dirty, config);
}
