import { db } from './dbCore';
import { ulid } from 'ulid';

import { ensureIconHash, fetchUrlAsIconPayload, isDataUri, isGoogleFaviconUrl, isHttpUrl, normalizeIconHash, normalizeIconPayload, resolveBookmarkIconPayload } from './iconService';
import { BookmarkRecord, NormalizeIconsProgress, NormalizeIconsSummary } from '../types';

//TODO: DRY Refactor

function isNonEmptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

  const normalized = String(folderId).trim();
  return normalized || null;
}

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

/////////////////////////////////////
/////// Database Maintenance ////////
/////////////////////////////////////

export async function exportDatabase() {
  try {
    return await db.transaction('r', db.folders, db.icons, db.bookmarks, async () => {
      const folders = (await db.folders.toArray()).map(normalizeFolderRecord);
      const iconRows = await db.icons.toArray();
      const bookmarks = (await db.bookmarks.toArray()).map(normalizeBookmarkRecord);

      const icons = (await Promise.all(
        iconRows.map(async (icon) => {
          if (!icon || !isNonEmptyId(icon.id)) {
            return null;
          }

          const data = String(icon.data ?? '');
          const hash = await ensureIconHash(data, icon.hash ?? '');

          return {
            id: String(icon.id),
            data,
            hash: String(hash ?? '')
          };
        })
      )).filter(Boolean);

      return {
        version: 6,
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
    const now = Date.now();
    const parsedPayload = typeof payload === 'string'
      ? JSON.parse(payload)
      : payload;

    const data = parsedPayload?.data ?? parsedPayload;

    const folderInputs = Array.isArray(data?.folders) ? data.folders : [];
    const folders = folderInputs
      .map((folder) => ({
        id: String(folder.id ?? '').trim() || ulid(),
        name: folder.name,
        parentId: folder.parentId === null || folder.parentId === undefined
          ? null
          : folder.parentId,
        createdAt: normalizeTimestamp(folder.createdAt, now),
        updatedAt: normalizeTimestamp(folder.updatedAt, now),
        customOrder: normalizeCustomOrder(folder.customOrder, 0)
      }))
      .filter((folder) => isNonEmptyId(folder.id) && folder.name);

    const folderIds = new Set(folders.map((folder) => folder.id));

    folders.forEach((folder) => {
      if (!folder.parentId || !folderIds.has(folder.parentId)) {
        folder.parentId = null;
      }

      folder.createdAt = normalizeTimestamp(folder.createdAt, now);
      folder.updatedAt = normalizeTimestamp(folder.updatedAt, folder.createdAt);
      folder.customOrder = normalizeCustomOrder(folder.customOrder, 0);
    });

    const iconInputs = Array.isArray(data?.icons) ? data.icons : [];
    const icons = iconInputs
      .map((icon) => ({
        id: String(icon.id ?? '').trim() || ulid(),
        data: String(icon.data ?? icon.base64 ?? ''),//ToOD: Remove Base64
        hash: String(icon.hash ?? '')
      }))
      .filter((icon) => isNonEmptyId(icon.id));

    const validFolderIds = new Set(folders.map((folder) => folder.id));
    const validIconIds = new Set(icons.map((icon) => icon.id));

    const bookmarkInputs = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
    const bookmarks = bookmarkInputs
      .map((bookmark) => {
        const id = String(bookmark.id ?? '').trim() || ulid();
        const folderId = bookmark.folderId === null || bookmark.folderId === undefined
          ? null
          : bookmark.folderId;
        const iconId = bookmark.iconId === null || bookmark.iconId === undefined
          ? null
          : bookmark.iconId;

        return {
          id,
          title: String(bookmark.title ?? ''),
          url: String(bookmark.url ?? ''),
          folderId: folderId && validFolderIds.has(folderId) ? folderId : null,
          iconId: iconId && validIconIds.has(iconId) ? iconId : null,
          createdAt: normalizeTimestamp(bookmark.createdAt, now),
          updatedAt: normalizeTimestamp(bookmark.updatedAt, now),
          lastClickedAt: normalizeNullableTimestamp(bookmark.lastClickedAt),
          customOrder: normalizeCustomOrder(bookmark.customOrder, 0)
        };
      })
      .filter((bookmark) => isNonEmptyId(bookmark.id) && bookmark.url);

    bookmarks.forEach((bookmark) => {
      bookmark.createdAt = normalizeTimestamp(bookmark.createdAt, now);
      bookmark.updatedAt = normalizeTimestamp(bookmark.updatedAt, bookmark.createdAt);
      bookmark.lastClickedAt = normalizeNullableTimestamp(bookmark.lastClickedAt);
      bookmark.customOrder = normalizeCustomOrder(bookmark.customOrder, 0);
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

export async function normalizeLegacyIconsToBase64(options: { onProgress?: ((progress: NormalizeIconsProgress) => void) | null; storageMode?: 'base64' | 'url' } = {}): Promise<NormalizeIconsSummary> {
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
  const storageMode = options?.storageMode === 'url' ? 'url' : 'base64';
  const icons = (await db.icons.toArray());
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
    if (!isNonEmptyId(bookmark.iconId)) {
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
        .filter((iconId) => isNonEmptyId(iconId))
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
