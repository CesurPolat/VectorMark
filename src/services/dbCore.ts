import Dexie from 'dexie';
import { ulid } from 'ulid';
import type { BookmarkRecord, FolderRecord, IconRow } from '../types';

const DB_NAME = 'myDatabaseV2';
const LEGACY_DB_NAME = 'myDatabase';

type LegacyFolderRow = {
  id?: number;
  name?: string;
  parentId?: number | null;
  createdAt?: number;
  updatedAt?: number;
  customOrder?: number;
};

type LegacyIconRow = {
  id?: number;
  data?: string;
  hash?: string;
  base64?: string;
};

type LegacyBookmarkRow = {
  id?: number;
  title?: string;
  url?: string;
  folderId?: number | null;
  iconId?: number | null;
  createdAt?: number;
  updatedAt?: number;
  lastClickedAt?: number | null;
  customOrder?: number;
};

export interface VectorMarkDatabase extends Dexie {
  folders: Dexie.Table<FolderRecord, string>;
  icons: Dexie.Table<IconRow, string>;
  bookmarks: Dexie.Table<BookmarkRecord, string>;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeNullableTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function normalizeCustomOrder(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function normalizeLegacyString(value: unknown): string {
  return String(value ?? '').trim();
}

function createLegacyDb(): Dexie {
  const legacyDb = new Dexie(LEGACY_DB_NAME);

  legacyDb.version(5).stores({
    folders: '++id, name, parentId, createdAt, updatedAt, customOrder, &[parentId+name]',
    icons: '++id, data, hash',
    bookmarks: '++id, title, url, folderId, iconId, createdAt, updatedAt, lastClickedAt, customOrder'
  });

  return legacyDb;
}

async function migrateLegacyNumericDb(targetDb: VectorMarkDatabase): Promise<void> {
  const hasLegacyDb = await Dexie.exists(LEGACY_DB_NAME);

  if (!hasLegacyDb) {
    return;
  }

  const currentCounts = await Promise.all([
    targetDb.folders.count(),
    targetDb.icons.count(),
    targetDb.bookmarks.count()
  ]);

  if (currentCounts.some((count) => count > 0)) {
    return;
  }

  const legacyDb = createLegacyDb();

  try {
    await legacyDb.open();

    const [legacyFolders, legacyIcons, legacyBookmarks] = await Promise.all([
      legacyDb.table<LegacyFolderRow, number>('folders').toArray(),
      legacyDb.table<LegacyIconRow, number>('icons').toArray(),
      legacyDb.table<LegacyBookmarkRow, number>('bookmarks').toArray()
    ]);

    if (legacyFolders.length === 0 && legacyIcons.length === 0 && legacyBookmarks.length === 0) {
      return;
    }

    const now = Date.now();
    const folderIdMap = new Map<number, string>();
    const iconIdMap = new Map<number, string>();

    legacyFolders.forEach((folder) => {
      if (Number.isInteger(folder.id)) {
        folderIdMap.set(Number(folder.id), ulid());
      }
    });

    legacyIcons.forEach((icon) => {
      if (Number.isInteger(icon.id)) {
        iconIdMap.set(Number(icon.id), ulid());
      }
    });

    const folders: FolderRecord[] = legacyFolders
      .filter((folder) => Number.isInteger(folder.id))
      .map((folder) => {
        const createdAt = normalizeTimestamp(folder.createdAt, now);
        return {
          id: folderIdMap.get(Number(folder.id)) || ulid(),
          name: normalizeLegacyString(folder.name),
          parentId: Number.isInteger(folder.parentId ?? NaN)
            ? folderIdMap.get(Number(folder.parentId)) || null
            : null,
          createdAt,
          updatedAt: normalizeTimestamp(folder.updatedAt, createdAt),
          customOrder: normalizeCustomOrder(folder.customOrder, 0)
        };
      })
      .filter((folder) => folder.name);

    const icons: IconRow[] = legacyIcons
      .filter((icon) => Number.isInteger(icon.id))
      .map((icon) => ({
        id: iconIdMap.get(Number(icon.id)) || ulid(),
        data: normalizeLegacyString(icon.data ?? icon.base64),
        hash: normalizeLegacyString(icon.hash)
      }));

    const validFolderIds = new Set(folders.map((folder) => folder.id));
    const validIconIds = new Set(icons.map((icon) => icon.id));

    const bookmarks: BookmarkRecord[] = legacyBookmarks
      .filter((bookmark) => normalizeLegacyString(bookmark.url))
      .map((bookmark) => {
        const createdAt = normalizeTimestamp(bookmark.createdAt, now);
        const mappedFolderId = Number.isInteger(bookmark.folderId ?? NaN)
          ? folderIdMap.get(Number(bookmark.folderId))
          : null;
        const mappedIconId = Number.isInteger(bookmark.iconId ?? NaN)
          ? iconIdMap.get(Number(bookmark.iconId))
          : null;

        return {
          id: ulid(),
          title: normalizeLegacyString(bookmark.title) || normalizeLegacyString(bookmark.url),
          url: normalizeLegacyString(bookmark.url),
          folderId: mappedFolderId && validFolderIds.has(mappedFolderId) ? mappedFolderId : null,
          iconId: mappedIconId && validIconIds.has(mappedIconId) ? mappedIconId : null,
          createdAt,
          updatedAt: normalizeTimestamp(bookmark.updatedAt, createdAt),
          lastClickedAt: normalizeNullableTimestamp(bookmark.lastClickedAt),
          customOrder: normalizeCustomOrder(bookmark.customOrder, 0)
        };
      });

    await targetDb.transaction('rw', targetDb.folders, targetDb.icons, targetDb.bookmarks, async () => {
      if (folders.length > 0) {
        await targetDb.folders.bulkAdd(folders);
      }

      if (icons.length > 0) {
        await targetDb.icons.bulkAdd(icons);
      }

      if (bookmarks.length > 0) {
        await targetDb.bookmarks.bulkAdd(bookmarks);
      }
    });
  } finally {
    legacyDb.close();
  }
}

export const db = new Dexie(DB_NAME) as VectorMarkDatabase;

db.version(1).stores({
  folders: 'id, name, parentId, createdAt, updatedAt, customOrder, &[parentId+name]',
  icons: 'id, data, hash',
  bookmarks: 'id, title, url, folderId, iconId, createdAt, updatedAt, lastClickedAt, customOrder'
});

db.on('ready', async () => {
  await migrateLegacyNumericDb(db);
});
