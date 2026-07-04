const GEOCODE_CACHE_KEY = 'sales_audit_geocode_cache_v1';

const readCache = () => {
  try {
    const raw = localStorage.getItem(GEOCODE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeCache = (cache) => {
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota */
  }
};

const cacheKey = (town, state, pincode) =>
  `${String(pincode || '').trim()}|${String(town || '').trim().toLowerCase()}|${String(state || '').trim().toLowerCase()}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve town coordinates via backend Nominatim proxy (state-aware).
 * Results are cached in localStorage. Future pincode column is supported when present.
 */
export const geocodeTownOnline = async (town, state, pincode = '') => {
  const key = cacheKey(town, state, pincode);
  const cache = readCache();
  if (cache[key]) return { ...cache[key], source: 'cache' };

  const params = new URLSearchParams();
  if (pincode) params.set('pincode', String(pincode).trim());
  if (town) params.set('town', String(town).trim());
  if (state) params.set('state', String(state).trim());

  try {
    const res = await fetch(`/api/geocode?${params.toString()}`);
    if (!res.ok) return { mapped: false, rawTown: town, rawState: state };
    const data = await res.json();
    if (data.mapped) {
      cache[key] = data;
      writeCache(cache);
    }
    return data;
  } catch {
    return { mapped: false, rawTown: town, rawState: state };
  }
};

/** Resolve many unique town/state pairs with polite pacing (Nominatim rate limits). */
export const geocodeTownsBatch = async (entries, onProgress) => {
  const results = new Map();
  const unique = [];
  const seen = new Set();

  for (const { town, state, pincode } of entries) {
    const k = cacheKey(town, state, pincode);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push({ town, state, pincode, key: k });
  }

  for (let i = 0; i < unique.length; i += 1) {
    const { town, state, pincode, key } = unique[i];
    const hit = await geocodeTownOnline(town, state, pincode);
    results.set(key, hit);
    if (onProgress) onProgress(i + 1, unique.length);
    if (i < unique.length - 1) await sleep(350);
  }

  return results;
};
