/**
 * Build headless `agentero` and copy it into src-tauri/binaries with the
 * target-triple suffix required by Tauri `bundle.externalBin`.
 *
 * Usage:
 *   node scripts/prepare-bundled-cli.mjs           # debug (default)
 *   node scripts/prepare-bundled-cli.mjs --release
 *   node scripts/prepare-bundled-cli.mjs --stub    # empty placeholder for typecheck
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const release = process.argv.includes("--release");
const stub = process.argv.includes("--stub");
const isWin = process.platform === "win32";
const ext = isWin ? ".exe" : "";

function hostTriple() {
	try {
		return execSync("rustc --print host-tuple", { encoding: "utf8" }).trim();
	} catch {
		const out = execSync("rustc -Vv", { encoding: "utf8" });
		const line = out.split("\n").find((l) => l.startsWith("host:"));
		if (!line) throw new Error("could not determine host triple");
		return line.split(/\s+/)[1];
	}
}

const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const outDir = path.join(root, "src-tauri", "binaries");
fs.mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, `agentero-cli-${triple}${ext}`);

if (stub) {
	fs.writeFileSync(dest, "");
	try {
		fs.chmodSync(dest, 0o755);
	} catch {
		// windows
	}
	console.log(`[prepare-bundled-cli] stub → ${dest}`);
	process.exit(0);
}

const profile = release ? "release" : "debug";
console.log(
	`[prepare-bundled-cli] cargo build -p agentero-cli --${profile === "release" ? "release" : ""}`.trim(),
);
execSync(`cargo build -p agentero-cli${release ? " --release" : ""}`, {
	cwd: root,
	stdio: "inherit",
});

const src = path.join(root, "target", profile, `agentero${ext}`);
if (!fs.existsSync(src)) {
	console.error(`[prepare-bundled-cli] missing ${src}`);
	process.exit(1);
}
fs.copyFileSync(src, dest);
try {
	fs.chmodSync(dest, 0o755);
} catch {
	// windows
}
console.log(`[prepare-bundled-cli] ${src} → ${dest}`);
