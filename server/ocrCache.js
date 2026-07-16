import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'ocr-cache.json');

const ensureCacheDir = () => {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
};

const loadCache = () => {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
};

const saveCache = (cache) => {
  try {
    ensureCacheDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  } catch {
    /* ignore disk full / permissions */
  }
};

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export const getCachedOcr = (contentHash) => {
  const cache = loadCache();
  return cache[contentHash] || null;
};

export const setCachedOcr = (contentHash, value) => {
  const cache = loadCache();
  cache[contentHash] = {
    ...value,
    cachedAt: new Date().toISOString(),
  };
  // Keep cache bounded (~500 entries)
  const keys = Object.keys(cache);
  if (keys.length > 500) {
    keys
      .sort((a, b) => String(cache[a].cachedAt || '').localeCompare(String(cache[b].cachedAt || '')))
      .slice(0, keys.length - 500)
      .forEach((k) => delete cache[k]);
  }
  saveCache(cache);
};
