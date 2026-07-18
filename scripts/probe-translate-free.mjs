#!/usr/bin/env node
/**
 * Temporary probe: free MT engine availability (same class of endpoints as Host).
 *
 * Usage:
 *   node scripts/probe-translate-free.mjs
 *   node scripts/probe-translate-free.mjs --text "Hello world" --to zh-CN
 *   node scripts/probe-translate-free.mjs --only googleapi,bing,youdao
 *
 * Not imported by the app. Safe to delete after verification.
 */

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
function flag(name, fallback) {
	const i = args.indexOf(name);
	if (i >= 0 && args[i + 1]) return args[i + 1];
	return fallback;
}

const TEXT = flag("--text", "Hello world");
const TO = flag("--to", "zh-CN");
const FROM = flag("--from", "en");
const ONLY = flag("--only", "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const TIMEOUT_MS = Number(flag("--timeout", "15000")) || 15000;

const engines = [
	{ id: "bing", run: bing },
	{ id: "youdao", run: youdao },
	{ id: "huoshanweb", run: huoshan },
	{ id: "tencenttransmart", run: tencent },
	{ id: "googleapi", run: () => google("https://translate.googleapis.com") },
	{ id: "google", run: () => google("https://translate.google.com") },
];

async function fetchWithTimeout(url, init = {}) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		return await fetch(url, {
			...init,
			signal: ctrl.signal,
			headers: {
				"User-Agent": UA,
				...(init.headers || {}),
			},
		});
	} finally {
		clearTimeout(t);
	}
}

