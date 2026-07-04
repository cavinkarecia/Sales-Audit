import cities from '../data/cities.json';

/**
 * Haversine formula to calculate distance in KM between two points.
 * Returns a string with one decimal place, or null if any coord is missing.
 */
export const getDistance = (lat1, lon1, lat2, lon2) => {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return d.toFixed(1);
};

/**
 * Find nearest city from the local dataset of 7,000+ Indian cities (used by Live map only).
 */
export const findNearestCity = (lat, lng) => {
  if (!lat || !lng) return "Unknown Location";
  let minDistance = Infinity;
  let nearestCity = "India";

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const dy = lat - city.latitude;
    const dx = lng - city.longitude;
    const distSq = dx * dx + dy * dy;

    if (distSq < minDistance) {
      minDistance = distSq;
      nearestCity = `${city.city}, ${city.state}`;
    }
    if (minDistance < 0.0001) break;
  }
  return nearestCity;
};

/* ------------------------------------------------------------------ *
 *  Robust town-name geocoding for auditor travel history              *
 * ------------------------------------------------------------------ */

/**
 * Manual aliases for towns where the field-entered name does not match
 * the canonical name in cities.json. Keys are normalized (lowercase,
 * stripped of punctuation and extra spaces); values are the canonical
 * city name as it appears in cities.json (case-insensitive match).
 *
 * Add new mappings here whenever a town shows up in the Unmapped Towns
 * panel of the dashboard.
 */
const TOWN_ALIASES = {
  // Common spelling variants / Anglicizations
  'bengaluru': 'Bangalore',
  'bangaluru': 'Bangalore',
  'bombay': 'Mumbai',
  'calcutta': 'Kolkata',
  'madras': 'Chennai',
  'pondicherry': 'Puducherry',
  'trivandrum': 'Thiruvananthapuram',
  'gurgaon': 'Gurugram',
  'cochin': 'Kochi',
  'mysore': 'Mysuru',
  'mangalore': 'Mangaluru',
  'baroda': 'Vadodara',
  'belgaum': 'Belagavi',
  'hubli': 'Hubballi',
  'hubballi-dharwad': 'Hubballi',
  'allahabad': 'Prayagraj',
  'vizag': 'Visakhapatnam',
  'vishakhapatnam': 'Visakhapatnam',
  'tindivanam': 'Tindivanam',
  'tinnevelly': 'Tirunelveli',
  'palghat': 'Palakkad',
  'quilon': 'Kollam',
  'tellicherry': 'Thalassery',
  'cannanore': 'Kannur',
  'alleppey': 'Alappuzha',
  'kanjirappally': 'Kanjirapally',
  'gauhati': 'Guwahati',
  'jubbulpore': 'Jabalpur',
  'cawnpore': 'Kanpur',
  'benares': 'Varanasi',
  'banaras': 'Varanasi',
  'nizambad': 'Nizamabad',
  'nuzvid': 'Nuzvid',
  'kanjivaram': 'Kanchipuram',
  'conjeevaram': 'Kanchipuram',
  'tanjore': 'Thanjavur',
  'trichy': 'Tiruchirappalli',
  'tiruchi': 'Tiruchirappalli',
  'trichinopoly': 'Tiruchirappalli',
  'salem town': 'Salem',
  'coimbatore north': 'Coimbatore',
  'coimbatore south': 'Coimbatore',
  'navi mumbai': 'Navi Mumbai',
  'new delhi': 'Delhi',
  'delhi ncr': 'Delhi',
  'gr noida': 'Greater Noida',
  'noida ext': 'Noida',
  'kolhapur city': 'Kolhapur',
};

/**
 * State aliases / abbreviations to canonical names used in cities.json.
 */
const STATE_ALIASES = {
  'tn': 'Tamil Nadu',
  'tamilnadu': 'Tamil Nadu',
  'ap': 'Andhra Pradesh',
  'andhra': 'Andhra Pradesh',
  'andhrapradesh': 'Andhra Pradesh',
  'ts': 'Telangana',
  'telengana': 'Telangana',
  'ka': 'Karnataka',
  'kar': 'Karnataka',
  'kl': 'Kerala',
  'mh': 'Maharashtra',
  'maha': 'Maharashtra',
  'gj': 'Gujarat',
  'mp': 'Madhya Pradesh',
  'up': 'Uttar Pradesh',
  'uk': 'Uttarakhand',
  'rj': 'Rajasthan',
  'pb': 'Punjab',
  'hr': 'Haryana',
  'wb': 'West Bengal',
  'jk': 'Jammu and Kashmir',
  'odisha': 'Odisha',
  'orissa': 'Odisha',
  'cg': 'Chhattisgarh',
  'chattisgarh': 'Chhattisgarh',
  'jh': 'Jharkhand',
  'br': 'Bihar',
  'as': 'Assam',
  'goa': 'Goa',
  'hp': 'Himachal Pradesh',
};

