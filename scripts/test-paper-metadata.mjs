/**
 * Smoke test: PDF/HTML from metadata are remote URLs only (no local paths).
 * Run: node scripts/test-paper-metadata.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function resolveRemoteUrl(ref) {
	if (!ref?.trim()) return null;
	const value = ref.trim();
	if (/^https?:\/\//i.test(value)) return value;
	return null;
}

function arxivUrls(id) {
	const bare = id.replace(/^arXiv:/i, "").replace(/v\d+$/i, "");
	return {
		pdf: `https://arxiv.org/pdf/${bare}`,
		html: `https://arxiv.org/html/${bare}`,
	};
}

function paperRemoteAssetsFromMetadata(meta) {
	let pdfUrl = resolveRemoteUrl(meta.pdf_url);
	let htmlUrl = resolveRemoteUrl(meta.html_url);
	const arxiv = meta.arxiv_id ? arxivUrls(meta.arxiv_id) : null;
	if (!pdfUrl && arxiv) pdfUrl = arxiv.pdf;
	if (!htmlUrl && arxiv) htmlUrl = arxiv.html;
	return { pdfUrl, htmlUrl };
}

const vaultSrc = readFileSync(join(root, "src/lib/vault.ts"), "utf8");
const metaMatch = vaultSrc.match(
	/"demo-vault\/papers\/1706\.03762\/metadata\.json":\s*`([\s\S]*?)`\s*,/,
);
if (!metaMatch) {
	console.error("FAIL: mock metadata not found");
	process.exit(1);
}

const meta = JSON.parse(metaMatch[1]);
const { pdfUrl, htmlUrl } = paperRemoteAssetsFromMetadata(meta);

console.log("pdf_url:", pdfUrl);
console.log("html_url:", htmlUrl);

if (!pdfUrl?.startsWith("https://arxiv.org/pdf/")) {
	console.error("FAIL: pdf must be remote arXiv URL");
	process.exit(1);
}
if (!htmlUrl?.startsWith("https://arxiv.org/html/")) {
	console.error("FAIL: html must be remote arXiv URL");
	process.exit(1);
}
// Relative local paths must NOT resolve for preview
if (resolveRemoteUrl("source/original.pdf") !== null) {
	console.error("FAIL: local relative path must be rejected");
	process.exit(1);
}

process.env.NO_PROXY = "*";
const pdfHead = await fetch(pdfUrl, { method: "HEAD" });
const htmlHead = await fetch(htmlUrl, { method: "HEAD" });
console.log("HEAD pdf:", pdfHead.status, pdfHead.headers.get("content-type"));
console.log(
	"HEAD html:",
	htmlHead.status,
	htmlHead.headers.get("content-type"),
);
if (!pdfHead.ok || !htmlHead.ok) process.exit(1);

console.log("OK: PDF/HTML preview uses remote URLs only (no local download)");
