import $ from 'jquery';
import '@fortawesome/fontawesome-free/js/all.min.js';
import 'bulma/css/bulma.min.css';

import {
  listBookmarksPageWithIcons,
  searchBookmarksPage,
  countBookmarks,
  updateBookmark,
  deleteBookmark,
  createFolder,
  listFolders,
  renameFolder,
  updateFolder,
  deleteFolder,
  recordBookmarkClick,
  moveBookmarkInCustomOrder,
  moveFolderInCustomOrder,
  resolveBookmarkIconPayload
} from '../services/dbService';

import {exportDatabase, importDatabaseReplace, normalizeLegacyIconsToBase64} from '../services/dbMaintenanceService';

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
  folderMapKey,
  escapeHtml,
  escapeAttr
} from './sidepanel-utils';

const state = {
  bookmarks: [],
  folders: [],
  currentFolderId: null,
  loading: true,
  error: null,
  query: '',
  selectedBookmark: null,
  selectedBookmarkIds: new Set(),
  selectedFolderIds: new Set(),
  multiSelectEnabled: false,
  activeDrawer: null,
  settingsBusy: false,
  pageSize: 40,
  openInNewTab: true,
  viewMode: 'list',
  iconStorageMode: 'base64',
  bookmarkSortBy: 'updatedAt',
  bookmarkSortDir: 'desc',
  folderSortBy: 'name',
  folderSortDir: 'asc',
  totalBookmarks: 0,
  hasMore: true,
  loadingMore: false,
  requestToken: 0,
  contextMenu: {
    isOpen: false,
    type: null,
    targetId: null,
    x: 0,
    y: 0
  },
  moveModalOpen: false
};

function normalizeId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function isValidId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

let $searchInput;
let $count;
let $list;
let $listWrap;
let $breadcrumb;
let $contextMenu;
let $settingsOpenBtn;
let $fullscreenToggleBtn;
let $panelCloseBtn;
let $loadingState;
let $emptyState;
let $errorState;
let $errorMessage;
let $drawer;
let $drawerBackdrop;
let $drawerTitle;
let $editTitle;
let $editUrl;
let $editFolderSelect;
let $drawerSave;
let $drawerClose;
let $drawerCancel;
let $loadingMoreState;
let $openNewTabToggle;
let $pageSizeSelect;
let $iconStorageModeSelect;
let $sharedSortSelect;
let $viewModeChip;
let $multiSelectChip;
let $multiSelectPanel;
let $multiSelectCount;
let $bulkOpenBtn;
let $bulkMoveBtn;
let $bulkDeleteBtn;
let $bulkClearBtn;
let $moveModal;
let $moveModalBackdrop;
let $moveModalClose;
let $moveModalCancel;
let $moveModalSubmit;
let $moveTargetFolderSelect;

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
    state.viewMode = settings.viewMode === 'grid' ? 'grid' : 'list';
    state.iconStorageMode = settings.iconStorageMode;
    state.bookmarkSortBy = settings.bookmarkSortBy;
    state.bookmarkSortDir = settings.bookmarkSortDir;
    state.folderSortBy = settings.folderSortBy;
    state.folderSortDir = settings.folderSortDir;
  } catch (error) {
    console.error('Error loading settings:', error);
    const defaults = getDefaultSettings();
    state.openInNewTab = defaults.openInNewTab;
    state.pageSize = defaults.pageSize;
    state.viewMode = defaults.viewMode === 'grid' ? 'grid' : 'list';
    state.iconStorageMode = defaults.iconStorageMode;
    state.bookmarkSortBy = defaults.bookmarkSortBy;
    state.bookmarkSortDir = defaults.bookmarkSortDir;
    state.folderSortBy = defaults.folderSortBy;
    state.folderSortDir = defaults.folderSortDir;
  }

  normalizeSharedSortState();

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
  normalizeSharedSortState();
}

function normalizeSharedSortState() {
  if (state.bookmarkSortBy === 'customOrder' || state.folderSortBy === 'customOrder') {
    state.bookmarkSortBy = 'customOrder';
    state.folderSortBy = 'customOrder';
    state.bookmarkSortDir = 'asc';
    state.folderSortDir = 'asc';
    return;
  }

  if (state.bookmarkSortBy === 'lastClickedAt') {
    state.folderSortBy = 'updatedAt';
  }

  if (state.bookmarkSortBy === 'title') {
    state.folderSortBy = 'name';
  }
}

function toSharedSortSelectionValue() {
  const bookmarkSortBy = state.bookmarkSortBy;
  const bookmarkSortDir = state.bookmarkSortDir;

  if (bookmarkSortBy === 'customOrder') {
    return 'customOrder:asc';
  }

  if (bookmarkSortBy === 'lastClickedAt') {
    return `lastOpened:${bookmarkSortDir === 'asc' ? 'asc' : 'desc'}`;
  }

  if (bookmarkSortBy === 'title') {
    return `label:${bookmarkSortDir}`;
  }

  return `updatedAt:${bookmarkSortDir === 'asc' ? 'asc' : 'desc'}`;
}

