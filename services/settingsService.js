const DEFAULT_SETTINGS = {
  openInNewTab: false,
  pageSize: 40,
  iconStorageMode: 'base64'
};

const SETTINGS_STORAGE_KEY = 'vectormarkSettings';

function clampPageSize(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.pageSize;
  }

  return Math.max(1, Math.min(250, Math.floor(parsed)));
}

function normalizeSettings(raw = {}) {
  const iconStorageMode = raw.iconStorageMode === 'url' ? 'url' : 'base64';

  return {
    openInNewTab: raw.openInNewTab === true,
    pageSize: clampPageSize(raw.pageSize),
    iconStorageMode
  };
}

function getStorage() {
  return chrome?.storage?.local ?? null;
}

export async function getSettings() {
  const storage = getStorage();

  if (!storage) {
    return { ...DEFAULT_SETTINGS };
  }

  return await new Promise((resolve) => {
    storage.get([SETTINGS_STORAGE_KEY, 'openInNewTab', 'pageSize', 'iconStorageMode'], (result) => {
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

export async function updateSettings(partialSettings) {
  const storage = getStorage();

  if (!storage) {
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...partialSettings });
  }

  const current = await getSettings();
  const merged = normalizeSettings({ ...current, ...partialSettings });

  await new Promise((resolve, reject) => {
    storage.set({
      [SETTINGS_STORAGE_KEY]: merged,
      // Keep legacy keys for backward compatibility.
      openInNewTab: merged.openInNewTab,
      pageSize: merged.pageSize,
      iconStorageMode: merged.iconStorageMode
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

export function getDefaultSettings() {
  return { ...DEFAULT_SETTINGS };
}
