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
let $foldersList;
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

$(document).ready(async () => {
  cacheDom();
  bindEvents();
  await loadAll();
});

async function loadAll() {
  await loadFolders();
  await loadBookmarks();
}

function cacheDom() {
  $searchInput = $('#bookmark-search');
  $count = $('#bookmark-count');
  $status = $('#bookmark-status');
  $list = $('#bookmarks-list');
  $listWrap = $('#bookmark-scroll-wrap');
  $foldersList = $('#folders-list');
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

  $foldersList.on('click', '[data-folder-id]', (event) => {
    const folderIdRaw = String($(event.currentTarget).data('folder-id'));
    state.currentFolderId = folderIdRaw === 'all' ? null : Number(folderIdRaw);
    loadBookmarks();
    renderFolders();
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

async function loadFolders() {
  try {
    state.folders = await listFolders();
    renderFolders();
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
  if (state.query) {
    return await searchBookmarksPage(state.query, state.currentFolderId, offset, limit);
  }

  const [items, total] = await Promise.all([
    listBookmarksPageWithIcons(state.currentFolderId, offset, limit),
    countBookmarks(state.currentFolderId)
  ]);

  return {
    items,
    total
  };
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
  renderFolders();

  $loadingState.toggleClass('is-hidden', !state.loading);
  $errorState.toggleClass('is-hidden', !state.error);

  const shouldShowEmpty = !state.loading && !state.error && state.bookmarks.length === 0;
  $emptyState.toggleClass('is-hidden', !shouldShowEmpty);
  $loadingMoreState.toggleClass('is-hidden', !state.loadingMore);

  if (state.loading || state.error || shouldShowEmpty) {
    $list.empty();
    return;
  }

  $list.empty();

  state.bookmarks.forEach((bookmark) => {
    const iconHtml = bookmark.icon
      ? `<img src="${escapeAttr(bookmark.icon.base64)}" alt="" />`
      : '<i class="fas fa-bookmark"></i>';

    const item = $(`
      <article class="vm-card${state.selectedBookmark && state.selectedBookmark.id === bookmark.id ? ' is-active' : ''}" data-bookmark-id="${bookmark.id}">
        <div class="vm-card-head">
          <div class="vm-icon">${iconHtml}</div>
          <div class="vm-card-body">
            <a class="vm-bookmark-title" href="${escapeAttr(bookmark.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(bookmark.title)}</a>
            <div class="vm-bookmark-url">${escapeHtml(bookmark.url)}</div>
          </div>
        </div>

        <div class="vm-card-actions">
          <a class="button is-small is-success is-light" href="${escapeAttr(bookmark.url)}" target="_blank" rel="noreferrer noopener">
            <span class="icon is-small"><i class="fas fa-external-link-alt"></i></span>
            <span>Open</span>
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

function renderFolders() {
  if (!$foldersList) {
    return;
  }

  const current = state.currentFolderId;
  const folderChips = [];

  folderChips.push(`
    <button class="vm-folder-pill${current === null ? ' is-active' : ''}" type="button" data-folder-id="all">
      <span class="vm-folder-left">
        <i class="fas fa-folder-open"></i>
        <span class="vm-folder-name">All Bookmarks</span>
      </span>
      <span class="vm-folder-count">${state.folders.reduce((sum, folder) => sum + folder.bookmarkCount, 0)}</span>
    </button>
  `);

  state.folders.forEach((folder) => {
    folderChips.push(`
      <button class="vm-folder-pill${current === folder.id ? ' is-active' : ''}" type="button" data-folder-id="${folder.id}">
        <span class="vm-folder-left">
          <i class="fas fa-folder"></i>
          <span class="vm-folder-name">${escapeHtml(folder.name)}</span>
        </span>
        <span class="vm-folder-count">${folder.bookmarkCount}</span>
      </button>
    `);
  });

  $foldersList.html(folderChips.join(''));
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

  if (state.currentFolderId !== null) {
    const folder = state.folders.find((item) => item.id === state.currentFolderId);
    return folder ? `Folder: ${folder.name}` : 'Folder view';
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
    const folder = await createFolder(folderName);
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

async function importNormalizedBookmarks(items) {
  const folderMap = new Map();

  const existingFolders = await listFolders();
  existingFolders.forEach((folder) => {
    folderMap.set(folder.name.toLowerCase(), folder.id);
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

  const cacheKey = normalizedPath.toLowerCase();

  if (folderMap.has(cacheKey)) {
    return folderMap.get(cacheKey);
  }

  const folder = await createFolder(normalizedPath);
  folderMap.set(cacheKey, folder.id);

  return folder.id;
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