function applySharedSortSelection(value) {
  const nextSort = parseSortSelectionValue(value, 'updatedAt', 'desc');

  if (nextSort.sortBy === 'customOrder') {
    state.bookmarkSortBy = 'customOrder';
    state.folderSortBy = 'customOrder';
    state.bookmarkSortDir = 'asc';
    state.folderSortDir = 'asc';
    return;
  }

  if (nextSort.sortBy === 'lastOpened') {
    state.bookmarkSortBy = 'lastClickedAt';
    state.folderSortBy = 'updatedAt';
    state.bookmarkSortDir = nextSort.sortDir;
    state.folderSortDir = nextSort.sortDir;
    return;
  }

  if (nextSort.sortBy === 'label') {
    state.bookmarkSortBy = 'title';
    state.folderSortBy = 'name';
    state.bookmarkSortDir = nextSort.sortDir;
    state.folderSortDir = nextSort.sortDir;
    return;
  }

  state.bookmarkSortBy = 'updatedAt';
  state.folderSortBy = 'updatedAt';
  state.bookmarkSortDir = nextSort.sortDir;
  state.folderSortDir = nextSort.sortDir;
}

function parseSortSelectionValue(value, fallbackBy, fallbackDir) {
  const [rawBy, rawDir] = String(value ?? '').trim().split(':');
  const sortBy = String(rawBy ?? '').trim() || fallbackBy;
  const sortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : fallbackDir;

  return {
    sortBy,
    sortDir
  };
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
  return saved;
}

function syncSettingsControls() {
  if ($openNewTabToggle) {
    $openNewTabToggle.prop('checked', state.openInNewTab);
  }

  if ($pageSizeSelect) {
    $pageSizeSelect.val(String(state.pageSize));
  }

  if ($iconStorageModeSelect) {
    $iconStorageModeSelect.val(state.iconStorageMode === 'url' ? 'url' : 'base64');
  }

  if ($sharedSortSelect) {
    $sharedSortSelect.val(toSharedSortSelectionValue());
  }

  if ($viewModeChip) {
    $viewModeChip.attr('title', state.viewMode === 'grid' ? 'Grid view' : 'List view');
    $viewModeChip.attr('aria-label', state.viewMode === 'grid' ? 'Grid view active' : 'List view active');
    $viewModeChip.toggleClass('is-grid', state.viewMode === 'grid');
    $viewModeChip.toggleClass('is-active', state.viewMode === 'grid');
  }

  if ($multiSelectChip) {
    $multiSelectChip.attr('title', state.multiSelectEnabled ? 'Multi select on' : 'Multi select off');
    $multiSelectChip.attr('aria-label', state.multiSelectEnabled ? 'Multi select on' : 'Multi select off');
    $multiSelectChip.toggleClass('is-on', state.multiSelectEnabled);
    $multiSelectChip.toggleClass('is-active', state.multiSelectEnabled);
  }
}

function cacheDom() {
  $searchInput = $('#bookmark-search');
  $count = $('#bookmark-count');
  $list = $('#bookmarks-list');
  $listWrap = $('#bookmark-scroll-wrap');
  $breadcrumb = $('#folder-breadcrumb');
  $contextMenu = $('#context-menu');
  $settingsOpenBtn = $('#settings-open-btn');
  $fullscreenToggleBtn = $('#fullscreen-toggle-btn');
  $panelCloseBtn = $('#panel-close-btn');
  $loadingState = $('#loading-state');
  $emptyState = $('#empty-state');
  $errorState = $('#error-state');
  $errorMessage = $('#error-message');
  $drawer = $('#bookmark-drawer');
  $drawerBackdrop = $('#drawer-backdrop');
  $drawerTitle = $('#drawer-title');
  $editTitle = $('#edit-title');
  $editUrl = $('#edit-url');
  $editFolderSelect = $('#edit-folder-select');
  $drawerSave = $('#drawer-save');
  $drawerClose = $('#drawer-close');
  $drawerCancel = $('#drawer-cancel');
  $loadingMoreState = $('#loading-more-state');
  $openNewTabToggle = $('#open-new-tab-toggle');
  $pageSizeSelect = $('#page-size-select');
  $iconStorageModeSelect = $('#icon-storage-mode-select');
  $sharedSortSelect = $('#shared-sort-select');
  $viewModeChip = $('#view-mode-chip');
  $multiSelectChip = $('#multi-select-chip');
  $multiSelectPanel = $('#multi-select-panel');
  $multiSelectCount = $('#multi-select-count');
  $bulkOpenBtn = $('#bulk-open-btn');
  $bulkMoveBtn = $('#bulk-move-btn');
  $bulkDeleteBtn = $('#bulk-delete-btn');
  $bulkClearBtn = $('#bulk-clear-btn');
  $moveModal = $('#move-modal');
  $moveModalBackdrop = $('#move-modal-backdrop');
  $moveModalClose = $('#move-modal-close');
  $moveModalCancel = $('#move-modal-cancel');
  $moveModalSubmit = $('#move-modal-submit');
  $moveTargetFolderSelect = $('#move-target-folder-select');
}

function getSelectedCount() {
  return state.selectedFolderIds.size + state.selectedBookmarkIds.size;
}

function clearMultiSelection() {
  state.selectedFolderIds.clear();
  state.selectedBookmarkIds.clear();
}

function selectAllVisibleItems() {
  const foldersInView = getCurrentChildFolders();

  state.selectedFolderIds = new Set(foldersInView.map((folder) => folder.id));
  state.selectedBookmarkIds = new Set(state.bookmarks.map((bookmark) => bookmark.id));
}