/**
 * Normalize a free-form town/state string for matching:
 *  - trim, lowercase
 *  - strip surrounding parenthetical hints  e.g. "Madurai (East)"
 *  - collapse repeated whitespace
 *  - strip trailing tokens like "town", "city", "dist", "district"
 *  - drop punctuation except hyphens (some place names contain them)
 */
const normalizeName = (raw) => {
  if (!raw) return '';
  let s = String(raw).toLowerCase().trim();
  if (!s || s === 'n/a' || s === 'na' || s === '-' || s === '--') return '';

  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/[.,_/\\]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  const suffixes = [' town', ' city', ' dist', ' district', ' tehsil', ' taluk', ' taluka', ' mandal'];
  for (const suf of suffixes) {
    if (s.endsWith(suf)) {
      s = s.slice(0, -suf.length).trim();
    }
  }
  return s;
};

const canonicalStateName = (state) => {
  const n = normalizeName(state);
  if (!n) return '';
  if (STATE_ALIASES[n]) return STATE_ALIASES[n];
  return n;
};

/**
 * Build a fast lookup index from cities.json once at module load.
 *   byCity[normalizedCity] = [city, city, ...]   (may have duplicates across states)
 */
const buildCityIndex = () => {
  const byCity = new Map();
  for (const c of cities) {
    const key = normalizeName(c.city);
    if (!key) continue;
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push(c);
  }
  return byCity;
};

const CITY_INDEX = buildCityIndex();

/**
 * Try to resolve a town name to a city record from cities.json.
 * Returns the city object on success, null otherwise.
 *
 * Matching strategy (in order):
 *   1. Manual alias lookup (then exact match on the aliased name)
 *   2. Exact normalized match
 *   3. Exact normalized match restricted to the supplied state (if any)
 *   4. First-token match (e.g. "Madurai East" -> "Madurai")
 *   5. Substring containment, but only if exactly one candidate matches
 */
const resolveCity = (rawTown, rawState) => {
  const town = normalizeName(rawTown);
  if (!town) return null;

  const stateNorm = canonicalStateName(rawState).toLowerCase();
  const stateMatches = (record) => {
    if (!stateNorm) return true;
    return normalizeName(record.state) === stateNorm;
  };

  const aliasTarget = TOWN_ALIASES[town];
  const aliasedKey = aliasTarget ? normalizeName(aliasTarget) : null;

  const tryKey = (key) => {
    if (!key) return null;
    const list = CITY_INDEX.get(key);
    if (!list || list.length === 0) return null;
    if (stateNorm) {
      const inState = list.find(stateMatches);
      if (inState) return inState;
    }
    const sorted = [...list].sort((a, b) => (b.population || 0) - (a.population || 0));
    return sorted[0];
  };

  let hit = tryKey(aliasedKey) || tryKey(town);
  if (hit) return hit;

  const firstToken = town.split(' ')[0];
  if (firstToken && firstToken !== town) {
    hit = tryKey(firstToken);
    if (hit) return hit;
  }

  const candidates = [];
  for (const [key, list] of CITY_INDEX) {
    if (key.length < 4) continue;
    if (key === town) continue;
    if (key.startsWith(town) || town.startsWith(key)) {
      for (const c of list) {
        if (stateMatches(c)) candidates.push(c);
      }
    }
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && stateNorm) {
    const inState = candidates.filter(stateMatches);
    if (inState.length === 1) return inState[0];
  }

  // Match against district name within the stated state (e.g. "Kurnool" district vs city)
  if (stateNorm) {
    const districtHits = cities.filter(
      (c) => stateMatches(c) && normalizeName(c.district) === town,
    );
    if (districtHits.length === 1) return districtHits[0];
    if (districtHits.length > 1) {
      districtHits.sort((a, b) => (b.population || 0) - (a.population || 0));
      return districtHits[0];
    }
  }

  return null;
};

/**
 * Backwards-compatible helper that returns just { lat, lng } or null.
 * Optional second arg lets callers supply a state hint for disambiguation.
 */
export const findCityCoords = (cityName, stateHint) => {
  const c = resolveCity(cityName, stateHint);
  if (!c) return null;
  return { lat: c.latitude, lng: c.longitude };
};

/**
 * Richer geocoding result with the matched city/state and a confidence flag.
 *   { lat, lng, matchedCity, matchedState, mapped: true }
 * Returns { mapped: false, rawTown, rawState } if no match.
 *
 * Pincode is accepted for API compatibility; online geocoder uses it when local match fails.
 */
export const geocodeTown = (cityName, stateHint, _pincode) => {
  const c = resolveCity(cityName, stateHint);
  if (!c) {
    return {
      mapped: false,
      rawTown: cityName || '',
      rawState: stateHint || '',
    };
  }
  return {
    mapped: true,
    lat: c.latitude,
    lng: c.longitude,
    matchedCity: c.city,
    matchedState: c.state,
    rawTown: cityName || '',
    rawState: stateHint || '',
  };
};
