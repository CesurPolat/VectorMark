import $ from 'jquery';
import '@fortawesome/fontawesome-free/js/all.min.js';
import 'bulma/css/bulma.min.css';

import {
  createFolder,
  listFolders,
  exportDatabase,
  importDatabaseReplace,
  saveOrUpdateBookmarkByUrl,
  resolveBookmarkIconPayload,
  normalizeLegacyIconsToBase64
} from '../services/dbService';
import {
  getSettings,
  updateSettings,
  getDefaultSettings
} from '../services/settingsService';
import {
  downloadTextFile,
  getChromeBookmarkTree,
  flattenChromeBookmarkTree,
  parseBookmarkJsonImport,
  parseNetscapeBookmarkHtml,
  folderMapKey
} from '../sidepanel/sidepanel-utils';

const state = {
  settingsBusy: false,
  openInNewTab: true,
  pageSize: 40,
  viewMode: 'list',
  iconStorageMode: 'base64',
  bookmarkSortBy: 'updatedAt',
  bookmarkSortDir: 'desc',
  folderSortBy: 'name',
  folderSortDir: 'asc'
};

let $status;
let $openNewTabToggle;
let $pageSizeSelect;
let $iconStorageModeSelect;
let $closePageBtn;
let $dbExportBtn;
let $dbImportBtn;
let $dbImportInput;
let $openLanceDbDemoBtn;
let $bookmarkImportChromeBtn;
let $bookmarkImportJsonBtn;
let $bookmarkImportHtmlBtn;
let $bookmarkJsonInput;
let $bookmarkHtmlInput;
let $normalizeIconsBtn;

$(document).ready(async () => {
  cacheDom();
  bindEvents();
  await loadSettings();
  setStatus('Settings ready.', false);
});

function cacheDom() {
  $status = $('#settings-status');
  $openNewTabToggle = $('#open-new-tab-toggle');
  $pageSizeSelect = $('#page-size-select');
  $iconStorageModeSelect = $('#icon-storage-mode-select');
  $closePageBtn = $('#close-page-btn');
  $dbExportBtn = $('#db-export-btn');
  $dbImportBtn = $('#db-import-btn');
  $dbImportInput = $('#db-import-input');
  $openLanceDbDemoBtn = $('#open-lancedb-demo-btn');
  $bookmarkImportChromeBtn = $('#bookmark-import-chrome-btn');
  $bookmarkImportJsonBtn = $('#bookmark-import-json-btn');
  $bookmarkImportHtmlBtn = $('#bookmark-import-html-btn');
  $bookmarkJsonInput = $('#bookmark-json-input');
  $bookmarkHtmlInput = $('#bookmark-html-input');
  $normalizeIconsBtn = $('#normalize-icons-btn');
}

function bindEvents() {
  $closePageBtn.on('click', () => {
    window.close();
  });

  $openNewTabToggle.on('change', async () => {
    const nextOpenInNewTab = $openNewTabToggle.prop('checked');
    state.openInNewTab = nextOpenInNewTab;

    try {
      await persistSettings();
      setStatus('Behavior setting saved.', false);
    } catch (error) {
      console.error('Error saving openInNewTab setting:', error);
      state.openInNewTab = !nextOpenInNewTab;
      syncSettingsControls();
      setStatus('Could not save link behavior.', true);
    }
  });

  $pageSizeSelect.on('change', async () => {
    const nextPageSize = Number($pageSizeSelect.val());

    if (!Number.isFinite(nextPageSize)) {
      return;
    }

    const previousPageSize = state.pageSize;
    state.pageSize = Math.min(250, Math.max(1, Math.floor(nextPageSize)));

    try {
      await persistSettings();
      setStatus('Page size updated.', false);
    } catch (error) {
      console.error('Error saving page size setting:', error);
      state.pageSize = previousPageSize;
      syncSettingsControls();
      setStatus('Could not save page size.', true);
    }
  });

  $iconStorageModeSelect.on('change', async () => {
    const nextMode = String($iconStorageModeSelect.val() ?? '').trim() === 'url' ? 'url' : 'base64';
    const previousMode = state.iconStorageMode;
    state.iconStorageMode = nextMode;

    try {
      await persistSettings();
      setStatus('Icon storage mode saved.', false);
    } catch (error) {
      console.error('Error saving icon storage mode:', error);
      state.iconStorageMode = previousMode;
      syncSettingsControls();
      setStatus('Could not save icon storage mode.', true);
    }
  });

  $dbExportBtn.on('click', handleDbExport);
  $dbImportBtn.on('click', () => $dbImportInput.trigger('click'));
  $dbImportInput.on('change', handleDbImportChange);
  $openLanceDbDemoBtn.on('click', openLanceDbDemo);

  $bookmarkImportChromeBtn.on('click', handleChromeBookmarkImport);
  $bookmarkImportJsonBtn.on('click', () => $bookmarkJsonInput.trigger('click'));
  $bookmarkJsonInput.on('change', handleBookmarkJsonImportChange);
  $bookmarkImportHtmlBtn.on('click', () => $bookmarkHtmlInput.trigger('click'));
  $bookmarkHtmlInput.on('change', handleBookmarkHtmlImportChange);
  $normalizeIconsBtn.on('click', handleNormalizeIcons);
}

