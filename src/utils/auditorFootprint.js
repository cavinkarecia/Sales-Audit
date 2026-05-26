import { parseLocationCoords, getAttendanceForAuditorDate } from './attendanceProcessor.js';
import { findNearestCity, geocodeTown } from './geoUtils.js';
import { namesMatch } from './nameMatcher.js';

const normTown = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const townsMatch = (a, b) => {
  if (!a || !b) return false;
  const na = normTown(a);
  const nb = normTown(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
};

const pjpDateKey = (dateStr) => {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
};

/**
 * Auditor "footprint" for a day = where they actually were (PJP route + attendance GPS).
 * NOT the same as the allowance sheet layout (one shared tab with all auditors).
 */
export const buildAuditorFootprint = (attendanceRecords, pjpRecords, auditorName, dateKey) => {
  const attendance = getAttendanceForAuditorDate(attendanceRecords, auditorName, dateKey);
  const pjpLegs = pjpRecords.filter(
    (r) => namesMatch(r.employeeName, auditorName) && pjpDateKey(r.date) === dateKey,
  );

  const towns = new Set();
  pjpLegs.forEach((leg) => {
    if (leg.fromTown) towns.add(String(leg.fromTown).trim());
    if (leg.toTown) towns.add(String(leg.toTown).trim());
  });

  const coords = attendance ? parseLocationCoords(attendance.location) : null;
  let gpsCity = null;
  if (coords) {
    gpsCity = findNearestCity(coords.lat, coords.lng);
    if (gpsCity) towns.add(gpsCity);
  }

  const totalKms = pjpLegs.reduce((s, l) => s + (l.kms || 0), 0);

  return {
    auditor: auditorName,
    dateKey,
    hasData: Boolean(attendance || pjpLegs.length > 0),
    present: attendance?.isPresent ?? null,
    gps: coords
      ? {
          lat: coords.lat,
          lng: coords.lng,
          raw: attendance.location,
          nearestCity: gpsCity || '—',
        }
      : null,
    legs: pjpLegs.map((l) => ({
      from: l.fromTown || '—',
      to: l.toTown || '—',
      kms: l.kms ?? 0,
    })),
    townsVisited: Array.from(towns).filter(Boolean),
    totalKms,
    routeSummary:
      pjpLegs.length > 0
        ? pjpLegs.map((l) => `${l.fromTown || '?'} → ${l.toTown || '?'}`).join(' · ')
        : gpsCity
          ? `GPS near ${gpsCity} (no PJP legs)`
          : '—',
  };
};

const townInFootprint = (town, footprint) => {
  if (!town) return true;
  return footprint.townsVisited.some((t) => townsMatch(t, town));
};

const haversineKm = (a, b) => {
  if (!a || !b) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

/**
 * Returns whether the allowance claim route aligns with the auditor's real footprint.
 */
export const evaluateClaimVsFootprint = (claim, footprint) => {
  if (!footprint.hasData) {
    return {
      aligns: false,
      routeOk: false,
      fromOk: false,
      toOk: false,
      gpsKmToClaimedDest: null,
      reason: 'No attendance or PJP footprint for this auditor on this date.',
    };
  }

  const fromOk = townInFootprint(claim.fromTown, footprint);
  const toOk = townInFootprint(claim.toTown, footprint);

  let gpsKmToClaimedDest = null;
  if (footprint.gps && claim.toTown) {
    const geo = geocodeTown(claim.toTown);
    if (geo?.lat != null) {
      gpsKmToClaimedDest = haversineKm(footprint.gps, { lat: geo.lat, lng: geo.lng });
    }
  }

  const routeOk =
    (!claim.fromTown && !claim.toTown) ||
    (fromOk && toOk) ||
    (fromOk && !claim.toTown) ||
    (toOk && !claim.fromTown);

  let reason = '';
  if (!routeOk) {
    const parts = [];
    if (claim.fromTown && !fromOk) {
      parts.push(`"${claim.fromTown}" not in footprint towns (${footprint.townsVisited.join(', ') || 'none'})`);
    }
    if (claim.toTown && !toOk) {
      parts.push(`"${claim.toTown}" not in footprint (PJP route or GPS city)`);
    }
    reason = parts.join('. ');
  }

  return {
    aligns: routeOk && footprint.present !== false,
    routeOk,
    fromOk,
    toOk,
    gpsKmToClaimedDest,
    reason,
  };
};
