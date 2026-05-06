import type { IconPayload, IconRow, IconStorageMode } from '../types';

const ICON_FETCH_TIMEOUT_MS = 7000;
const GOOGLE_FAVICON_MIN_INTERVAL_MS = 180;
let lastGoogleFaviconFetchAt = 0;

export function normalizeIconData(icon: IconRow | null | undefined): IconRow | null {
  if (!icon) {
    return null;
  }

  return {
    ...icon,
    data: String(icon.data ?? icon.base64 ?? ''),
    hash: String(icon.hash ?? '')
  };
}

export function normalizeIconPayload(data: unknown): string | null {
  const value = String(data ?? '').trim();
  return value || null;
}

export function normalizeIconHash(hash: unknown): string | null {
  const value = String(hash ?? '').trim();
  return value || null;
}

export function normalizeIconInput(icon: IconPayload | IconRow | string | null | undefined): IconPayload | null {
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

export function isDataUri(value: unknown): boolean {
  return /^data:/i.test(String(value ?? '').trim());
}

export function isHttpUrl(value: unknown): boolean {
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

export function isGoogleFaviconUrl(url: unknown): boolean {
  try {
    const parsed = new URL(String(url ?? '').trim());
    return parsed.hostname === 'www.google.com' && parsed.pathname === '/s2/favicons';
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
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

async function blobToDataUrl(blob: Blob): Promise<string> {
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

async function sha256Hex(bufferLike: BufferSource): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bufferLike);
  const bytes = new Uint8Array(hashBuffer);

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hashText(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(String(value ?? ''));
  return await sha256Hex(encoded);
}

async function hashFromDataUri(dataUri: unknown): Promise<string | null> {
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

export async function ensureIconHash(data: unknown, currentHash = ''): Promise<string> {
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

export async function fetchUrlAsIconPayload(url: unknown, options: { storageMode?: IconStorageMode; throttleGoogle?: boolean } = {}): Promise<IconPayload | null> {
  if (!isHttpUrl(url)) {
    return null;
  }

  if (options?.throttleGoogle === true && isGoogleFaviconUrl(url)) {
    await throttleGoogleFaviconFetch();
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);
  const requestUrl = String(url).trim();

  try {
    const response = await fetch(requestUrl, {
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

export async function resolveBookmarkIconPayload(pageUrl: unknown, preferredIconUrl = '', options: { domainCache?: Map<string, IconPayload | null>; storageMode?: IconStorageMode; skipPageHtmlLookup?: boolean } = {}): Promise<IconPayload | null> {
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

export async function resolveBookmarkIconData(pageUrl: unknown, preferredIconUrl = '', options: { domainCache?: Map<string, IconPayload | null>; storageMode?: IconStorageMode; skipPageHtmlLookup?: boolean } = {}): Promise<string | null> {
  const payload = await resolveBookmarkIconPayload(pageUrl, preferredIconUrl, options);
  return payload?.data ?? null;
}
