// Refresh bundled tweakcn themes: node scripts/fetch-tweakcn-themes.mjs
import { writeFile } from "node:fs/promises";
import path from "node:path";

const REGISTRY_URL = "https://tweakcn.com/r/registry.json";
const OUT = path.join(
	import.meta.dirname,
	"..",
	"src",
	"themes",
	"tweakcn.json",
);

// Only keep variables the app consumes (colors + radius); fonts, shadows,
// spacing and tracking are excluded so bundled fonts/layout stay intact.
const EXCLUDE = /^(font-|shadow|letter-spacing$|spacing$|tracking-)/;

const res = await fetch(REGISTRY_URL);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const registry = await res.json();

const pick = (vars = {}) =>
	Object.fromEntries(Object.entries(vars).filter(([k]) => !EXCLUDE.test(k)));

const themes = registry.items
	.filter((item) => item.cssVars?.light && item.cssVars?.dark)
	.map((item) => ({
		name: item.name,
		title: item.title ?? item.name,
		light: pick(item.cssVars.light),
		dark: pick(item.cssVars.dark),
	}));

await writeFile(OUT, `${JSON.stringify(themes, null, "\t")}\n`);
console.log(`wrote ${themes.length} themes to ${OUT}`);
