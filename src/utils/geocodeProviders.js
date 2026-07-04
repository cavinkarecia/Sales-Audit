/** Canonical Indian state names for geocoding queries. */
import { AUDITOR_BASE_TOWNS } from './knownTownCoords.js';
export const STATE_CANONICAL = {
  'tn': 'Tamil Nadu',
  'tamilnadu': 'Tamil Nadu',
  'tamil nadu': 'Tamil Nadu',
  'ap': 'Andhra Pradesh',
  'andhra': 'Andhra Pradesh',
  'andhrapradesh': 'Andhra Pradesh',
  'andhra pradesh': 'Andhra Pradesh',
  'ts': 'Telangana',
  'telengana': 'Telangana',
  'telangana': 'Telangana',
  'ka': 'Karnataka',
  'kar': 'Karnataka',
  'karnataka': 'Karnataka',
  'kl': 'Kerala',
  'kerala': 'Kerala',
  'mh': 'Maharashtra',
  'maha': 'Maharashtra',
  'maharashtra': 'Maharashtra',
  'gj': 'Gujarat',
  'gujarat': 'Gujarat',
  'mp': 'Madhya Pradesh',
  'madhya pradesh': 'Madhya Pradesh',
  'up': 'Uttar Pradesh',
  'uttar pradesh': 'Uttar Pradesh',
  'uk': 'Uttarakhand',
  'uttarakhand': 'Uttarakhand',
  'rj': 'Rajasthan',
  'rajasthan': 'Rajasthan',
  'pb': 'Punjab',
  'punjab': 'Punjab',
  'hr': 'Haryana',
  'haryana': 'Haryana',
  'wb': 'West Bengal',
  'west bengal': 'West Bengal',
  'jk': 'Jammu and Kashmir',
  'jammu and kashmir': 'Jammu and Kashmir',
  'odisha': 'Odisha',
  'orissa': 'Odisha',
  'cg': 'Chhattisgarh',
  'chattisgarh': 'Chhattisgarh',
  'chhattisgarh': 'Chhattisgarh',
  'jh': 'Jharkhand',
  'jharkhand': 'Jharkhand',
  'br': 'Bihar',
  'bihar': 'Bihar',
  'as': 'Assam',
  'assam': 'Assam',
  'goa': 'Goa',
  'hp': 'Himachal Pradesh',
  'himachal pradesh': 'Himachal Pradesh',
};

export const CLUSTER_TO_STATE = {
  tn: 'Tamil Nadu',
  ap: 'Andhra Pradesh',
  ts: 'Telangana',
  rapt: 'Andhra Pradesh',
  kar: 'Karnataka',
  ka: 'Karnataka',
  kl: 'Kerala',
  mh: 'Maharashtra',
  west: 'Maharashtra',
  gj: 'Gujarat',
  mp: 'Madhya Pradesh',
  up: 'Uttar Pradesh',
  north: 'Uttar Pradesh',
  rj: 'Rajasthan',
  wb: 'West Bengal',
  hr: 'Haryana',
  pb: 'Punjab',
  br: 'Bihar',
  jh: 'Jharkhand',
  cg: 'Chhattisgarh',
  od: 'Odisha',
  as: 'Assam',
  jobc: 'Bihar',
};

const normKey = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');

/** Normalize state from sheet/cluster to canonical name for geocoding. */
export const normalizeStateForGeocode = (state, clusterHint = '') => {
  const s = normKey(state);
  if (s && STATE_CANONICAL[s]) return STATE_CANONICAL[s];
  if (s && s.length > 2) {
    const titled = s.replace(/\b\w/g, (c) => c.toUpperCase());
    if (STATE_CANONICAL[s]) return STATE_CANONICAL[s];
    return titled;
  }
  const c = normKey(clusterHint);
  if (CLUSTER_TO_STATE[c]) return CLUSTER_TO_STATE[c];
  return state ? String(state).trim() : '';
};

/** Clean town text from spreadsheet (strip RS labels, extra punctuation). */
export const sanitizeTownInput = (raw) => {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s || /^n\/?a$/i.test(s) || s === '-' || s === '--') return '';

  s = s.replace(/^\s*(rs|retail\s*store|shop|store)\s*[-:]\s*/i, '');
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/[.,_/\\]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  const suffixes = [' town', ' city', ' dist', ' district', ' tehsil', ' taluk', ' taluka', ' mandal'];
  for (const suf of suffixes) {
    if (s.toLowerCase().endsWith(suf)) {
      s = s.slice(0, -suf.length).trim();
    }
  }
  return s;
};

export const isBlankGeoField = (raw) => {
  const s = String(raw || '').trim();
  return !s || /^n\/?a$/i.test(s) || s === '-' || s === '--';
};

export const geocodeCacheKey = (town, state, pincode = '') =>
  `${String(pincode || '').trim()}|${sanitizeTownInput(town).toLowerCase()}|${normKey(state)}`;

/** Curated coordinates for auditor base towns and common field destinations. */
const buildKnownTownCoords = () => {
  const map = new Map();
  const add = (name, lat, lng, state = '') => {
    const key = sanitizeTownInput(name).toLowerCase();
    if (!key || Number.isNaN(lat) || Number.isNaN(lng)) return;
    if (!map.has(key)) {
      map.set(key, { lat, lng, matchedCity: sanitizeTownInput(name), matchedState: state, source: 'known' });
    }
  };

  for (const t of AUDITOR_BASE_TOWNS) {
    add(t.name, t.lat, t.lng, t.state);
  }

  return map;
};

