import { PETROL_KM_RATE } from './expenseVoucherParser.js';

const near = (a, b, tol = 5) => Math.abs(a - b) <= tol;

/** Validate one date block — used for every date on every auditor tab. */
export const validateDateBlock = (block) => {
  const issues = [];
  const ok = [];

  const petrolAmt = block.petrolTravel || 0;
  const travel = block.travel || 0;
  const local = block.localConveyance || 0;
  const stay = block.accommodation || 0;
  const grand = block.grandTotal || 0;
  const tickets = block.ticketsSubtotal ?? travel + local;

  const isKmPetrol = block.isKmPetrolDay || block.splitType === 'petrol_km';
  const isPetrol = block.isPetrolDay || block.splitType === 'petrol' || isKmPetrol;
  const isBus = block.hasBusTrainHint || block.splitType === 'bus_train';

  if (grand <= 0 && tickets <= 0 && petrolAmt <= 0 && stay <= 0) {
    issues.push({ code: 'EMPTY_DAY', message: `${block.date}: No amounts found` });
    return { issues, ok, status: 'flag' };
  }

  if (isKmPetrol && block.kmTraveled > 0) {
    const expected = block.kmCalcAmount || Math.round(block.kmTraveled * PETROL_KM_RATE);
    const kmNote =
      block.kmLegs?.length > 1
        ? `${block.kmLegs.join('+')}=${block.kmTraveled} km`
        : `${block.kmTraveled} km`;
    const sheetAmt = petrolAmt || block.dayTotal || grand;

    if (near(expected, sheetAmt)) {
      ok.push({
        code: 'PETROL_KM_OK',
        message: `${block.date}: ${kmNote} × ₹${PETROL_KM_RATE} = ₹${expected} ✓`,
      });
    } else {
      issues.push({
        code: 'PETROL_KM_MISMATCH',
        message: `${block.date}: ${kmNote} × ₹${PETROL_KM_RATE} = ₹${expected} but sheet ₹${sheetAmt}`,
      });
    }
  } else if (isPetrol && petrolAmt > 0) {
    if (near(petrolAmt, grand) || stay === 0) {
      ok.push({
        code: 'PETROL_OK',
        message: `${block.date}: Petrol ₹${petrolAmt} (fuel day)`,
      });
    }
  }

  if (isBus && !isPetrol) {
    const expected = tickets + stay;
    if (grand > 0 && !near(expected, grand)) {
      issues.push({
        code: 'BUS_SUM_MISMATCH',
        message: `${block.date}: travel ₹${travel} + local ₹${local} + stay ₹${stay} ≠ grand ₹${grand}`,
      });
    } else if (grand > 0) {
      ok.push({
        code: 'BUS_OK',
        message: `${block.date}: travel ₹${travel} + local ₹${local}${stay ? ` + stay ₹${stay}` : ''} = ₹${grand} ✓`,
      });
    }
  }

  if (grand > 0 && travel === 0 && local === 0 && petrolAmt === 0 && stay === 0) {
    issues.push({
      code: 'UNPARSED_SPLIT',
      message: `${block.date}: Grand total ₹${grand} but no travel/local/petrol/stay line found — check sheet layout`,
    });
  }

  const status = issues.some((i) => i.code.includes('MISMATCH') || i.code === 'UNPARSED_SPLIT')
    ? 'flag'
    : issues.length
      ? 'review'
      : 'ok';

  return { issues, ok, status };
};

export const auditVoucherDates = (voucher) => {
  const perDate = (voucher.dateBlocks || []).map((block) => ({
    date: block.date,
    splitType: block.splitType,
    ...validateDateBlock(block),
  }));

  const issueCount = perDate.reduce((s, d) => s + d.issues.length, 0);
  const okCount = perDate.reduce((s, d) => s + d.ok.length, 0);

  const headerIssues = [];
  if (voucher.fuelTotal > 0 && voucher.dateWisePetrolSum > 0) {
    if (!near(voucher.fuelTotal, voucher.dateWisePetrolSum, 50)) {
      headerIssues.push({
        code: 'FUEL_HEADER_MISMATCH',
        message: `Fuel header ₹${voucher.fuelTotal} ≠ date petrol sum ₹${voucher.dateWisePetrolSum}`,
      });
    }
  }
  if (voucher.ticketsTotal > 0 && voucher.dateWiseTicketsSum > 0) {
    if (!near(voucher.ticketsTotal, voucher.dateWiseTicketsSum, 10)) {
      headerIssues.push({
        code: 'TICKETS_HEADER_MISMATCH',
        message: `Tickets+Local header ₹${voucher.ticketsTotal} ≠ date sum ₹${voucher.dateWiseTicketsSum}`,
      });
    }
  }

  return {
    auditorName: voucher.auditorName,
    sheetName: voucher.sheetName,
    dateCount: perDate.length,
    issueCount,
    okCount,
    headerIssues,
    perDate,
    status:
      issueCount + headerIssues.length > 0
        ? 'flag'
        : perDate.length === 0
          ? 'review'
          : 'pass',
  };
};

export const auditAllVouchers = (vouchers) => {
  const audits = vouchers.map(auditVoucherDates);
  return {
    audits,
    summary: {
      auditors: audits.length,
      totalDates: audits.reduce((s, a) => s + a.dateCount, 0),
      flaggedDates: audits.reduce((s, a) => s + a.issueCount, 0),
      passedDates: audits.reduce((s, a) => s + a.okCount, 0),
      flaggedAuditors: audits.filter((a) => a.status === 'flag').length,
    },
  };
};
