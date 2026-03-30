import { pipeline, env } from "../vendor/transformers.js";

//env.localModelPath = chrome.runtime.getURL("models/");

env.allowLocalModels = true;
env.allowRemoteModels = false;

//env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("models/all-MiniLM-L6-v2/wasm/");
env.backends.onnx.wasm.wasmPaths = "chrome-extension://ccpfbjgmcfjhefbnkiciaochcobfkcan/models/all-MiniLM-L6-v2/wasm/";

env.backends.onnx.wasm.useWasmModule = false;
env.backends.onnx.wasm.allowLocalModels = true;
env.backends.onnx.wasm.proxy = false;

const extractor = await pipeline('feature-extraction', 'all-MiniLM-L6-v2');

// Compute sentence embeddings
const sentences = ['This is an example sentence', 'Each sentence is converted'];
const output = await extractor(sentences, { pooling: 'mean', normalize: true });
console.log(output.data);

document.getElementById("test").innerText = output.data.join("\n");