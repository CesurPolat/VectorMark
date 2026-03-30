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