import '../vendor/dexie.js';

const db = new Dexie('myDatabase');
db.version(1).stores({
  folders: '++id, &name',
  icons: '++id, base64',
  bookmarks: '++id, title, url, folderId, iconId'
});

// Add a bookmark with a new icon
export async function addBookmarkWithIcon(title, url, folderId, base64) {
  try {
    return await db.transaction('rw', db.icons, db.bookmarks, async () => {
      const iconId = await db.icons.add({ base64 });

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

function getFolderBookmarkCollection(folderId = null) {
  return folderId === null
    ? db.bookmarks.orderBy('id').reverse()
    : db.bookmarks.where('folderId').equals(folderId);
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

export async function countBookmarks(folderId = null) {
  try {
    return await db.transaction('r', db.bookmarks, async () => {
      return folderId === null
        ? await db.bookmarks.count()
        : await db.bookmarks.where('folderId').equals(folderId).count();
    });
  } catch (error) {
    console.error('Error counting bookmarks:', error);
    throw error;
  }
}

export async function listBookmarksPageWithIcons(folderId = null, offset = 0, limit = 40) {
  try {
    const safeOffset = toSafePageNumber(offset, 0);
    const safeLimit = Math.max(1, toSafePageNumber(limit, 40));

    return await db.transaction('r', db.bookmarks, db.icons, async () => {
      const bookmarks = await getFolderBookmarkCollection(folderId)
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

export async function searchBookmarksPage(query, folderId = null, offset = 0, limit = 40) {
  try {
    const normalizedQuery = (query ?? '').trim().toLowerCase();

    if (!normalizedQuery) {
      const [items, total] = await Promise.all([
        listBookmarksPageWithIcons(folderId, offset, limit),
        countBookmarks(folderId)
      ]);

      return { items, total };
    }

    const safeOffset = toSafePageNumber(offset, 0);
    const safeLimit = Math.max(1, toSafePageNumber(limit, 40));
    const filter = createSearchFilter(normalizedQuery);

    return await db.transaction('r', db.bookmarks, db.icons, async () => {
      const total = await getFolderBookmarkCollection(folderId)
        .filter(filter)
        .count();

      const bookmarks = await getFolderBookmarkCollection(folderId)
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

export async function saveOrUpdateBookmarkByUrl(title, url, folderId, base64) {
  try {
    return await db.transaction('rw', db.bookmarks, db.icons, async () => {
      const bookmark = await db.bookmarks
        .where('url')
        .equals(url)
        .first();

      if (!bookmark) {
        const iconId = await db.icons.add({ base64 });
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

      if (base64) {
        if (iconId) {
          await db.icons.update(iconId, { base64 });
        } else {
          iconId = await db.icons.add({ base64 });
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

function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

export async function createFolder(name) {
  try {
    const normalizedName = normalizeFolderName(name);

    if (!normalizedName) {
      throw new Error('Folder name is required.');
    }

    const existing = await db.folders
      .where('name')
      .equalsIgnoreCase(normalizedName)
      .first();

    if (existing) {
      throw new Error('A folder with this name already exists.');
    }

    const folderId = await db.folders.add({ name: normalizedName });

    return {
      id: folderId,
      name: normalizedName,
      bookmarkCount: 0
    };
  } catch (error) {
    console.error('Error creating folder:', error);
    throw error;
  }
}

export async function listFolders() {
  try {
    return await db.transaction('r', db.folders, db.bookmarks, async () => {
      const folders = await db.folders.toArray();

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
    if (folderId === null || folderId === undefined) {
      return null;
    }

    const parsedFolderId = Number(folderId);

    if (!Number.isInteger(parsedFolderId)) {
      throw new Error('Invalid folder id.');
    }

    return await db.folders.get(parsedFolderId);
  } catch (error) {
    console.error('Error getting folder by id:', error);
    throw error;
  }
}

export async function renameFolder(folderId, newName) {
  try {
    const parsedFolderId = Number(folderId);
    const normalizedName = normalizeFolderName(newName);

    if (!Number.isInteger(parsedFolderId)) {
      throw new Error('Invalid folder id.');
    }

    if (!normalizedName) {
      throw new Error('Folder name is required.');
    }

    return await db.transaction('rw', db.folders, async () => {
      const current = await db.folders.get(parsedFolderId);

      if (!current) {
        throw new Error('Folder not found.');
      }

      const existing = await db.folders
        .where('name')
        .equalsIgnoreCase(normalizedName)
        .first();

      if (existing && existing.id !== parsedFolderId) {
        throw new Error('A folder with this name already exists.');
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
    const parsedFolderId = Number(folderId);

    if (!Number.isInteger(parsedFolderId)) {
      throw new Error('Invalid folder id.');
    }

    const parsedMoveFolderId = moveBookmarksTo === null || moveBookmarksTo === undefined
      ? null
      : Number(moveBookmarksTo);

    if (parsedMoveFolderId !== null && !Number.isInteger(parsedMoveFolderId)) {
      throw new Error('Invalid destination folder id.');
    }

    if (parsedMoveFolderId !== null && parsedMoveFolderId === parsedFolderId) {
      throw new Error('Destination folder cannot be the same folder.');
    }

    return await db.transaction('rw', db.folders, db.bookmarks, async () => {
      const folder = await db.folders.get(parsedFolderId);

      if (!folder) {
        return false;
      }

      if (parsedMoveFolderId !== null) {
        const destination = await db.folders.get(parsedMoveFolderId);

        if (!destination) {
          throw new Error('Destination folder not found.');
        }

        await db.bookmarks
          .where('folderId')
          .equals(parsedFolderId)
          .modify({ folderId: parsedMoveFolderId });
      } else {
        await db.bookmarks
          .where('folderId')
          .equals(parsedFolderId)
          .modify({ folderId: null });
      }

      await db.folders.delete(parsedFolderId);

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
        version: 1,
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
    const parsedPayload = typeof payload === 'string'
      ? JSON.parse(payload)
      : payload;

    const data = parsedPayload?.data ?? parsedPayload;

    const folders = ensureArray(data?.folders, 'folders')
      .map((folder) => ({
        id: Number(folder.id),
        name: normalizeFolderName(folder.name)
      }))
      .filter((folder) => Number.isInteger(folder.id) && folder.name);

    const icons = ensureArray(data?.icons, 'icons')
      .map((icon) => ({
        id: Number(icon.id),
        base64: String(icon.base64 ?? '')
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