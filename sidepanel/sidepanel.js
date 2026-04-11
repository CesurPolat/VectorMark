import {
  listBookmarksPageWithIcons,
  searchBookmarksPage,
  countBookmarks,
  updateBookmark,
  deleteBookmark,
  createFolder,
  listFolders,
  exportDatabase,
  importDatabaseReplace,
  saveOrUpdateBookmarkByUrl
} from '../services/dbService.js';
import {
  getSettings,
  updateSettings,
  getDefaultSettings
} from '../services/settingsService.js';

const state = {
  bookmarks: [],
  folders: [],
  currentFolderId: null,
  loading: true,
  error: null,
  query: '',
  selectedBookmark: null,
  activeDrawer: null,
  settingsBusy: false,
  pageSize: 40,
  openInNewTab: true,
  totalBookmarks: 0,
  hasMore: true,
  loadingMore: false,
  requestToken: 0
};

let $searchInput;
let $count;
let $status;
let $list;
let $listWrap;
let $breadcrumb;
let $createFolderInput;
let $createFolderBtn;
let $settingsOpenBtn;
let $loadingState;
let $emptyState;
let $errorState;
let $errorMessage;
let $drawer;
let $drawerBackdrop;
let $settingsDrawer;
let $drawerTitle;
let $editTitle;
let $editUrl;
let $drawerSave;
let $drawerClose;
let $drawerCancel;
let $settingsClose;
let $settingsCancel;
let $settingsStatus;
let $dbExportBtn;
let $dbImportBtn;
let $dbImportInput;
let $bookmarkImportChromeBtn;
let $bookmarkImportJsonBtn;
let $bookmarkImportHtmlBtn;
let $bookmarkJsonInput;
let $bookmarkHtmlInput;
let $loadingMoreState;
let $openNewTabToggle;
let $pageSizeSelect;

$(document).ready(async () => {
  cacheDom();
  bindEvents();
  await loadAll();
});

async function loadAll() {
  await loadSettings();
  await loadFolders();
  await loadBookmarks();
}

async function loadSettings() {
  try {
    const settings = await getSettings();
    state.openInNewTab = settings.openInNewTab;
    state.pageSize = settings.pageSize;
  } catch (error) {
    console.error('Error loading settings:', error);
    const defaults = getDefaultSettings();
    state.openInNewTab = defaults.openInNewTab;
    state.pageSize = defaults.pageSize;
  }

  syncSettingsControls();
}

function syncSettingsControls() {
  if ($openNewTabToggle) {
    $openNewTabToggle.prop('checked', state.openInNewTab);
  }

  if ($pageSizeSelect) {
    $pageSizeSelect.val(String(state.pageSize));
  }
}

function cacheDom() {
  $searchInput = $('#bookmark-search');
  $count = $('#bookmark-count');
  $status = $('#bookmark-status');
  $list = $('#bookmarks-list');
  $listWrap = $('#bookmark-scroll-wrap');
  $breadcrumb = $('#folder-breadcrumb');
  $createFolderInput = $('#create-folder-input');
  $createFolderBtn = $('#create-folder-btn');
  $settingsOpenBtn = $('#settings-open-btn');
  $loadingState = $('#loading-state');
  $emptyState = $('#empty-state');
  $errorState = $('#error-state');
  $errorMessage = $('#error-message');
  $drawer = $('#bookmark-drawer');
  $drawerBackdrop = $('#drawer-backdrop');
  $settingsDrawer = $('#settings-drawer');
  $drawerTitle = $('#drawer-title');
  $editTitle = $('#edit-title');
  $editUrl = $('#edit-url');
  $drawerSave = $('#drawer-save');
  $drawerClose = $('#drawer-close');
  $drawerCancel = $('#drawer-cancel');
  $settingsClose = $('#settings-close');
  $settingsCancel = $('#settings-cancel');
  $settingsStatus = $('#settings-status');
  $dbExportBtn = $('#db-export-btn');
  $dbImportBtn = $('#db-import-btn');
  $dbImportInput = $('#db-import-input');
  $bookmarkImportChromeBtn = $('#bookmark-import-chrome-btn');
  $bookmarkImportJsonBtn = $('#bookmark-import-json-btn');
  $bookmarkImportHtmlBtn = $('#bookmark-import-html-btn');
  $bookmarkJsonInput = $('#bookmark-json-input');
  $bookmarkHtmlInput = $('#bookmark-html-input');
  $loadingMoreState = $('#loading-more-state');
  $openNewTabToggle = $('#open-new-tab-toggle');
  $pageSizeSelect = $('#page-size-select');
}

