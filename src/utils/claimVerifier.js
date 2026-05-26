import { parseLocationCoords, getAttendanceForAuditorDate } from './attendanceProcessor.js';
import { geocodeTown, findNearestCity } from './geoUtils.js';
import { namesMatch } from './nameMatcher.js';

const RATE_ONE_WAY = 4;
const RATE_ROUND_TRIP = 8;
const TOWN_MATCH_TOLERANCE_KM = 35;

const normTown = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

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

const pjpForClaim = (pjpRecords, auditorName, dateKey) =>
  pjpRecords.filter(
    (r) => namesMatch(r.employeeName, auditorName) && pjpDateKey(r.date) === dateKey,
  );

const expectedPetrolAmount = (kms, roundTrip) => {
  const rate = roundTrip ? RATE_ROUND_TRIP : RATE_ONE_WAY;
  return Math.round(kms * rate * 100) / 100;
};

const addFlag = (flags, code, title, detail, severity = 'high') => {
  flags.push({ code, title, detail, severity });
};

/**
 * Rule-based verification with structured flags for UI.
 */
export const verifyAllowanceClaims = (attendanceRecords, pjpRecords, allowanceClaims) => {
  const results = [];

  allowanceClaims.forEach((claim, index) => {
    const flags = [];
    const auditor = claim.employeeName;
    const dateKey = claim.dateKey;

    const attendance = getAttendanceForAuditorDate(attendanceRecords, auditor, dateKey);
    const pjpLegs = pjpForClaim(pjpRecords, auditor, dateKey);
    const coords = attendance ? parseLocationCoords(attendance.location) : null;

    const pjpFromTowns = [...new Set(pjpLegs.map((l) => l.fromTown).filter(Boolean))];
    const pjpToTowns = [...new Set(pjpLegs.map((l) => l.toTown).filter(Boolean))];
    const pjpKms = pjpLegs.reduce((s, l) => s + (l.kms || 0), 0);

    // --- Attendance ---
    if (!attendance) {
      addFlag(
        flags,
        'ATTENDANCE_MISSING',
        'No attendance on claim date',
        `No GoSurvey attendance row for "${auditor}" on ${claim.date}. Upload attendance first.`,
      );
    } else if (!attendance.isPresent) {
      addFlag(
        flags,
        'ATTENDANCE_ABSENT',
        'Auditor marked absent',
        `Latest attendance on ${claim.date} shows NOT on field, but an allowance was claimed.`,
        'high',
      );
    }

    // --- PJP ---
    if (pjpLegs.length === 0) {
      addFlag(
        flags,
        'PJP_MISSING',
        'No PJP route for this day',
        `PJP sheet has no travel row for "${auditor}" on ${claim.date}. Cannot verify route or kms.`,
      );
    }

    const fromOk =
      !claim.fromTown ||
      pjpFromTowns.some((t) => townsMatch(t, claim.fromTown)) ||
      pjpToTowns.some((t) => townsMatch(t, claim.fromTown));
    const toOk =
      !claim.toTown ||
      pjpToTowns.some((t) => townsMatch(t, claim.toTown)) ||
      pjpFromTowns.some((t) => townsMatch(t, claim.toTown));

    if (claim.fromTown && !fromOk) {
      addFlag(
        flags,
        'FROM_TOWN_MISMATCH',
        'From town does not match PJP',
        `Claim from "${claim.fromTown}" but PJP shows: ${pjpFromTowns.join(', ') || '—'} → ${pjpToTowns.join(', ') || '—'}.`,
      );
    }
    if (claim.toTown && !toOk) {
      addFlag(
        flags,
        'TO_TOWN_MISMATCH',
        'To town does not match PJP',
        `Claim to "${claim.toTown}" but PJP route towns are: ${pjpFromTowns.join(', ') || '—'} → ${pjpToTowns.join(', ') || '—'}.`,
      );
    }

    // --- Petrol / kms ---
    const refKms = claim.kms > 0 ? claim.kms : pjpKms;
    const rate = claim.roundTrip ? RATE_ROUND_TRIP : RATE_ONE_WAY;
    const expectedPetrol = refKms > 0 ? expectedPetrolAmount(refKms, claim.roundTrip) : 0;

    if (claim.petrolAmount > 0 && refKms <= 0) {
      addFlag(
        flags,
        'KMS_MISSING',
        'Petrol claimed but no kms',
        `Petrol ₹${claim.petrolAmount} claimed but neither allowance nor PJP has distance (kms).`,
      );
    }

    if (claim.petrolAmount > 0 && expectedPetrol > 0) {
      const diff = Math.abs(claim.petrolAmount - expectedPetrol);
      if (diff > 5) {
        addFlag(
          flags,
          'PETROL_AMOUNT_MISMATCH',
          'Petrol amount incorrect',
          `Claimed ₹${claim.petrolAmount} but expected ₹${expectedPetrol} (${refKms} km × ₹${rate}/km${claim.roundTrip ? ', round trip' : ''}). Difference ₹${Math.round(diff)}.`,
        );
      }
    }

    if (claim.kms > 0 && pjpKms > 0 && Math.abs(claim.kms - pjpKms) > 10) {
      addFlag(
        flags,
        'KMS_PJP_MISMATCH',
        'Kms differ from PJP',
        `Allowance claims ${claim.kms} km but PJP total for the day is ${pjpKms} km.`,
        'medium',
      );
    }

    // --- Bus ---
    if (claim.busAmount > 0 && pjpLegs.length === 0) {
      addFlag(
        flags,
        'BUS_WITHOUT_PJP',
        'Bus fare without PJP route',
        `Bus/ticket ₹${claim.busAmount} claimed but no PJP travel logged on ${claim.date}.`,
      );
    }

    // --- GPS ---
    let nearestCity = null;
    let gpsDistanceKm = null;
    if (coords) {
      nearestCity = findNearestCity(coords.lat, coords.lng);
      if (claim.toTown) {
        const geo = geocodeTown(claim.toTown);
        if (geo?.mapped && geo.lat != null) {
          gpsDistanceKm = haversineKm(coords, { lat: geo.lat, lng: geo.lng });
          if (gpsDistanceKm != null && gpsDistanceKm > TOWN_MATCH_TOLERANCE_KM) {
            addFlag(
              flags,
              'GPS_DESTINATION_MISMATCH',
              'GPS far from claimed destination',
              `Attendance GPS (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}${nearestCity ? `, near ${nearestCity}` : ''}) is ~${Math.round(gpsDistanceKm)} km from "${claim.toTown}".`,
              'medium',
            );
          }
        }
      }
    }

    const comparison = {
      attendance: attendance
        ? {
            found: true,
            present: attendance.isPresent,
            location: attendance.location || '—',
            nearestCity: nearestCity || '—',
          }
        : { found: false, present: null, location: '—', nearestCity: '—' },
      pjp: {
        found: pjpLegs.length > 0,
        legs: pjpLegs.map((l) => ({
          from: l.fromTown || '—',
          to: l.toTown || '—',
          kms: l.kms ?? '—',
        })),
        totalKms: pjpKms || '—',
        towns: `${pjpFromTowns.join(', ') || '—'} → ${pjpToTowns.join(', ') || '—'}`,
      },
      allowance: {
        from: claim.fromTown || '—',
        to: claim.toTown || '—',
        kms: claim.kms || '—',
        petrol: claim.petrolAmount ? `₹${claim.petrolAmount}` : '—',
        bus: claim.busAmount ? `₹${claim.busAmount}` : '—',
        total: claim.totalAmount ? `₹${claim.totalAmount}` : '—',
        roundTrip: claim.roundTrip ? 'Yes' : 'No',
        billType: claim.billType || '—',
      },
      petrolCheck: {
        ratePerKm: rate,
        referenceKms: refKms || 0,
        expected: expectedPetrol ? `₹${expectedPetrol}` : '—',
        claimed: claim.petrolAmount ? `₹${claim.petrolAmount}` : '—',
        match:
          claim.petrolAmount > 0 && expectedPetrol > 0
            ? Math.abs(claim.petrolAmount - expectedPetrol) <= 5
            : null,
      },
      gpsDistanceKm: gpsDistanceKm != null ? `${Math.round(gpsDistanceKm)} km` : '—',
    };

    const issues = flags.map((f) => f.detail);

    results.push({
      id: `claim-${index}`,
      claim,
      auditor,
      dateKey,
      status: flags.length === 0 ? 'pass' : 'flag',
      flags,
      issues,
      comparison,
      verdict:
        flags.length === 0
          ? 'Claim aligns with attendance, PJP route, and petrol rate.'
          : flags.map((f) => f.title).join(' · '),
    });
  });

  const passed = results.filter((r) => r.status === 'pass').length;
  const flagged = results.filter((r) => r.status === 'flag').length;

  return {
    results,
    summary: {
      total: results.length,
      passed,
      flagged,
      passRate: results.length ? Math.round((passed / results.length) * 100) : 0,
    },
  };
};

export const buildVerificationPayloadForAI = (verification) => ({
  summary: verification.summary,
  flaggedClaims: verification.results
    .filter((r) => r.status === 'flag')
    .slice(0, 40)
    .map((r) => ({
      auditor: r.auditor,
      date: r.claim.date,
      flags: r.flags,
      comparison: r.comparison,
    })),
});
