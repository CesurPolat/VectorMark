import { db } from './dbCore.js';
import {
  normalizeIconData,
  normalizeIconPayload,
  normalizeIconHash,
  normalizeIconInput,
  isDataUri,
  isHttpUrl,
  isGoogleFaviconUrl,
  ensureIconHash,
  fetchUrlAsIconPayload,
  resolveBookmarkIconPayload,
  resolveBookmarkIconData
} from './iconService.js';

async function getOrCreateIconId(iconInput) {
  const normalizedIcon = normalizeIconInput(iconInput);

  if (!normalizedIcon) {
    return null;
  }

  let existing = null;

  if (normalizedIcon.hash) {
    existing = await db.icons.where('hash').equals(normalizedIcon.hash).first();
  }

  if (!existing) {
    existing = await db.icons.where('data').equals(normalizedIcon.data).first();
  }

  if (existing?.id) {
    return existing.id;
  }

  return await db.icons.add({
    data: normalizedIcon.data,
    hash: normalizedIcon.hash || ''
  });
}

async function deleteIconIfUnused(iconId) {
  if (!Number.isInteger(iconId)) {
    return false;
  }

  const usageCount = await db.bookmarks.where('iconId').equals(iconId).count();

  if (usageCount > 0) {
    return false;
  }

  await db.icons.delete(iconId);
  return true;
}

export { resolveBookmarkIconPayload, resolveBookmarkIconData };

const BOOKMARK_SORT_FIELDS = new Set(['customOrder', 'updatedAt', 'createdAt', 'lastClickedAt', 'title', 'id']);
const FOLDER_SORT_FIELDS = new Set(['customOrder', 'updatedAt', 'createdAt', 'name', 'bookmarkCount', 'id']);

function getNowTimestamp() {
  return Date.now();
}

function normalizeTimestamp(value, fallback) {
  const parsed = Number(value);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  return fallback;
}

function normalizeNullableTimestamp(value) {
  const parsed = Number(value);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  return null;
}

function normalizeCustomOrder(value, fallback = 0) {
  const parsed = Number(value);

  if (Number.isFinite(parsed)) {
    return Math.floor(parsed);
  }

  return fallback;
}