function toggleFolderSelection(folderId) {
  if (!isValidId(folderId)) {
    return;
  }

  if (state.selectedFolderIds.has(folderId)) {
    state.selectedFolderIds.delete(folderId);
  } else {
    state.selectedFolderIds.add(folderId);
  }

  render();
}

function toggleBookmarkSelection(bookmarkId) {
  if (!isValidId(bookmarkId)) {
    return;
  }

  if (state.selectedBookmarkIds.has(bookmarkId)) {
    state.selectedBookmarkIds.delete(bookmarkId);
  } else {
    state.selectedBookmarkIds.add(bookmarkId);
  }

  render();
}

async function toggleViewMode() {
  const previousMode = state.viewMode;
  state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';

  try {
    await persistSettings();
    render();
  } catch (error) {
    console.error('Error saving view mode setting:', error);
    state.viewMode = previousMode;
    syncSettingsControls();
    render();
    setError('Could not save view mode setting.');
  }
}

function toggleMultiSelect() {
  state.multiSelectEnabled = !state.multiSelectEnabled;

  if (!state.multiSelectEnabled) {
    closeMoveModal();
    clearMultiSelection();
  }

  hideContextMenu();
  render();
}

async function handleBulkOpenSelected() {
  const selectedIds = Array.from(state.selectedBookmarkIds);

  if (selectedIds.length === 0) {
    return;
  }

  const selectedBookmarks = state.bookmarks.filter((bookmark) => state.selectedBookmarkIds.has(bookmark.id));

  if (selectedBookmarks.length === 0) {
    return;
  }

  try {
    for (const bookmark of selectedBookmarks) {
      await openBookmarkUrl(bookmark.url, true);
      await recordBookmarkClick(bookmark.id);
    }

    if (state.bookmarkSortBy === 'lastClickedAt') {
      await loadBookmarks();
    }
  } catch (error) {
    console.error('Error opening selected bookmarks:', error);
    setError('Unable to open selected bookmarks right now.');
  }
}

async function handleBulkMoveSelected() {
  const selectedCount = getSelectedCount();

  if (selectedCount === 0) {
    return;
  }

  openMoveModal();
}

function openMoveModal() {
  if (!state.multiSelectEnabled || getSelectedCount() === 0) {
    return;
  }

  if ($moveTargetFolderSelect) {
    $moveTargetFolderSelect.empty();
    $moveTargetFolderSelect.append('<option value="root">All Bookmarks (root)</option>');

    state.folders.forEach((folder) => {
      $moveTargetFolderSelect.append(`<option value="${folder.id}">${escapeHtml(folder.name)}</option>`);
    });
  }

  state.moveModalOpen = true;
  $moveModalBackdrop.removeClass('is-hidden');
  $moveModal.removeClass('is-hidden');
}

function closeMoveModal() {
  state.moveModalOpen = false;
  $moveModalBackdrop.addClass('is-hidden');
  $moveModal.addClass('is-hidden');
}

async function submitMoveModal() {
  const selectedCount = getSelectedCount();

  if (!state.moveModalOpen || selectedCount === 0) {
    return;
  }

  const rawValue = String($moveTargetFolderSelect.val() ?? 'root');
  const targetFolderId = rawValue === 'root' ? null : normalizeId(rawValue);

  if (targetFolderId !== null && !state.folders.some((folder) => folder.id === targetFolderId)) {
    setError('Invalid target folder.');
    return;
  }

  try {
    const bookmarkIds = Array.from(state.selectedBookmarkIds);
    const folderIds = Array.from(state.selectedFolderIds);

    for (const bookmarkId of bookmarkIds) {
      await updateBookmark(bookmarkId, { folderId: targetFolderId });
    }

    for (const folderId of folderIds) {
      if (folderId === targetFolderId) {
        continue;
      }

      await updateFolder(folderId, { parentId: targetFolderId });
    }

    closeMoveModal();
    clearMultiSelection();
    await loadFolders();
    await loadBookmarks();
  } catch (error) {
    console.error('Error moving selected items:', error);
    setError(error?.message || 'Unable to move selected items.');
  }
}

async function handleBulkDeleteSelected() {
  const bookmarkIds = Array.from(state.selectedBookmarkIds);
  const folderIds = Array.from(state.selectedFolderIds);

  if (bookmarkIds.length === 0 && folderIds.length === 0) {
    return;
  }

  const confirmed = window.confirm(
    `Delete ${bookmarkIds.length} bookmark(s) and ${folderIds.length} folder(s)? Folder delete is recursive.`
  );

  if (!confirmed) {
    return;
  }

  try {
    for (const bookmarkId of bookmarkIds) {
      await deleteBookmark(bookmarkId);
    }

    for (const folderId of folderIds) {
      await deleteFolder(folderId, true);
    }

    clearMultiSelection();
    await loadFolders();
    await loadBookmarks();
  } catch (error) {
    console.error('Error deleting selected items:', error);
    setError(error?.message || 'Unable to delete selected items.');
  }
}