async function loadSettings() {
  try {
    const settings = await getSettings();
    applySavedSettings(settings);
  } catch (error) {
    console.error('Error loading settings:', error);
    applySavedSettings(getDefaultSettings());
  }

  syncSettingsControls();
}

function applySavedSettings(saved) {
  state.openInNewTab = saved.openInNewTab;
  state.pageSize = saved.pageSize;
  state.viewMode = saved.viewMode === 'grid' ? 'grid' : 'list';
  state.iconStorageMode = saved.iconStorageMode;
  state.bookmarkSortBy = saved.bookmarkSortBy;
  state.bookmarkSortDir = saved.bookmarkSortDir;
  state.folderSortBy = saved.folderSortBy;
  state.folderSortDir = saved.folderSortDir;
}

function syncSettingsControls() {
  $openNewTabToggle.prop('checked', state.openInNewTab);
  $pageSizeSelect.val(String(state.pageSize));
  $iconStorageModeSelect.val(state.iconStorageMode === 'url' ? 'url' : 'base64');
}

function getSettingsPayload() {
  return {
    openInNewTab: state.openInNewTab,
    pageSize: state.pageSize,
    viewMode: state.viewMode,
    iconStorageMode: state.iconStorageMode,
    bookmarkSortBy: state.bookmarkSortBy,
    bookmarkSortDir: state.bookmarkSortDir,
    folderSortBy: state.folderSortBy,
    folderSortDir: state.folderSortDir,
    manualOrderEnabled: false
  };
}

async function persistSettings() {
  const saved = await updateSettings(getSettingsPayload());
  applySavedSettings(saved);
  syncSettingsControls();
}

function setStatus(message, isError) {
  $status.text(message || '');
  $status.css('color', isError ? '#ffb1b1' : '');
}

function setSettingsBusy(isBusy) {
  state.settingsBusy = isBusy;

  $dbExportBtn.prop('disabled', isBusy);
  $dbImportBtn.prop('disabled', isBusy);
  $bookmarkImportChromeBtn.prop('disabled', isBusy);
  $bookmarkImportJsonBtn.prop('disabled', isBusy);
  $bookmarkImportHtmlBtn.prop('disabled', isBusy);
  $normalizeIconsBtn.prop('disabled', isBusy);
  $openNewTabToggle.prop('disabled', isBusy);
  $pageSizeSelect.prop('disabled', isBusy);
  $iconStorageModeSelect.prop('disabled', isBusy);
  $openLanceDbDemoBtn.prop('disabled', isBusy);
}

function openLanceDbDemo() {
  const demoPath = 'test_documents/test.html';
  const demoUrl = typeof chrome !== 'undefined' && chrome?.runtime?.getURL
    ? chrome.runtime.getURL(demoPath)
    : new URL(`../${demoPath}`, window.location.href).href;

  try {
    if (typeof chrome !== 'undefined' && chrome?.tabs?.create) {
      chrome.tabs.create({ url: demoUrl });
    } else {
      window.open(demoUrl, '_blank', 'noopener');
    }
    setStatus('Opening VecLite demo...', false);
  } catch (error) {
    console.error('Failed to open VecLite demo:', error);
    setStatus('Failed to open VecLite demo.', true);
  }
}

async function handleDbExport() {
  setSettingsBusy(true);
  setStatus('Preparing DB export...', false);

  try {
    const payload = await exportDatabase();
    const filename = `vectormark-db-${new Date().toISOString().replaceAll(':', '-').split('.')[0]}.json`;
    downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json');
    setStatus('DB export completed.', false);
  } catch (error) {
    console.error('DB export failed:', error);
    setStatus(error?.message || 'DB export failed.', true);
  } finally {
    setSettingsBusy(false);
  }
}

async function handleDbImportChange(event) {
  const file = event.target.files?.[0];
  $dbImportInput.val('');

  if (!file) {
    return;
  }

  const confirmed = window.confirm('DB import replace will delete current saved data. Continue?');

  if (!confirmed) {
    return;
  }

  setSettingsBusy(true);
  setStatus('Importing DB...', false);

  try {
    const text = await file.text();
    const result = await importDatabaseReplace(text);
    await loadSettings();
    setStatus(`DB imported. Folders: ${result.folders}, Bookmarks: ${result.bookmarks}.`, false);
  } catch (error) {
    console.error('DB import failed:', error);
    setStatus(error?.message || 'DB import failed.', true);
  } finally {
    setSettingsBusy(false);
  }
}

async function handleChromeBookmarkImport() {
  setSettingsBusy(true);
  setStatus('Reading Chrome bookmarks...', false);

  try {
    const tree = await getChromeBookmarkTree();
    const parsed = flattenChromeBookmarkTree(tree);
    const result = await importNormalizedBookmarks(parsed);
    setStatus(`Chrome import done. Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}.`, false);
  } catch (error) {
    console.error('Chrome import failed:', error);
    setStatus(error?.message || 'Chrome import failed.', true);
  } finally {
    setSettingsBusy(false);
  }
}

