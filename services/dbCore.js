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