function bindEvents() {
  let searchTimer = null;

  $searchInput.on('input', () => {
    state.query = $searchInput.val().trim();

    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }

    searchTimer = window.setTimeout(() => {
      loadBookmarks();
    }, 180);
  });

  $listWrap.on('scroll', handleListScroll);

  $list.on('click', '[data-action="open-folder"]', (event) => {
    const folderId = Number($(event.currentTarget).data('folder-id'));

    if (!Number.isInteger(folderId)) {
      return;
    }

    navigateToFolder(folderId);
  });

  $list.on('click', '[data-action="open-link"]', async (event) => {
    event.preventDefault();
    const url = String($(event.currentTarget).data('url') ?? '').trim();

    if (!url) {
      return;
    }

    try {
      await openBookmarkUrl(url, state.openInNewTab);
    } catch (error) {
      console.error('Error opening url:', error);
      setError('Unable to open this link right now.');
    }
  });

  $breadcrumb.on('click', '[data-folder-id]', (event) => {
    const folderIdRaw = String($(event.currentTarget).data('folder-id'));
    const folderId = folderIdRaw === 'all' ? null : Number(folderIdRaw);
    navigateToFolder(folderId);
  });

  $createFolderBtn.on('click', createFolderFromInput);
  $createFolderInput.on('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      createFolderFromInput();
    }
  });

  $settingsOpenBtn.on('click', openSettingsDrawer);
  $settingsClose.on('click', closeSettingsDrawer);
  $settingsCancel.on('click', closeSettingsDrawer);

  $openNewTabToggle.on('change', async () => {
    state.openInNewTab = $openNewTabToggle.prop('checked');

    try {
      await updateSettings({
        openInNewTab: state.openInNewTab,
        pageSize: state.pageSize
      });

      render();
      setSettingsStatus('Behavior setting saved.', false);
    } catch (error) {
      console.error('Error saving openInNewTab setting:', error);
      setSettingsStatus('Could not save link behavior.', true);
      $openNewTabToggle.prop('checked', !state.openInNewTab);
      state.openInNewTab = $openNewTabToggle.prop('checked');
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
      await updateSettings({
        openInNewTab: state.openInNewTab,
        pageSize: state.pageSize
      });

      await loadBookmarks();
      setSettingsStatus('Page size updated.', false);
    } catch (error) {
      console.error('Error saving page size setting:', error);
      state.pageSize = previousPageSize;
      $pageSizeSelect.val(String(previousPageSize));
      setSettingsStatus('Could not save page size.', true);
    }
  });

  $list.on('click', '[data-action="edit"]', (event) => {
    const bookmarkId = Number($(event.currentTarget).data('id'));
    const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);

    if (bookmark) {
      openDrawer(bookmark);
    }
  });

  $list.on('click', '[data-action="delete"]', async (event) => {
    const bookmarkId = Number($(event.currentTarget).data('id'));
    const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);

    if (!bookmark) {
      return;
    }

    const confirmed = window.confirm(`Delete "${bookmark.title}"?`);

    if (!confirmed) {
      return;
    }

    setStatus('Deleting bookmark...');

    try {
      await deleteBookmark(bookmarkId);

      if (state.selectedBookmark && state.selectedBookmark.id === bookmarkId) {
        closeDrawer();
      }

      await loadFolders();
      await loadBookmarks();
    } catch (error) {
      console.error('Error deleting bookmark:', error);
      setError('Unable to delete this bookmark right now.');
    }
  });

  $drawerSave.on('click', saveBookmark);
  $drawerClose.on('click', closeDrawer);
  $drawerCancel.on('click', closeDrawer);
  $drawerBackdrop.on('click', () => {
    if (state.activeDrawer === 'bookmark') {
      closeDrawer();
      return;
    }

    if (state.activeDrawer === 'settings') {
      closeSettingsDrawer();
    }
  });

  $dbExportBtn.on('click', handleDbExport);
  $dbImportBtn.on('click', () => $dbImportInput.trigger('click'));
  $dbImportInput.on('change', handleDbImportChange);

  $bookmarkImportChromeBtn.on('click', handleChromeBookmarkImport);
  $bookmarkImportJsonBtn.on('click', () => $bookmarkJsonInput.trigger('click'));
  $bookmarkJsonInput.on('change', handleBookmarkJsonImportChange);
  $bookmarkImportHtmlBtn.on('click', () => $bookmarkHtmlInput.trigger('click'));
  $bookmarkHtmlInput.on('change', handleBookmarkHtmlImportChange);

  $(document).on('keydown', (event) => {
    if (event.key === 'Escape') {
      if (state.activeDrawer === 'bookmark') {
        closeDrawer();
      }

      if (state.activeDrawer === 'settings') {
        closeSettingsDrawer();
      }
    }
  });
}

