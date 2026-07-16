/**
 * Merge two expense workbook "parts" (e.g. days 1–15 and days 16–31 of the same
 * month) into a single set of per-auditor vouchers, identical in shape to a
 * one-time upload so every dashboard / verifier keeps working unchanged.
 */

const normId = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const num = (n) => Number(n) || 0;
const sum = (a, b) => num(a) + num(b);

const voucherKey = (v) => {
  const emp = String(v?.employeeNo || '').trim();
  if (emp) return `emp:${emp.toLowerCase()}`;
  return `name:${normId(v?.auditorName || v?.sheetName)}`;
};

const dateKeyOf = (b) => String(b?.dateKey || '');

/** Rebuild the enriched `totals` block using the same formula as image analysis. */
const recomputeTotals = (v) => {
  const manualTickets = num(v.dateWiseTicketsSum);
  const manualPetrol = num(v.dateWisePetrolSum);
  const fromTickets = num(v.imageAnalysis?.totalFromTickets);
  const busTravelLocal = fromTickets > 0 ? fromTickets : manualTickets;
  const stayAmount = Math.max(num(v.accommodationTotal), num(v.dateWiseAccommodationSum));
  const petrolAmount = Math.max(num(v.fuelTotal), manualPetrol);
  const correctTotal = busTravelLocal + petrolAmount + stayAmount;
  const headerParts = num(v.fuelTotal) + num(v.ticketsTotal) + num(v.accommodationTotal);

  return {
    declaredTotal: num(v.declaredTotal),
    headerParts,
    manualDateWiseSum: manualTickets + manualPetrol,
    manualTicketsSum: manualTickets,
    manualPetrolSum: manualPetrol,
    dateWiseAccommodationSum: num(v.dateWiseAccommodationSum),
    dateWiseGrandSum: num(v.dateWiseGrandSum),
    headerTicketsLocal: num(v.ticketsTotal),
    fromTicketImages: fromTickets,
    fuelHeader: num(v.fuelTotal),
    accommodation: stayAmount,
    petrolExpectedFromMap: (v.mapLegs || []).reduce((s, leg) => {
      const rate = leg.roundTrip ? 8 : 4;
      return s + num(leg.kms) * rate;
    }, 0),
    correctTotal,
    difference: num(v.declaredTotal) - correctTotal,
  };
};

const mergeTwoVouchers = (a, b) => {
  const merged = {
    ...a,
    auditorName: a.auditorName || b.auditorName,
    employeeNo: a.employeeNo || b.employeeNo,
    sheetName: a.sheetName || b.sheetName,
    fuelTotal: sum(a.fuelTotal, b.fuelTotal),
    ticketsTotal: sum(a.ticketsTotal, b.ticketsTotal),
    accommodationTotal: sum(a.accommodationTotal, b.accommodationTotal),
    declaredTotal: sum(a.declaredTotal, b.declaredTotal),
    dateBlocks: [...(a.dateBlocks || []), ...(b.dateBlocks || [])].sort((x, y) =>
      dateKeyOf(x).localeCompare(dateKeyOf(y)),
    ),
    dateWiseBusTrainSum: sum(a.dateWiseBusTrainSum, b.dateWiseBusTrainSum),
    dateWiseTicketsSum: sum(a.dateWiseTicketsSum, b.dateWiseTicketsSum),
    dateWisePetrolSum: sum(a.dateWisePetrolSum, b.dateWisePetrolSum),
    dateWiseAccommodationSum: sum(a.dateWiseAccommodationSum, b.dateWiseAccommodationSum),
    dateWiseGrandSum: sum(a.dateWiseGrandSum, b.dateWiseGrandSum),
    headerPartsSum: sum(a.headerPartsSum, b.headerPartsSum),
    headerCorrected: [...(a.headerCorrected || []), ...(b.headerCorrected || [])],
    mapLegs: [...(a.mapLegs || []), ...(b.mapLegs || [])],
    imageUrls: [...new Set([...(a.imageUrls || []), ...(b.imageUrls || [])])],
    voucherMode: a.voucherMode === b.voucherMode ? a.voucherMode : 'mixed',
    imageAnalysis: {
      bills: [
        ...((a.imageAnalysis && a.imageAnalysis.bills) || []),
        ...((b.imageAnalysis && b.imageAnalysis.bills) || []),
      ],
      tickets: [
        ...((a.imageAnalysis && a.imageAnalysis.tickets) || []),
        ...((b.imageAnalysis && b.imageAnalysis.tickets) || []),
      ],
      totalFromTickets: sum(a.imageAnalysis?.totalFromTickets, b.imageAnalysis?.totalFromTickets),
      imageCount: sum(a.imageAnalysis?.imageCount, b.imageAnalysis?.imageCount),
      cacheHits: sum(a.imageAnalysis?.cacheHits, b.imageAnalysis?.cacheHits),
      provider: a.imageAnalysis?.provider || b.imageAnalysis?.provider || '',
      note: [a.imageAnalysis?.note, b.imageAnalysis?.note].filter(Boolean).join(' | '),
    },
    _mergedParts: (a._mergedParts || 1) + (b._mergedParts || 1),
  };
  merged.totals = recomputeTotals(merged);
  return merged;
};

export const mergeExpenseVoucherParts = (partA = [], partB = []) => {
  const map = new Map();
  const order = [];

  for (const v of partA) {
    const k = voucherKey(v);
    if (map.has(k)) map.set(k, mergeTwoVouchers(map.get(k), v));
    else {
      map.set(k, v);
      order.push(k);
    }
  }
  for (const v of partB) {
    const k = voucherKey(v);
    if (map.has(k)) map.set(k, mergeTwoVouchers(map.get(k), v));
    else {
      map.set(k, v);
      order.push(k);
    }
  }

  return order.map((k) => map.get(k));
};

const summaryKey = (s) => {
  const emp = String(s?.employeeNo || '').trim();
  if (emp) return `emp:${emp.toLowerCase()}`;
  return `name:${normId(s?.auditorName || s?.sheetName)}`;
};

/** One row per auditor: keep the first part's sheetName, sum date-row counts. */
export const mergeSheetSummaries = (a = [], b = []) => {
  const map = new Map();
  const order = [];
  const add = (s) => {
    const k = summaryKey(s);
    if (map.has(k)) {
      const prev = map.get(k);
      map.set(k, {
        ...prev,
        dateRows: num(prev.dateRows) + num(s.dateRows),
        status: prev.status === 'loaded' || s.status === 'loaded' ? 'loaded' : prev.status,
      });
    } else {
      map.set(k, { ...s });
      order.push(k);
    }
  };
  a.forEach(add);
  b.forEach(add);
  return order.map((k) => map.get(k));
};

/** Parts cover disjoint date ranges, so date counts add up. */
export const mergeDateAuditSummaries = (a, b) => {
  const sa = a?.summary;
  const sb = b?.summary;
  if (!sa && !sb) return null;
  if (!sa) return b;
  if (!sb) return a;
  return {
    ...a,
    summary: {
      auditors: Math.max(num(sa.auditors), num(sb.auditors)),
      totalDates: num(sa.totalDates) + num(sb.totalDates),
      passedDates: num(sa.passedDates) + num(sb.passedDates),
      flaggedDates: num(sa.flaggedDates) + num(sb.flaggedDates),
    },
  };
};
