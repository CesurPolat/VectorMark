import '../vendor/dexie.js';

const db = new Dexie('myDatabase');
db.version(1).stores({
  folders: '++id, &name',
  icons: '++id, data',
  bookmarks: '++id, title, url, folderId, iconId'
});

db.version(2)
  .stores({
    folders: '++id, name, parentId, &[parentId+name]',
    icons: '++id, data',
    bookmarks: '++id, title, url, folderId, iconId'
  })
  .upgrade(async (tx) => {
    await tx.table('folders').toCollection().modify((folder) => {
      if (!Object.prototype.hasOwnProperty.call(folder, 'parentId')) {
        folder.parentId = null;
      }
    });
  });

db.version(3)
  .stores({
    folders: '++id, name, parentId, &[parentId+name]',
    icons: '++id, data',
    bookmarks: '++id, title, url, folderId, iconId'
  })
  .upgrade(async (tx) => {
    await tx.table('icons').toCollection().modify((icon) => {
      if (!Object.prototype.hasOwnProperty.call(icon, 'data')) {
        icon.data = String(icon.base64 ?? '');
      }

      delete icon.base64;
    });
  });

function normalizeIconData(icon) {
  if (!icon) {
    return null;
  }

  return {
    ...icon,
    data: String(icon.data ?? icon.base64 ?? '')
  };
}

