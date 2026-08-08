/**
 * Build headless CLI (`agentero-cli` cargo bin) and copy it into
 * src-tauri/binaries with the target-triple suffix required by Tauri
 * `bundle.externalBin`.
 *
 * Usage:
 *   node scripts/prepare-bundled-cli.mjs           # debug (default)
 *   node scripts/prepare-bundled-cli.mjs --release
 *   node scripts/prepare-bundled-cli.mjs --stub    # tiny non-empty placeholder for typecheck
 *   node scripts/prepare-bundled-cli.mjs --ensure  # seed stub only if missing (tauri dev)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const release = process.argv.includes("--release");
const stub = process.argv.includes("--stub");
const ensure = process.argv.includes("--ensure");
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

/** Non-empty placeholder so Tauri build-script accepts `externalBin`. */
function writeStub(target) {
	const body = isWin
		? "@echo off\r\necho agentero-cli stub\r\nexit /b 1\r\n"
		: "#!/bin/sh\necho 'agentero-cli stub' >&2\nexit 1\n";
	fs.writeFileSync(target, body);
	try {
		fs.chmodSync(target, 0o755);
	} catch {
		// windows
	}
}

function needsSeed(target) {
	return !fs.existsSync(target) || fs.statSync(target).size === 0;
}

if (ensure) {
	// For `tauri dev`: create a compile-time placeholder without overwriting a real CLI.
	if (needsSeed(dest)) {
		writeStub(dest);
		console.log(`[prepare-bundled-cli] ensure seeded stub → ${dest}`);
	} else {
		console.log(`[prepare-bundled-cli] ensure ok → ${dest}`);
	}
	process.exit(0);
}

if (stub) {
	// Host still rejects stubs that cannot report --version before Install.
	writeStub(dest);
	console.log(`[prepare-bundled-cli] stub → ${dest}`);
	process.exit(0);
}

// Fresh trees have no externalBin artifact; Tauri build-script fails while
// compiling agentero_lib (dependency of agentero-cli). Seed a stub first,
// then overwrite with the real binary after cargo build.
if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
	writeStub(dest);
	console.log(`[prepare-bundled-cli] seeded stub for compile → ${dest}`);
}

const profile = release ? "release" : "debug";
console.log(
	`[prepare-bundled-cli] cargo build -p agentero-cli${release ? " --release" : ""}`,
);
execSync(`cargo build -p agentero-cli${release ? " --release" : ""}`, {
	cwd: root,
	stdio: "inherit",
});

const src = path.join(root, "target", profile, `agentero-cli${ext}`);
if (!fs.existsSync(src)) {
	console.error(`[prepare-bundled-cli] missing ${src}`);
	process.exit(1);
}
// Refuse to ship a broken empty artifact.
const st = fs.statSync(src);
if (st.size < 1024) {
	console.error(
		`[prepare-bundled-cli] ${src} is too small (${st.size} bytes); refusing`,
	);
	process.exit(1);
}
fs.copyFileSync(src, dest);
// Also stage next to the GUI binary for `tauri dev` Settings → Install CLI.
const devSidecar = path.join(root, "target", profile, `agentero-cli${ext}`);
if (path.resolve(src) !== path.resolve(devSidecar)) {
	fs.copyFileSync(src, devSidecar);
}
try {
	fs.chmodSync(dest, 0o755);
} catch {
	// windows
}
console.log(`[prepare-bundled-cli] ${src} → ${dest}`);