function navigateToFolder(folderId) {
  const parsedFolderId = folderId === null || folderId === undefined ? null : Number(folderId);

  if (parsedFolderId !== null && !Number.isInteger(parsedFolderId)) {
    return;
  }

  state.currentFolderId = parsedFolderId;
  loadBookmarks();
  renderBreadcrumb();
}

async function openBookmarkUrl(url, inNewTab) {
  return await new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const queryError = chrome.runtime?.lastError;

      if (queryError) {
        reject(new Error(queryError.message));
        return;
      }

      const activeTab = tabs?.[0] ?? null;

      if (inNewTab) {
        chrome.tabs.create({
          url,
          index: activeTab && Number.isInteger(activeTab.index) ? activeTab.index + 1 : undefined
        }, () => {
          const createError = chrome.runtime?.lastError;

          if (createError) {
            reject(new Error(createError.message));
            return;
          }

          resolve();
        });

        return;
      }

      if (activeTab?.id) {
        chrome.tabs.update(activeTab.id, { url }, () => {
          const updateError = chrome.runtime?.lastError;

          if (updateError) {
            reject(new Error(updateError.message));
            return;
          }

          resolve();
        });

        return;
      }

      chrome.tabs.create({ url }, () => {
        const createError = chrome.runtime?.lastError;

        if (createError) {
          reject(new Error(createError.message));
          return;
        }

        resolve();
      });
    });
  });
}

async function loadFolders() {
  try {
    state.folders = await listFolders();

    if (state.currentFolderId !== null && !state.folders.some((folder) => folder.id === state.currentFolderId)) {
      state.currentFolderId = null;
    }

    renderBreadcrumb();
  } catch (error) {
    console.error('Error loading folders:', error);
    setError('Unable to load folders right now.');
  }
}

async function loadBookmarks() {
  const requestToken = ++state.requestToken;
  state.loading = true;
  state.loadingMore = false;
  state.error = null;
  state.bookmarks = [];
  state.totalBookmarks = 0;
  state.hasMore = true;
  $listWrap.scrollTop(0);
  render();

  try {
    const page = await fetchBookmarkPage({
      offset: 0,
      limit: state.pageSize
    });

    if (requestToken !== state.requestToken) {
      return;
    }

    state.bookmarks = page.items;
    state.totalBookmarks = page.total;
    state.hasMore = state.bookmarks.length < state.totalBookmarks;
  } catch (error) {
    if (requestToken !== state.requestToken) {
      return;
    }

    console.error('Error loading bookmarks:', error);
    state.bookmarks = [];
    state.totalBookmarks = 0;
    state.error = 'Error loading bookmarks.';
    $errorMessage.text(error?.message || 'Something went wrong while loading the bookmarks.');
  } finally {
    if (requestToken !== state.requestToken) {
      return;
    }

    state.loading = false;
    state.loadingMore = false;
    render();
  }
}

