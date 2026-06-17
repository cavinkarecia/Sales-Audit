import { namesMatch } from './nameMatcher.js';
import { getAttendanceForAuditorDate } from './attendanceProcessor.js';

const PETROL_ONE_WAY = 4;
const PETROL_ROUND = 8;

const normTown = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const townsMatch = (a, b) => {
  const na = normTown(a);
  const nb = normTown(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
};

const flag = (severity, code, message, detail = {}) => ({
  severity,
  code,
  message,
  ...detail,
});

export const verifyExpenseVoucher = (voucher, attendanceRecords = [], pjpRecords = []) => {
  const flags = [];
  const dateResults = [];

  if (!voucher.auditorName) {
    flags.push(flag('red', 'NO_AUDITOR', 'Missing Requested By / auditor name'));
  }

  const headerParts =
    voucher.fuelTotal + voucher.ticketsTotal + voucher.accommodationTotal;
  const headerRecon = Math.abs(headerParts - voucher.declaredTotal);
  if (voucher.declaredTotal > 0 && headerRecon > 5) {
    flags.push(
      flag(
        'orange',
        'HEADER_TOTAL_MISMATCH',
        `Header Total ₹${voucher.declaredTotal} ≠ Fuel ₹${voucher.fuelTotal} + Tickets/Local ₹${voucher.ticketsTotal} + Stay ₹${voucher.accommodationTotal} (diff ₹${Math.round(headerRecon)})`,
        { declaredTotal: voucher.declaredTotal, headerParts },
      ),
    );
  }

  if (voucher.dateBlocks.length === 0) {
    flags.push(
      flag(
        'red',
        'NO_DATE_ROWS',
        'No date-wise expense rows found (dates in column A with travel/local/grand total anywhere in row)',
      ),
    );
  }

  voucher.dateBlocks.forEach((block) => {
    const dayFlags = [];

    if (block.isPetrolDay || block.isKmPetrolDay || block.splitType === 'petrol_km') {
      if (block.kmTraveled > 0) {
        const expectedPetrol = block.kmCalcAmount || Math.round(block.kmTraveled * PETROL_ONE_WAY);
        const sheetAmt = block.petrolTravel || block.dayTotal || block.grandTotal;
        const kmNote = block.kmLegs?.length > 1
          ? `${block.kmLegs.join('+')}=${block.kmTraveled} km`
          : `${block.kmTraveled} km`;

        if (Math.abs(expectedPetrol - sheetAmt) > 5) {
          dayFlags.push(
            flag(
              'red',
              'PETROL_KM_MISMATCH',
              `${block.date}: ${kmNote} × ₹${PETROL_ONE_WAY} = ₹${expectedPetrol} but sheet shows ₹${sheetAmt}`,
            ),
          );
        } else {
          dayFlags.push(
            flag(
              'green',
              'PETROL_KM_OK',
              `${block.date}: ${kmNote} × ₹${PETROL_ONE_WAY} = ₹${expectedPetrol} matches sheet ₹${sheetAmt}`,
            ),
          );
        }
      } else if (block.petrolTravel > 0) {
        dayFlags.push(
          flag(
            'green',
            'PETROL_DAY',
            `${block.date}: Petrol/fuel ₹${block.petrolTravel} (no km row in sheet)`,
          ),
        );
      }
    } else {
      const sumMismatch = Math.abs(block.ticketsSubtotal - (block.grandTotal - block.accommodation)) > 5;
      if (sumMismatch && block.grandTotal > 0 && block.accommodation === 0) {
        dayFlags.push(
          flag(
            'red',
            'DATE_SUM_MISMATCH',
            `${block.date}: travel ₹${block.travel} + local ₹${block.localConveyance} ≠ grand total ₹${block.grandTotal}`,
          ),
        );
      } else if (block.accommodation > 0 && block.grandTotal > 0) {
        const expected = block.ticketsSubtotal + block.accommodation;
        if (Math.abs(expected - block.grandTotal) > 5) {
          dayFlags.push(
            flag(
              'orange',
              'DATE_BREAKDOWN_MISMATCH',
              `${block.date}: travel ₹${block.travel} + local ₹${block.localConveyance} + stay ₹${block.accommodation} ≠ grand total ₹${block.grandTotal}`,
            ),
          );
        }
      }
    }

    if (block.ticketAmountFromImages > 0) {
      const target = block.imageCompareTarget ?? block.ticketComparable;
      if (block.manualMatchesImages === false) {
        dayFlags.push(
          flag(
            'red',
            'TICKET_IMAGE_MISMATCH',
            `${block.date}: Sheet travel ₹${target} ≠ ticket image ₹${block.ticketAmountFromImages}`,
          ),
        );
      } else {
        dayFlags.push(
          flag(
            'green',
            'TICKET_IMAGE_OK',
            `${block.date}: Ticket image ₹${block.ticketAmountFromImages} matches sheet travel ₹${target}`,
          ),
        );
      }
    } else if (block.hasBusTrainHint && !block.isPetrolDay && !block.isKmPetrolDay) {
      dayFlags.push(
        flag(
          'orange',
          'NO_TICKET_IMAGE',
          `${block.date}: Bus/train travel ₹${block.travel} — no matching ticket amount from images`,
        ),
      );
    }

    const att = getAttendanceForAuditorDate(
      attendanceRecords,
      voucher.auditorName,
      block.dateKey,
    );
    if (attendanceRecords.length && !att) {
      dayFlags.push(
        flag('orange', 'NO_ATTENDANCE', `${block.date}: No matching attendance row for auditor`),
      );
    } else if (att && !att.isPresent) {
      const reason = String(att.absentReason || '').toLowerCase();
      if (/leave|education|no audit/i.test(reason)) {
        dayFlags.push(flag('red', 'ATTENDANCE_REJECT', `${block.date}: Absent — ${att.absentReason}`));
      }
    }

    dateResults.push({
      ...block,
      flags: dayFlags,
      status: dayFlags.some((f) => f.severity === 'red')
        ? 'flag'
        : dayFlags.some((f) => f.severity === 'orange')
          ? 'review'
          : 'ok',
    });
    flags.push(...dayFlags);
  });

  const manualTravel = (voucher.dateWiseTicketsSum || 0) + (voucher.dateWisePetrolSum || 0);

  if (voucher.ticketsTotal > 0 && voucher.dateWiseTicketsSum > 0) {
    const diff = Math.abs(voucher.ticketsTotal - voucher.dateWiseTicketsSum);
    if (diff > 10) {
      flags.push(
        flag(
          'red',
          'TICKETS_VS_DATE_SUM',
          `Tickets+Local header ₹${voucher.ticketsTotal} ≠ sum of date-wise travel+local ₹${voucher.dateWiseTicketsSum} (diff ₹${Math.round(diff)})`,
          { ticketHeader: voucher.ticketsTotal, dateSum: voucher.dateWiseTicketsSum },
        ),
      );
    }
  }

  if (voucher.fuelTotal > 0 && voucher.dateWisePetrolSum > 0) {
    const diff = Math.abs(voucher.fuelTotal - voucher.dateWisePetrolSum);
    if (diff > 50) {
      flags.push(
        flag(
          'orange',
          'FUEL_VS_DATE_SUM',
          `Fuel header ₹${voucher.fuelTotal} vs date-wise petrol totals ₹${voucher.dateWisePetrolSum}`,
        ),
      );
    }
  }

  if (voucher.accommodationTotal > 0 && voucher.dateWiseAccommodationSum > 0) {
    const diff = Math.abs(voucher.accommodationTotal - voucher.dateWiseAccommodationSum);
    if (diff > 10 && voucher.dateWiseAccommodationSum < voucher.accommodationTotal) {
      flags.push(
        flag(
          'orange',
          'STAY_PARTIAL_IN_DATES',
          `Stay header ₹${voucher.accommodationTotal} — only ₹${voucher.dateWiseAccommodationSum} listed inside date blocks (rest may be in header only)`,
        ),
      );
    }
  }

  voucher.mapLegs.forEach((leg, i) => {
    const expected = leg.roundTrip ? leg.kms * PETROL_ROUND : leg.kms * PETROL_ONE_WAY;
    const sameStop = townsMatch(leg.fromTown, leg.toTown);

    if (sameStop && leg.roundTrip) {
      flags.push(
        flag(
          'red',
          'SAME_STOP_ROUND_TRIP',
          `Map leg ${i + 1}: From and To are the same stop but round-trip ₹8/km applied — should be one-way ₹4/km`,
          { leg },
        ),
      );
    }

    if (leg.kms > 0) {
      flags.push(
        flag(
          'green',
          'PETROL_CALC',
          `Petrol leg ${i + 1}: ${leg.kms} km × ₹${leg.roundTrip ? PETROL_ROUND : PETROL_ONE_WAY} = ₹${expected} (secondary check)`,
          { expected, leg },
        ),
      );
    }
  });

  if (voucher.totals) {
    const t = voucher.totals;
    if (Math.abs(t.difference) > 10) {
      flags.push(
        flag(
          t.difference > 0 ? 'orange' : 'red',
          'CORRECT_TOTAL_MISMATCH',
          `Declared ₹${t.declaredTotal} vs correct total ₹${t.correctTotal} (diff ₹${Math.round(t.difference)})`,
          t,
        ),
      );
    }
    if (t.fromTicketImages > 0 && Math.abs(t.fromTicketImages - t.manualDateWiseSum) > 10) {
      flags.push(
        flag(
          'orange',
          'MANUAL_VS_TICKET_IMAGE',
          `Manual travel total ₹${t.manualDateWiseSum} vs bus/train from ticket images ₹${t.fromTicketImages}`,
          t,
        ),
      );
    }

    const rebuilt =
      (t.fromTicketImages || t.manualDateWiseSum || 0) +
      (t.accommodation || 0) +
      (t.fuelHeader || 0);
    if (voucher.declaredTotal > 0 && Math.abs(rebuilt - t.correctTotal) <= 5) {
      flags.push(
        flag(
          'green',
          'TOTAL_FORMULA',
          `Correct total = Travel ₹${t.fromTicketImages || t.manualDateWiseSum} + Stay ₹${t.accommodation} + Fuel ₹${t.fuelHeader} = ₹${t.correctTotal}`,
        ),
      );
    }
  }

  const redCount = flags.filter((f) => f.severity === 'red').length;
  const orangeCount = flags.filter((f) => f.severity === 'orange').length;

  return {
    id: `${voucher.sheetName}-${voucher.auditorName}`,
    voucher,
    flags,
    dateResults,
    summary: {
      auditorName: voucher.auditorName,
      employeeNo: voucher.employeeNo,
      declaredTotal: voucher.declaredTotal,
      correctTotal: voucher.totals?.correctTotal ?? voucher.declaredTotal,
      dateRows: voucher.dateBlocks.length,
      redCount,
      orangeCount,
      status: redCount > 0 ? 'flag' : orangeCount > 0 ? 'review' : 'pass',
    },
  };
};

export const verifyAllExpenseVouchers = (vouchers, attendanceRecords, pjpRecords) => {
  const results = vouchers.map((v) =>
    verifyExpenseVoucher(v, attendanceRecords, pjpRecords),
  );
  return {
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.summary.status === 'pass').length,
      review: results.filter((r) => r.summary.status === 'review').length,
      flagged: results.filter((r) => r.summary.status === 'flag').length,
    },
  };
};

export const buildExpenseAIPayload = (verification) => ({
  summary: verification.summary,
  flagged: verification.results
    .filter((r) => r.summary.status !== 'pass')
    .map((r) => ({
      auditor: r.voucher.auditorName,
      employeeNo: r.voucher.employeeNo,
      declaredTotal: r.voucher.declaredTotal,
      correctTotal: r.voucher.totals?.correctTotal,
      dateBlocks: r.voucher.dateBlocks,
      flags: r.flags.filter((f) => f.severity !== 'green'),
    })),
});