function normalizeBookmarkFolderId(folderId) {
  if (folderId === null || folderId === undefined) {
    return null;
  }

  const parsed = Number(folderId);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizeSortDirection(direction, fallback = 'desc') {
  return direction === 'asc' || direction === 'desc' ? direction : fallback;
}

function normalizeBookmarkSortBy(sortBy, fallback = 'updatedAt') {
  if (sortBy === 'manual') {
    return 'customOrder';
  }

  return BOOKMARK_SORT_FIELDS.has(sortBy) ? sortBy : fallback;
}

function normalizeFolderSortBy(sortBy, fallback = 'name') {
  if (sortBy === 'manual') {
    return 'customOrder';
  }

  return FOLDER_SORT_FIELDS.has(sortBy) ? sortBy : fallback;
}

function getBookmarkSortOptions(options = {}) {
  const sortBy = normalizeBookmarkSortBy(String(options?.sortBy ?? '').trim() || 'updatedAt');
  const fallbackDirection = sortBy === 'title' || sortBy === 'customOrder' ? 'asc' : 'desc';

  return {
    sortBy,
    sortDir: normalizeSortDirection(options?.sortDir, fallbackDirection)
  };
}

function getFolderSortOptions(options = {}) {
  const sortBy = normalizeFolderSortBy(String(options?.sortBy ?? '').trim() || 'name');
  const fallbackDirection = sortBy === 'name' || sortBy === 'customOrder' ? 'asc' : 'desc';

  return {
    sortBy,
    sortDir: normalizeSortDirection(options?.sortDir, fallbackDirection)
  };
}

function compareValues(left, right, direction = 'asc') {
  const dir = direction === 'asc' ? 1 : -1;

  if (left === right) {
    return 0;
  }

  if (left === null || left === undefined) {
    return 1;
  }

  if (right === null || right === undefined) {
    return -1;
  }

  if (typeof left === 'string' || typeof right === 'string') {
    return String(left).localeCompare(String(right)) * dir;
  }

  return (Number(left) - Number(right)) * dir;
}

function sortBookmarkRecords(records, options = {}) {
  const { sortBy, sortDir } = getBookmarkSortOptions(options);

  return [...records].sort((left, right) => {
    const primary = compareValues(left?.[sortBy], right?.[sortBy], sortDir);

    if (primary !== 0) {
      return primary;
    }

    const updatedFallback = compareValues(left?.updatedAt, right?.updatedAt, 'desc');

    if (updatedFallback !== 0) {
      return updatedFallback;
    }

    return compareValues(left?.id, right?.id, 'desc');
  });
}

function sortFolderRecords(records, options = {}) {
  const { sortBy, sortDir } = getFolderSortOptions(options);

  return [...records].sort((left, right) => {
    const primary = compareValues(left?.[sortBy], right?.[sortBy], sortDir);

    if (primary !== 0) {
      return primary;
    }

    return compareValues(left?.id, right?.id, 'asc');
  });
}

async function getNextBookmarkCustomOrder(folderId = null) {
  const normalizedFolderId = normalizeBookmarkFolderId(folderId);
  const scopedBookmarks = normalizedFolderId === null
    ? await db.bookmarks.toCollection().filter(isRootBookmark).toArray()
    : await db.bookmarks.where('folderId').equals(normalizedFolderId).toArray();

  const maxOrder = scopedBookmarks.reduce((max, bookmark) => {
    return Math.max(max, normalizeCustomOrder(bookmark?.customOrder, 0));
  }, 0);

  return maxOrder + 1;
}

async function getNextFolderCustomOrder(parentId = null) {
  const normalizedParentId = normalizeParentId(parentId);
  const scopedFolders = await getFoldersByParentId(normalizedParentId);

  const maxOrder = scopedFolders.reduce((max, folder) => {
    return Math.max(max, normalizeCustomOrder(folder?.customOrder, 0));
  }, 0);

  return maxOrder + 1;
}

async function getFoldersByParentId(parentId = null) {
  const normalizedParentId = normalizeParentId(parentId);

  if (normalizedParentId === null) {
    return await db.folders
      .toCollection()
      .filter((folder) => folder.parentId === null || folder.parentId === undefined)
      .toArray();
  }

  return await db.folders.where('parentId').equals(normalizedParentId).toArray();
}

// Add a bookmark with a new icon
export async function addBookmarkWithIcon(title, url, folderId, data) {
  try {
    return await db.transaction('rw', db.icons, db.bookmarks, async () => {
      const now = getNowTimestamp();
      const normalizedFolderId = normalizeBookmarkFolderId(folderId);
      const iconId = await getOrCreateIconId(data);
      const customOrder = await getNextBookmarkCustomOrder(normalizedFolderId);

      const bookmarkId = await db.bookmarks.add({
        title,
        url,
        folderId: normalizedFolderId,
        iconId,
        createdAt: now,
        updatedAt: now,
        lastClickedAt: null,
        customOrder
      });

      return bookmarkId;
    });
  } catch (error) {
    console.error('Error adding bookmark with icon:', error);
    throw error;
  }
}

export async function updateBookmark(bookmarkId, updates) {
  try {
    return await db.transaction('rw', db.bookmarks, async () => {
      const currentBookmark = await db.bookmarks.get(bookmarkId);

      if (!currentBookmark) {
        throw new Error('Bookmark not found.');
      }

      const nextBookmark = {
        ...currentBookmark,
        ...updates
      };

      const hasFolderUpdate = Object.prototype.hasOwnProperty.call(updates || {}, 'folderId');

      if (hasFolderUpdate) {
        nextBookmark.folderId = normalizeBookmarkFolderId(updates.folderId);

        if (nextBookmark.folderId !== currentBookmark.folderId && !Object.prototype.hasOwnProperty.call(updates || {}, 'customOrder')) {
          nextBookmark.customOrder = await getNextBookmarkCustomOrder(nextBookmark.folderId);
        }
      }

      nextBookmark.createdAt = normalizeTimestamp(nextBookmark.createdAt, getNowTimestamp());
      nextBookmark.updatedAt = getNowTimestamp();
      nextBookmark.lastClickedAt = normalizeNullableTimestamp(nextBookmark.lastClickedAt);
      nextBookmark.customOrder = normalizeCustomOrder(nextBookmark.customOrder, currentBookmark.id || 0);

      delete nextBookmark.id;

      await db.bookmarks.update(bookmarkId, nextBookmark);

      return bookmarkId;
    });
  } catch (error) {
    console.error('Error updating bookmark:', error);
    throw error;
  }
}

export async function deleteBookmark(bookmarkId) {
  try {
    return await db.transaction('rw', db.bookmarks, db.icons, async () => {
      const bookmark = await db.bookmarks.get(bookmarkId);

      if (!bookmark) {
        return false;
      }

      await db.bookmarks.delete(bookmarkId);

      if (bookmark.iconId) {
        await deleteIconIfUnused(bookmark.iconId);
      }

      return true;
    });
  } catch (error) {
    console.error('Error deleting bookmark:', error);
    throw error;
  }
}

export async function deleteBookmarkByUrl(url) {
  try {
    return await db.transaction('rw', db.bookmarks, db.icons, async () => {
      const bookmark = await db.bookmarks.where('url').equals(url).first();

      if (!bookmark) {
        return false;
      }

      await db.bookmarks.delete(bookmark.id);

      if (bookmark.iconId) {
        await deleteIconIfUnused(bookmark.iconId);
      }

      return true;
    });
  } catch (error) {
    console.error('Error deleting bookmark by url:', error);
    throw error;
  }
}

// List all bookmarks with their icons
export async function listBookmarksWithIcons(folderId = null) {
  try {
    return await db.transaction('r', db.bookmarks, db.icons, async () => {
      const bookmarks = folderId === null
        ? await db.bookmarks.toArray()
        : await db.bookmarks.where('folderId').equals(folderId).toArray();

      const result = await Promise.all(
        bookmarks.map(async (bookmark) => {
          const icon = bookmark.iconId
            ? await db.icons.get(bookmark.iconId)
            : null;

          return {
            ...bookmark,
            icon
          };
        })
      );

      return result;
    });
  } catch (error) {
    console.error('Error listing bookmarks with icons:', error);
    throw error;
  }
}

function toSafePageNumber(value, fallback = 0) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function toSafePageSize(value, fallback = 40) {
  const parsed = toSafePageNumber(value, fallback);
  return Math.min(250, Math.max(1, parsed));
}

function toQueryOptions(options = {}) {
  return {
    rootOnly: options?.rootOnly === true,
    sortBy: options?.sortBy,
    sortDir: options?.sortDir
  };
}

function isRootBookmark(bookmark) {
  return bookmark?.folderId === null || bookmark?.folderId === undefined;
}

function normalizeBookmarkRecord(record = {}) {
  const now = getNowTimestamp();
  const createdAt = normalizeTimestamp(record.createdAt, now);
  const updatedAt = normalizeTimestamp(record.updatedAt, createdAt);

  return {
    ...record,
    folderId: normalizeBookmarkFolderId(record.folderId),
    createdAt,
    updatedAt,
    lastClickedAt: normalizeNullableTimestamp(record.lastClickedAt),
    customOrder: normalizeCustomOrder(record.customOrder, Number(record.id) || 0)
  };
}

async function getFolderBookmarkRecords(folderId = null, options = {}) {
  const queryOptions = toQueryOptions(options);

  if (folderId === null) {
    if (queryOptions.rootOnly) {
      return await db.bookmarks
        .toCollection()
        .filter(isRootBookmark)
        .toArray();
    }

    return await db.bookmarks.toArray();
  }

  return await db.bookmarks.where('folderId').equals(folderId).toArray();
}

async function attachIcons(bookmarks) {
  return await Promise.all(
    bookmarks.map(async (bookmark) => {
      const normalizedBookmark = normalizeBookmarkRecord(bookmark);
      const icon = bookmark.iconId
        ? await db.icons.get(bookmark.iconId)
        : null;

      return {
        ...normalizedBookmark,
        icon
      };
    })
  );
}

export async function countBookmarks(folderId = null, options = {}) {
  try {
    const queryOptions = toQueryOptions(options);

    return await db.transaction('r', db.bookmarks, async () => {
      if (folderId === null) {
        return queryOptions.rootOnly
          ? await db.bookmarks.toCollection().filter(isRootBookmark).count()
          : await db.bookmarks.count();
      }

      return await db.bookmarks.where('folderId').equals(folderId).count();
    });
  } catch (error) {
    console.error('Error counting bookmarks:', error);
    throw error;
  }
}

export async function listBookmarksPageWithIcons(folderId = null, offset = 0, limit = 40, options = {}) {
  try {
    const safeOffset = toSafePageNumber(offset, 0);
    const safeLimit = toSafePageSize(limit, 40);
    const queryOptions = toQueryOptions(options);

    return await db.transaction('r', db.bookmarks, db.icons, async () => {
      const allBookmarks = await getFolderBookmarkRecords(folderId, queryOptions);
      const sorted = sortBookmarkRecords(allBookmarks, queryOptions);
      const bookmarks = sorted.slice(safeOffset, safeOffset + safeLimit);

      return await attachIcons(bookmarks);
    });
  } catch (error) {
    console.error('Error listing bookmark page with icons:', error);
    throw error;
  }
}

function createSearchFilter(normalizedQuery) {
  return (bookmark) => {
    const title = (bookmark.title ?? '').toLowerCase();
    const url = (bookmark.url ?? '').toLowerCase();

    return title.includes(normalizedQuery) || url.includes(normalizedQuery);
  };
}

async function getFolderScopeIds(folderId) {
  if (folderId === null || folderId === undefined) {
    return null;
  }

  const rootFolderId = normalizeFolderId(folderId);

  if (rootFolderId === null) {
    return null;
  }

  const folders = await db.folders.toArray();
  const scopedIds = new Set([rootFolderId]);
  const queue = [rootFolderId];

  while (queue.length > 0) {
    const currentId = queue.shift();

    folders.forEach((candidate) => {
      if (!scopedIds.has(candidate.id) && (candidate.parentId ?? null) === currentId) {
        scopedIds.add(candidate.id);
        queue.push(candidate.id);
      }
    });
  }

  return scopedIds;
}

export async function searchBookmarksPage(query, folderId = null, offset = 0, limit = 40, options = {}) {
  try {
    const normalizedQuery = (query ?? '').trim().toLowerCase();
    const queryOptions = toQueryOptions(options);

    if (!normalizedQuery) {
      const [items, total] = await Promise.all([
        listBookmarksPageWithIcons(folderId, offset, limit, queryOptions),
        countBookmarks(folderId, queryOptions)
      ]);

      return { items, total };
    }

    const safeOffset = toSafePageNumber(offset, 0);
    const safeLimit = toSafePageSize(limit, 40);
    const matchesQuery = createSearchFilter(normalizedQuery);

    return await db.transaction('r', db.bookmarks, db.icons, db.folders, async () => {
      const scopedFolderIds = await getFolderScopeIds(folderId);
      const filter = (bookmark) => {
        if (!matchesQuery(bookmark)) {
          return false;
        }

        if (scopedFolderIds) {
          return scopedFolderIds.has(bookmark.folderId);
        }

        if (queryOptions.rootOnly) {
          return isRootBookmark(bookmark);
        }

        return true;
      };

      const allMatches = await db.bookmarks
        .toCollection()
        .filter(filter)
        .toArray();

      const sorted = sortBookmarkRecords(allMatches, queryOptions);
      const total = sorted.length;
      const bookmarks = sorted.slice(safeOffset, safeOffset + safeLimit);

      const items = await attachIcons(bookmarks);

      return {
        items,
        total
      };
    });
  } catch (error) {
    console.error('Error searching bookmark page:', error);
    throw error;
  }
}

export async function searchBookmarks(query, folderId = null) {
  try {
    const normalizedQuery = (query ?? '').trim().toLowerCase();

    if (!normalizedQuery) {
      return await listBookmarksWithIcons(folderId);
    }

    const bookmarks = await listBookmarksWithIcons(folderId);

    return bookmarks.filter((bookmark) => {
      const title = (bookmark.title ?? '').toLowerCase();
      const url = (bookmark.url ?? '').toLowerCase();

      return title.includes(normalizedQuery) || url.includes(normalizedQuery);
    });
  } catch (error) {
    console.error('Error searching bookmarks:', error);
    throw error;
  }
}

export async function isUrlExist(url) {
  try {
    const bookmark = await db.bookmarks
      .where('url')
      .equals(url)
      .first();

    return !!bookmark;
  } catch (error) {
    console.error('Error checking if url exists:', error);
    throw error;
  }
}

export async function getBookmarkByUrl(url) {
  try {
    const bookmark = await db.bookmarks.where('url').equals(url).first();
    return bookmark ? normalizeBookmarkRecord(bookmark) : null;
  } catch (error) {
    console.error('Error getting bookmark by url:', error);
    throw error;
  }
}

export async function saveOrUpdateBookmarkByUrl(title, url, folderId, data) {
  try {
    return await db.transaction('rw', db.bookmarks, db.icons, async () => {
      const now = getNowTimestamp();
      const normalizedIcon = normalizeIconInput(data);
      const normalizedFolderId = normalizeBookmarkFolderId(folderId);
      const bookmark = await db.bookmarks
        .where('url')
        .equals(url)
        .first();

      if (!bookmark) {
        const iconId = await getOrCreateIconId(normalizedIcon);
        const customOrder = await getNextBookmarkCustomOrder(normalizedFolderId);
        const bookmarkId = await db.bookmarks.add({
          title,
          url,
          folderId: normalizedFolderId,
          iconId,
          createdAt: now,
          updatedAt: now,
          lastClickedAt: null,
          customOrder
        });

        return {
          bookmarkId,
          action: 'created'
        };
      }

      let iconId = bookmark.iconId;
      let previousIconIdToCleanup = null;

      if (normalizedIcon) {
        const nextIconId = await getOrCreateIconId(normalizedIcon);

        if (nextIconId && iconId !== nextIconId) {
          const previousIconId = iconId;
          iconId = nextIconId;
          previousIconIdToCleanup = previousIconId;
        }
      }

      const updates = {
        title,
        updatedAt: now
      };

      if (normalizedFolderId !== bookmark.folderId) {
        updates.folderId = normalizedFolderId;
        updates.customOrder = await getNextBookmarkCustomOrder(normalizedFolderId);
      }

      if (Number.isInteger(iconId)) {
        updates.iconId = iconId;
      }

      await db.bookmarks.update(bookmark.id, updates);

      if (previousIconIdToCleanup) {
        await deleteIconIfUnused(previousIconIdToCleanup);
      }

      return {
        bookmarkId: bookmark.id,
        action: 'updated'
      };
    });
  } catch (error) {
    console.error('Error saving or updating bookmark by url:', error);
    throw error;
  }
}

export async function recordBookmarkClick(bookmarkId) {
  try {
    const parsedBookmarkId = Number(bookmarkId);

    if (!Number.isInteger(parsedBookmarkId) || parsedBookmarkId <= 0) {
      return false;
    }

    const clickedAt = getNowTimestamp();
    const updatedCount = await db.bookmarks.update(parsedBookmarkId, {
      lastClickedAt: clickedAt
    });

    return updatedCount > 0;
  } catch (error) {
    console.error('Error recording bookmark click:', error);
    throw error;
  }
}

async function applyBookmarkOrder(folderId, orderedIds) {
  const now = getNowTimestamp();
  const normalizedFolderId = normalizeBookmarkFolderId(folderId);

  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    await db.bookmarks.update(id, {
      folderId: normalizedFolderId,
      customOrder: index + 1,
      updatedAt: now
    });
  }
}