// Add a bookmark with a new icon
export async function addBookmarkWithIcon(title, url, folderId, data) {
  try {
    return await db.transaction('rw', db.icons, db.bookmarks, async () => {
      const iconId = await db.icons.add({ data });

      const bookmarkId = await db.bookmarks.add({
        title,
        url,
        folderId,
        iconId
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
        await db.icons.delete(bookmark.iconId);
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
        await db.icons.delete(bookmark.iconId);
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
    rootOnly: options?.rootOnly === true
  };
}

function isRootBookmark(bookmark) {
  return bookmark?.folderId === null || bookmark?.folderId === undefined;
}

function getFolderBookmarkCollection(folderId = null, options = {}) {
  const queryOptions = toQueryOptions(options);

  if (folderId === null) {
    if (queryOptions.rootOnly) {
      return db.bookmarks
        .orderBy('id')
        .reverse()
        .filter(isRootBookmark);
    }

    return db.bookmarks.orderBy('id').reverse();
  }

  return db.bookmarks.where('folderId').equals(folderId);
}

async function attachIcons(bookmarks) {
  return await Promise.all(
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
      const bookmarks = await getFolderBookmarkCollection(folderId, queryOptions)
        .offset(safeOffset)
        .limit(safeLimit)
        .toArray();

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

      const total = await db.bookmarks
        .toCollection()
        .filter(filter)
        .count();

      const bookmarks = await db.bookmarks
        .orderBy('id')
        .reverse()
        .filter(filter)
        .offset(safeOffset)
        .limit(safeLimit)
        .toArray();

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

export async function saveOrUpdateBookmarkByUrl(title, url, folderId, data) {
  try {
    return await db.transaction('rw', db.bookmarks, db.icons, async () => {
      const bookmark = await db.bookmarks
        .where('url')
        .equals(url)
        .first();

      if (!bookmark) {
        const iconId = await db.icons.add({ data });
        const bookmarkId = await db.bookmarks.add({
          title,
          url,
          folderId,
          iconId
        });

        return {
          bookmarkId,
          action: 'created'
        };
      }

      let iconId = bookmark.iconId;

      if (data) {
        if (iconId) {
          await db.icons.update(iconId, { data });
        } else {
          iconId = await db.icons.add({ data });
        }
      }

      const updates = {
        title
      };

      if (iconId) {
        updates.iconId = iconId;
      }

      await db.bookmarks.update(bookmark.id, updates);

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
  return {
    ...folder,
    parentId: normalizeParentId(folder.parentId)
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
      if (normalizedParentId !== null) {
        const parentFolder = await db.folders.get(normalizedParentId);

        if (!parentFolder) {
          throw new Error('Parent folder not found.');
        }
      }

      const siblingFolders = await db.folders
        .where('parentId')
        .equals(normalizedParentId)
        .toArray();

      const hasDuplicateName = siblingFolders.some((folder) => {
        return folder.name.trim().toLowerCase() === normalizedName.toLowerCase();
      });

      if (hasDuplicateName) {
        throw new Error('A folder with this name already exists in this location.');
      }

      const folderId = await db.folders.add({
        name: normalizedName,
        parentId: normalizedParentId
      });

      return {
        id: folderId,
        name: normalizedName,
        parentId: normalizedParentId,
        bookmarkCount: 0
      };
    });
  } catch (error) {
    console.error('Error creating folder:', error);
    throw error;
  }
}

export async function listFolders() {
  try {
    return await db.transaction('r', db.folders, db.bookmarks, async () => {
      const folders = (await db.folders.toArray()).map(normalizeFolderRecord);

      const withCounts = await Promise.all(
        folders.map(async (folder) => {
          const bookmarkCount = await db.bookmarks
            .where('folderId')
            .equals(folder.id)
            .count();

          return {
            ...folder,
            bookmarkCount
          };
        })
      );

      withCounts.sort((a, b) => a.name.localeCompare(b.name));

      return withCounts;
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

export async function listChildFolders(parentId = null) {
  try {
    const normalizedParentId = normalizeParentId(parentId);

    return await db.transaction('r', db.folders, db.bookmarks, async () => {
      const folders = await db.folders
        .where('parentId')
        .equals(normalizedParentId)
        .toArray();

      const withCounts = await Promise.all(
        folders.map(async (folder) => {
          const bookmarkCount = await db.bookmarks
            .where('folderId')
            .equals(folder.id)
            .count();

          return {
            ...normalizeFolderRecord(folder),
            bookmarkCount
          };
        })
      );

      withCounts.sort((a, b) => a.name.localeCompare(b.name));
      return withCounts;
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

      const siblingFolders = await db.folders
        .where('parentId')
        .equals(current.parentId ?? null)
        .toArray();

      const hasDuplicateName = siblingFolders.some((folder) => {
        return folder.id !== parsedFolderId && folder.name.trim().toLowerCase() === normalizedName.toLowerCase();
      });

      if (hasDuplicateName) {
        throw new Error('A folder with this name already exists in this location.');
      }

      await db.folders.update(parsedFolderId, { name: normalizedName });

      return parsedFolderId;
    });
  } catch (error) {
    console.error('Error renaming folder:', error);
    throw error;
  }
}

export async function deleteFolder(folderId, moveBookmarksTo = null) {
  try {
    const parsedFolderId = normalizeFolderId(folderId);
    const parsedMoveFolderId = normalizeFolderId(moveBookmarksTo);

    if (parsedMoveFolderId !== null && parsedMoveFolderId === parsedFolderId) {
      throw new Error('Destination folder cannot be the same folder.');
    }

    return await db.transaction('rw', db.folders, db.bookmarks, async () => {
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

      if (parsedMoveFolderId !== null && descendants.has(parsedMoveFolderId)) {
        throw new Error('Destination folder cannot be inside the folder being deleted.');
      }

      const folderIdsToDelete = Array.from(descendants);

      if (parsedMoveFolderId !== null) {
        const destination = await db.folders.get(parsedMoveFolderId);

        if (!destination) {
          throw new Error('Destination folder not found.');
        }

        await db.bookmarks
          .filter((bookmark) => folderIdsToDelete.includes(bookmark.folderId))
          .modify({ folderId: parsedMoveFolderId });
      } else {
        await db.bookmarks
          .filter((bookmark) => folderIdsToDelete.includes(bookmark.folderId))
          .modify({ folderId: null });
      }

      await db.folders.bulkDelete(folderIdsToDelete);

      return true;
    });
  } catch (error) {
    console.error('Error deleting folder:', error);
    throw error;
  }
}

export async function exportDatabase() {
  try {
    return await db.transaction('r', db.folders, db.icons, db.bookmarks, async () => {
      const folders = await db.folders.toArray();
      const icons = await db.icons.toArray();
      const bookmarks = await db.bookmarks.toArray();

      return {
        version: 3,
        exportedAt: new Date().toISOString(),
        data: {
          folders,
          icons: icons.map(normalizeIconData),
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
          : Number(folder.parentId)
      }))
      .filter((folder) => Number.isInteger(folder.id) && folder.name);

    const folderIds = new Set(folders.map((folder) => folder.id));

    folders.forEach((folder) => {
      if (!Number.isInteger(folder.parentId) || !folderIds.has(folder.parentId)) {
        folder.parentId = null;
      }
    });

    const icons = ensureArray(data?.icons, 'icons')
      .map((icon) => ({
        id: Number(icon.id),
        data: String(icon.data ?? icon.base64 ?? '')
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
          iconId: Number.isInteger(iconId) && validIconIds.has(iconId) ? iconId : null
        };
      })
      .filter((bookmark) => Number.isInteger(bookmark.id) && bookmark.url);

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