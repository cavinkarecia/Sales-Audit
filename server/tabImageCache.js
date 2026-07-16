import { extractMediaFromXlsxBuffer, DEFAULT_SHEET_FETCH_HEADERS } from './xlsxMediaExtract.js';

const CACHE_TTL_MS = 45 * 60 * 1000;
const CACHE_MAX_TABS = 8;
const cache = new Map();

const cacheKey = (spreadsheetId, gid) => `${spreadsheetId}:${gid}`;

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

export const getEmbeddedImage = (spreadsheetId, gid, index) => {
  const entry = cache.get(cacheKey(spreadsheetId, gid));
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
  const key = cacheKey(spreadsheetId, gid);
  const existing = cache.get(key);
  if (existing && Date.now() - existing.at < CACHE_TTL_MS) {
    return existing;
  }

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx&gid=${gid}`;
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
  };
  cache.set(key, entry);
  pruneCache();
  return entry;
};

export const buildEmbeddedImageUrls = (spreadsheetId, gid, count) =>
  Array.from({ length: count }, (_, i) =>
    `/api/sheet/embedded-image?id=${encodeURIComponent(spreadsheetId)}&gid=${encodeURIComponent(gid)}&i=${i}`,
  );