async function applyFolderOrder(parentId, orderedIds) {
  const now = getNowTimestamp();
  const normalizedParentId = normalizeParentId(parentId);

  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    await db.folders.update(id, {
      parentId: normalizedParentId,
      customOrder: index + 1,
      updatedAt: now
    });
  }
}

function reorderByPosition(orderedIds, targetId, position = 'top') {
  const source = [...orderedIds];
  const currentIndex = source.indexOf(targetId);

  if (currentIndex < 0) {
    return source;
  }

  const [item] = source.splice(currentIndex, 1);

  if (position === 'up') {
    const nextIndex = Math.max(0, currentIndex - 1);
    source.splice(nextIndex, 0, item);
    return source;
  }

  if (position === 'down') {
    const nextIndex = Math.min(source.length, currentIndex + 1);
    source.splice(nextIndex, 0, item);
    return source;
  }

  if (position === 'bottom') {
    source.push(item);
    return source;
  }

  source.unshift(item);
  return source;
}

export async function moveBookmarkInCustomOrder(bookmarkId, position = 'top') {
  try {
    const parsedBookmarkId = Number(bookmarkId);

    if (!Number.isInteger(parsedBookmarkId) || parsedBookmarkId <= 0) {
      throw new Error('Invalid bookmark id.');
    }

    return await db.transaction('rw', db.bookmarks, async () => {
      const bookmark = await db.bookmarks.get(parsedBookmarkId);

      if (!bookmark) {
        throw new Error('Bookmark not found.');
      }

      const folderId = normalizeBookmarkFolderId(bookmark.folderId);
      const scopedBookmarks = folderId === null
        ? await db.bookmarks.toCollection().filter(isRootBookmark).toArray()
        : await db.bookmarks.where('folderId').equals(folderId).toArray();

      const orderedIds = sortBookmarkRecords(scopedBookmarks, {
        sortBy: 'customOrder',
        sortDir: 'asc'
      }).map((item) => item.id);

      const reorderedIds = reorderByPosition(orderedIds, parsedBookmarkId, position);
      await applyBookmarkOrder(folderId, reorderedIds);

      return true;
    });
  } catch (error) {
    console.error('Error moving bookmark in custom order:', error);
    throw error;
  }
}