function snippet(s, n = 80) {
	const t = String(s ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function google(host) {
	const u = new URL(`${host}/translate_a/single`);
	u.searchParams.set("client", "gtx");
	u.searchParams.set("sl", FROM === "auto" ? "auto" : FROM);
	u.searchParams.set("tl", TO);
	u.searchParams.set("dt", "t");
	u.searchParams.set("q", TEXT);
	const res = await fetchWithTimeout(u);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	let out = "";
	for (const seg of data?.[0] ?? []) {
		if (seg?.[0]) out += seg[0];
	}
	if (!out) throw new Error("empty result");
	return out;
}

async function bing() {
	const auth = await fetchWithTimeout(
		"https://edge.microsoft.com/translate/auth",
	);
	if (!auth.ok) throw new Error(`auth HTTP ${auth.status}`);
	const token = (await auth.text()).trim();
	if (!token) throw new Error("empty token");
	const url = new URL(
		"https://api-edge.cognitive.microsofttranslator.com/translate",
	);
	url.searchParams.set("to", TO);
	url.searchParams.set("api-version", "3.0");
	url.searchParams.set("includeSentenceLength", "true");
	if (FROM && FROM !== "auto") url.searchParams.set("from", FROM);
	const res = await fetchWithTimeout(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify([{ text: TEXT }]),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	const out = data?.[0]?.translations?.[0]?.text;
	if (!out) throw new Error("empty result");
	return out;
}

function youdaoLang(code) {
	if (code === "auto") return "AUTO";
	const base = code.split("-")[0].toUpperCase();
	return base === "ZH" ? "ZH_CN" : base;
}

async function youdao() {
	const typ = `${youdaoLang(FROM)}2${youdaoLang(TO)}`;
	// Prefer mobile-ish endpoint; desktop often returns HTML interstitial.
	const candidates = [
		() => {
			const u = new URL("https://fanyi.youdao.com/translate");
			u.searchParams.set("doctype", "json");
			u.searchParams.set("type", typ);
			u.searchParams.set("i", TEXT);
			return fetchWithTimeout(u, {
				headers: {
					Referer: "https://fanyi.youdao.com/",
					Accept: "application/json, text/plain, */*",
				},
			});
		},
		() => {
			const u = new URL("https://aidemo.youdao.com/trans");
			u.searchParams.set("q", TEXT);
			u.searchParams.set("from", FROM === "auto" ? "Auto" : FROM.split("-")[0]);
			u.searchParams.set(
				"to",
				TO.startsWith("zh") ? "zh-CHS" : TO.split("-")[0],
			);
			return fetchWithTimeout(u);
		},
	];
	let lastErr = "unknown";
	for (const make of candidates) {
		try {
			const res = await make();
			if (!res.ok) {
				lastErr = `HTTP ${res.status}`;
				continue;
			}
			const text = await res.text();
			if (text.trimStart().startsWith("<")) {
				lastErr = "HTML response";
				continue;
			}
			const data = JSON.parse(text);
			// classic web shape
			let out = "";
			for (const row of data?.translateResult ?? []) {
				for (const cell of row ?? []) {
					if (cell?.tgt) out += cell.tgt;
				}
			}
			if (!out && data?.translation) {
				out = Array.isArray(data.translation)
					? data.translation.join("")
					: String(data.translation);
			}
			if (!out && data?.data?.translation) {
				out = String(data.data.translation);
			}
			if (out) return out;
			lastErr = "empty result";
		} catch (e) {
			lastErr = e instanceof Error ? e.message : String(e);
		}
	}
	throw new Error(lastErr);
}

async function haici() {
	const idRes = await fetchWithTimeout("http://capi.dict.cn/fanyi.php", {
		headers: { Referer: "http://fanyi.dict.cn/" },
	});
	if (!idRes.ok) throw new Error(`appId HTTP ${idRes.status}`);
	const appId = (await idRes.text()).trim().replace(/^"|"$/g, "");
	if (!appId) throw new Error("empty appId");
	const escaped = TEXT.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	const texts = `["${escaped}"]`;
	const u = new URL(
		"http://api.microsofttranslator.com/V2/Ajax.svc/TranslateArray",
	);
	u.searchParams.set("appId", appId);
	u.searchParams.set("from", FROM === "auto" ? "" : FROM);
	u.searchParams.set("to", TO);
	u.searchParams.set("texts", texts);
	const res = await fetchWithTimeout(u);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.text()).replace(/^\uFEFF/, "");
	const data = JSON.parse(body);
	let out = "";
	for (const line of data ?? []) {
		if (line?.TranslatedText) out += line.TranslatedText;
	}
	if (!out) throw new Error("empty result");
	return out;
}

/** Minimal AES-128-ECB PKCS7 for CNKI (Web Crypto subtle is CBC-only; use pure JS). */
async function cnki() {
	// Dynamic import of node crypto for AES-ECB
	const crypto = await import("node:crypto");
	const key = Buffer.from("4e87183cfd3a45fe", "utf8");
	const plain = Buffer.from(TEXT.slice(0, 800), "utf8");
	const pad = 16 - (plain.length % 16);
	const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
	const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
	cipher.setAutoPadding(false);
	const enc = Buffer.concat([cipher.update(padded), cipher.final()]);
	const words = enc.toString("base64").replace(/\//g, "_").replace(/\+/g, "-");

	const tokRes = await fetchWithTimeout(
		"https://dict.cnki.net/fyzs-front-api/getToken",
	);
	if (!tokRes.ok) throw new Error(`token HTTP ${tokRes.status}`);
	const tokJson = await tokRes.json();
	const token = tokJson?.data || tokJson?.token;
	if (!token) throw new Error("empty token");

	const res = await fetchWithTimeout(
		"https://dict.cnki.net/fyzs-front-api/translate/literaltranslation",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json;charset=UTF-8",
				Token: token,
			},
			body: JSON.stringify({ words, translateType: null }),
		},
	);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	if (data?.data?.isInputVerificationCode) {
		throw new Error("captcha required");
	}
	const out = data?.data?.mResult;
	if (!out) throw new Error("empty result");
	return out;
}

async function deeplx() {
	const id = 1000 * (Math.floor(Math.random() * 99999) + 8300000) + 1;
	const iCounts = (TEXT.match(/i/g) || []).length + 1;
	const ts = Date.now();
	const timestamp = ts - (ts % iCounts) + iCounts;
	const mapLang = (c) => {
		if (c.startsWith("zh"))
			return c.toLowerCase().includes("tw") ? "ZH-HANT" : "ZH-HANS";
		if (c === "auto") return "auto";
		return c.split("-")[0].toUpperCase();
	};
	let body = JSON.stringify({
		jsonrpc: "2.0",
		method: "LMT_handle_texts",
		id,
		params: {
			texts: [{ text: TEXT, requestAlternatives: 3 }],
			splitting: "newlines",
			lang: {
				source_lang_user_selected: mapLang(FROM),
				target_lang: mapLang(TO),
			},
			timestamp,
			commonJobParams: { wasSpoken: false, transcribe_as: "" },
		},
	});
	if ((id + 5) % 29 === 0 || (id + 3) % 13 === 0) {
		body = body.replace('"method":"', '"method" : "');
	} else {
		body = body.replace('"method":"', '"method": "');
	}
	const url =
		"https://www2.deepl.com/jsonrpc?client=chrome-extension,1.28.0&method=LMT_handle_jobs";
	const res = await fetchWithTimeout(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: "None",
			Origin: "chrome-extension://cofdbpoegempjloogbagkncekinflcnj",
			Referer: "https://www.deepl.com/",
			"User-Agent":
				"DeepLBrowserExtension/1.28.0 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
		},
		body,
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	const out = data?.result?.texts?.[0]?.text;
	if (!out) throw new Error("empty result");
	return out;
}

async function huoshan() {
	const res = await fetchWithTimeout(
		"https://translate.volcengine.com/crx/translate/v1",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				source_language: FROM === "auto" ? "auto" : FROM.split("-")[0],
				target_language: TO.split("-")[0],
				text: TEXT,
			}),
		},
	);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	if (!data?.translation) throw new Error("empty result");
	return data.translation;
}

