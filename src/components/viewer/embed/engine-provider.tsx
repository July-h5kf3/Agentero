import { usePdfiumEngine } from "@embedpdf/engines/react";
import type { PdfEngine } from "@embedpdf/models";
import pdfiumWasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { createContext, type ReactNode, useContext } from "react";

export type PdfEngineContextValue = {
	engine: PdfEngine | null;
	isLoading: boolean;
	error: Error | null;
};

const PdfEngineContext = createContext<PdfEngineContextValue>({
	engine: null,
	isLoading: true,
	error: null,
});

/**
 * Creates the PDFium (WASM) engine once for the whole workspace window and
 * shares it with every PDF tab via context. PDFium holds many documents
 * concurrently, so a single engine backs all `<EmbedPDF>` providers.
 *
 * The wasm binary is bundled as a local asset (offline-first Tauri); font
 * fallback is disabled so no external font requests are made. `worker: false`
 * runs PDFium on the main thread: under Tauri's WKWebView the worker variant
 * re-fetches the wasm from a `blob:` worker context and silently stalls, so the
 * main-thread engine (loading the wasm via the Vite `?url` asset) is used.
 */
export function PdfEngineHost({ children }: { children: ReactNode }) {
	const { engine, isLoading, error } = usePdfiumEngine({
		wasmUrl: pdfiumWasmUrl,
		worker: false,
		fontFallback: null,
	});
	return (
		<PdfEngineContext.Provider value={{ engine, isLoading, error }}>
			{children}
		</PdfEngineContext.Provider>
	);
}

export function usePdfEngineContext(): PdfEngineContextValue {
	return useContext(PdfEngineContext);
}
