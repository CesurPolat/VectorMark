import { VecLite, IndexedDBAdapter } from 'veclite';
import { db } from './dbCore';
import { getSettings } from './settingsService';
import { getEmbeddingProvider } from './embeddingService';
import type { BookmarkRecord, EmbeddingRebuildProgress, Settings } from '../types';

const INDEX_DB_NAME = 'VectorMarkEmbeddings';
const INDEX_STORE_NAME = 'bookmarks';
const DEFAULT_BATCH_SIZE = 32;

let vecLitePromise: Promise<VecLite> | null = null;
let vecLiteDimensions: number | null = null;

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

function getEmbeddingText(record: Pick<BookmarkRecord, 'title' | 'url'>): string {
  const parts = [record?.title || '', record?.url || ''];
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

async function ensureVecLite(settings: Settings, dimensionsOverride?: number): Promise<VecLite> {
  const dimensions = dimensionsOverride || settings.embeddingVectorDimensions || 384;

  if (vecLitePromise && vecLiteDimensions === dimensions) {
    return vecLitePromise;
  }

  vecLiteDimensions = dimensions;
  vecLitePromise = (async () => {
    const wasmUrl = resolveExtensionUrl('veclite/veclite_bg.wasm');
    await VecLite.init(wasmUrl);
    const instance = new VecLite({
      dimensions,
      storage: new IndexedDBAdapter(INDEX_DB_NAME, INDEX_STORE_NAME)
    });
    await instance.load();
    return instance;
  })();

  return vecLitePromise;
}

function normalizeBookmarkRecord(record: BookmarkRecord): BookmarkRecord {
  return {
    ...record,
    folderId: record.folderId ?? null,
    createdAt: Number(record.createdAt) || Date.now(),
    updatedAt: Number(record.updatedAt) || Date.now(),
    lastClickedAt: record.lastClickedAt ?? null,
    customOrder: Number(record.customOrder) || 0
  };
}

async function embedTexts(settings: Settings, texts: string[]): Promise<number[][]> {
  const provider = await getEmbeddingProvider(settings);
  const result = await provider.embedTexts(texts);

  if (!result.vectors || result.vectors.length === 0) {
    throw new Error('Embedding provider returned no vectors.');
  }

  return result.vectors;
}

async function yieldToUi(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function upsertBookmarkEmbedding(record: BookmarkRecord): Promise<void> {
  const settings = await getSettings();

  if (!settings.semanticSearchEnabled) {
    return;
  }

  const normalized = normalizeBookmarkRecord(record);
  const text = getEmbeddingText(normalized);

  if (!text) {
    return;
  }

  const vectors = await embedTexts(settings, [text]);
  const dbInstance = await ensureVecLite(settings, vectors[0]?.length);
  dbInstance.upsert([
    {
      id: normalized.id,
      vector: vectors[0],
      metadata: {
        folderId: normalized.folderId ?? ''
      }
    }
  ]);
  await dbInstance.save();
}

export async function deleteBookmarkEmbedding(bookmarkId: string): Promise<void> {
  const settings = await getSettings();

  if (!settings.semanticSearchEnabled) {
    return;
  }

  const dbInstance = await ensureVecLite(settings);
  dbInstance.delete([bookmarkId]);
  await dbInstance.save();
}

export async function semanticSearchBookmarks(query: string, topK: number): Promise<Array<{ id: string; score: number }>> {
  const settings = await getSettings();

  if (!settings.semanticSearchEnabled) {
    return [];
  }

  const normalizedQuery = String(query ?? '').trim();

  if (!normalizedQuery) {
    return [];
  }

  const vectors = await embedTexts(settings, [normalizedQuery]);
  const dbInstance = await ensureVecLite(settings, vectors[0]?.length);
  const result = dbInstance.search({
    vector: vectors[0],
    topK: Math.max(1, topK)
  });

  return result.map((item: any) => ({
    id: String(item?.id ?? ''),
    score: Number(item?.score ?? 0)
  })).filter((item) => item.id);
}

export async function rebuildEmbeddingIndex(options: { onProgress?: ((progress: EmbeddingRebuildProgress) => void) | null } = {}): Promise<void> {
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
  const settings = await getSettings();
  const allBookmarks = await db.bookmarks.toArray();
  const total = allBookmarks.length;

  const reportProgress = (progress: Omit<EmbeddingRebuildProgress, 'total'>) => {
    if (!onProgress) {
      return;
    }

    onProgress({
      total,
      ...progress
    });
  };

  reportProgress({ stage: 'start', processed: 0 });

  if (total === 0) {
    const dbInstance = await ensureVecLite(settings);
    await dbInstance.clear();
    await dbInstance.save();
    reportProgress({ stage: 'done', processed: 0 });
    return;
  }

  const batchSize = DEFAULT_BATCH_SIZE;
  const firstBatch = allBookmarks.slice(0, batchSize).map(normalizeBookmarkRecord);
  const firstTexts = firstBatch.map(getEmbeddingText);
  const firstVectors = await embedTexts(settings, firstTexts);
  const dbInstance = await ensureVecLite(settings, firstVectors[0]?.length);

  await dbInstance.clear();

  const firstEntries = firstBatch.map((bookmark, index) => ({
    id: bookmark.id,
    vector: firstVectors[index],
    metadata: {
      folderId: bookmark.folderId ?? ''
    }
  }));

  dbInstance.upsert(firstEntries);
  let processed = firstEntries.length;
  reportProgress({ stage: 'batch', processed });
  await yieldToUi();

  for (let i = batchSize; i < allBookmarks.length; i += batchSize) {
    const batch = allBookmarks.slice(i, i + batchSize).map(normalizeBookmarkRecord);
    const texts = batch.map(getEmbeddingText);
    const vectors = await embedTexts(settings, texts);

    const entries = batch.map((bookmark, index) => ({
      id: bookmark.id,
      vector: vectors[index],
      metadata: {
        folderId: bookmark.folderId ?? ''
      }
    }));

    dbInstance.upsert(entries);
    processed += entries.length;
    reportProgress({ stage: 'batch', processed });
    await yieldToUi();
  }

  await dbInstance.save();
  reportProgress({ stage: 'done', processed: total });
}