async function handleBookmarkJsonImportChange(event) {
  const file = event.target.files?.[0];
  $bookmarkJsonInput.val('');

  if (!file) {
    return;
  }

  setSettingsBusy(true);
  setStatus('Importing bookmarks from JSON...', false);

  try {
    const raw = JSON.parse(await file.text());
    const parsed = parseBookmarkJsonImport(raw);
    const result = await importNormalizedBookmarks(parsed);
    setStatus(`JSON import done. Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}.`, false);
  } catch (error) {
    console.error('JSON import failed:', error);
    setStatus(error?.message || 'JSON import failed.', true);
  } finally {
    setSettingsBusy(false);
  }
}

async function handleBookmarkHtmlImportChange(event) {
  const file = event.target.files?.[0];
  $bookmarkHtmlInput.val('');

  if (!file) {
    return;
  }

  setSettingsBusy(true);
  setStatus('Importing bookmarks from Netscape HTML...', false);

  try {
    const html = await file.text();
    const parsed = parseNetscapeBookmarkHtml(html);
    const result = await importNormalizedBookmarks(parsed);
    setStatus(`HTML import done. Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}.`, false);
  } catch (error) {
    console.error('HTML import failed:', error);
    setStatus(error?.message || 'HTML import failed.', true);
  } finally {
    setSettingsBusy(false);
  }
}

async function handleNormalizeIcons() {
  const modeLabel = state.iconStorageMode === 'url' ? 'URL + hash' : 'Base64';
  const confirmed = window.confirm(`Normalize icons will use ${modeLabel} mode, merge duplicates, and remove unused icon rows. Continue?`);

  if (!confirmed) {
    return;
  }

  setSettingsBusy(true);
  setStatus(`Normalizing icons (${modeLabel})...`, false);

  try {
    let lastProgressRenderAt = 0;

    const summary = await normalizeLegacyIconsToBase64({
      storageMode: state.iconStorageMode,
      onProgress: (progress) => {
        const now = Date.now();

        if (progress.stage !== 'done' && now - lastProgressRenderAt < 120) {
          return;
        }

        lastProgressRenderAt = now;

        if (progress.stage === 'convert') {
          setStatus(
            `Normalizing icons... ${progress.processed}/${progress.total} processed${progress.failed ? `, failed: ${progress.failed}` : ''}`,
            false
          );
          return;
        }

        if (progress.stage === 'merge') {
          setStatus('Normalizing icons... merging duplicates and updating references...', false);
          return;
        }

        if (progress.stage === 'start') {
          setStatus('Normalizing icons... preparing data...', false);
        }
      }
    });

    setStatus(
      `Icon normalization done. Total: ${summary.total}, Converted: ${summary.converted}, Reattached: ${summary.reattached}, Detached: ${summary.detached}, Deleted: ${summary.deleted}, Failed: ${summary.failed}.`,
      false
    );
  } catch (error) {
    console.error('Icon normalization failed:', error);
    setStatus(error?.message || 'Icon normalization failed.', true);
  } finally {
    setSettingsBusy(false);
  }
}

async function importNormalizedBookmarks(items) {
  const folderMap = new Map();
  const iconDataByDomain = new Map();

  const existingFolders = await listFolders();
  existingFolders.forEach((folder) => {
    folderMap.set(folderMapKey(folder.parentId ?? null, folder.name), folder.id);
  });

  const summary = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0
  };

  for (const item of items) {
    const url = String(item.url ?? '').trim();

    if (!url || !/^https?:/i.test(url)) {
      summary.skipped += 1;
      continue;
    }

    const title = String(item.title ?? '').trim() || url;
    const folderPath = String(item.folderPath ?? '').trim();
    const folderId = await resolveFolderId(folderPath, folderMap);
    const iconPayload = await resolveBookmarkIconPayload(url, '', {
      domainCache: iconDataByDomain,
      storageMode: state.iconStorageMode,
      skipPageHtmlLookup: true
    });

    try {
      const result = await saveOrUpdateBookmarkByUrl(
        title,
        url,
        folderId,
        iconPayload
      );

      if (result.action === 'created') {
        summary.created += 1;
      } else {
        summary.updated += 1;
      }
    } catch (error) {
      console.error('Error importing bookmark:', error, item);
      summary.errors += 1;
    }
  }

  return summary;
}

async function resolveFolderId(folderPath, folderMap) {
  const normalizedPath = String(folderPath ?? '').trim();

  if (!normalizedPath) {
    return null;
  }

  const segments = normalizedPath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  let parentId = null;

  for (const segment of segments) {
    const key = folderMapKey(parentId, segment);

    if (folderMap.has(key)) {
      parentId = folderMap.get(key);
      continue;
    }

    const folder = await createFolder(segment, parentId);
    folderMap.set(key, folder.id);
    parentId = folder.id;
  }

  return parentId;
}
