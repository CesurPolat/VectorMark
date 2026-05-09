import { pipeline, env } from '@huggingface/transformers';
import type { EmbeddingProvider, Settings } from '../types';

type EmbeddingVector = number[];

type EmbedResult = {
  vectors: EmbeddingVector[];
  dimensions: number;
};

interface EmbeddingProviderClient {
  provider: EmbeddingProvider;
  embedTexts(texts: string[]): Promise<EmbedResult>;
}

const localExtractorCache = new Map<string, Promise<any>>();

function resolveExtensionUrl(path: string): string {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }

  const baseHref = typeof globalThis !== 'undefined' && globalThis.location?.href
    ? globalThis.location.href
    : '';

  if (!baseHref) {
    return path;
  }

  return new URL(`../${path}`, baseHref).href;
}

function configureTransformerEnv(settings: Settings): string {
  const modelRootUrl = resolveExtensionUrl('models/');
  const modelName = settings.embeddingLocalModel || 'all-MiniLM-L6-v2';
  const modelUrl = resolveExtensionUrl(`models/${modelName}/`);
  const wasmPath = resolveExtensionUrl(`models/${modelName}/wasm/`);

  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = modelRootUrl;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: wasmPath + 'ort-wasm-simd-threaded.jsep.mjs',
    wasm: wasmPath + 'ort-wasm-simd-threaded.jsep.wasm',
  };
  // @ts-ignore
  env.backends.onnx.wasm.useWasmModule = false;
  // @ts-ignore
  env.backends.onnx.wasm.allowLocalModels = true;
  env.backends.onnx.wasm.proxy = false;

  return modelUrl;
}

async function getLocalExtractor(settings: Settings) {
  const modelUrl = configureTransformerEnv(settings);

  if (!localExtractorCache.has(modelUrl)) {
    localExtractorCache.set(modelUrl, pipeline('feature-extraction', modelUrl));
  }

  return localExtractorCache.get(modelUrl);
}

function splitEmbeddingOutput(output: any, expectedCount: number): EmbedResult {
  const rawData = Array.from(output?.data ?? []);
  const dims = Array.isArray(output?.dims) ? output.dims : null;

  if (!dims || dims.length < 2) {
    const vector = rawData.length > 0 ? rawData : [];
    return {
      vectors: [vector],
      dimensions: vector.length
    };
  }

  const batchSize = Number(dims[0]) || expectedCount || 1;
  const dimension = Number(dims[1]) || Math.floor(rawData.length / Math.max(1, batchSize));
  const vectors: EmbeddingVector[] = [];

  for (let i = 0; i < batchSize; i += 1) {
    const start = i * dimension;
    vectors.push(rawData.slice(start, start + dimension));
  }

  return {
    vectors,
    dimensions: dimension
  };
}

async function localEmbedTexts(settings: Settings, texts: string[]): Promise<EmbedResult> {
  const extractor = await getLocalExtractor(settings);
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  return splitEmbeddingOutput(output, texts.length);
}

async function openAiEmbedTexts(settings: Settings, texts: string[]): Promise<EmbedResult> {
  const apiKey = settings.embeddingOpenAiApiKey;
  const model = settings.embeddingOpenAiModel || 'text-embedding-3-small';

  if (!apiKey) {
    throw new Error('OpenAI API key is missing.');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: texts
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embeddings failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const vectors = Array.isArray(payload?.data)
    ? payload.data.map((item: any) => item?.embedding || [])
    : [];
  const dimensions = vectors.length > 0 ? vectors[0].length : 0;

  return { vectors, dimensions };
}

export async function getEmbeddingProvider(settings: Settings): Promise<EmbeddingProviderClient> {
  const provider = settings.embeddingProvider === 'openai' ? 'openai' : 'local';

  if (provider === 'openai') {
    return {
      provider,
      embedTexts: (texts: string[]) => openAiEmbedTexts(settings, texts)
    };
  }

  return {
    provider: 'local',
    embedTexts: (texts: string[]) => localEmbedTexts(settings, texts)
  };
}
