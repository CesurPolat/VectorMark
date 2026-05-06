import { db } from './dbCore';
import { ulid } from 'ulid';
import {
  normalizeIconInput,
  resolveBookmarkIconPayload,
  resolveBookmarkIconData
} from './iconService';
import type {
  BookmarkRecord,
  QueryOptions
} from '../types';

type EntityId = string;

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

  const iconId = ulid();

  await db.icons.add({
    id: iconId,
    data: normalizedIcon.data,
    hash: normalizedIcon.hash || ''
  });

  return iconId;
}

async function deleteIconIfUnused(iconId: string) {
  const usageCount = await db.bookmarks.where('iconId').equals(iconId).count();

  if (usageCount > 0) {
    return false;
  }

  await db.icons.delete(iconId);
  return true;
}

export { resolveBookmarkIconPayload, resolveBookmarkIconData };

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

  const normalized = String(folderId).trim();
  return normalized || null;
}

function normalizeSortDirection(direction, fallback = 'desc') {
  return direction === 'asc' || direction === 'desc' ? direction : fallback;
}

function getSortOptions(options: QueryOptions, fallbackSortBy, ascSortFields) {
  const rawSortBy = String(options?.sortBy ?? '').trim() || fallbackSortBy;
  const normalizedSortBy = rawSortBy === 'manual'
    ? 'customOrder'
    : rawSortBy;
  const fallbackDirection = ascSortFields.has(normalizedSortBy) ? 'asc' : 'desc';

  return {
    sortBy: normalizedSortBy,
    sortDir: normalizeSortDirection(options?.sortDir, fallbackDirection)
  };
}

function getBookmarkSortOptions(options: QueryOptions = {}) {
  return getSortOptions(options, 'updatedAt', new Set(['title', 'customOrder']));
}

function getFolderSortOptions(options: QueryOptions = {}) {
  return getSortOptions(options, 'name', new Set(['name', 'customOrder']));
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
  const scopedFolders = await getFoldersByParentId(parentId);

  const maxOrder = scopedFolders.reduce((max, folder) => {
    return Math.max(max, normalizeCustomOrder(folder?.customOrder, 0));
  }, 0);

  return maxOrder + 1;
}

async function getFoldersByParentId(parentId = null) {
  if (parentId === null) {
    return await db.folders
      .toCollection()
      .filter((folder) => folder.parentId === null || folder.parentId === undefined)
      .toArray();
  }

  return await db.folders.where('parentId').equals(parentId).toArray();
}

