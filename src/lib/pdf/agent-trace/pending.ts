/**
 * In-memory map from Agent runtime session id → traces awaiting completion.
 * Used so complete/fail handlers can patch answerSnapshot / providerSessionId.
 */

export type PendingVisualTraceWrite = {
	paperAbsPath: string;
	traceId: string;
};

const pendingByRuntimeSession = new Map<string, PendingVisualTraceWrite[]>();

export function rememberPendingVisualTraces(
	runtimeSessionId: string,
	writes: PendingVisualTraceWrite[],
): void {
	if (!runtimeSessionId || !writes.length) return;
	const existing = pendingByRuntimeSession.get(runtimeSessionId) ?? [];
	pendingByRuntimeSession.set(runtimeSessionId, [...existing, ...writes]);
}

export function takePendingVisualTraces(
	runtimeSessionId: string,
): PendingVisualTraceWrite[] {
	const writes = pendingByRuntimeSession.get(runtimeSessionId) ?? [];
	pendingByRuntimeSession.delete(runtimeSessionId);
	return writes;
}
