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

function normalizeIconData(icon) {
  if (!icon) {
    return null;
  }

  return {
    ...icon,
    data: String(icon.data ?? icon.base64 ?? ''),
    hash: String(icon.hash ?? '')
  };
}

function normalizeIconPayload(data) {
  const value = String(data ?? '').trim();
  return value || null;
}

function normalizeIconHash(hash) {
  const value = String(hash ?? '').trim();
  return value || null;
}

function normalizeIconInput(icon) {
  if (icon === null || icon === undefined) {
    return null;
  }

  if (typeof icon === 'string') {
    const data = normalizeIconPayload(icon);
    return data ? { data, hash: null } : null;
  }

  const data = normalizeIconPayload(icon.data);

  if (!data) {
    return null;
  }

  return {
    data,
    hash: normalizeIconHash(icon.hash)
  };
}

const ICON_FETCH_TIMEOUT_MS = 7000;
const GOOGLE_FAVICON_MIN_INTERVAL_MS = 180;
let lastGoogleFaviconFetchAt = 0;

function isDataUri(value) {
  return /^data:/i.test(String(value ?? '').trim());
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

function extractHostnameFromUrl(value) {
  try {
    const parsed = new URL(String(value ?? '').trim());
    return parsed.hostname ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function extractDomainFromGoogleFaviconUrl(value) {
  try {
    const parsed = new URL(String(value ?? '').trim());

    if (parsed.hostname !== 'www.google.com' || parsed.pathname !== '/s2/favicons') {
      return null;
    }

    const rawDomain = String(parsed.searchParams.get('domain_url') ?? '').trim();

    if (!rawDomain) {
      return null;
    }

    if (/^https?:\/\//i.test(rawDomain)) {
      return extractHostnameFromUrl(rawDomain);
    }

    return rawDomain.toLowerCase();
  } catch {
    return null;
  }
}

      function getIconDomainKey(pageUrl, iconUrl = '') {
        const pageHost = extractHostnameFromUrl(pageUrl);

        if (pageHost) {
          return pageHost;
        }

        const googleDomain = extractDomainFromGoogleFaviconUrl(iconUrl);

        if (googleDomain) {
          return googleDomain;
        }

        return extractHostnameFromUrl(iconUrl);
      }

      function isGoogleFaviconUrl(url) {
        try {
          const parsed = new URL(String(url ?? '').trim());
          return parsed.hostname === 'www.google.com' && parsed.pathname === '/s2/favicons';
        } catch {
          return false;
        }
      }

      async function sleep(ms) {
        if (!Number.isFinite(ms) || ms <= 0) {
          return;
        }

        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, ms);
        });
      }

      async function throttleGoogleFaviconFetch() {
        const now = Date.now();
        const elapsed = now - lastGoogleFaviconFetchAt;
        const waitMs = GOOGLE_FAVICON_MIN_INTERVAL_MS - elapsed;

        if (waitMs > 0) {
          await sleep(waitMs);
        }

        lastGoogleFaviconFetchAt = Date.now();
      }

      function buildGoogleFaviconUrl(pageUrl) {
        try {
          const parsed = new URL(String(pageUrl ?? '').trim());

          if (!parsed.hostname) {
            return null;
          }

          return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(parsed.hostname)}&sz=64`;
        } catch {
          return null;
        }
      }

      async function blobToDataUrl(blob) {
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();

          reader.onload = () => {
            resolve(typeof reader.result === 'string' ? reader.result : '');
          };

          reader.onerror = () => {
            reject(new Error('Could not convert icon blob to base64.'));
          };

          reader.readAsDataURL(blob);
        });
      }

      function base64ToBytes(base64) {
        const sanitized = String(base64 ?? '').replace(/\s+/g, '');
        const binary = atob(sanitized);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }

        return bytes;
      }

      async function sha256Hex(bufferLike) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', bufferLike);
        const bytes = new Uint8Array(hashBuffer);

        return Array.from(bytes)
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      }

      async function hashText(value) {
        const encoded = new TextEncoder().encode(String(value ?? ''));
        return await sha256Hex(encoded);
      }

      async function ensureIconHash(data, currentHash = '') {
        const existingHash = normalizeIconHash(currentHash);

        if (existingHash) {
          return existingHash;
        }

        const normalizedData = normalizeIconPayload(data);

        if (!normalizedData) {
          return '';
        }

        if (isDataUri(normalizedData)) {
          return (await hashFromDataUri(normalizedData)) || '';
        }

        if (isHttpUrl(normalizedData)) {
          // Fallback hash for unreachable URL icons: deterministic and non-empty.
          return await hashText(`url:${normalizedData.toLowerCase()}`);
        }

        return await hashText(normalizedData);
      }

      async function hashFromDataUri(dataUri) {
        try {
          const match = String(dataUri ?? '').match(/^data:([^;,]+)?(;base64)?,(.*)$/i);

          if (!match) {
            return null;
          }

          const isBase64 = !!match[2];
          const payload = match[3] ?? '';

          if (isBase64) {
            const bytes = base64ToBytes(payload);
            return await sha256Hex(bytes);
          }

          const decoded = decodeURIComponent(payload);
          const bytes = new TextEncoder().encode(decoded);
          return await sha256Hex(bytes);
        } catch {
          return null;
        }
      }

      function readHtmlAttribute(tag, attributeName) {
        const pattern = new RegExp(`${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
        const match = String(tag ?? '').match(pattern);

        if (!match) {
          return '';
        }

        return String(match[1] ?? match[2] ?? match[3] ?? '').trim();
      }

      function extractFaviconHrefFromHtml(html, pageUrl) {
        const source = String(html ?? '');
        const linkTagRegex = /<link\b[^>]*>/gi;
        let match = linkTagRegex.exec(source);

        while (match) {
          const tag = match[0];
          const rel = readHtmlAttribute(tag, 'rel').toLowerCase();
          const href = readHtmlAttribute(tag, 'href');

          if (rel.includes('icon') && href) {
            try {
              return new URL(href, pageUrl).href;
            } catch {
              // Continue scanning next link tag.
            }
          }

          match = linkTagRegex.exec(source);
        }

        return null;
      }

      async function findFaviconUrlFromPageHtml(pageUrl) {
        if (!isHttpUrl(pageUrl)) {
          return null;
        }

        const controller = new AbortController();
        const timeoutId = globalThis.setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);

        try {
          const response = await fetch(pageUrl, {
            method: 'GET',
            signal: controller.signal,
            cache: 'force-cache'
          });

          if (!response.ok) {
            return null;
          }

          const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();

          if (contentType && !contentType.includes('text/html')) {
            return null;
          }

          const html = await response.text();
          return extractFaviconHrefFromHtml(html, pageUrl);
        } catch {
          return null;
        } finally {
          globalThis.clearTimeout(timeoutId);
        }
      }

      async function fetchUrlAsIconPayload(url, options = {}) {
        if (!isHttpUrl(url)) {
          return null;
        }

        if (options?.throttleGoogle === true && isGoogleFaviconUrl(url)) {
          await throttleGoogleFaviconFetch();
        }

        const controller = new AbortController();
        const timeoutId = globalThis.setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            cache: 'force-cache'
          });

          if (!response.ok) {
            return null;
          }

          const blob = await response.blob();
          const hash = await sha256Hex(await blob.arrayBuffer());

          if (options?.storageMode === 'url') {
            return {
              data: String(url).trim(),
              hash
            };
          }

          const dataUri = await blobToDataUrl(blob);

          if (!isDataUri(dataUri)) {
            return null;
          }

          return {
            data: dataUri,
            hash
          };
        } catch {
          return null;
        } finally {
          globalThis.clearTimeout(timeoutId);
        }
      }

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

      export async function resolveBookmarkIconPayload(pageUrl, preferredIconUrl = '', options = {}) {
        const preferred = String(preferredIconUrl ?? '').trim();
        const domainCache = options?.domainCache instanceof Map ? options.domainCache : null;
        const domainKey = getIconDomainKey(pageUrl, preferred);
        const storageMode = options?.storageMode === 'url' ? 'url' : 'base64';
        const skipPageHtmlLookup = options?.skipPageHtmlLookup === true;
        const cacheKey = domainKey ? `${storageMode}:${domainKey}` : null;

        if (domainCache && cacheKey && domainCache.has(cacheKey)) {
          return domainCache.get(cacheKey);
        }

        let resolved = null;

        if (isDataUri(preferred)) {
          const hash = await hashFromDataUri(preferred);
          resolved = {
            data: preferred,
            hash
          };
        }

        if (!resolved && isHttpUrl(preferred)) {
          resolved = await fetchUrlAsIconPayload(preferred, { storageMode });
        }

        if (!resolved && !skipPageHtmlLookup) {
          const htmlDiscoveredFaviconUrl = await findFaviconUrlFromPageHtml(pageUrl);

          if (htmlDiscoveredFaviconUrl) {
            resolved = await fetchUrlAsIconPayload(htmlDiscoveredFaviconUrl, { storageMode });
          }
        }

        if (!resolved) {
          const googleFaviconUrl = buildGoogleFaviconUrl(pageUrl);

          if (googleFaviconUrl) {
            resolved = await fetchUrlAsIconPayload(googleFaviconUrl, {
              throttleGoogle: true,
              storageMode
            });
          }
        }

        const output = resolved || null;

        if (output?.data) {
          output.hash = await ensureIconHash(output.data, output.hash);
        }

        if (domainCache && cacheKey) {
          domainCache.set(cacheKey, output);
        }

        return output;
      }

      export async function resolveBookmarkIconData(pageUrl, preferredIconUrl = '', options = {}) {
        const payload = await resolveBookmarkIconPayload(pageUrl, preferredIconUrl, options);
        return payload?.data ?? null;
      }

      // Add a bookmark with a new icon
      export async function addBookmarkWithIcon(title, url, folderId, data) {
        try {
          return await db.transaction('rw', db.icons, db.bookmarks, async () => {
            const iconId = await getOrCreateIconId(data);

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
      const normalizedIcon = normalizeIconInput(data);
      const bookmark = await db.bookmarks
        .where('url')
        .equals(url)
        .first();

      if (!bookmark) {
        const iconId = await getOrCreateIconId(normalizedIcon);
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
        title
      };

      if (iconId) {
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
      const iconRows = await db.icons.toArray();
      const bookmarks = await db.bookmarks.toArray();

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
        version: 4,
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