const KNOWN_TOWN_COORDS = buildKnownTownCoords();

export const lookupKnownTown = (town, stateHint = '') => {
  const key = sanitizeTownInput(town).toLowerCase();
  if (!key) return null;
  const hit = KNOWN_TOWN_COORDS.get(key);
  if (!hit) return null;
  if (stateHint && hit.matchedState) {
    const want = normKey(normalizeStateForGeocode(stateHint));
    const have = normKey(hit.matchedState);
    if (want && have && want !== have && !have.includes(want) && !want.includes(have)) {
      return null;
    }
  }
  return { mapped: true, ...hit };
};

const stateMatchesHint = (propsState, cleanState) => {
  if (!cleanState) return true;
  const a = normKey(propsState);
  const b = normKey(cleanState);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
};

const pickPhotonFeature = (features, cleanState) => {
  const ranked = (features || [])
    .filter((f) => f?.geometry?.coordinates?.length >= 2)
    .filter((f) => {
      const cc = String(f.properties?.countrycode || '').toUpperCase();
      return !cc || cc === 'IN';
    })
    .filter((f) => stateMatchesHint(f.properties?.state, cleanState))
    .sort((a, b) => photonTypeScore(b.properties) - photonTypeScore(a.properties));

  return ranked[0] || null;
};

const photonTypeScore = (props = {}) => {
  const t = String(props.type || props.osm_value || '').toLowerCase();
  if (t === 'city' || t === 'town' || t === 'village' || t === 'hamlet') return 4;
  if (t === 'suburb' || t === 'locality') return 3;
  if (t === 'district' || t === 'county') return 2;
  return 1;
};

/** Query Photon (OSM) — works reliably from cloud servers unlike Nominatim. */
export const geocodeWithPhoton = async (town, state, pincode = '') => {
  const cleanTown = sanitizeTownInput(town);
  const cleanState = normalizeStateForGeocode(state);
  const queries = [];

  if (/^\d{6}$/.test(String(pincode || '').trim())) {
    queries.push(`${pincode}, India`);
  }
  if (cleanTown && cleanState) {
    queries.push(`${cleanTown}, ${cleanState}, India`);
  }
  if (cleanTown) {
    queries.push(`${cleanTown}, India`);
  }

  if (!queries.length) {
    return { mapped: false, rawTown: town, rawState: state };
  }

  try {
    for (const q of queries) {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) continue;

      const data = await response.json();
      let hit = pickPhotonFeature(data.features, cleanState);
      if (!hit && cleanState) {
        hit = pickPhotonFeature(data.features, '');
      }
      if (!hit) continue;

      const [lng, lat] = hit.geometry.coordinates;
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

      const props = hit.properties || {};
      return {
        mapped: true,
        lat,
        lng,
        matchedCity: props.name || props.city || cleanTown,
        matchedState: props.state || cleanState,
        rawTown: town,
        rawState: state,
        source: 'photon',
      };
    }
    return { mapped: false, rawTown: town, rawState: state };
  } catch {
    return { mapped: false, rawTown: town, rawState: state };
  }
};

/** Query Nominatim (may be blocked from some datacenters). */
export const geocodeWithNominatim = async (town, state, pincode = '') => {
  const cleanTown = sanitizeTownInput(town);
  const cleanState = normalizeStateForGeocode(state);
  let query = '';
  if (/^\d{6}$/.test(String(pincode || '').trim())) {
    query = `${pincode}, India`;
  } else if (cleanTown && cleanState) {
    query = `${cleanTown}, ${cleanState}, India`;
  } else if (cleanTown) {
    query = `${cleanTown}, India`;
  } else {
    return { mapped: false, rawTown: town, rawState: state };
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '3');
    url.searchParams.set('countrycodes', 'in');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'SalesAudit/2.0 (field-audit travel map)',
        Accept: 'application/json',
      },
    });

    if (!response.ok) return { mapped: false, rawTown: town, rawState: state };

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { mapped: false, rawTown: town, rawState: state };
    }

    const ranked = [...rows].sort((a, b) => {
      const score = (r) => {
        const t = String(r.type || r.addresstype || '').toLowerCase();
        if (t === 'city' || t === 'town' || t === 'village') return 3;
        if (t === 'administrative') return 1;
        return 2;
      };
      return score(b) - score(a);
    });

    const hit = ranked[0];
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return { mapped: false, rawTown: town, rawState: state };
    }

    const addr = hit.address || {};
    return {
      mapped: true,
      lat,
      lng,
      matchedCity: addr.city || addr.town || addr.village || hit.name || cleanTown,
      matchedState: addr.state || cleanState,
      rawTown: town,
      rawState: state,
      source: 'nominatim',
    };
  } catch {
    return { mapped: false, rawTown: town, rawState: state };
  }
};

/** Try known coords, then Photon, then Nominatim. */
export const geocodeOnlineMulti = async (town, state, pincode = '') => {
  const known = lookupKnownTown(town, state);
  if (known?.mapped) return known;

  const photon = await geocodeWithPhoton(town, state, pincode);
  if (photon.mapped) return photon;
  return geocodeWithNominatim(town, state, pincode);
};
