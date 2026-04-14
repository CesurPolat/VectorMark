import '../vendor/dexie.js';

export const db = new Dexie('myDatabase');

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

db.version(4)
  .stores({
    folders: '++id, name, parentId, &[parentId+name]',
    icons: '++id, data, hash',
    bookmarks: '++id, title, url, folderId, iconId'
  })
  .upgrade(async (tx) => {
    await tx.table('icons').toCollection().modify((icon) => {
      icon.data = String(icon.data ?? icon.base64 ?? '');
      icon.hash = String(icon.hash ?? '').trim();
      delete icon.base64;
    });
  });

db.version(5)
  .stores({
    folders: '++id, name, parentId, createdAt, updatedAt, customOrder, &[parentId+name]',
    icons: '++id, data, hash',
    bookmarks: '++id, title, url, folderId, iconId, createdAt, updatedAt, lastClickedAt, customOrder'
  })
  .upgrade(async (tx) => {
    const now = Date.now();

    await tx.table('folders').toCollection().modify((folder) => {
      const createdAt = Number(folder.createdAt);
      const updatedAt = Number(folder.updatedAt);
      const customOrder = Number(folder.customOrder);

      folder.createdAt = Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : now;
      folder.updatedAt = Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : folder.createdAt;
      folder.customOrder = Number.isFinite(customOrder) ? Math.floor(customOrder) : Number(folder.id) || 0;
      folder.parentId = folder.parentId === null || folder.parentId === undefined ? null : Number(folder.parentId);

      if (!Number.isInteger(folder.parentId) || folder.parentId <= 0) {
        folder.parentId = null;
      }
    });

    await tx.table('bookmarks').toCollection().modify((bookmark) => {
      const createdAt = Number(bookmark.createdAt);
      const updatedAt = Number(bookmark.updatedAt);
      const lastClickedAt = Number(bookmark.lastClickedAt);
      const customOrder = Number(bookmark.customOrder);

      bookmark.createdAt = Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : now;
      bookmark.updatedAt = Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : bookmark.createdAt;
      bookmark.lastClickedAt = Number.isFinite(lastClickedAt) && lastClickedAt > 0 ? Math.floor(lastClickedAt) : null;
      bookmark.customOrder = Number.isFinite(customOrder) ? Math.floor(customOrder) : Number(bookmark.id) || 0;
      bookmark.folderId = bookmark.folderId === null || bookmark.folderId === undefined ? null : Number(bookmark.folderId);

      if (!Number.isInteger(bookmark.folderId) || bookmark.folderId <= 0) {
        bookmark.folderId = null;
      }
    });
  });
