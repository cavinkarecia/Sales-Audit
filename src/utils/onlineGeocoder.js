import {
  geocodeCacheKey,
  geocodeOnlineMulti,
  geocodeWithPhoton,
  sanitizeTownInput,
} from './geocodeProviders.js';

const GEOCODE_CACHE_KEY = 'sales_audit_geocode_cache_v2';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve town coordinates via server proxy, then direct Photon fallback.
 * Results cached in localStorage.
 */
export const geocodeTownOnline = async (town, state, pincode = '') => {
  const key = geocodeCacheKey(town, state, pincode);
  const cache = readCache();
  if (cache[key]?.mapped) return { ...cache[key], source: cache[key].source || 'cache' };

  const cleanTown = sanitizeTownInput(town);
  if (!cleanTown && !/^\d{6}$/.test(String(pincode || '').trim())) {
    return { mapped: false, rawTown: town, rawState: state };
  }

  const params = new URLSearchParams();
  if (pincode) params.set('pincode', String(pincode).trim());
  if (cleanTown) params.set('town', cleanTown);
  if (state) params.set('state', String(state).trim());

  let result = { mapped: false, rawTown: town, rawState: state };

  try {
    const res = await fetch(`/api/geocode?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.mapped) result = data;
    }
  } catch {
    /* server unavailable */
  }

  if (!result.mapped) {
    result = await geocodeWithPhoton(cleanTown || town, state, pincode);
  }

  if (result.mapped) {
    cache[key] = result;
    writeCache(cache);
  }

  return result;
};

/** Resolve many unique town/state pairs with polite pacing. */
export const geocodeTownsBatch = async (entries, onProgress) => {
  const results = new Map();
  const unique = [];
  const seen = new Set();

  for (const { town, state, pincode } of entries) {
    const k = geocodeCacheKey(town, state, pincode);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push({ town, state, pincode, key: k });
  }

  for (let i = 0; i < unique.length; i += 1) {
    const { town, state, pincode, key } = unique[i];
    const hit = await geocodeTownOnline(town, state, pincode);
    results.set(key, hit);
    if (onProgress) onProgress(i + 1, unique.length);
    if (i < unique.length - 1) await sleep(250);
  }

  return results;
};

export { geocodeCacheKey };