async function loadMoreBookmarks() {
  if (state.loading || state.loadingMore || !state.hasMore) {
    return;
  }

  const requestToken = ++state.requestToken;
  state.loadingMore = true;
  state.error = null;
  render();

  try {
    const page = await fetchBookmarkPage({
      offset: state.bookmarks.length,
      limit: state.pageSize
    });

    if (requestToken !== state.requestToken) {
      return;
    }

    state.bookmarks = state.bookmarks.concat(page.items);
    state.totalBookmarks = page.total;
    state.hasMore = state.bookmarks.length < state.totalBookmarks;
  } catch (error) {
    if (requestToken !== state.requestToken) {
      return;
    }

    console.error('Error loading more bookmarks:', error);
    state.error = 'Error loading more bookmarks.';
    $errorMessage.text(error?.message || 'Something went wrong while loading more bookmarks.');
  } finally {
    if (requestToken !== state.requestToken) {
      return;
    }

    state.loadingMore = false;
    render();
  }
}

async function fetchBookmarkPage({ offset, limit }) {
  const queryOptions = {
    rootOnly: !state.query
  };

  if (state.query) {
    return await searchBookmarksPage(state.query, state.currentFolderId, offset, limit, queryOptions);
  }

  const [items, total] = await Promise.all([
    listBookmarksPageWithIcons(state.currentFolderId, offset, limit, queryOptions),
    countBookmarks(state.currentFolderId, queryOptions)
  ]);

  return {
    items,
    total
  };
}