export async function moveFolderInCustomOrder(folderId, position = 'top') {
  try {
    const parsedFolderId = normalizeFolderId(folderId);

    return await db.transaction('rw', db.folders, async () => {
      const folder = await db.folders.get(parsedFolderId);

      if (!folder) {
        throw new Error('Folder not found.');
      }

      const parentId = normalizeParentId(folder.parentId);
      const siblings = await getFoldersByParentId(parentId);
      const orderedIds = sortFolderRecords(
        siblings.map(normalizeFolderRecord),
        { sortBy: 'customOrder', sortDir: 'asc' }
      ).map((item) => item.id);

      const reorderedIds = reorderByPosition(orderedIds, parsedFolderId, position);
      await applyFolderOrder(parentId, reorderedIds);

      return true;
    });
  } catch (error) {
    console.error('Error moving folder in custom order:', error);
    throw error;
  }
}

export async function reorderBookmarksInScope(folderId, orderedBookmarkIds = []) {
  try {
    const normalizedFolderId = normalizeBookmarkFolderId(folderId);
    const orderedIds = ensureArray(orderedBookmarkIds, 'orderedBookmarkIds')
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    return await db.transaction('rw', db.bookmarks, async () => {
      const scopedBookmarks = normalizedFolderId === null
        ? await db.bookmarks.toCollection().filter(isRootBookmark).toArray()
        : await db.bookmarks.where('folderId').equals(normalizedFolderId).toArray();

      const scopedIds = new Set(scopedBookmarks.map((bookmark) => bookmark.id));
      const scopedOrderedIds = orderedIds.filter((id) => scopedIds.has(id));
      const missingIds = scopedBookmarks
        .map((bookmark) => bookmark.id)
        .filter((id) => !scopedOrderedIds.includes(id));

      await applyBookmarkOrder(normalizedFolderId, [...scopedOrderedIds, ...missingIds]);
      return true;
    });
  } catch (error) {
    console.error('Error reordering bookmarks in scope:', error);
    throw error;
  }
}

