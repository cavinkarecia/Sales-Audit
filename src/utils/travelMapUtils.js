import { geocodeTown, getDistance } from './geoUtils';
import { geocodeTownsBatch, geocodeCacheKey } from './onlineGeocoder';
import { normalizeStateForGeocode, CLUSTER_TO_STATE, sanitizeTownInput, isBlankGeoField } from './geocodeProviders';

/**
 * Convert a dd-MM-yyyy string into a real Date for sorting / labelling.
 */
const parseDdMmYyyy = (str) => {
  if (!str) return null;
  const parts = String(str).split('-');
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const y = parseInt(parts[2], 10);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  return new Date(y, m, d);
};

const findAuditor = (auditorsMaster, name) => {
  if (!name || !auditorsMaster) return null;
  const lower = String(name).toLowerCase().trim();
  return auditorsMaster.find(a =>
    a.name.toLowerCase() === lower ||
    a.name.toLowerCase().includes(lower) ||
    lower.includes(a.name.toLowerCase())
  ) || null;
};

const pickPincode = (record) =>
  record.pincode || record['Pincode'] || record['Pin Code'] || record['PIN Code'] || '';

const pickPlannedRS = (record) =>
  record.plannedRSName || record['Planned RS Name'] || record['Planned Retail Store'] || '';

const inferState = (record, auditorsMaster) => {
  const fromSheet = record.state || record['State'] || '';
  if (!isBlankGeoField(fromSheet)) {
    return normalizeStateForGeocode(fromSheet);
  }
  const empName = record.employeeName || record['Employee Name'] || '';
  const auditor = findAuditor(auditorsMaster, empName);
  if (auditor?.cluster && CLUSTER_TO_STATE[String(auditor.cluster).toLowerCase()]) {
    return CLUSTER_TO_STATE[String(auditor.cluster).toLowerCase()];
  }
  return '';
};

const resolveCoords = (town, state, pincode, onlineLookup) => {
  const cleanTown = sanitizeTownInput(town);
  if (!cleanTown && !/^\d{6}$/.test(String(pincode || '').trim())) {
    return { coords: null, matchedCity: null, mapped: false, source: null };
  }

  const local = geocodeTown(cleanTown || town, state, pincode);
  if (local.mapped) {
    return {
      coords: { lat: local.lat, lng: local.lng },
      matchedCity: local.matchedCity,
      mapped: true,
      source: 'local',
    };
  }

  const key = geocodeCacheKey(cleanTown || town, state, pincode);
  const online = onlineLookup?.get(key);
  if (online?.mapped) {
    return {
      coords: { lat: online.lat, lng: online.lng },
      matchedCity: online.matchedCity,
      mapped: true,
      source: online.source || 'online',
    };
  }

  return { coords: null, matchedCity: null, mapped: false, source: null };
};

const buildLegFromRecord = (record, idx, dayIndexByDate, auditorsMaster, onlineLookup) => {
  const empName = record.employeeName || record['Employee Name'] || '';
  const dateStr = record.date || record['Date'] || '';
  const fromTown = record.fromTown || record['From Town Name'] || record['From Town'] || '';
  const toTown = record.toTown || record['To Town Name'] || record['To Town'] || '';
  const state = inferState(record, auditorsMaster);
  const pincode = pickPincode(record);
  const plannedRSName = pickPlannedRS(record);
  const reportedKmsRaw = record.kms !== undefined ? record.kms : record['Kms Travelled'];
  const reportedKms = (reportedKmsRaw === '' || reportedKmsRaw === null || reportedKmsRaw === undefined)
    ? null
    : (isNaN(parseFloat(reportedKmsRaw)) ? null : parseFloat(reportedKmsRaw));

  const fromResolved = resolveCoords(fromTown, state, '', onlineLookup);
  const toResolved = resolveCoords(toTown, state, pincode, onlineLookup);

  let fromCoords = fromResolved.coords;
  let toCoords = toResolved.coords;

  if (!fromCoords) {
    const auditor = findAuditor(auditorsMaster, empName);
    if (auditor?.coords) fromCoords = auditor.coords;
  }

  let computedKms = null;
  if (fromCoords && toCoords) {
    const d = getDistance(fromCoords.lat, fromCoords.lng, toCoords.lat, toCoords.lng);
    if (d !== null) computedKms = parseFloat(d);
  }

  return {
    id: `leg-${idx}`,
    employeeName: empName,
    date: dateStr,
    parsedDate: parseDdMmYyyy(dateStr),
    dayIndex: dayIndexByDate.get(dateStr) || 0,
    legIndex: idx + 1,
    fromTown,
    toTown,
    fromState: state,
    toState: state,
    pincode,
    plannedRSName,
    fromCoords,
    toCoords,
    fromMatchedCity: fromResolved.matchedCity,
    toMatchedCity: toResolved.matchedCity,
    fromGeocodeSource: fromResolved.source,
    toGeocodeSource: toResolved.source,
    reportedKms,
    computedKms,
    kms: reportedKms != null ? reportedKms : computedKms,
    kmsFromBase: computedKms,
    mapped: !!(fromCoords && toCoords),
    record,
  };
};

