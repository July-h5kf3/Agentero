/**
 * PDF viewer imperative handles by tab id (component-layer registry so the
 * annotations panel can drive the active viewer without React prop threading).
 */

import type { PdfViewerHandle } from "@/components/viewer/embed/pdf-viewer";

const handles = new Map<string, PdfViewerHandle>();

export function registerPdfHandle(
	tabId: string,
	handle: PdfViewerHandle | null,
): void {
	if (handle) handles.set(tabId, handle);
	else handles.delete(tabId);
}

export function pdfHandleFor(tabId: string | null): PdfViewerHandle | null {
	if (!tabId) return null;
	return handles.get(tabId) ?? null;
}
