import { sumDaySplits } from './expenseDayCheck.js';
import { computeDateWiseTicketsLocalSum } from './expenseVoucherParser.js';

export const TOL = {
  fuel: 50,
  tickets: 10,
  stay: 10,
  grand: 15,
  headerParts: 5,
  dayGrand: 5,
};

export const near = (a, b, tol) => Math.abs((a || 0) - (b || 0)) <= tol;

const roundRs = (n) => Math.round(Number(n) || 0);

/** Single source of truth for one auditor tab — header vs date-wise sums. */
export const computeAuditorAmounts = (voucher) => {
  const blocks = voucher?.dateBlocks || [];
  const splits = sumDaySplits(blocks);

  const header = {
    fuel: roundRs(voucher?.fuelTotal),
    ticketsLocal: roundRs(voucher?.ticketsTotal),
    stay: roundRs(voucher?.accommodationTotal),
    declared: roundRs(voucher?.declaredTotal),
  };

  const fromDates = {
    fuel: roundRs(blocks.reduce((s, b) => s + (b.petrolTravel || 0), 0)),
    conveyance: roundRs(blocks.reduce((s, b) => s + (b.conveyance || 0), 0)),
    ticketsLocal: roundRs(computeDateWiseTicketsLocalSum(blocks)),
    stay: roundRs(blocks.reduce((s, b) => s + (b.accommodation || 0), 0)),
    travel: roundRs(splits.travel),
    local: roundRs(splits.local),
    cash: roundRs(splits.cash),
    daySplitTotal: roundRs(splits.daySplitTotal),
  };

  fromDates.grand = fromDates.fuel + fromDates.ticketsLocal + fromDates.stay;

  const headerPartsSum = header.fuel + header.ticketsLocal + header.stay;
  const declaredUsed = header.declared > 0 ? header.declared : headerPartsSum;

  const checks = {
    headerPartsOk: near(headerPartsSum, declaredUsed, TOL.headerParts),
    fuelOk: header.fuel <= 0 || fromDates.fuel <= 0 || near(header.fuel, fromDates.fuel, TOL.fuel),
    ticketsOk:
      header.ticketsLocal <= 0 ||
      fromDates.ticketsLocal <= 0 ||
      near(header.ticketsLocal, fromDates.ticketsLocal, TOL.tickets),
    stayOk:
      header.stay <= 0 || fromDates.stay <= 0 || near(header.stay, fromDates.stay, TOL.stay),
    grandOk: declaredUsed <= 0 || near(declaredUsed, fromDates.grand, TOL.grand),
    daySplitOk: near(fromDates.daySplitTotal, fromDates.grand, TOL.dayGrand),
  };

  checks.allOk =
    checks.headerPartsOk &&
    checks.fuelOk &&
    checks.ticketsOk &&
    checks.stayOk &&
    checks.grandOk &&
    checks.daySplitOk;

  const issues = [];

  if (Array.isArray(voucher?.headerCorrected) && voucher.headerCorrected.length) {
    issues.push({
      severity: 'orange',
      code: 'HEADER_AUTO_CORRECT',
      message: `Header amounts adjusted: ${voucher.headerCorrected.join('; ')}`,
    });
  }

  if (header.declared > 0 && !checks.headerPartsOk) {
    issues.push({
      severity: 'red',
      code: 'HEADER_FORMULA',
      message: `Sheet header Total ₹${declaredUsed} ≠ Fuel ₹${header.fuel} + Tickets+Local ₹${header.ticketsLocal} + Stay ₹${header.stay} = ₹${headerPartsSum} (difference ₹${Math.abs(declaredUsed - headerPartsSum)})`,
    });
  }

  if (header.fuel > 0 && fromDates.fuel > 0 && !checks.fuelOk) {
    issues.push({
      severity: 'red',
      code: 'FUEL_MISMATCH',
      message: `Fuel: header ₹${header.fuel} ≠ sum of petrol on all date rows ₹${fromDates.fuel} (difference ₹${Math.abs(header.fuel - fromDates.fuel)})`,
    });
  }

  if (header.ticketsLocal > 0 && fromDates.ticketsLocal > 0 && !checks.ticketsOk) {
    issues.push({
      severity: 'red',
      code: 'TICKETS_MISMATCH',
      message: `Tickets + Local: header ₹${header.ticketsLocal} ≠ sum of Travel + Local on bus/train days ₹${fromDates.ticketsLocal} (difference ₹${Math.abs(header.ticketsLocal - fromDates.ticketsLocal)})`,
    });
  }

  if (header.stay > 0 && fromDates.stay > 0 && !checks.stayOk) {
    issues.push({
      severity: 'red',
      code: 'STAY_MISMATCH',
      message: `Stay: header ₹${header.stay} ≠ sum of stay on all date rows ₹${fromDates.stay} (difference ₹${Math.abs(header.stay - fromDates.stay)})`,
    });
  }

  if (declaredUsed > 0 && !checks.grandOk) {
    issues.push({
      severity: 'red',
      code: 'GRAND_MISMATCH',
      message: `Grand total: declared ₹${declaredUsed} ≠ date-wise total (Fuel ₹${fromDates.fuel} + Tickets+Local ₹${fromDates.ticketsLocal} + Stay ₹${fromDates.stay} = ₹${fromDates.grand}) — difference ₹${Math.abs(declaredUsed - fromDates.grand)}`,
    });
  }

  if (!checks.daySplitOk && fromDates.daySplitTotal > 0) {
    issues.push({
      severity: 'orange',
      code: 'DAY_SPLIT_SUM',
      message: `Day table sum ₹${fromDates.daySplitTotal} ≠ Fuel+Tickets+Stay from dates ₹${fromDates.grand} — check a date row is missing a column`,
    });
  }

  return {
    header,
    fromDates,
    splits,
    headerPartsSum,
    declaredUsed,
    checks,
    issues,
  };
};

