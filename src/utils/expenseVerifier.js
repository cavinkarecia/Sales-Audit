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
    voucher.fuelTotal +
    voucher.ticketsTotal +
    voucher.accommodationTotal;
  const headerRecon = Math.abs(headerParts - voucher.declaredTotal);
  if (voucher.declaredTotal > 0 && headerRecon > 5) {
    flags.push(
      flag(
        'orange',
        'HEADER_TOTAL_MISMATCH',
        `Header Total ₹${voucher.declaredTotal} ≠ Fuel+Tickets+Stay ₹${headerParts} (diff ₹${Math.round(headerRecon)})`,
        { declaredTotal: voucher.declaredTotal, headerParts },
      ),
    );
  }

  if (voucher.dateBlocks.length === 0) {
    flags.push(
      flag(
        'red',
        'NO_DATE_ROWS',
        'No date-wise travel / local conveyance rows found in column A (e.g. 01/04/26)',
      ),
    );
  }

  voucher.dateBlocks.forEach((block) => {
    const dayFlags = [];
    const sumMismatch = Math.abs(block.computedSum - block.grandTotal) > 2;
    if (sumMismatch) {
      dayFlags.push(
        flag(
          'red',
          'DATE_SUM_MISMATCH',
          `${block.date}: travel ₹${block.travel} + local ₹${block.localConveyance} ≠ grand total ₹${block.grandTotal}`,
        ),
      );
    }

    if (block.billImagesLikely) {
      dayFlags.push(
        flag(
          'green',
          'BUS_TRAIN_EVIDENCE',
          `${block.date}: Bus/train section present — manual entry ₹${block.grandTotal} (verify ticket image amounts in sheet)`,
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

  const dateSum = voucher.dateWiseBusTrainSum;
  const ticketHeader = voucher.ticketsTotal;
  if (ticketHeader > 0 && dateSum > 0 && Math.abs(ticketHeader - dateSum) > 10) {
    flags.push(
      flag(
        'orange',
        'TICKETS_VS_DATE_SUM',
        `Tickets+Local header ₹${ticketHeader} vs date-wise grand totals ₹${dateSum}`,
        { ticketHeader, dateSum },
      ),
    );
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

    const pjpAuditor = pjpRecords.filter((p) =>
      namesMatch(p.employeeName, voucher.auditorName),
    );
    if (pjpRecords.length && leg.kms > 0 && pjpAuditor.length) {
      const pjpKms = pjpAuditor.reduce((s, p) => s + (p.kms || 0), 0);
      if (pjpKms > 0 && Math.abs(pjpKms - leg.kms) > 15) {
        flags.push(
          flag(
            'orange',
            'PJP_KM_MISMATCH',
            `Map leg ${leg.kms} km vs PJP total ${Math.round(pjpKms)} km for auditor`,
          ),
        );
      }
    }
  });

  if (voucher.fuelTotal > 0) {
    flags.push(
      flag(
        'green',
        'PETROL_NOTED',
        `Fuel Expenses ₹${voucher.fuelTotal} — tracked separately (Step 9: lower priority)`,
      ),
    );
  }

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
          `Manual date-wise ₹${t.manualDateWiseSum} vs bus/train from ticket images ₹${t.fromTicketImages}`,
          t,
        ),
      );
    }
  }

  voucher.dateBlocks?.forEach((block) => {
    if (block.manualMatchesImages === false) {
      flags.push(
        flag(
          'red',
          'TICKET_IMAGE_MISMATCH',
          `${block.date}: Manual ₹${block.grandTotal} ≠ ticket image total ₹${block.ticketAmountFromImages}`,
        ),
      );
    }
  });

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
      dateBlocks: r.voucher.dateBlocks,
      flags: r.flags.filter((f) => f.severity !== 'green'),
    })),
});