function bindEvents() {
  let searchTimer = null;

  $viewModeChip.on('click', async () => {
    await toggleViewMode();
  });

  $multiSelectChip.on('click', () => {
    toggleMultiSelect();
  });

  $bulkOpenBtn.on('click', async () => {
    await handleBulkOpenSelected();
  });

  $bulkMoveBtn.on('click', async () => {
    await handleBulkMoveSelected();
  });

  $bulkDeleteBtn.on('click', async () => {
    await handleBulkDeleteSelected();
  });

  $bulkClearBtn.on('click', () => {
    if (getSelectedCount() === 0) {
      selectAllVisibleItems();
    } else {
      clearMultiSelection();
    }

    render();
  });

  $moveModalClose.on('click', closeMoveModal);
  $moveModalCancel.on('click', closeMoveModal);
  $moveModalBackdrop.on('click', closeMoveModal);
  $moveModalSubmit.on('click', async () => {
    await submitMoveModal();
  });

  $searchInput.on('input', () => {
    state.query = $searchInput.val().trim();

    if (state.multiSelectEnabled) {
      clearMultiSelection();
    }

    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }

    searchTimer = window.setTimeout(() => {
      loadBookmarks();
    }, 180);
  });

  $list.on('dragstart', '.vm-bookmark-row, .vm-folder-row', (e) => {
    if (state.multiSelectEnabled) {
      e.preventDefault();
      return;
    }

    const $row = $(e.currentTarget);
    const bookmarkId = $row.data('bookmark-id');
    const folderId = $row.data('folder-id');

    if (bookmarkId) {
      e.originalEvent.dataTransfer.setData('text/plain', JSON.stringify({ type: 'bookmark', id: bookmarkId }));
    } else if (folderId) {
      e.originalEvent.dataTransfer.setData('text/plain', JSON.stringify({ type: 'folder', id: folderId }));
    }
    $row.addClass('is-dragging');
  });

  $list.on('dragend', '.vm-bookmark-row, .vm-folder-row', (e) => {
    $(e.currentTarget).removeClass('is-dragging');
  });

  $list.on('dragover', '.vm-folder-row', (e) => {
    if (state.multiSelectEnabled) {
      return;
    }

    e.preventDefault();
    $(e.currentTarget).addClass('vm-drag-over');
  });

  $list.on('dragleave', '.vm-folder-row', (e) => {
    $(e.currentTarget).removeClass('vm-drag-over');
  });

  $list.on('drop', '.vm-folder-row', async (e) => {
    if (state.multiSelectEnabled) {
      return;
    }

    e.preventDefault();
    const $target = $(e.currentTarget);
    $target.removeClass('vm-drag-over');

    const targetFolderId = normalizeId($target.data('folder-id'));
    const dataStr = e.originalEvent.dataTransfer.getData('text/plain');

    if (!dataStr || !targetFolderId) return;

    try {
      const data = JSON.parse(dataStr);
      if (data.type === 'bookmark') {
        await updateBookmark(data.id, { folderId: targetFolderId });
      } else if (data.type === 'folder') {
        if (data.id === targetFolderId) return;
        await updateFolder(data.id, { parentId: targetFolderId });
      }
      await loadFolders();
      await loadBookmarks();
    } catch (err) {
      console.error('Drop error:', err);
      setError(err.message);
    }
  });

  $breadcrumb.on('dragover', '[data-folder-id]', (e) => {
    const $target = $(e.currentTarget);
    const targetFolderId = $target.data('folder-id');
    // We only care about root (all) or defined ancestors
    e.preventDefault();
    $target.addClass('vm-drag-over');
  });

  $breadcrumb.on('dragleave', '[data-folder-id]', (e) => {
    $(e.currentTarget).removeClass('vm-drag-over');
  });

  $breadcrumb.on('drop', '[data-folder-id]', async (e) => {
    e.preventDefault();
    const $target = $(e.currentTarget);
    $target.removeClass('vm-drag-over');

    const rawId = $target.data('folder-id');
    const targetFolderId = rawId === 'all' ? null : normalizeId(rawId);
    const dataStr = e.originalEvent.dataTransfer.getData('text/plain');

    if (!dataStr) return;

    try {
      const data = JSON.parse(dataStr);
      if (data.type === 'bookmark') {
        await updateBookmark(data.id, { folderId: targetFolderId });
      } else if (data.type === 'folder') {
        if (data.id === targetFolderId) return;
        await updateFolder(data.id, { parentId: targetFolderId });
      }
      await loadFolders();
      await loadBookmarks();
    } catch (err) {
      console.error('Drop to breadcrumb error:', err);
      setError(err.message);
    }
  });

  $listWrap.on('scroll', handleListScroll);

  $list.on('click', '[data-action="create-folder-inline"]', async () => {
    await createFolderFromInput();
  });

  $list.on('keydown', '#inline-create-folder-input', async (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    await createFolderFromInput();
  });

  $list.on('click', '[data-action="open-folder"]', (event) => {
    const folderId = normalizeId($(event.currentTarget).data('folder-id'));

    if (!isValidId(folderId)) {
      return;
    }

    if (state.multiSelectEnabled) {
      toggleFolderSelection(folderId);
      return;
    }

    navigateToFolder(folderId);
  });

  $list.on('click', '[data-action="toggle-folder-select"], [data-action="toggle-bookmark-select"]', (event) => {
    event.stopPropagation();
  });

  $list.on('change', '[data-action="toggle-folder-select"]', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const folderId = normalizeId($(event.currentTarget).data('folder-id'));
    toggleFolderSelection(folderId);
  });

  $list.on('change', '[data-action="toggle-bookmark-select"]', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const bookmarkId = normalizeId($(event.currentTarget).data('bookmark-id'));
    toggleBookmarkSelection(bookmarkId);
  });

  $list.on('click', '[data-action="open-link"]', async (event) => {
    event.preventDefault();
    hideContextMenu();

    const bookmarkId = normalizeId($(event.currentTarget).data('id'));
    const url = String($(event.currentTarget).data('url') ?? '').trim();

    if (!url) {
      return;
    }

    if (state.multiSelectEnabled) {
      toggleBookmarkSelection(bookmarkId);
      return;
    }

    try {
      await openBookmarkUrl(url, state.openInNewTab);

      if (isValidId(bookmarkId)) {
        await recordBookmarkClick(bookmarkId);
      }

      if (state.bookmarkSortBy === 'lastClickedAt') {
        await loadBookmarks();
      }
    } catch (error) {
      console.error('Error opening url:', error);
      setError('Unable to open this link right now.');
    }
  });

  $list.on('click', '[data-action="open-bookmark-menu"]', (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (state.multiSelectEnabled) {
      return;
    }

    const bookmarkId = normalizeId($(event.currentTarget).data('id'));

    if (!isValidId(bookmarkId)) {
      return;
    }

    const trigger = event.currentTarget;
    const rect = trigger.getBoundingClientRect();

    showContextMenu({
      type: 'bookmark',
      targetId: bookmarkId,
      x: Math.round(rect.right - 4),
      y: Math.round(rect.bottom + 4)
    });
  });

  $list.on('contextmenu', '.vm-folder-row, article[data-bookmark-id]', (event) => {
    if (state.multiSelectEnabled) {
      return;
    }

    event.preventDefault();

    const $target = $(event.currentTarget);

    if ($target.hasClass('vm-folder-row')) {
      const folderId = normalizeId($target.data('folder-id'));

      if (isValidId(folderId)) {
        showContextMenu({
          type: 'folder',
          targetId: folderId,
          x: event.pageX,
          y: event.pageY
        });
      }

      return;
    }

    const bookmarkId = normalizeId($target.data('bookmark-id'));

    if (isValidId(bookmarkId)) {
      showContextMenu({
        type: 'bookmark',
        targetId: bookmarkId,
        x: event.pageX,
        y: event.pageY
      });
    }
  });

  $contextMenu.on('click', '[data-menu-action]', async (event) => {
    const action = String($(event.currentTarget).data('menu-action') ?? '').trim();
    await handleContextMenuAction(action);
  });

  $(document).on('click', (event) => {
    if ($contextMenu.hasClass('is-hidden')) {
      return;
    }

    if ($(event.target).closest('#context-menu').length > 0) {
      return;
    }

    hideContextMenu();
  });

  $breadcrumb.on('click', '[data-folder-id]', (event) => {
    if (state.multiSelectEnabled) {
      return;
    }

    const folderIdRaw = String($(event.currentTarget).data('folder-id'));
    const folderId = folderIdRaw === 'all' ? null : normalizeId(folderIdRaw);
    navigateToFolder(folderId);
  });

  $sharedSortSelect.on('change', async () => {
    try {
      applySharedSortSelection($sharedSortSelect.val());
      await persistSettings();
      await loadFolders();
      await loadBookmarks();
    } catch (error) {
      console.error('Error saving shared sort:', error);
      setError('Could not save shared sort setting.');
    }
  });

  $settingsOpenBtn.on('click', openSettingsPage);
  $fullscreenToggleBtn.on('click', toggleFullscreenMode);
  $panelCloseBtn.on('click', closePanelWindow);

  $openNewTabToggle.on('change', async () => {
    const nextOpenInNewTab = $openNewTabToggle.prop('checked');
    state.openInNewTab = nextOpenInNewTab;

    try {
      await persistSettings();

      render();
    } catch (error) {
      console.error('Error saving openInNewTab setting:', error);
      state.openInNewTab = !nextOpenInNewTab;
      syncSettingsControls();
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

      await loadBookmarks();
    } catch (error) {
      console.error('Error saving page size setting:', error);
      state.pageSize = previousPageSize;
      $pageSizeSelect.val(String(previousPageSize));
    }
  });

  $iconStorageModeSelect.on('change', async () => {
    const nextMode = String($iconStorageModeSelect.val() ?? '').trim() === 'url' ? 'url' : 'base64';
    const previousMode = state.iconStorageMode;
    state.iconStorageMode = nextMode;

    try {
      await persistSettings();
    } catch (error) {
      console.error('Error saving icon storage mode:', error);
      state.iconStorageMode = previousMode;
      syncSettingsControls();
    }
  });

  $list.on('click', '[data-action="edit"]', (event) => {
    hideContextMenu();
    const bookmarkId = normalizeId($(event.currentTarget).data('id'));
    const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);

    if (bookmark) {
      openDrawer(bookmark);
    }
  });

  $list.on('click', '[data-action="delete"]', async (event) => {
    hideContextMenu();
    const bookmarkId = normalizeId($(event.currentTarget).data('id'));
    const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);

    if (!bookmark) {
      return;
    }

    try {
      await handleDeleteBookmark(bookmark);
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
    }
  });

  $(document).on('keydown', (event) => {
    if (event.key === 'Escape') {
      hideContextMenu();

      if (state.multiSelectEnabled) {
        state.multiSelectEnabled = false;
        clearMultiSelection();
        render();
      }

      if (state.moveModalOpen) {
        closeMoveModal();
      }

      if (state.activeDrawer === 'bookmark') {
        closeDrawer();
      }

    }
  });
}

