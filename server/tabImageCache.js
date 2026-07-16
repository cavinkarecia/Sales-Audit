import { extractMediaFromXlsxBuffer, DEFAULT_SHEET_FETCH_HEADERS } from './xlsxMediaExtract.js';

const CACHE_TTL_MS = 45 * 60 * 1000;
const CACHE_MAX_TABS = 12;
const cache = new Map();

const cacheKey = (spreadsheetId, gid) => `${spreadsheetId}:${gid}`;

const runPool = async (items, worker, concurrency = 4) => {
  if (!items.length) return [];
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
};

const pruneCache = () => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.at > CACHE_TTL_MS) cache.delete(key);
  }
  while (cache.size > CACHE_MAX_TABS) {
    const oldestKey = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

export const getEmbeddedImage = (spreadsheetId, gid) => {
  const entry = cache.get(cacheKey(spreadsheetId, gid));
  if (!entry) return null;
  return entry;
};

export const getEmbeddedImageAt = (spreadsheetId, gid, index) => {
  const entry = getEmbeddedImage(spreadsheetId, gid);
  if (!entry) return null;
  const image = entry.images[index];
  if (!image) return null;
  return { mime: image.mime, data: image.data };
};

export const loadTabImagesFromXlsx = async (
  spreadsheetId,
  gid,
  fetchHeaders = DEFAULT_SHEET_FETCH_HEADERS,
) => {
  const cleanGid = String(gid || '0').replace(/\D/g, '') || '0';
  const key = cacheKey(spreadsheetId, cleanGid);
  const existing = cache.get(key);
  if (existing && Date.now() - existing.at < CACHE_TTL_MS) {
    return existing;
  }

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx&gid=${cleanGid}`;
  const resp = await fetch(url, { redirect: 'follow', headers: fetchHeaders });
  if (!resp.ok) {
    throw new Error(`XLSX export HTTP ${resp.status}`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  const images = extractMediaFromXlsxBuffer(buffer);
  const entry = {
    images,
    at: Date.now(),
    source: 'xlsx',
    byteSize: buffer.length,
    gid: cleanGid,
  };
  cache.set(key, entry);
  pruneCache();
  return entry;
};

/** Preload XLSX exports for many tabs in parallel (one download per gid). */
export const loadTabImagesBatch = async (
  spreadsheetId,
  gids,
  fetchHeaders = DEFAULT_SHEET_FETCH_HEADERS,
  concurrency = 2,
) => {
  const uniq = [...new Set((gids || []).map((g) => String(g || '0').replace(/\D/g, '') || '0'))];
  // Cap batch size so one HTTP request cannot download dozens of multi-MB XLSX files.
  const limited = uniq.slice(0, 6);
  await runPool(
    limited,
    async (gid) => {
      try {
        await loadTabImagesFromXlsx(spreadsheetId, gid, fetchHeaders);
      } catch {
        /* tab may have no export */
      }
      return gid;
    },
    concurrency,
  );

  const byGid = {};
  for (const gid of uniq) {
    const entry = cache.get(cacheKey(spreadsheetId, gid));
    byGid[gid] = entry
      ? buildEmbeddedImageUrls(spreadsheetId, gid, entry.images.length)
      : [];
  }
  return byGid;
};

export const buildEmbeddedImageUrls = (spreadsheetId, gid, count) =>
  Array.from({ length: count }, (_, i) =>
    `/api/sheet/embedded-image?id=${encodeURIComponent(spreadsheetId)}&gid=${encodeURIComponent(gid)}&i=${i}`,
  );

export const parseEmbeddedImageUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw.includes('/api/sheet/embedded-image')) return null;
  const parsed = new URL(raw, 'http://local');
  return {
    id: parsed.searchParams.get('id') || '',
    gid: parsed.searchParams.get('gid') || '0',
    index: Number.parseInt(parsed.searchParams.get('i') || '0', 10),
  };
};

/** Drop in-memory XLSX image buffers (call on Hard Refresh). */
export const clearTabImageCache = () => {
  cache.clear();
  return { cleared: true };
};

export { DEFAULT_SHEET_FETCH_HEADERS };