export async function reorderFoldersInScope(parentId, orderedFolderIds = []) {
  try {
    const normalizedParentId = normalizeParentId(parentId);
    const orderedIds = ensureArray(orderedFolderIds, 'orderedFolderIds')
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    return await db.transaction('rw', db.folders, async () => {
      const siblings = await getFoldersByParentId(normalizedParentId);
      const siblingIds = new Set(siblings.map((folder) => folder.id));
      const siblingOrderedIds = orderedIds.filter((id) => siblingIds.has(id));
      const missingIds = siblings
        .map((folder) => folder.id)
        .filter((id) => !siblingOrderedIds.includes(id));

      await applyFolderOrder(normalizedParentId, [...siblingOrderedIds, ...missingIds]);
      return true;
    });
  } catch (error) {
    console.error('Error reordering folders in scope:', error);
    throw error;
  }
}

export async function listBookmarksPageWithSort(folderId = null, offset = 0, limit = 40, sortBy = 'updatedAt', sortDir = 'desc', options = {}) {
  return await listBookmarksPageWithIcons(folderId, offset, limit, {
    ...options,
    sortBy,
    sortDir
  });
}

export async function listChildFoldersWithSort(parentId = null, sortBy = 'name', sortDir = 'asc', options = {}) {
  return await listChildFolders(parentId, {
    ...options,
    sortBy,
    sortDir
  });
}

function normalizeFolderName(name) {
  return String(name ?? '').trim();
}

function normalizeFolderId(folderId) {
  if (folderId === null || folderId === undefined) {
    return null;
  }

  const parsedFolderId = Number(folderId);

  if (!Number.isInteger(parsedFolderId) || parsedFolderId <= 0) {
    throw new Error('Invalid folder id.');
  }

  return parsedFolderId;
}

function normalizeParentId(parentId) {
  return normalizeFolderId(parentId);
}