/** Sum amounts across every auditor tab in the workbook. */
export const computeWorkbookTotals = (vouchers) => {
  const empty = {
    auditors: 0,
    header: { fuel: 0, ticketsLocal: 0, stay: 0, declared: 0 },
    fromDates: { fuel: 0, ticketsLocal: 0, stay: 0, grand: 0 },
    mismatchAuditors: 0,
  };

  if (!vouchers?.length) return empty;

  const acc = { ...empty, auditors: vouchers.length };

  for (const v of vouchers) {
    const a = computeAuditorAmounts(v);
    acc.header.fuel += a.header.fuel;
    acc.header.ticketsLocal += a.header.ticketsLocal;
    acc.header.stay += a.header.stay;
    acc.header.declared += a.declaredUsed;
    acc.fromDates.fuel += a.fromDates.fuel;
    acc.fromDates.ticketsLocal += a.fromDates.ticketsLocal;
    acc.fromDates.stay += a.fromDates.stay;
    acc.fromDates.grand += a.fromDates.grand;
    if (!a.checks.allOk) acc.mismatchAuditors += 1;
  }

  acc.headerPartsSum =
    acc.header.fuel + acc.header.ticketsLocal + acc.header.stay;

  acc.checks = {
    headerPartsOk: near(acc.header.declared, acc.headerPartsSum, TOL.headerParts * vouchers.length),
    fuelOk: near(acc.header.fuel, acc.fromDates.fuel, TOL.fuel * vouchers.length),
    ticketsOk: near(acc.header.ticketsLocal, acc.fromDates.ticketsLocal, TOL.tickets * vouchers.length),
    stayOk: near(acc.header.stay, acc.fromDates.stay, TOL.stay * vouchers.length),
    grandOk: near(acc.headerPartsSum, acc.fromDates.grand, TOL.grand * vouchers.length),
  };

  return acc;
};

export const getAuditorColumnFlags = (voucher) => {
  const blocks = voucher?.dateBlocks || [];
  const hasBlock = (fn) => blocks.some(fn);
  return {
    fuel: (voucher?.fuelTotal || 0) > 0 || hasBlock((b) => (b.petrolTravel || 0) > 0),
    conveyance: hasBlock((b) => (b.conveyance || 0) > 0),
    ticketsLocal:
      (voucher?.ticketsTotal || 0) > 0 ||
      hasBlock((b) => (b.travel || 0) + (b.localConveyance || 0) + (b.cash || 0) > 0),
    stay: (voucher?.accommodationTotal || 0) > 0 || hasBlock((b) => (b.accommodation || 0) > 0),
  };
};
  const v = roundRs(n);
  if (v <= 0) return '—';
  return `₹${v.toLocaleString('en-IN')}`;
};

export const diffLabel = (a, b) => {
  const d = roundRs(a) - roundRs(b);
  if (d === 0) return 'match';
  return d > 0 ? `₹${d} more in header` : `₹${Math.abs(d)} more in dates`;
};
