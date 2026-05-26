import { parseLocationCoords, getAttendanceForAuditorDate } from './attendanceProcessor.js';
import { geocodeTown } from './geoUtils.js';
import { namesMatch } from './nameMatcher.js';

const RATE_ONE_WAY = 4;
const RATE_ROUND_TRIP = 8;
const TOWN_MATCH_TOLERANCE_KM = 35;

const norm = (s) => String(s || '').trim().toLowerCase();
const normTown = (s) => norm(s).replace(/[^a-z0-9]/g, '');

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

/**
 * Rule-based verification before / alongside AI review.
 */
export const verifyAllowanceClaims = (attendanceRecords, pjpRecords, allowanceClaims) => {
  const results = [];

  allowanceClaims.forEach((claim, index) => {
    const issues = [];
    const notes = [];
    const auditor = claim.employeeName;
    const dateKey = claim.dateKey;

    const attendance = getAttendanceForAuditorDate(attendanceRecords, auditor, dateKey);
    const pjpLegs = pjpForClaim(pjpRecords, auditor, dateKey);
    const coords = attendance ? parseLocationCoords(attendance.location) : null;

    if (!attendance) {
      issues.push('No attendance record for this auditor on claim date.');
    } else if (!attendance.isPresent) {
      issues.push('Auditor marked absent on claim date (latest attendance entry).');
    } else {
      notes.push(`Attendance: present at ${attendance.location || 'unknown location'}.`);
    }

    if (pjpLegs.length === 0) {
      issues.push('No PJP travel row for this auditor on claim date.');
    }

    const pjpFromTowns = pjpLegs.map((l) => l.fromTown).filter(Boolean);
    const pjpToTowns = pjpLegs.map((l) => l.toTown).filter(Boolean);
    const pjpKms = pjpLegs.reduce((s, l) => s + (l.kms || 0), 0);

    const fromOk =
      !claim.fromTown ||
      pjpFromTowns.some((t) => townsMatch(t, claim.fromTown)) ||
      pjpToTowns.some((t) => townsMatch(t, claim.fromTown));
    const toOk =
      !claim.toTown ||
      pjpToTowns.some((t) => townsMatch(t, claim.toTown)) ||
      pjpFromTowns.some((t) => townsMatch(t, claim.toTown));

    if (claim.fromTown && !fromOk) {
      issues.push(`Claim "from" (${claim.fromTown}) does not match PJP towns (${pjpFromTowns.join(', ') || 'n/a'}).`);
    }
    if (claim.toTown && !toOk) {
      issues.push(`Claim "to" (${claim.toTown}) does not match PJP towns (${pjpToTowns.join(', ') || 'n/a'}).`);
    }

    const refKms = claim.kms > 0 ? claim.kms : pjpKms;
    const expectedPetrol = refKms > 0 ? expectedPetrolAmount(refKms, claim.roundTrip) : 0;

    if (claim.petrolAmount > 0 && expectedPetrol > 0) {
      const diff = Math.abs(claim.petrolAmount - expectedPetrol);
      if (diff > 5) {
        issues.push(
          `Petrol claim ₹${claim.petrolAmount} vs expected ₹${expectedPetrol} (${refKms} km × ₹${claim.roundTrip ? RATE_ROUND_TRIP : RATE_ONE_WAY}/km).`,
        );
      } else {
        notes.push(`Petrol amount aligns with ${refKms} km at ₹${claim.roundTrip ? RATE_ROUND_TRIP : RATE_ONE_WAY}/km.`);
      }
    }

    if (claim.busAmount > 0 && pjpLegs.length === 0) {
      issues.push('Bus fare claimed but no PJP route logged for the day.');
    }

    let geoNote = null;
    if (coords && claim.toTown) {
      const geo = geocodeTown(claim.toTown);
      if (geo?.mapped && geo.lat != null) {
        const dist = haversineKm(coords, { lat: geo.lat, lng: geo.lng });
        if (dist != null && dist > TOWN_MATCH_TOLERANCE_KM) {
          issues.push(
            `Attendance GPS is ~${Math.round(dist)} km from claimed destination "${claim.toTown}".`,
          );
        } else {
          geoNote = `GPS within ~${Math.round(dist || 0)} km of ${claim.toTown}.`;
        }
      }
    }

    results.push({
      id: `claim-${index}`,
      claim,
      auditor,
      dateKey,
      status: issues.length === 0 ? 'pass' : 'flag',
      issues,
      notes: geoNote ? [...notes, geoNote] : notes,
      context: {
        attendancePresent: attendance?.isPresent ?? null,
        attendanceLocation: attendance?.location ?? null,
        pjpLegs: pjpLegs.map((l) => ({
          from: l.fromTown,
          to: l.toTown,
          kms: l.kms,
        })),
        expectedPetrol,
        pjpTotalKms: pjpKms,
      },
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
      from: r.claim.fromTown,
      to: r.claim.toTown,
      kms: r.claim.kms,
      petrol: r.claim.petrolAmount,
      bus: r.claim.busAmount,
      roundTrip: r.claim.roundTrip,
      issues: r.issues,
      pjp: r.context.pjpLegs,
      attendance: r.context.attendanceLocation,
    })),
});