function normalizeFolderRecord(folder) {
  const now = getNowTimestamp();
  const createdAt = normalizeTimestamp(folder?.createdAt, now);

  return {
    ...folder,
    parentId: normalizeParentId(folder.parentId),
    createdAt,
    updatedAt: normalizeTimestamp(folder?.updatedAt, createdAt),
    customOrder: normalizeCustomOrder(folder?.customOrder, Number(folder?.id) || 0)
  };
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

export async function createFolder(name, parentId = null) {
  try {
    const normalizedName = normalizeFolderName(name);
    const normalizedParentId = normalizeParentId(parentId);

    if (!normalizedName) {
      throw new Error('Folder name is required.');
    }

    return await db.transaction('rw', db.folders, async () => {
      const now = getNowTimestamp();

      if (normalizedParentId !== null) {
        const parentFolder = await db.folders.get(normalizedParentId);

        if (!parentFolder) {
          throw new Error('Parent folder not found.');
        }
      }

      const siblingFoldersSafe = await getFoldersByParentId(normalizedParentId);

      const hasDuplicateName = siblingFoldersSafe.some((folder) => {
        return folder.name.trim().toLowerCase() === normalizedName.toLowerCase();
      });

      if (hasDuplicateName) {
        throw new Error('A folder with this name already exists in this location.');
      }

      const customOrder = await getNextFolderCustomOrder(normalizedParentId);

      const folderId = await db.folders.add({
        name: normalizedName,
        parentId: normalizedParentId,
        createdAt: now,
        updatedAt: now,
        customOrder
      });

      return {
        id: folderId,
        name: normalizedName,
        parentId: normalizedParentId,
        createdAt: now,
        updatedAt: now,
        customOrder,
        bookmarkCount: 0
      };
    });
  } catch (error) {
    console.error('Error creating folder:', error);
    throw error;
  }
}

export async function listFolders(options = {}) {
  try {
    const queryOptions = toQueryOptions(options);

    return await db.transaction('r', db.folders, db.bookmarks, async () => {
      const allFolders = await db.folders.toArray();
      const folders = allFolders.map(normalizeFolderRecord);

      const withCounts = await Promise.all(
        folders.map(async (folder) => {
          const descendants = new Set();
          const queue = [folder.id];

          while (queue.length > 0) {
            const currentId = queue.shift();
            descendants.add(currentId);
            allFolders.forEach((candidate) => {
              if ((candidate.parentId ?? null) === currentId && !descendants.has(candidate.id)) {
                queue.push(candidate.id);
              }
            });
          }

          const folderIds = Array.from(descendants);
          const bookmarkCount = await db.bookmarks
            .filter((bookmark) => folderIds.includes(bookmark.folderId))
            .count();

          return {
            ...folder,
            bookmarkCount
          };
        })
      );

      return sortFolderRecords(withCounts, queryOptions);
    });
  } catch (error) {
    console.error('Error listing folders:', error);
    throw error;
  }
}

export async function getFolderById(folderId) {
  try {
    const parsedFolderId = normalizeFolderId(folderId);

    if (parsedFolderId === null) {
      return null;
    }

    const folder = await db.folders.get(parsedFolderId);
    return folder ? normalizeFolderRecord(folder) : null;
  } catch (error) {
    console.error('Error getting folder by id:', error);
    throw error;
  }
}

export async function listChildFolders(parentId = null, options = {}) {
  try {
    const normalizedParentId = normalizeParentId(parentId);
    const queryOptions = toQueryOptions(options);

    return await db.transaction('r', db.folders, db.bookmarks, async () => {
      const allFolders = await db.folders.toArray();
      const currentLevelFolders = await getFoldersByParentId(normalizedParentId);

      const withCounts = await Promise.all(
        currentLevelFolders.map(async (folder) => {
          const descendants = new Set();
          const queue = [folder.id];

          while (queue.length > 0) {
            const currentId = queue.shift();
            descendants.add(currentId);
            allFolders.forEach((candidate) => {
              if ((candidate.parentId ?? null) === currentId && !descendants.has(candidate.id)) {
                queue.push(candidate.id);
              }
            });
          }

          const folderIds = Array.from(descendants);
          const bookmarkCount = await db.bookmarks
            .filter((bookmark) => folderIds.includes(bookmark.folderId))
            .count();

          return {
            ...normalizeFolderRecord(folder),
            bookmarkCount
          };
        })
      );

      return sortFolderRecords(withCounts, queryOptions);
    });
  } catch (error) {
    console.error('Error listing child folders:', error);
    throw error;
  }
}

export async function listFolderAncestors(folderId) {
  try {
    const parsedFolderId = normalizeFolderId(folderId);

    if (parsedFolderId === null) {
      return [];
    }

    return await db.transaction('r', db.folders, async () => {
      const ancestors = [];
      let current = await db.folders.get(parsedFolderId);
      const visited = new Set();

      while (current) {
        if (visited.has(current.id)) {
          break;
        }

        visited.add(current.id);
        ancestors.unshift(normalizeFolderRecord(current));

        if (current.parentId === null || current.parentId === undefined) {
          break;
        }

        current = await db.folders.get(current.parentId);
      }

      return ancestors;
    });
  } catch (error) {
    console.error('Error listing folder ancestors:', error);
    throw error;
  }
}

export async function renameFolder(folderId, newName) {
  try {
    const parsedFolderId = normalizeFolderId(folderId);
    const normalizedName = normalizeFolderName(newName);

    if (!normalizedName) {
      throw new Error('Folder name is required.');
    }

    return await db.transaction('rw', db.folders, async () => {
      const current = await db.folders.get(parsedFolderId);

      if (!current) {
        throw new Error('Folder not found.');
      }

      const siblingFoldersSafe = await getFoldersByParentId(current.parentId ?? null);

      const hasDuplicateName = siblingFoldersSafe.some((folder) => {
        return folder.id !== parsedFolderId && folder.name.trim().toLowerCase() === normalizedName.toLowerCase();
      });

      if (hasDuplicateName) {
        throw new Error('A folder with this name already exists in this location.');
      }

      await db.folders.update(parsedFolderId, {
        name: normalizedName,
        updatedAt: getNowTimestamp()
      });

      return parsedFolderId;
    });
  } catch (error) {
    console.error('Error renaming folder:', error);
    throw error;
  }
}

export async function deleteFolder(folderId, deleteRecursively = false) {
  try {
    const parsedFolderId = normalizeFolderId(folderId);

    return await db.transaction('rw', db.folders, db.bookmarks, async () => {
      const now = getNowTimestamp();
      const folder = await db.folders.get(parsedFolderId);

      if (!folder) {
        return false;
      }

      const allFolders = await db.folders.toArray();
      const descendants = new Set();
      const queue = [parsedFolderId];

      while (queue.length > 0) {
        const currentId = queue.shift();
        descendants.add(currentId);

        allFolders.forEach((candidate) => {
          if (!descendants.has(candidate.id) && (candidate.parentId ?? null) === currentId) {
            queue.push(candidate.id);
          }
        });
      }

      const folderIdsToDelete = Array.from(descendants);

      if (deleteRecursively) {
        // Alt klasörler ve içindeki bookmarkları kalıcı olarak sil
        await db.bookmarks
          .filter((bookmark) => folderIdsToDelete.includes(bookmark.folderId))
          .delete();
      } else {
        // Sadece klasörleri sil, bookmarkları root'a taşı
        await db.bookmarks
          .filter((bookmark) => folderIdsToDelete.includes(bookmark.folderId))
          .modify((bookmark) => {
            bookmark.folderId = null;
            bookmark.updatedAt = now;
          });
      }

      await db.folders.bulkDelete(folderIdsToDelete);

      return true;
    });
  } catch (error) {
    console.error('Error deleting folder:', error);
    throw error;
  }
}

export async function updateFolder(folderId, updates) {
  try {
    const parsedFolderId = normalizeFolderId(folderId);

    if (parsedFolderId === null) {
      throw new Error('Folder ID is required for update.');
    }

    return await db.transaction('rw', db.folders, async () => {
      const current = await db.folders.get(parsedFolderId);

      if (!current) {
        throw new Error('Folder not found.');
      }

      const nextFolder = {
        ...current,
        ...updates
      };

      const hasParentUpdate = Object.prototype.hasOwnProperty.call(updates || {}, 'parentId');

      if (hasParentUpdate) {
        const nextParentId = normalizeParentId(updates.parentId);

        if (nextParentId !== null) {
          if (nextParentId === parsedFolderId) {
            throw new Error('A folder cannot be its own parent.');
          }

          const allFolders = await db.folders.toArray();
          const descendants = new Set();
          const queue = [parsedFolderId];

          while (queue.length > 0) {
            const currentId = queue.shift();
            descendants.add(currentId);

            allFolders.forEach((candidate) => {
              if (!descendants.has(candidate.id) && (candidate.parentId ?? null) === currentId) {
                queue.push(candidate.id);
              }
            });
          }

          if (descendants.has(nextParentId)) {
            throw new Error('A folder cannot be moved into its own subfolder.');
          }
        }

        nextFolder.parentId = nextParentId;

        if (nextFolder.parentId !== current.parentId && !Object.prototype.hasOwnProperty.call(updates || {}, 'customOrder')) {
          nextFolder.customOrder = await getNextFolderCustomOrder(nextFolder.parentId);
        }
      }

      if (Object.prototype.hasOwnProperty.call(updates || {}, 'name')) {
        const normalizedName = normalizeFolderName(updates.name);

        if (!normalizedName) {
          throw new Error('Folder name is required.');
        }

        const siblingFoldersSafe = await getFoldersByParentId(nextFolder.parentId ?? null);
        const hasDuplicateName = siblingFoldersSafe.some((folder) => {
          return folder.id !== parsedFolderId && folder.name.trim().toLowerCase() === normalizedName.toLowerCase();
        });

        if (hasDuplicateName) {
          throw new Error('A folder with this name already exists in this location.');
        }

        nextFolder.name = normalizedName;
      }

      nextFolder.updatedAt = getNowTimestamp();
      nextFolder.customOrder = normalizeCustomOrder(nextFolder.customOrder, current.id || 0);

      await db.folders.put(nextFolder);
      return parsedFolderId;
    });
  } catch (error) {
    console.error('Error updating folder:', error);
    throw error;
  }
}

export async function exportDatabase() {
  try {
    return await db.transaction('r', db.folders, db.icons, db.bookmarks, async () => {
      const folders = (await db.folders.toArray()).map(normalizeFolderRecord);
      const iconRows = await db.icons.toArray();
      const bookmarks = (await db.bookmarks.toArray()).map(normalizeBookmarkRecord);

      const icons = (await Promise.all(
        iconRows.map(async (icon) => {
          const normalizedIcon = normalizeIconData(icon);

          if (!normalizedIcon || !Number.isInteger(Number(normalizedIcon.id))) {
            return null;
          }

          const data = String(normalizedIcon.data ?? '');
          const hash = await ensureIconHash(data, normalizedIcon.hash ?? '');

          return {
            id: Number(normalizedIcon.id),
            data,
            hash: String(hash ?? '')
          };
        })
      )).filter(Boolean);

      return {
        version: 5,
        exportedAt: new Date().toISOString(),
        data: {
          folders,
          icons,
          bookmarks
        }
      };
    });
  } catch (error) {
    console.error('Error exporting database:', error);
    throw error;
  }
}

export async function importDatabaseReplace(payload) {
  try {
    const now = getNowTimestamp();
    const parsedPayload = typeof payload === 'string'
      ? JSON.parse(payload)
      : payload;

    const data = parsedPayload?.data ?? parsedPayload;

    const folders = ensureArray(data?.folders, 'folders')
      .map((folder) => ({
        id: Number(folder.id),
        name: normalizeFolderName(folder.name),
        parentId: folder.parentId === null || folder.parentId === undefined
          ? null
          : Number(folder.parentId),
        createdAt: normalizeTimestamp(folder.createdAt, now),
        updatedAt: normalizeTimestamp(folder.updatedAt, now),
        customOrder: normalizeCustomOrder(folder.customOrder, Number(folder.id) || 0)
      }))
      .filter((folder) => Number.isInteger(folder.id) && folder.name);

    const folderIds = new Set(folders.map((folder) => folder.id));

    folders.forEach((folder) => {
      if (!Number.isInteger(folder.parentId) || !folderIds.has(folder.parentId)) {
        folder.parentId = null;
      }

      folder.createdAt = normalizeTimestamp(folder.createdAt, now);
      folder.updatedAt = normalizeTimestamp(folder.updatedAt, folder.createdAt);
      folder.customOrder = normalizeCustomOrder(folder.customOrder, folder.id);
    });

    const icons = ensureArray(data?.icons, 'icons')
      .map((icon) => ({
        id: Number(icon.id),
        data: String(icon.data ?? icon.base64 ?? ''),
        hash: String(icon.hash ?? '')
      }))
      .filter((icon) => Number.isInteger(icon.id));

    const validFolderIds = new Set(folders.map((folder) => folder.id));
    const validIconIds = new Set(icons.map((icon) => icon.id));

    const bookmarks = ensureArray(data?.bookmarks, 'bookmarks')
      .map((bookmark) => {
        const id = Number(bookmark.id);
        const folderId = bookmark.folderId === null || bookmark.folderId === undefined
          ? null
          : Number(bookmark.folderId);
        const iconId = bookmark.iconId === null || bookmark.iconId === undefined
          ? null
          : Number(bookmark.iconId);

        return {
          id,
          title: String(bookmark.title ?? ''),
          url: String(bookmark.url ?? ''),
          folderId: Number.isInteger(folderId) && validFolderIds.has(folderId) ? folderId : null,
          iconId: Number.isInteger(iconId) && validIconIds.has(iconId) ? iconId : null,
          createdAt: normalizeTimestamp(bookmark.createdAt, now),
          updatedAt: normalizeTimestamp(bookmark.updatedAt, now),
          lastClickedAt: normalizeNullableTimestamp(bookmark.lastClickedAt),
          customOrder: normalizeCustomOrder(bookmark.customOrder, id)
        };
      })
      .filter((bookmark) => Number.isInteger(bookmark.id) && bookmark.url);

    bookmarks.forEach((bookmark) => {
      bookmark.createdAt = normalizeTimestamp(bookmark.createdAt, now);
      bookmark.updatedAt = normalizeTimestamp(bookmark.updatedAt, bookmark.createdAt);
      bookmark.lastClickedAt = normalizeNullableTimestamp(bookmark.lastClickedAt);
      bookmark.customOrder = normalizeCustomOrder(bookmark.customOrder, bookmark.id);
    });

    await db.transaction('rw', db.folders, db.icons, db.bookmarks, async () => {
      await db.bookmarks.clear();
      await db.icons.clear();
      await db.folders.clear();

      if (folders.length > 0) {
        await db.folders.bulkAdd(folders);
      }

      if (icons.length > 0) {
        await db.icons.bulkAdd(icons);
      }

      if (bookmarks.length > 0) {
        await db.bookmarks.bulkAdd(bookmarks);
      }
    });

    return {
      folders: folders.length,
      icons: icons.length,
      bookmarks: bookmarks.length
    };
  } catch (error) {
    console.error('Error importing database:', error);
    throw error;
  }
}

export async function normalizeLegacyIconsToBase64(options = {}) {
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
  const storageMode = options?.storageMode === 'url' ? 'url' : 'base64';
  const icons = (await db.icons.toArray()).map(normalizeIconData);
  const bookmarks = await db.bookmarks.toArray();
  const bookmarksByIconId = new Map();
  const domainCache = new Map();
  const totalIcons = icons.length;

  function reportProgress(progress) {
    if (!onProgress) {
      return;
    }

    onProgress({
      total: totalIcons,
      ...progress
    });
  }

  reportProgress({ stage: 'start', processed: 0 });

  bookmarks.forEach((bookmark) => {
    if (!Number.isInteger(bookmark.iconId)) {
      return;
    }

    if (!bookmarksByIconId.has(bookmark.iconId)) {
      bookmarksByIconId.set(bookmark.iconId, []);
    }

    bookmarksByIconId.get(bookmark.iconId).push(bookmark);
  });

  const nextDataByIconId = new Map();
  const nextHashByIconId = new Map();
  let processed = 0;
  let failed = 0;

  for (const icon of icons) {
    const normalized = normalizeIconPayload(icon.data);

    if (!normalized) {
      nextDataByIconId.set(icon.id, null);
      nextHashByIconId.set(icon.id, normalizeIconHash(icon.hash) || '');
      processed += 1;
      reportProgress({ stage: 'convert', processed });
      continue;
    }

    if (isDataUri(normalized)) {
      const hash = await ensureIconHash(normalized, icon.hash);
      nextDataByIconId.set(icon.id, normalized);
      nextHashByIconId.set(icon.id, hash || '');
      processed += 1;
      reportProgress({ stage: 'convert', processed });
      continue;
    }

    const relatedBookmarks = bookmarksByIconId.get(icon.id) || [];
    const primaryBookmarkUrl = relatedBookmarks[0]?.url || '';
    const converted = await resolveBookmarkIconPayload(primaryBookmarkUrl, normalized, {
      domainCache,
      storageMode,
      skipPageHtmlLookup: true
    });

    if (!converted?.data) {
      if (storageMode === 'url' && isHttpUrl(normalized)) {
        let hash = normalizeIconHash(icon.hash);

        if (!hash) {
          const hashed = await fetchUrlAsIconPayload(normalized, {
            storageMode: 'url',
            throttleGoogle: isGoogleFaviconUrl(normalized)
          });

          hash = normalizeIconHash(hashed?.hash);
        }

        hash = await ensureIconHash(normalized, hash);

        nextDataByIconId.set(icon.id, normalized);
        nextHashByIconId.set(icon.id, hash || '');

        if (!hash) {
          failed += 1;
        }

        processed += 1;
        reportProgress({ stage: 'convert', processed, failed });
        continue;
      }

      failed += 1;
    }

    nextDataByIconId.set(icon.id, converted?.data || null);
    nextHashByIconId.set(
      icon.id,
      await ensureIconHash(converted?.data || '', converted?.hash || '')
    );
    processed += 1;
    reportProgress({ stage: 'convert', processed, failed });
  }

  reportProgress({ stage: 'merge', processed: totalIcons, failed });

  const canonicalByData = new Map();
  const canonicalByHash = new Map();
  const targetIconIdByIconId = new Map();

  icons.forEach((icon) => {
    const nextData = nextDataByIconId.get(icon.id) || null;
    const nextHash = normalizeIconHash(nextHashByIconId.get(icon.id));

    if (!nextData) {
      targetIconIdByIconId.set(icon.id, null);
      return;
    }

    if (nextHash && canonicalByHash.has(nextHash)) {
      targetIconIdByIconId.set(icon.id, canonicalByHash.get(nextHash));
      return;
    }

    if (canonicalByData.has(nextData)) {
      targetIconIdByIconId.set(icon.id, canonicalByData.get(nextData));
      return;
    }

    if (nextHash) {
      canonicalByHash.set(nextHash, icon.id);
    }

    canonicalByData.set(nextData, icon.id);
    targetIconIdByIconId.set(icon.id, icon.id);
  });

  const summary = {
    total: totalIcons,
    converted: 0,
    detached: 0,
    reattached: 0,
    deleted: 0,
    failed
  };

  await db.transaction('rw', db.icons, db.bookmarks, async () => {
    for (const icon of icons) {
      const nextData = nextDataByIconId.get(icon.id) || null;
      const nextHash = normalizeIconHash(nextHashByIconId.get(icon.id)) || '';

      if (nextData && icon.data !== nextData) {
        await db.icons.update(icon.id, {
          data: nextData,
          hash: nextHash
        });
        summary.converted += 1;
        continue;
      }

      if (String(icon.hash ?? '') !== nextHash) {
        await db.icons.update(icon.id, { hash: nextHash });
      }
    }

    for (const icon of icons) {
      const targetIconId = targetIconIdByIconId.get(icon.id);

      if (targetIconId === icon.id) {
        continue;
      }

      if (targetIconId === null) {
        const detachedCount = await db.bookmarks.where('iconId').equals(icon.id).modify({ iconId: null });
        summary.detached += detachedCount;
        continue;
      }

      const reattachedCount = await db.bookmarks.where('iconId').equals(icon.id).modify({ iconId: targetIconId });
      summary.reattached += reattachedCount;
    }

    const referencedIconIds = new Set(
      (await db.bookmarks.toArray())
        .map((bookmark) => bookmark.iconId)
        .filter((iconId) => Number.isInteger(iconId))
    );

    const existingIcons = await db.icons.toArray();

    for (const icon of existingIcons) {
      if (referencedIconIds.has(icon.id)) {
        continue;
      }

      await db.icons.delete(icon.id);
      summary.deleted += 1;
    }
  });

  reportProgress({ stage: 'done', processed: totalIcons, summary });

  return summary;
}