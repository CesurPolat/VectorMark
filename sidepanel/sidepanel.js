import { listBookmarksWithIcons, searchBookmarks, updateBookmark, deleteBookmark } from '../services/dbService.js';

const state = {
  bookmarks: [],
  loading: true,
  error: null,
  query: '',
  selectedBookmark: null,
  requestToken: 0
};

let $searchInput;
let $count;
let $status;
let $list;
let $loadingState;
let $emptyState;
let $errorState;
let $errorMessage;
let $drawer;
let $drawerBackdrop;
let $drawerTitle;
let $editTitle;
let $editUrl;
let $drawerSave;
let $drawerClose;
let $drawerCancel;

$(document).ready(async () => {
  cacheDom();
  bindEvents();
  await loadBookmarks();
});

function cacheDom() {
  $searchInput = $('#bookmark-search');
  $count = $('#bookmark-count');
  $status = $('#bookmark-status');
  $list = $('#bookmarks-list');
  $loadingState = $('#loading-state');
  $emptyState = $('#empty-state');
  $errorState = $('#error-state');
  $errorMessage = $('#error-message');
  $drawer = $('#bookmark-drawer');
  $drawerBackdrop = $('#drawer-backdrop');
  $drawerTitle = $('#drawer-title');
  $editTitle = $('#edit-title');
  $editUrl = $('#edit-url');
  $drawerSave = $('#drawer-save');
  $drawerClose = $('#drawer-close');
  $drawerCancel = $('#drawer-cancel');
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
  $drawerBackdrop.on('click', closeDrawer);

  $(document).on('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDrawer();
    }
  });
}

async function loadBookmarks() {
  const requestToken = ++state.requestToken;
  state.loading = true;
  state.error = null;
  render();

  try {
    const bookmarks = state.query
      ? await searchBookmarks(state.query)
      : await listBookmarksWithIcons();

    if (requestToken !== state.requestToken) {
      return;
    }

    state.bookmarks = bookmarks;
  } catch (error) {
    if (requestToken !== state.requestToken) {
      return;
    }

    console.error('Error loading bookmarks:', error);
    state.bookmarks = [];
    state.error = 'Error loading bookmarks.';
    $errorMessage.text(error?.message || 'Something went wrong while loading the bookmarks.');
  } finally {
    if (requestToken !== state.requestToken) {
      return;
    }

    state.loading = false;
    render();
  }
}

function render() {
  $count.text(state.bookmarks.length);
  $status.text(getStatusLabel());

  $loadingState.toggleClass('is-hidden', !state.loading);
  $errorState.toggleClass('is-hidden', !state.error);

  const shouldShowEmpty = !state.loading && !state.error && state.bookmarks.length === 0;
  $emptyState.toggleClass('is-hidden', !shouldShowEmpty);

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

function getStatusLabel() {
  if (state.loading) {
    return 'Loading bookmarks';
  }

  if (state.error) {
    return 'Needs attention';
  }

  if (state.query) {
    return `Filtered by "${state.query}"`;
  }

  return 'Ready';
}

function openDrawer(bookmark) {
  state.selectedBookmark = bookmark;
  $drawerTitle.text(`Edit: ${bookmark.title}`);
  $editTitle.val(bookmark.title);
  $editUrl.val(bookmark.url);
  $drawer.attr('aria-hidden', 'false');
  $drawerBackdrop.addClass('is-open');
  $drawer.addClass('is-open');
  render();
  window.setTimeout(() => {
    $editTitle.trigger('focus');
    $editTitle.trigger('select');
  }, 50);
}

function closeDrawer() {
  if (!state.selectedBookmark) {
    $drawerBackdrop.removeClass('is-open');
    $drawer.removeClass('is-open');
    $drawer.attr('aria-hidden', 'true');
    return;
  }

  state.selectedBookmark = null;
  $drawerBackdrop.removeClass('is-open');
  $drawer.removeClass('is-open');
  $drawer.attr('aria-hidden', 'true');
  render();
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
