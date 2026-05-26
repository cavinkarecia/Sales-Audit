import { geocodeTown, getDistance } from './geoUtils';

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

/**
 * Build a chronologically-ordered list of travel legs for plotting on the
 * live map. Each leg has resolved coordinates, day index, route label and
 * kilometres (taken from the sheet when present, otherwise computed from
 * Haversine on the resolved coordinates).
 *
 * Input records are expected in the shape produced by sheetFetcher.fetchAllSheets
 * (i.e. { date, employeeName, fromTown, toTown, state, kms, plannedRSName, ... }).
 *
 * Returns:
 *   {
 *     legs: [{
 *       id, employeeName, date, parsedDate, dayIndex, legIndex,
 *       fromTown, toTown, fromState, toState,
 *       fromCoords, toCoords,             // null when unmapped
 *       fromMatchedCity, toMatchedCity,   // canonical names from cities.json
 *       reportedKms, computedKms, kms,    // numbers (or null)
 *       mapped,                           // true only when both ends resolved
 *       record                            // original record reference
 *     }],
 *     unmappedTowns: [{ town, state, count, employees: [...] }],
 *     dayKeys: [{ key, label, dayIndex }]
 *   }
 */
export const buildTravelLegs = (records, auditorsMaster) => {
  if (!records || records.length === 0) {
    return { legs: [], unmappedTowns: [], dayKeys: [] };
  }

  const sorted = [...records].sort((a, b) => {
    const da = parseDdMmYyyy(a.date);
    const db = parseDdMmYyyy(b.date);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });

  const dayIndexByDate = new Map();
  let nextDayIdx = 0;
  for (const r of sorted) {
    if (!dayIndexByDate.has(r.date)) {
      nextDayIdx += 1;
      dayIndexByDate.set(r.date, nextDayIdx);
    }
  }

  const unmappedMap = new Map();
  const noteUnmapped = (town, state, employeeName) => {
    const key = `${(town || '').toLowerCase().trim()}|${(state || '').toLowerCase().trim()}`;
    if (!key.trim() || key === '|') return;
    if (!unmappedMap.has(key)) {
      unmappedMap.set(key, { town: town || '', state: state || '', count: 0, employees: new Set() });
    }
    const entry = unmappedMap.get(key);
    entry.count += 1;
    if (employeeName) entry.employees.add(employeeName);
  };

  const legs = sorted.map((record, idx) => {
    const empName = record.employeeName || record['Employee Name'] || '';
    const dateStr = record.date || record['Date'] || '';
    const fromTown = record.fromTown || record['From Town Name'] || record['From Town'] || '';
    const toTown = record.toTown || record['To Town Name'] || record['To Town'] || '';
    const state = record.state || record['State'] || '';
    const reportedKmsRaw = record.kms !== undefined ? record.kms : record['Kms Travelled'];
    const reportedKms = (reportedKmsRaw === '' || reportedKmsRaw === null || reportedKmsRaw === undefined)
      ? null
      : (isNaN(parseFloat(reportedKmsRaw)) ? null : parseFloat(reportedKmsRaw));

    const fromGeo = geocodeTown(fromTown, state);
    const toGeo = geocodeTown(toTown, state);

    if (!fromGeo.mapped && fromTown) noteUnmapped(fromTown, state, empName);
    if (!toGeo.mapped && toTown) noteUnmapped(toTown, state, empName);

    let fromCoords = fromGeo.mapped ? { lat: fromGeo.lat, lng: fromGeo.lng } : null;
    let toCoords = toGeo.mapped ? { lat: toGeo.lat, lng: toGeo.lng } : null;

    if (!fromCoords) {
      const auditor = findAuditor(auditorsMaster, empName);
      if (auditor && auditor.coords) {
        fromCoords = auditor.coords;
      }
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
      fromCoords,
      toCoords,
      fromMatchedCity: fromGeo.mapped ? fromGeo.matchedCity : null,
      toMatchedCity: toGeo.mapped ? toGeo.matchedCity : null,
      reportedKms,
      computedKms,
      kms: reportedKms != null ? reportedKms : computedKms,
      mapped: !!(fromCoords && toCoords),
      record,
    };
  });

  const unmappedTowns = Array.from(unmappedMap.values())
    .map(u => ({ town: u.town, state: u.state, count: u.count, employees: Array.from(u.employees) }))
    .sort((a, b) => b.count - a.count);

  const dayKeys = Array.from(dayIndexByDate.entries()).map(([date, dayIndex]) => ({
    key: date,
    label: date,
    dayIndex,
  }));

  return { legs, unmappedTowns, dayKeys };
};

/**
 * Simple deterministic colour per day index, so each travel day shows up
 * with its own hue on the map.
 */
export const dayColor = (dayIndex) => {
  const palette = [
    '#58a6ff', '#3fb950', '#f85149', '#d29922', '#bc8cff',
    '#ff8c5a', '#36c8e6', '#ffd700', '#ff6ad5', '#7ee787',
  ];
  if (!dayIndex || dayIndex <= 0) return palette[0];
  return palette[(dayIndex - 1) % palette.length];
};