// Add a bookmark with a new icon
export async function addBookmarkWithIcon(title, url, folderId, data) {
  try {
    return await db.transaction('rw', db.icons, db.bookmarks, async () => {
      const now = Date.now();
      const normalizedFolderId = normalizeBookmarkFolderId(folderId);
      const iconId = await getOrCreateIconId(data);
      const customOrder = await getNextBookmarkCustomOrder(normalizedFolderId);

      const bookmarkId = ulid();

      await db.bookmarks.add({
        id: bookmarkId,
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

      nextBookmark.createdAt = normalizeTimestamp(nextBookmark.createdAt, Date.now());
      nextBookmark.updatedAt = Date.now();
      nextBookmark.lastClickedAt = normalizeNullableTimestamp(nextBookmark.lastClickedAt);
      nextBookmark.customOrder = normalizeCustomOrder(nextBookmark.customOrder, 0);

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

function toQueryOptions(options: QueryOptions = {}): QueryOptions {
  return {
    rootOnly: options?.rootOnly === true,
    sortBy: options?.sortBy,
    sortDir: options?.sortDir
  };
}

function isRootBookmark(bookmark) {
  return bookmark?.folderId === null || bookmark?.folderId === undefined;
}



async function getFolderBookmarkRecords(folderId: string | null = null, options: QueryOptions = {}) {
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

  if (folderId === null) {
    return null;
  }

  const folders = await db.folders.toArray();
  const scopedIds = new Set([folderId]);
  const queue = [folderId];

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
      const now = Date.now();
      const normalizedIcon = normalizeIconInput(data);
      const normalizedFolderId = normalizeBookmarkFolderId(folderId);
      const bookmark = await db.bookmarks
        .where('url')
        .equals(url)
        .first();

      if (!bookmark) {
        const iconId = await getOrCreateIconId(normalizedIcon);
        const customOrder = await getNextBookmarkCustomOrder(normalizedFolderId);
        const bookmarkId = ulid();

        await db.bookmarks.add({
          id: bookmarkId,
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

      const updates: Partial<BookmarkRecord> = {
        title,
        updatedAt: now
      };

      if (normalizedFolderId !== bookmark.folderId) {
        updates.folderId = normalizedFolderId;
        updates.customOrder = await getNextBookmarkCustomOrder(normalizedFolderId);
      }

      if (iconId != null) {
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
    if (!bookmarkId) {
      return false;
    }

    const clickedAt = Date.now();
    const updatedCount = await db.bookmarks.update(bookmarkId, {
      lastClickedAt: clickedAt
    });

    return updatedCount > 0;
  } catch (error) {
    console.error('Error recording bookmark click:', error);
    throw error;
  }
}

async function applyBookmarkOrder(folderId, orderedIds) {
  const now = Date.now();
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
  const now = Date.now();

  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    await db.folders.update(id, {
      parentId: parentId,
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

    if (!bookmarkId) {
      throw new Error('Invalid bookmark id.');
    }

    return await db.transaction('rw', db.bookmarks, async () => {
      const bookmark = await db.bookmarks.get(bookmarkId);

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

      const reorderedIds = reorderByPosition(orderedIds, bookmarkId, position);
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

    return await db.transaction('rw', db.folders, async () => {
      const folder = await db.folders.get(folderId);

      if (!folder) {
        throw new Error('Folder not found.');
      }

      const siblings = await getFoldersByParentId(folder.parentId);
      const orderedIds = sortFolderRecords(
        siblings.map(normalizeFolderRecord),
        { sortBy: 'customOrder', sortDir: 'asc' }
      ).map((item) => item.id);

      const reorderedIds = reorderByPosition(orderedIds, folderId, position);
      await applyFolderOrder(folder.parentId, reorderedIds);

      return true;
    });
  } catch (error) {
    console.error('Error moving folder in custom order:', error);
    throw error;
  }
}

export async function reorderBookmarksInScope(folderId: string | null, orderedBookmarkIds: string[] = []) {
  try {
    const normalizedFolderId = normalizeBookmarkFolderId(folderId);
    const orderedIds = orderedBookmarkIds
      .map((id) => id)
      .filter(Boolean);

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

export async function reorderFoldersInScope(parentId: string | null, orderedFolderIds: string[] = []) {
  try {
    const orderedIds = orderedFolderIds
      .map((id) => id)
      .filter(Boolean);

    return await db.transaction('rw', db.folders, async () => {
      const siblings = await getFoldersByParentId(parentId);
      const siblingIds = new Set(siblings.map((folder) => folder.id));
      const siblingOrderedIds = orderedIds.filter((id) => siblingIds.has(id));
      const missingIds = siblings
        .map((folder) => folder.id)
        .filter((id) => !siblingOrderedIds.includes(id));

      await applyFolderOrder(parentId, [...siblingOrderedIds, ...missingIds]);
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

//TODO: Remove both from dbMaintaince and here
function normalizeBookmarkRecord(record: Partial<BookmarkRecord> = {}): BookmarkRecord {
  const now = Date.now();
  const createdAt = normalizeTimestamp(record.createdAt, now);
  const updatedAt = normalizeTimestamp(record.updatedAt, createdAt);

  return {
    id: String(record.id ?? ''),
    title: String(record.title ?? ''),
    url: String(record.url ?? ''),
    folderId: normalizeBookmarkFolderId(record.folderId),
    iconId: record.iconId,
    createdAt,
    updatedAt,
    lastClickedAt: normalizeNullableTimestamp(record.lastClickedAt),
    customOrder: normalizeCustomOrder(record.customOrder, 0)
  };
}

// Start: CRUD Folder

function normalizeFolderRecord(folder) {
  const now = Date.now();
  const createdAt = normalizeTimestamp(folder?.createdAt, now);

  return {
    ...folder,
    id: String(folder?.id ?? ''),
    parentId: folder.parentId,
    createdAt,
    updatedAt: normalizeTimestamp(folder?.updatedAt, createdAt),
    customOrder: normalizeCustomOrder(folder?.customOrder, 0)
  };
}

export async function createFolder(name, parentId = null) {
  try {
    const normalizedName = name.trim();

    if (!normalizedName) {
      throw new Error('Folder name is required.');
    }

    return await db.transaction('rw', db.folders, async () => {
      const now = Date.now();

      if (parentId !== null) {
        const parentFolder = await db.folders.get(parentId);

        if (!parentFolder) {
          throw new Error('Parent folder not found.');
        }
      }

      const siblingFoldersSafe = await getFoldersByParentId(parentId);

      const hasDuplicateName = siblingFoldersSafe.some((folder) => {
        return folder.name.trim().toLowerCase() === normalizedName.toLowerCase();
      });

      if (hasDuplicateName) {
        throw new Error('A folder with this name already exists in this location.');
      }

      const customOrder = await getNextFolderCustomOrder(parentId);

      const folderId = ulid();

      await db.folders.add({
        id: folderId,
        name: normalizedName,
        parentId: parentId,
        createdAt: now,
        updatedAt: now,
        customOrder
      });

      return {
        id: folderId,
        name: normalizedName,
        parentId: parentId,
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

    if (folderId === null) {
      return null;
    }

    const folder = await db.folders.get(folderId);
    return folder ? normalizeFolderRecord(folder) : null;
  } catch (error) {
    console.error('Error getting folder by id:', error);
    throw error;
  }
}

export async function listChildFolders(parentId = null, options = {}) {
  try {
    const queryOptions = toQueryOptions(options);

    return await db.transaction('r', db.folders, db.bookmarks, async () => {
      const allFolders = await db.folders.toArray();
      const currentLevelFolders = await getFoldersByParentId(parentId);

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

    if (folderId === null) {
      return [];
    }

    return await db.transaction('r', db.folders, async () => {
      const ancestors = [];
      let current = await db.folders.get(folderId);
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
    const normalizedName = newName.trim();

    if (!normalizedName) {
      throw new Error('Folder name is required.');
    }

    return await db.transaction('rw', db.folders, async () => {
      const current = await db.folders.get(folderId);

      if (!current) {
        throw new Error('Folder not found.');
      }

      const siblingFoldersSafe = await getFoldersByParentId(current.parentId ?? null);

      const hasDuplicateName = siblingFoldersSafe.some((folder) => {
        return folder.id !== folderId && folder.name.trim().toLowerCase() === normalizedName.toLowerCase();
      });

      if (hasDuplicateName) {
        throw new Error('A folder with this name already exists in this location.');
      }

      await db.folders.update(folderId, {
        name: normalizedName,
        updatedAt: Date.now()
      });

      return folderId;
    });
  } catch (error) {
    console.error('Error renaming folder:', error);
    throw error;
  }
}

export async function deleteFolder(folderId, deleteRecursively = false) {
  try {

    return await db.transaction('rw', db.folders, db.bookmarks, async () => {
      const now = Date.now();
      const folder = await db.folders.get(folderId);

      if (!folder) {
        return false;
      }

      const allFolders = await db.folders.toArray();
      const descendants = new Set<string>();
      const queue: string[] = [folderId];

      while (queue.length > 0) {
        const currentId = queue.shift();
        descendants.add(currentId);

        allFolders.forEach((candidate) => {
          if (!descendants.has(candidate.id) && (candidate.parentId ?? null) === currentId) {
            queue.push(candidate.id);
          }
        });
      }

      const folderIdsToDelete: string[] = Array.from(descendants);

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

    if (folderId === null) {
      throw new Error('Folder ID is required for update.');
    }

    return await db.transaction('rw', db.folders, async () => {
      const current = await db.folders.get(folderId);

      if (!current) {
        throw new Error('Folder not found.');
      }

      const nextFolder = {
        ...current,
        ...updates
      };

      const hasParentUpdate = Object.prototype.hasOwnProperty.call(updates || {}, 'parentId');

      if (hasParentUpdate) {

        if (updates.parentId !== null) {
          if (updates.parentId === folderId) {
            throw new Error('A folder cannot be its own parent.');
          }

          const allFolders = await db.folders.toArray();
          const descendants = new Set();
          const queue = [folderId];

          while (queue.length > 0) {
            const currentId = queue.shift();
            descendants.add(currentId);

            allFolders.forEach((candidate) => {
              if (!descendants.has(candidate.id) && (candidate.parentId ?? null) === currentId) {
                queue.push(candidate.id);
              }
            });
          }

          if (descendants.has(updates.parentId)) {
            throw new Error('A folder cannot be moved into its own subfolder.');
          }
        }

        nextFolder.parentId = updates.parentId;

        if (nextFolder.parentId !== current.parentId && !Object.prototype.hasOwnProperty.call(updates || {}, 'customOrder')) {
          nextFolder.customOrder = await getNextFolderCustomOrder(nextFolder.parentId);
        }
      }

      if (Object.prototype.hasOwnProperty.call(updates || {}, 'name')) {
        const normalizedName = updates.name.trim();

        if (!normalizedName) {
          throw new Error('Folder name is required.');
        }

        const siblingFoldersSafe = await getFoldersByParentId(nextFolder.parentId ?? null);
        const hasDuplicateName = siblingFoldersSafe.some((folder) => {
          return folder.id !== folderId && folder.name.trim().toLowerCase() === normalizedName.toLowerCase();
        });

        if (hasDuplicateName) {
          throw new Error('A folder with this name already exists in this location.');
        }

        nextFolder.name = normalizedName;
      }

      nextFolder.updatedAt = Date.now();
      nextFolder.customOrder = normalizeCustomOrder(nextFolder.customOrder, 0);

      await db.folders.put(nextFolder);
      return folderId;
    });
  } catch (error) {
    console.error('Error updating folder:', error);
    throw error;
  }
}

// End: Folder
