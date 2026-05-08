import type { BookmarkImportItem } from '../types';

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function getChromeBookmarkTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((nodes) => {
      const runtimeError = chrome.runtime?.lastError;

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(nodes || []);
    });
  });
}

export function flattenChromeBookmarkTree(nodes: chrome.bookmarks.BookmarkTreeNode[]): BookmarkImportItem[] {
  const result: BookmarkImportItem[] = [];

  function walk(currentNodes: chrome.bookmarks.BookmarkTreeNode[], folderPath: string[]) {
    (currentNodes || []).forEach((node) => {
      const isBookmark = !!node.url;
      const label = (node.title || '').trim();

      if (isBookmark) {
        result.push({
          title: label || node.url,
          url: node.url,
          folderPath: folderPath.join(' / ')
        });
        return;
      }

      const nextPath = label ? [...folderPath, label] : folderPath;
      walk(node.children || [], nextPath);
    });
  }

  walk(nodes, []);

  return result;
}

export function parseBookmarkJsonImport(raw: unknown): BookmarkImportItem[] {
  const rawObject = raw as { bookmarks?: unknown[] } | null;
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(rawObject?.bookmarks)
      ? rawObject.bookmarks
      : null;

  if (!items) {
    throw new Error('Bookmark JSON must be an array or contain a bookmarks array.');
  }

  return items
    .map((item) => ({
      title: String(item.title ?? '').trim(),
      url: String(item.url ?? '').trim(),
      folderPath: String(item.folderPath ?? item.folder ?? '').trim()
    }))
    .filter((item) => item.url);
}

export function parseNetscapeBookmarkHtml(html: string): BookmarkImportItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const rootDl = doc.querySelector('dl');

  if (!rootDl) {
    throw new Error('Netscape bookmark file does not contain a DL root.');
  }

  const result: BookmarkImportItem[] = [];

  function getDirectChildByTag(parent: Element, tagName: string): Element | null {
    const upper = tagName.toUpperCase();

    for (const child of Array.from(parent.children)) {
      if (child.tagName === upper) {
        return child;
      }
    }

    return null;
  }

  function walkDl(dl: Element, folderPath: string[]) {
    const children = Array.from(dl.children);

    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];

      if (child.tagName !== 'DT') {
        continue;
      }

      const h3 = getDirectChildByTag(child, 'H3');
      const link = getDirectChildByTag(child, 'A');
      let nestedDl = getDirectChildByTag(child, 'DL');

      if (!nestedDl) {
        const nextSibling = children[index + 1];
        if (nextSibling?.tagName === 'DL') {
          nestedDl = nextSibling;
        }
      }

      if (link) {
        const url = String(link.getAttribute('href') ?? '').trim();

        if (url) {
          result.push({
            title: String(link.textContent ?? '').trim() || url,
            url,
            folderPath: folderPath.join(' / ')
          });
        }
      }

      if (h3 && nestedDl) {
        const folderName = String(h3.textContent ?? '').trim();
        const nextPath = folderName ? [...folderPath, folderName] : folderPath;
        walkDl(nestedDl, nextPath);
      }
    }
  }

  walkDl(rootDl, []);

  return result;
}

export function folderMapKey(parentId: string | null, name: string): string {
  return `${parentId === null ? 'root' : parentId}:${name.toLowerCase()}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}
