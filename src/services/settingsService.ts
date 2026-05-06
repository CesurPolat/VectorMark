import type { PartialSettingsInput, Settings, ViewMode, IconStorageMode, BookmarkSortBy, FolderSortBy, SortDirection } from '../types';

const DEFAULT_SETTINGS: Settings = {
  openInNewTab: false,
  pageSize: 40,
  viewMode: 'list',
  iconStorageMode: 'base64',
  bookmarkSortBy: 'updatedAt',
  bookmarkSortDir: 'desc',
  folderSortBy: 'name',
  folderSortDir: 'asc',
  manualOrderEnabled: false
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

  return {
    openInNewTab: raw.openInNewTab === true,
    pageSize: clampPageSize(raw.pageSize),
    viewMode,
    iconStorageMode,
    bookmarkSortBy: (bookmarkSortBy || DEFAULT_SETTINGS.bookmarkSortBy) as BookmarkSortBy,
    bookmarkSortDir,
    folderSortBy: (folderSortBy || DEFAULT_SETTINGS.folderSortBy) as FolderSortBy,
    folderSortDir,
    manualOrderEnabled: raw.manualOrderEnabled === true
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
      'manualOrderEnabled'
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
      manualOrderEnabled: merged.manualOrderEnabled
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
