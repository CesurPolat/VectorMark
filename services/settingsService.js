const DEFAULT_SETTINGS = {
  openInNewTab: false,
  pageSize: 40
};

function clampPageSize(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.pageSize;
  }

  return Math.max(1, Math.min(250, Math.floor(parsed)));
}

function normalizeSettings(raw = {}) {
  return {
    openInNewTab: raw.openInNewTab === true,
    pageSize: clampPageSize(raw.pageSize)
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
    storage.get(DEFAULT_SETTINGS, (result) => {
      resolve(normalizeSettings(result));
    });
  });
}

export async function updateSettings(partialSettings) {
  const storage = getStorage();

  if (!storage) {
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...partialSettings });
  }

  const merged = normalizeSettings({ ...DEFAULT_SETTINGS, ...partialSettings });

  await new Promise((resolve, reject) => {
    storage.set(merged, () => {
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
