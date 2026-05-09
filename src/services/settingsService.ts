import type { PartialSettingsInput, Settings, ViewMode, IconStorageMode, SortDirection, SortFields } from '../types';

const DEFAULT_SETTINGS: Settings = {
  openInNewTab: false,
  pageSize: 40,
  viewMode: 'list',
  iconStorageMode: 'base64',
  bookmarkSortBy: 'updatedAt',
  bookmarkSortDir: 'desc',
  folderSortBy: 'name',
  folderSortDir: 'asc',
  manualOrderEnabled: false,
  semanticSearchEnabled: false,
  embeddingProvider: 'local',
  embeddingLocalModel: 'all-MiniLM-L6-v2',
  embeddingOpenAiModel: 'text-embedding-3-small',
  embeddingOpenAiApiKey: '',
  embeddingVectorDimensions: 384
};

const SETTINGS_STORAGE_KEY = 'vectormarkSettings';

function clampPageSize(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.pageSize;
  }

  return Math.max(1, Math.min(250, Math.floor(parsed)));
}

function normalizeSettings(raw: PartialSettingsInput = {}): Settings {
  const iconStorageMode: IconStorageMode = raw.iconStorageMode === 'url' ? 'url' : 'base64';
  const viewMode: ViewMode = raw.viewMode === 'grid' ? 'grid' : 'list';
  const bookmarkSortBy = String(raw.bookmarkSortBy ?? '').trim();
  const bookmarkSortDir: SortDirection = raw.bookmarkSortDir === 'asc' ? 'asc' : 'desc';
  const folderSortBy = String(raw.folderSortBy ?? '').trim();
  const folderSortDir: SortDirection = raw.folderSortDir === 'desc' ? 'desc' : 'asc';
  const embeddingProvider = raw.embeddingProvider === 'openai' ? 'openai' : 'local';
  const embeddingLocalModel = String(raw.embeddingLocalModel ?? '').trim() || DEFAULT_SETTINGS.embeddingLocalModel;
  const embeddingOpenAiModel = String(raw.embeddingOpenAiModel ?? '').trim() || DEFAULT_SETTINGS.embeddingOpenAiModel;
  const embeddingOpenAiApiKey = String(raw.embeddingOpenAiApiKey ?? '').trim();
  const embeddingVectorDimensions = Number.isFinite(Number(raw.embeddingVectorDimensions))
    ? Math.max(1, Math.floor(Number(raw.embeddingVectorDimensions)))
    : DEFAULT_SETTINGS.embeddingVectorDimensions;

  return {
    openInNewTab: raw.openInNewTab === true,
    pageSize: clampPageSize(raw.pageSize),
    viewMode,
    iconStorageMode,
    bookmarkSortBy: (bookmarkSortBy || DEFAULT_SETTINGS.bookmarkSortBy) as SortFields,
    bookmarkSortDir,
    folderSortBy: (folderSortBy || DEFAULT_SETTINGS.folderSortBy) as SortFields,
    folderSortDir,
    manualOrderEnabled: raw.manualOrderEnabled === true,
    semanticSearchEnabled: raw.semanticSearchEnabled === true,
    embeddingProvider,
    embeddingLocalModel,
    embeddingOpenAiModel,
    embeddingOpenAiApiKey,
    embeddingVectorDimensions
  };
}

function getStorage() {
  return chrome?.storage?.local ?? null;
}

export async function getSettings(): Promise<Settings> {
  const storage = getStorage();

  if (!storage) {
    return { ...DEFAULT_SETTINGS };
  }

  return await new Promise<Settings>((resolve) => {
    storage.get([
      SETTINGS_STORAGE_KEY,
      'openInNewTab',
      'pageSize',
      'viewMode',
      'iconStorageMode',
      'bookmarkSortBy',
      'bookmarkSortDir',
      'folderSortBy',
      'folderSortDir',
      'manualOrderEnabled',
      'semanticSearchEnabled',
      'embeddingProvider',
      'embeddingLocalModel',
      'embeddingOpenAiModel',
      'embeddingOpenAiApiKey',
      'embeddingVectorDimensions'
    ], (result) => {
      const runtimeError = chrome.runtime?.lastError;

      if (runtimeError) {
        console.error('Error reading settings from storage:', runtimeError);
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }

      if (result && typeof result[SETTINGS_STORAGE_KEY] === 'object' && result[SETTINGS_STORAGE_KEY] !== null) {
        resolve(normalizeSettings(result[SETTINGS_STORAGE_KEY]));
        return;
      }

      // Legacy fallback for old flat keys.
      const legacy = normalizeSettings(result || {});
      resolve(legacy);
    });
  });
}

export async function updateSettings(partialSettings: PartialSettingsInput): Promise<Settings> {
  const storage = getStorage();

  if (!storage) {
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...partialSettings });
  }

  const current = await getSettings();
  const merged = normalizeSettings({ ...current, ...partialSettings });

  await new Promise<void>((resolve, reject) => {
    storage.set({
      [SETTINGS_STORAGE_KEY]: merged,
      // Keep legacy keys for backward compatibility.
      openInNewTab: merged.openInNewTab,
      pageSize: merged.pageSize,
      viewMode: merged.viewMode,
      iconStorageMode: merged.iconStorageMode,
      bookmarkSortBy: merged.bookmarkSortBy,
      bookmarkSortDir: merged.bookmarkSortDir,
      folderSortBy: merged.folderSortBy,
      folderSortDir: merged.folderSortDir,
      manualOrderEnabled: merged.manualOrderEnabled,
      semanticSearchEnabled: merged.semanticSearchEnabled,
      embeddingProvider: merged.embeddingProvider,
      embeddingLocalModel: merged.embeddingLocalModel,
      embeddingOpenAiModel: merged.embeddingOpenAiModel,
      embeddingOpenAiApiKey: merged.embeddingOpenAiApiKey,
      embeddingVectorDimensions: merged.embeddingVectorDimensions
    }, () => {
      const runtimeError = chrome.runtime?.lastError;

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });

  return merged;
}

export function getDefaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}