/** Towns that still need online geocoding (local cities.json miss). */
export const collectGeocodeCandidates = (records, auditorsMaster) => {
  const seen = new Set();
  const out = [];

  for (const record of records) {
    const state = inferState(record, auditorsMaster);
    const pincode = pickPincode(record);
    const towns = [
      { town: record.fromTown || record['From Town Name'] || '', pincode: '' },
      { town: record.toTown || record['To Town Name'] || '', pincode },
    ];

    for (const { town, pincode: pc } of towns) {
      const clean = sanitizeTownInput(town);
      if (!clean) continue;
      if (geocodeTown(clean, state, pc).mapped) continue;
      const key = geocodeCacheKey(clean, state, pc);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ town: clean, state, pincode: pc });
    }
  }

  return out;
};

const collectUnmapped = (legs) => {
  const unmappedMap = new Map();
  const note = (town, state, pincode, employeeName) => {
    const key = `${sanitizeTownInput(town).toLowerCase()}|${(state || '').toLowerCase().trim()}|${pincode || ''}`;
    if (!sanitizeTownInput(town)) return;
    if (!unmappedMap.has(key)) {
      unmappedMap.set(key, { town: sanitizeTownInput(town), state: state || '', pincode: pincode || '', count: 0, employees: new Set() });
    }
    const entry = unmappedMap.get(key);
    entry.count += 1;
    if (employeeName) entry.employees.add(employeeName);
  };

  legs.forEach((leg) => {
    if (!leg.toCoords && sanitizeTownInput(leg.toTown)) {
      note(leg.toTown, leg.toState, leg.pincode, leg.employeeName);
    }
  });

  return Array.from(unmappedMap.values())
    .map(u => ({ town: u.town, state: u.state, pincode: u.pincode, count: u.count, employees: Array.from(u.employees) }))
    .sort((a, b) => b.count - a.count);
};

const sortRecords = (records) =>
  [...records].sort((a, b) => {
    const da = parseDdMmYyyy(a.date);
    const db = parseDdMmYyyy(b.date);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });

const buildDayIndex = (sorted) => {
  const dayIndexByDate = new Map();
  let nextDayIdx = 0;
  for (const r of sorted) {
    if (!dayIndexByDate.has(r.date)) {
      nextDayIdx += 1;
      dayIndexByDate.set(r.date, nextDayIdx);
    }
  }
  return dayIndexByDate;
};

/**
 * Build a chronologically-ordered list of travel legs for plotting on the map.
 */
export const buildTravelLegs = (records, auditorsMaster) => {
  if (!records || records.length === 0) {
    return { legs: [], unmappedTowns: [], dayKeys: [], geocodeCandidates: [] };
  }

  const sorted = sortRecords(records);
  const dayIndexByDate = buildDayIndex(sorted);

  const legs = sorted.map((record, idx) =>
    buildLegFromRecord(record, idx, dayIndexByDate, auditorsMaster, null),
  );

  const geocodeCandidates = collectGeocodeCandidates(records, auditorsMaster);

  const dayKeys = Array.from(dayIndexByDate.entries()).map(([date, dayIndex]) => ({
    key: date,
    label: date,
    dayIndex,
  }));

  return {
    legs,
    unmappedTowns: collectUnmapped(legs),
    dayKeys,
    geocodeCandidates,
  };
};

/**
 * Re-resolve legs using online geocoding (Photon) for towns cities.json missed.
 */
export const enrichTravelLegsOnline = async (travelMap, auditorsMaster, onProgress) => {
  const candidates = travelMap.geocodeCandidates?.length
    ? travelMap.geocodeCandidates
    : collectGeocodeCandidates(
      travelMap.legs.map((l) => l.record).filter(Boolean),
      auditorsMaster,
    );

  if (!candidates.length) return travelMap;

  const onlineResults = await geocodeTownsBatch(candidates, onProgress);

  const sorted = sortRecords(travelMap.legs.map((l) => l.record).filter(Boolean));
  const dayIndexByDate = buildDayIndex(sorted);

  const legs = sorted.map((record, idx) =>
    buildLegFromRecord(record, idx, dayIndexByDate, auditorsMaster, onlineResults),
  );

  const unmappedTowns = collectUnmapped(legs);

  return {
    legs,
    unmappedTowns,
    dayKeys: travelMap.dayKeys,
    geocodeCandidates: collectGeocodeCandidates(sorted, auditorsMaster),
    onlineResolved: candidates.length - unmappedTowns.length,
  };
};

/**
 * Simple deterministic colour per day index.
 */
export const dayColor = (dayIndex) => {
  const palette = [
    '#58a6ff', '#3fb950', '#f85149', '#d29922', '#bc8cff',
    '#ff8c5a', '#36c8e6', '#ffd700', '#ff6ad5', '#7ee787',
  ];
  if (!dayIndex || dayIndex <= 0) return palette[0];
  return palette[(dayIndex - 1) % palette.length];
};