async function tencent() {
	const res = await fetchWithTimeout("https://transmart.qq.com/api/imt", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Referer: "https://transmart.qq.com/zh-CN/index",
		},
		body: JSON.stringify({
			header: {
				fn: "auto_translation",
				client_key:
					"browser-chrome-110.0.0-Mac OS-df4bd4c5-a65d-44b2-a40f-42f34f3535f2-1677486696487",
			},
			type: "plain",
			model_category: "normal",
			source: {
				lang: FROM === "auto" ? "auto" : FROM.split("-")[0],
				text_list: [TEXT],
			},
			target: { lang: TO.split("-")[0] },
		}),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	const parts = data?.auto_translation;
	if (!Array.isArray(parts) || !parts.length) throw new Error("empty result");
	return parts.join("\n").trim();
}

async function main() {
	const list = ONLY.length
		? engines.filter((e) => ONLY.includes(e.id))
		: engines;

	console.log(`Probe free translate engines`);
	console.log(`  text: ${JSON.stringify(TEXT)}`);
	console.log(`  from: ${FROM}  to: ${TO}  timeout: ${TIMEOUT_MS}ms`);
	console.log(`  engines: ${list.map((e) => e.id).join(", ")}`);
	console.log("");

	const rows = [];
	for (const e of list) {
		const started = Date.now();
		process.stdout.write(`… ${e.id.padEnd(18)} `);
		try {
			const out = await e.run();
			const ms = Date.now() - started;
			console.log(`OK  ${String(ms).padStart(5)}ms  ${snippet(out)}`);
			rows.push({ id: e.id, ok: true, ms, sample: snippet(out, 40) });
		} catch (err) {
			const ms = Date.now() - started;
			const msg = err instanceof Error ? err.message : String(err);
			console.log(`FAIL ${String(ms).padStart(5)}ms  ${snippet(msg, 60)}`);
			rows.push({ id: e.id, ok: false, ms, error: msg });
		}
	}

	const ok = rows.filter((r) => r.ok).length;
	const fail = rows.length - ok;
	console.log("");
	console.log(`Summary: ${ok} ok / ${fail} fail / ${rows.length} total`);
	if (fail) process.exitCode = 1;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