function navigateToFolder(folderId) {
  hideContextMenu();
  const parsedFolderId = normalizeId(folderId);

  state.currentFolderId = parsedFolderId;
  clearMultiSelection();
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
    state.folders = await listFolders({
      sortBy: state.folderSortBy,
      sortDir: state.folderSortDir
    });

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
    rootOnly: !state.query,
    sortBy: state.bookmarkSortBy,
    sortDir: state.bookmarkSortDir
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
    });
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
      pieces.push(`<span class="vm-crumb is-active" data-folder-id="${escapeAttr(idAttr)}">${escapeHtml(crumb.label)}</span>`);
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
  const selectedCount = getSelectedCount();

  $count.text(state.totalBookmarks);
  renderBreadcrumb();

  $list.removeClass('vm-list-mode-list vm-list-mode-grid');
  $list.addClass(state.viewMode === 'grid' ? 'vm-list-mode-grid' : 'vm-list-mode-list');

  if ($multiSelectCount) {
    $multiSelectCount.text(String(selectedCount));
  }

  if ($multiSelectPanel) {
    $multiSelectPanel.toggleClass('is-hidden', !state.multiSelectEnabled);
  }

  if ($listWrap) {
    $listWrap.toggleClass('with-multi-panel', state.multiSelectEnabled);
  }

  if ($bulkOpenBtn) {
    $bulkOpenBtn.prop('disabled', state.selectedBookmarkIds.size === 0);
  }

  if ($bulkMoveBtn) {
    $bulkMoveBtn.prop('disabled', selectedCount === 0);
  }

  if ($bulkDeleteBtn) {
    $bulkDeleteBtn.prop('disabled', selectedCount === 0);
  }

  if ($bulkClearBtn) {
    if (selectedCount === 0) {
      $bulkClearBtn.attr('title', 'Select all');
      $bulkClearBtn.attr('aria-label', 'Select all');
      $bulkClearBtn.addClass('is-select-all');
    } else {
      $bulkClearBtn.attr('title', 'Clear selection');
      $bulkClearBtn.attr('aria-label', 'Clear selection');
      $bulkClearBtn.removeClass('is-select-all');
    }

    $bulkClearBtn.prop('disabled', false);
  }

  if ($multiSelectChip) {
    $multiSelectChip.attr('title', state.multiSelectEnabled ? 'Multi select on' : 'Multi select off');
    $multiSelectChip.attr('aria-label', state.multiSelectEnabled ? 'Multi select on' : 'Multi select off');
    $multiSelectChip.toggleClass('is-on', state.multiSelectEnabled);
    $multiSelectChip.toggleClass('is-active', state.multiSelectEnabled);
  }

  if ($viewModeChip) {
    $viewModeChip.attr('title', state.viewMode === 'grid' ? 'Grid view' : 'List view');
    $viewModeChip.attr('aria-label', state.viewMode === 'grid' ? 'Grid view active' : 'List view active');
    $viewModeChip.toggleClass('is-grid', state.viewMode === 'grid');
    $viewModeChip.toggleClass('is-active', state.viewMode === 'grid');
  }

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

  if (!state.query) {
    const createRow = $(`
      <article class="vm-folder-create-inline" role="group" aria-label="Create folder inline">
        <span class="vm-create-icon" aria-hidden="true"><i class="fas fa-folder-plus"></i></span>
        <input id="inline-create-folder-input" class="input" type="text" placeholder="New folder" maxlength="60" />
        <button class="button vm-folder-create-submit" type="button" aria-label="Create folder" data-action="create-folder-inline">
          <span class="icon"><i class="fas fa-plus"></i></span>
        </button>
      </article>
    `);

    $list.append(createRow);
  }

  foldersInView.forEach((folder) => {
    const folderChecked = state.selectedFolderIds.has(folder.id);
    const folderCheckboxHtml = state.multiSelectEnabled
      ? `
        <label class="vm-select-checkbox" aria-label="Select folder">
          <input class="vm-item-checkbox" type="checkbox" data-action="toggle-folder-select" data-folder-id="${folder.id}" ${folderChecked ? 'checked' : ''} />
        </label>
      `
      : '';

    const item = $(`
      <article class="vm-card vm-folder-row${folderChecked ? ' is-active' : ''}" data-action="open-folder" data-folder-id="${folder.id}" tabindex="0" role="button" draggable="true">
        <div class="vm-card-head">
          ${folderCheckboxHtml}
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
    const bookmarkChecked = state.selectedBookmarkIds.has(bookmark.id);
    const bookmarkCheckboxHtml = state.multiSelectEnabled
      ? `
        <label class="vm-select-checkbox" aria-label="Select bookmark">
          <input class="vm-item-checkbox" type="checkbox" data-action="toggle-bookmark-select" data-bookmark-id="${bookmark.id}" ${bookmarkChecked ? 'checked' : ''} />
        </label>
      `
      : '';

    const bookmarkMenuButtonHtml = state.multiSelectEnabled
      ? ''
      : `
        <button class="button vm-link-button vm-row-menu-trigger" type="button" aria-label="Open bookmark menu" data-action="open-bookmark-menu" data-id="${bookmark.id}">
          <span class="icon is-small"><i class="fas fa-ellipsis-v"></i></span>
        </button>
      `;

    const iconHtml = bookmark.icon
      ? `<img src="${escapeAttr(bookmark.icon.data)}" alt="" />`
      : '<i class="fas fa-bookmark"></i>';

    const item = $(`
      <article class="vm-card vm-bookmark-row${bookmarkChecked || (state.selectedBookmark && state.selectedBookmark.id === bookmark.id && !state.multiSelectEnabled) ? ' is-active' : ''}" data-bookmark-id="${bookmark.id}" draggable="true">
        <div class="vm-card-head">
          ${bookmarkCheckboxHtml}
          <div class="vm-icon">${iconHtml}</div>
          <div class="vm-card-body">
            <a class="vm-bookmark-title" href="${escapeAttr(bookmark.url)}" title="${escapeAttr(bookmark.title)}" data-action="open-link" data-id="${bookmark.id}" data-url="${escapeAttr(bookmark.url)}">${escapeHtml(bookmark.title)}</a>
            <div class="vm-bookmark-url" title="${escapeAttr(bookmark.url)}">${escapeHtml(bookmark.url)}</div>
          </div>
          ${bookmarkMenuButtonHtml}
        </div>
      </article>
    `);

    $list.append(item);
  });
}

function setContextMenuState(nextState) {
  state.contextMenu = {
    ...state.contextMenu,
    ...nextState
  };
}

function renderContextMenuItems() {
  if (!$contextMenu) {
    return;
  }

  if (!state.contextMenu.isOpen) {
    $contextMenu.addClass('is-hidden');
    $contextMenu.attr('aria-hidden', 'true');
    $contextMenu.empty();
    return;
  }

  const menuItems = state.contextMenu.type === 'folder'
    ? [
      { action: 'open-folder', label: 'Open folder', icon: 'fas fa-folder-open' },
      { action: 'rename-folder', label: 'Rename folder', icon: 'fas fa-pen' },
      { action: 'move-folder-top', label: 'Move folder to top (custom)', icon: 'fas fa-angle-double-up' },
      { action: 'move-folder-bottom', label: 'Move folder to bottom (custom)', icon: 'fas fa-angle-double-down' },
      { separator: true },
      { action: 'delete-folder', label: 'Delete folder', danger: true, icon: 'fas fa-trash' }
    ]
    : [
      { action: 'open-bookmark', label: state.openInNewTab ? 'Open in new tab' : 'Open here', icon: 'fas fa-external-link-alt' },
      { action: 'edit-bookmark', label: 'Edit bookmark', icon: 'fas fa-pen' },
      { action: 'copy-url', label: 'Copy URL', icon: 'fas fa-link' },
      { action: 'copy-title', label: 'Copy title', icon: 'fas fa-font' },
      { action: 'move-bookmark-top', label: 'Move bookmark to top (custom)', icon: 'fas fa-angle-double-up' },
      { action: 'move-bookmark-bottom', label: 'Move bookmark to bottom (custom)', icon: 'fas fa-angle-double-down' },
      { separator: true },
      { action: 'delete-bookmark', label: 'Delete bookmark', danger: true, icon: 'fas fa-trash' }
    ];

  const html = menuItems.map((item) => {
    if (item.separator) {
      return '<div class="vm-menu-separator"></div>';
    }

    return `
      <button class="vm-menu-item${item.danger ? ' is-danger' : ''}" type="button" data-menu-action="${escapeAttr(item.action)}">
        <span class="icon" aria-hidden="true"><i class="${escapeAttr(item.icon || 'fas fa-circle')}"></i></span>
        <span class="vm-menu-text">${escapeHtml(item.label)}</span>
      </button>
    `;
  }).join('');

  $contextMenu.html(html);
  $contextMenu.removeClass('is-hidden');
  $contextMenu.attr('aria-hidden', 'false');

  const menuElement = $contextMenu.get(0);

  if (!menuElement) {
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const menuRect = menuElement.getBoundingClientRect();
  const maxLeft = Math.max(4, viewportWidth - menuRect.width - 4);
  const maxTop = Math.max(4, viewportHeight - menuRect.height - 4);
  const safeLeft = Math.max(4, Math.min(state.contextMenu.x, maxLeft));
  const safeTop = Math.max(4, Math.min(state.contextMenu.y, maxTop));

  $contextMenu.css({
    left: `${safeLeft}px`,
    top: `${safeTop}px`
  });
}

function showContextMenu({ type, targetId, x, y }) {
  setContextMenuState({
    isOpen: true,
    type,
    targetId,
    x,
    y
  });
  renderContextMenuItems();
}

function hideContextMenu() {
  if (!state.contextMenu.isOpen) {
    return;
  }

  setContextMenuState({
    isOpen: false,
    type: null,
    targetId: null
  });
  renderContextMenuItems();
}

async function copyTextToClipboard(value) {
  const text = String(value ?? '');

  if (!text) {
    return false;
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const input = document.createElement('textarea');
  input.value = text;
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  input.remove();
  return true;
}

async function handleDeleteBookmark(bookmark) {
  const confirmed = window.confirm(`Delete "${bookmark.title}"?`);

  if (!confirmed) {
    return;
  }

  await deleteBookmark(bookmark.id);

  if (state.selectedBookmark && state.selectedBookmark.id === bookmark.id) {
    closeDrawer();
  }

  await loadFolders();
  await loadBookmarks();
}

async function handleContextMenuAction(action) {
  const menuType = state.contextMenu.type;
  const targetId = state.contextMenu.targetId;
  hideContextMenu();

  if (!menuType || !isValidId(targetId)) {
    return;
  }

  try {
    if (menuType === 'bookmark') {
      const bookmark = state.bookmarks.find((item) => item.id === targetId);

      if (!bookmark) {
        return;
      }

      if (action === 'open-bookmark') {
        await openBookmarkUrl(bookmark.url, state.openInNewTab);
        await recordBookmarkClick(bookmark.id);

        if (state.bookmarkSortBy === 'lastClickedAt') {
          await loadBookmarks();
        }

        return;
      }

      if (action === 'edit-bookmark') {
        openDrawer(bookmark);
        return;
      }

      if (action === 'copy-url') {
        await copyTextToClipboard(bookmark.url);
        return;
      }

      if (action === 'copy-title') {
        await copyTextToClipboard(bookmark.title);
        return;
      }

      if (action === 'move-bookmark-top' || action === 'move-bookmark-bottom') {
        const position = action === 'move-bookmark-top' ? 'top' : 'bottom';
        await moveBookmarkInCustomOrder(bookmark.id, position);

        await loadBookmarks();
        return;
      }

      if (action === 'delete-bookmark') {
        await handleDeleteBookmark(bookmark);
      }

      return;
    }

    const folder = state.folders.find((item) => item.id === targetId);

    if (!folder) {
      return;
    }

    if (action === 'open-folder') {
      navigateToFolder(folder.id);
      return;
    }

    if (action === 'rename-folder') {
      const nextName = window.prompt('Folder name', folder.name);

      if (!nextName) {
        return;
      }

      await renameFolder(folder.id, nextName);
      await loadFolders();
      render();
      return;
    }

    if (action === 'move-folder-top' || action === 'move-folder-bottom') {
      const position = action === 'move-folder-top' ? 'top' : 'bottom';
      await moveFolderInCustomOrder(folder.id, position);

      await loadFolders();
      render();
      return;
    }

    if (action === 'delete-folder') {
      const confirmed = window.confirm(`Delete folder "${folder.name}" AND all its contents (bookmarks and subfolders)?`);

      if (!confirmed) {
        return;
      }

      await deleteFolder(folder.id, true);
      await loadFolders();
      await loadBookmarks();
    }
  } catch (error) {
    console.error('Context menu action failed:', error);
    setError(error?.message || 'Context menu action failed.');
  }
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

  // Populate folder select
  $editFolderSelect.empty();
  $editFolderSelect.append('<option value="null">All Bookmarks</option>');
  state.folders.forEach(f => {
    const selected = f.id === bookmark.folderId ? ' selected' : '';
    $editFolderSelect.append(`<option value="${f.id}"${selected}>${escapeHtml(f.name)}</option>`);
  });

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

async function openSettingsPage() {
  const settingsUrl = chrome?.runtime?.getURL
    ? chrome.runtime.getURL('settings/settings.html')
    : '../settings/settings.html';

  if (chrome?.runtime?.openOptionsPage) {
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.openOptionsPage(() => {
          const runtimeError = chrome.runtime?.lastError;

          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }

          resolve();
        });
      });

      return;
    } catch (error) {
      console.error('openOptionsPage failed, falling back to tab open:', error);
    }
  }

  if (chrome?.tabs?.create) {
    try {
      await new Promise((resolve, reject) => {
        chrome.tabs.create({ url: settingsUrl, active: true }, () => {
          const runtimeError = chrome.runtime?.lastError;

          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }

          resolve();
        });
      });

      return;
    } catch (error) {
      console.error('tabs.create fallback failed:', error);
    }
  }

  window.location.href = settingsUrl;
}

async function toggleFullscreenMode() {
  const panelUrl = chrome?.runtime?.getURL
    ? chrome.runtime.getURL('src/sidepanel/sidepanel.html')
    : '../src/sidepanel/sidepanel.html';

  try {
    await chrome.tabs.create({
      url: panelUrl,
      active: true
    });

    closePanelWindow();
  } catch (error) {
    console.error('Failed to open side panel as a tab:', error);
  }
}

function closePanelWindow() {
  window.close();
}

async function saveBookmark() {
  if (!state.selectedBookmark) {
    return;
  }

  const title = $editTitle.val().trim();
  const url = $editUrl.val().trim();
  const folderVal = $editFolderSelect.val();
  const folderId = folderVal === 'null' ? null : normalizeId(folderVal);

  if (!title || !url) {
    setError('Title and URL are required before saving.');
    return;
  }

  try {
    await updateBookmark(state.selectedBookmark.id, {
      title,
      url,
      folderId
    });

    closeDrawer();
    await loadBookmarks();
  } catch (error) {
    console.error('Error updating bookmark:', error);
    setError(error?.message || 'Unable to save bookmark changes.');
  }
}

async function createFolderFromInput() {
  const $inlineInput = $('#inline-create-folder-input');
  const folderName = String($inlineInput.val() ?? '').trim();

  if (!folderName) {
    setError('Folder name is required.');
    return;
  }

  try {
    const folder = await createFolder(folderName, state.currentFolderId);
    $inlineInput.val('');
    await loadFolders();
    state.currentFolderId = folder.id;
    await loadBookmarks();
  } catch (error) {
    console.error('Error creating folder:', error);
    setError(error?.message || 'Unable to create folder.');
  }
}

function setError(message) {
  state.error = message;
  $errorMessage.text(message);
  render();
}