function getCurrentChildFolders() {
  if (state.query) {
    return [];
  }

  const parentId = state.currentFolderId;

  return state.folders
    .filter((folder) => {
      const candidateParent = folder.parentId === undefined ? null : folder.parentId;
      return candidateParent === parentId;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getCurrentFolderPath() {
  if (state.currentFolderId === null) {
    return [];
  }

  const byId = new Map(state.folders.map((folder) => [folder.id, folder]));
  const path = [];
  const visited = new Set();
  let current = byId.get(state.currentFolderId);

  while (current) {
    if (visited.has(current.id)) {
      break;
    }

    visited.add(current.id);
    path.unshift(current);

    if (current.parentId === null || current.parentId === undefined) {
      break;
    }

    current = byId.get(current.parentId);
  }

  return path;
}

function renderBreadcrumb() {
  if (!$breadcrumb) {
    return;
  }

  const crumbs = [{ id: null, label: 'All Bookmarks' }];
  getCurrentFolderPath().forEach((folder) => {
    crumbs.push({ id: folder.id, label: folder.name });
  });

  const pieces = [];

  crumbs.forEach((crumb, index) => {
    const isLast = index === crumbs.length - 1;
    const idAttr = crumb.id === null ? 'all' : String(crumb.id);

    if (isLast) {
      pieces.push(`<span class="vm-crumb is-active">${escapeHtml(crumb.label)}</span>`);
    } else {
      pieces.push(`<button class="vm-crumb" type="button" data-folder-id="${escapeAttr(idAttr)}">${escapeHtml(crumb.label)}</button>`);
      pieces.push('<span class="vm-crumb-sep"><i class="fas fa-chevron-right"></i></span>');
    }
  });

  $breadcrumb.html(pieces.join(''));
}

function handleListScroll() {
  if (state.loading || state.loadingMore || !state.hasMore) {
    return;
  }

  const element = $listWrap.get(0);

  if (!element) {
    return;
  }

  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;

  if (remaining <= 180) {
    loadMoreBookmarks();
  }
}

function render() {
  $count.text(state.totalBookmarks);
  $status.text(getStatusLabel());
  renderBreadcrumb();

  $loadingState.toggleClass('is-hidden', !state.loading);
  $errorState.toggleClass('is-hidden', !state.error);

  const foldersInView = getCurrentChildFolders();
  const shouldShowEmpty = !state.loading && !state.error && foldersInView.length === 0 && state.bookmarks.length === 0;
  $emptyState.toggleClass('is-hidden', !shouldShowEmpty);
  $loadingMoreState.toggleClass('is-hidden', !state.loadingMore);

  if (state.loading || state.error || shouldShowEmpty) {
    $list.empty();
    return;
  }

  $list.empty();

  foldersInView.forEach((folder) => {
    const item = $(`
      <article class="vm-card vm-folder-row" data-action="open-folder" data-folder-id="${folder.id}" tabindex="0" role="button">
        <div class="vm-card-head">
          <div class="vm-icon"><i class="fas fa-folder"></i></div>
          <div class="vm-card-body">
            <div class="vm-bookmark-title">${escapeHtml(folder.name)}</div>
            <div class="vm-folder-subtext">${folder.bookmarkCount} bookmarks</div>
          </div>
          <span class="icon has-text-grey-light"><i class="fas fa-chevron-right"></i></span>
        </div>
      </article>
    `);

    $list.append(item);
  });

  state.bookmarks.forEach((bookmark) => {
    const iconHtml = bookmark.icon
      ? `<img src="${escapeAttr(bookmark.icon.base64)}" alt="" />`
      : '<i class="fas fa-bookmark"></i>';

    const item = $(`
      <article class="vm-card${state.selectedBookmark && state.selectedBookmark.id === bookmark.id ? ' is-active' : ''}" data-bookmark-id="${bookmark.id}">
        <div class="vm-card-head">
          <div class="vm-icon">${iconHtml}</div>
          <div class="vm-card-body">
            <a class="vm-bookmark-title" href="${escapeAttr(bookmark.url)}" data-action="open-link" data-url="${escapeAttr(bookmark.url)}">${escapeHtml(bookmark.title)}</a>
            <div class="vm-bookmark-url">${escapeHtml(bookmark.url)}</div>
          </div>
        </div>

        <div class="vm-card-actions">
          <a class="button is-small is-success is-light" href="${escapeAttr(bookmark.url)}" data-action="open-link" data-url="${escapeAttr(bookmark.url)}">
            <span class="icon is-small"><i class="fas fa-external-link-alt"></i></span>
            <span>${state.openInNewTab ? 'Open New Tab' : 'Open Here'}</span>
          </a>
          <button class="button is-small vm-link-button" type="button" data-action="edit" data-id="${bookmark.id}">
            <span class="icon is-small"><i class="fas fa-pen"></i></span>
            <span>Edit</span>
          </button>
          <button class="button is-small is-danger is-light" type="button" data-action="delete" data-id="${bookmark.id}">
            <span class="icon is-small"><i class="fas fa-trash"></i></span>
            <span>Delete</span>
          </button>
        </div>
      </article>
    `);

    $list.append(item);
  });
}

function getStatusLabel() {
  if (state.loading) {
    return 'Loading bookmarks';
  }

  if (state.error) {
    return 'Needs attention';
  }

  if (state.query) {
    return `Filtered by "${state.query}" (${state.bookmarks.length}/${state.totalBookmarks})`;
  }

  const path = getCurrentFolderPath();

  if (path.length > 0) {
    const label = path.map((item) => item.name).join(' / ');
    return `Folder: ${label}`;
  }

  if (state.hasMore) {
    return `${state.bookmarks.length}/${state.totalBookmarks} loaded`;
  }

  return `All ${state.totalBookmarks} loaded`;
}

function openDrawer(bookmark) {
  state.selectedBookmark = bookmark;
  $drawerTitle.text(`Edit: ${bookmark.title}`);
  $editTitle.val(bookmark.title);
  $editUrl.val(bookmark.url);
  $drawer.attr('aria-hidden', 'false');
  $drawerBackdrop.addClass('is-open');
  $drawer.addClass('is-open');
  state.activeDrawer = 'bookmark';
  render();
  window.setTimeout(() => {
    $editTitle.trigger('focus');
    $editTitle.trigger('select');
  }, 50);
}

function closeDrawer() {
  if (!state.selectedBookmark) {
    if (state.activeDrawer === 'bookmark') {
      $drawerBackdrop.removeClass('is-open');
      state.activeDrawer = null;
    }
    $drawer.removeClass('is-open');
    $drawer.attr('aria-hidden', 'true');
    return;
  }

  state.selectedBookmark = null;
  $drawerBackdrop.removeClass('is-open');
  $drawer.removeClass('is-open');
  $drawer.attr('aria-hidden', 'true');
  state.activeDrawer = null;
  render();
}

function openSettingsDrawer() {
  if (state.activeDrawer === 'bookmark') {
    closeDrawer();
  }

  state.activeDrawer = 'settings';
  $settingsDrawer.attr('aria-hidden', 'false');
  $settingsDrawer.addClass('is-open');
  $drawerBackdrop.addClass('is-open');
  syncSettingsControls();
  setSettingsStatus('Choose an action.', false);
}

function closeSettingsDrawer() {
  if (state.settingsBusy) {
    return;
  }

  $settingsDrawer.removeClass('is-open');
  $settingsDrawer.attr('aria-hidden', 'true');
  $drawerBackdrop.removeClass('is-open');
  state.activeDrawer = null;
}

async function saveBookmark() {
  if (!state.selectedBookmark) {
    return;
  }

  const title = $editTitle.val().trim();
  const url = $editUrl.val().trim();

  if (!title || !url) {
    setError('Title and URL are required before saving.');
    return;
  }

  setStatus('Saving bookmark...');

  try {
    await updateBookmark(state.selectedBookmark.id, {
      title,
      url
    });

    closeDrawer();
    await loadBookmarks();
  } catch (error) {
    console.error('Error updating bookmark:', error);
    setError(error?.message || 'Unable to save bookmark changes.');
  }
}

async function createFolderFromInput() {
  const folderName = $createFolderInput.val().trim();

  if (!folderName) {
    setError('Folder name is required.');
    return;
  }

  setStatus('Creating folder...');

  try {
    const folder = await createFolder(folderName, state.currentFolderId);
    $createFolderInput.val('');
    await loadFolders();
    state.currentFolderId = folder.id;
    await loadBookmarks();
    setStatus(`Folder "${folder.name}" created.`);
  } catch (error) {
    console.error('Error creating folder:', error);
    setError(error?.message || 'Unable to create folder.');
  }
}

function setStatus(message) {
  state.error = null;
  $status.text(message);
  $errorState.addClass('is-hidden');
}

function setError(message) {
  state.error = message;
  $errorMessage.text(message);
  render();
}

function setSettingsStatus(message, isError = false) {
  if (!$settingsStatus) {
    return;
  }

  $settingsStatus.text(message || '');
  $settingsStatus.css('color', isError ? '#ffb1b1' : '');
}

function setSettingsBusy(isBusy) {
  state.settingsBusy = isBusy;
  $dbExportBtn.prop('disabled', isBusy);
  $dbImportBtn.prop('disabled', isBusy);
  $bookmarkImportChromeBtn.prop('disabled', isBusy);
  $bookmarkImportJsonBtn.prop('disabled', isBusy);
  $bookmarkImportHtmlBtn.prop('disabled', isBusy);
  $openNewTabToggle.prop('disabled', isBusy);
  $pageSizeSelect.prop('disabled', isBusy);
}

async function handleDbExport() {
  setSettingsBusy(true);
  setSettingsStatus('Preparing DB export...', false);

  try {
    const payload = await exportDatabase();
    const filename = `vectormark-db-${new Date().toISOString().replaceAll(':', '-').split('.')[0]}.json`;
    downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json');
    setSettingsStatus('DB export completed.', false);
  } catch (error) {
    console.error('DB export failed:', error);
    setSettingsStatus(error?.message || 'DB export failed.', true);
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
  setSettingsStatus('Importing DB...', false);

  try {
    const text = await file.text();
    const result = await importDatabaseReplace(text);
    await loadAll();
    closeDrawer();
    setSettingsStatus(`DB imported. Folders: ${result.folders}, Bookmarks: ${result.bookmarks}.`, false);
  } catch (error) {
    console.error('DB import failed:', error);
    setSettingsStatus(error?.message || 'DB import failed.', true);
  } finally {
    setSettingsBusy(false);
  }
}

async function handleChromeBookmarkImport() {
  setSettingsBusy(true);
  setSettingsStatus('Reading Chrome bookmarks...', false);

  try {
    const tree = await getChromeBookmarkTree();
    const parsed = flattenChromeBookmarkTree(tree);
    const result = await importNormalizedBookmarks(parsed);
    await loadAll();
    setSettingsStatus(`Chrome import done. Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}.`, false);
  } catch (error) {
    console.error('Chrome import failed:', error);
    setSettingsStatus(error?.message || 'Chrome import failed.', true);
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
  setSettingsStatus('Importing bookmarks from JSON...', false);

  try {
    const raw = JSON.parse(await file.text());
    const parsed = parseBookmarkJsonImport(raw);
    const result = await importNormalizedBookmarks(parsed);
    await loadAll();
    setSettingsStatus(`JSON import done. Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}.`, false);
  } catch (error) {
    console.error('JSON import failed:', error);
    setSettingsStatus(error?.message || 'JSON import failed.', true);
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
  setSettingsStatus('Importing bookmarks from Netscape HTML...', false);

  try {
    const html = await file.text();
    const parsed = parseNetscapeBookmarkHtml(html);
    const result = await importNormalizedBookmarks(parsed);
    await loadAll();
    setSettingsStatus(`HTML import done. Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}.`, false);
  } catch (error) {
    console.error('HTML import failed:', error);
    setSettingsStatus(error?.message || 'HTML import failed.', true);
  } finally {
    setSettingsBusy(false);
  }
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function getChromeBookmarkTree() {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((nodes) => {
      const runtimeError = chrome.runtime?.lastError;

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(nodes || []);
    });
  });
}

function flattenChromeBookmarkTree(nodes) {
  const result = [];

  function walk(currentNodes, folderPath) {
    (currentNodes || []).forEach((node) => {
      const isBookmark = !!node.url;
      const label = (node.title || '').trim();

      if (isBookmark) {
        result.push({
          title: label || node.url,
          url: node.url,
          folderPath: folderPath.join(' / ')
        });
        return;
      }

      const nextPath = label ? [...folderPath, label] : folderPath;
      walk(node.children || [], nextPath);
    });
  }

  walk(nodes, []);

  return result;
}

function parseBookmarkJsonImport(raw) {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.bookmarks)
      ? raw.bookmarks
      : null;

  if (!items) {
    throw new Error('Bookmark JSON must be an array or contain a bookmarks array.');
  }

  return items
    .map((item) => ({
      title: String(item.title ?? '').trim(),
      url: String(item.url ?? '').trim(),
      folderPath: String(item.folderPath ?? item.folder ?? '').trim()
    }))
    .filter((item) => item.url);
}

function parseNetscapeBookmarkHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const rootDl = doc.querySelector('dl');

  if (!rootDl) {
    throw new Error('Netscape bookmark file does not contain a DL root.');
  }

  const result = [];

  function getDirectChildByTag(parent, tagName) {
    const upper = tagName.toUpperCase();

    for (const child of parent.children) {
      if (child.tagName === upper) {
        return child;
      }
    }

    return null;
  }

  function walkDl(dl, folderPath) {
    const children = Array.from(dl.children);

    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];

      if (child.tagName !== 'DT') {
        continue;
      }

      const h3 = getDirectChildByTag(child, 'H3');
      const link = getDirectChildByTag(child, 'A');
      let nestedDl = getDirectChildByTag(child, 'DL');

      if (!nestedDl) {
        const nextSibling = children[index + 1];
        if (nextSibling?.tagName === 'DL') {
          nestedDl = nextSibling;
        }
      }

      if (link) {
        const url = String(link.getAttribute('href') ?? '').trim();

        if (url) {
          result.push({
            title: String(link.textContent ?? '').trim() || url,
            url,
            folderPath: folderPath.join(' / ')
          });
        }
      }

      if (h3 && nestedDl) {
        const folderName = String(h3.textContent ?? '').trim();
        const nextPath = folderName ? [...folderPath, folderName] : folderPath;
        walkDl(nestedDl, nextPath);
      }
    }
  }

  walkDl(rootDl, []);

  return result;
}

function folderMapKey(parentId, name) {
  return `${parentId === null ? 'root' : parentId}:${name.toLowerCase()}`;
}

async function importNormalizedBookmarks(items) {
  const folderMap = new Map();

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

    try {
      const result = await saveOrUpdateBookmarkByUrl(
        title,
        url,
        folderId,
        `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64`
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
