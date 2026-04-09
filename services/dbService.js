import * as DexieModule from '../vendor/dexie.js';

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