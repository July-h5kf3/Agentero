/**
 * Zotero Connector–compatible local server control (Host :23119).
 * @see docs/backend/connector.md
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/tauri";

export type ConnectorStatus = {
	enabled: boolean;
	listening: boolean;
	port: number;
	boundAddress: string | null;
	lastError: string | null;
	vaultPath: string | null;
	parentDir: string;
};

export type ConnectorItemSaved = {
	path: string;
	id: string;
	title: string;
	deduped: boolean;
	sessionId: string;
};

type ApiResult<T> = {
	ok: boolean;
	data?: T;
	error?: { code: string; message: string };
};

async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
	const res = await promise;
	if (!res?.ok || res.data === undefined) {
		throw new Error(res?.error?.message ?? "connector command failed");
	}
	return res.data;
}

export async function connectorGetStatus(): Promise<ConnectorStatus> {
	if (!isTauri()) {
		return {
			enabled: false,
			listening: false,
			port: 23119,
			boundAddress: null,
			lastError: null,
			vaultPath: null,
			parentDir: "papers",
		};
	}
	return unwrap(invoke<ApiResult<ConnectorStatus>>("connector_get_status"));
}

export async function connectorSetEnabled(
	enabled: boolean,
): Promise<ConnectorStatus> {
	if (!isTauri()) {
		return connectorGetStatus();
	}
	return unwrap(
		invoke<ApiResult<ConnectorStatus>>("connector_set_enabled", {
			args: { enabled },
		}),
	);
}

export async function connectorSetVault(
	vaultPath: string | null,
): Promise<void> {
	if (!isTauri()) return;
	await unwrap(
		invoke<ApiResult<null>>("connector_set_vault", {
			args: { vaultPath },
		}),
	);
}

/** Default save parent for Connector (`papers` or `papers/…` org folder). */
export async function connectorSetParentDir(parentDir: string): Promise<void> {
	if (!isTauri()) return;
	const dir = parentDir
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!dir) return;
	await unwrap(
		invoke<ApiResult<null>>("connector_set_parent_dir", {
			args: { parentDir: dir },
		}),
	);
}
