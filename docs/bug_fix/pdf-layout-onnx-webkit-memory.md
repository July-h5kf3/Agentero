# PDF layout analysis WebContent OOM

## Symptom

Layout analysis of a 23-page PDF stopped partway through and the background
task returned to zero.

## Root cause

macOS unified logs showed WebContent reaching about 9 GB and being terminated
with `ExceededMemoryLimit`. The CPU/WASM layout backend was loaded through
`onnxruntime-web/webgpu`, selecting ONNX Runtime's WebGPU/JSEP asyncify WASM
build. On Safari/WebKit 26 this build exhibits severe memory growth across
inferences. WebKit reloaded the renderer after termination, clearing the
in-memory task row.

This behavior matches ONNX Runtime
[#26827](https://github.com/microsoft/onnxruntime/issues/26827). Tensor disposal
does not resolve it because WASM linear memory cannot shrink, as discussed in
[#21673](https://github.com/microsoft/onnxruntime/issues/21673).

## Fix

The pnpm dependency patch loads `onnxruntime-web/wasm` for `wasm` and `cpu`
backends. It keeps `onnxruntime-web/webgpu` for an explicitly selected `webgpu`
backend. No task recovery, memory guard, retry, or layout workflow was added.

## Verification

- A RED/GREEN regression test proves the WASM backend uses the standard WASM
  runtime and does not load the WebGPU runtime.
- A rebuilt macOS app completed the original 23-page paper in one WebContent
  process and wrote a 4,763,378-byte `source/layout.json` containing all page
  indexes from 0 through 22.
- WebContent stayed near 1 GB for most of the run, rather than growing past 8
  GB, and the exact verification window contained no `ExceededMemoryLimit`
  event.
