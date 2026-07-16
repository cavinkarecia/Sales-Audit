import { flag, townsMatch } from './expenseVerifier.js';
import { namesMatch } from './nameMatcher.js';

export const GSTIN_HIGH_VALUE_INR = 5000;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const DHASH_DUPLICATE_THRESHOLD = 5;
export const ROUND_NUMBER_RATIO = 0.6;
export const TAMPER_ORANGE = 0.12;
export const TAMPER_RED = 0.28;

const hammingHex = (a, b) => {
  if (!a || !b || a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += x.toString(2).replace(/0/g, '').length;
  }
  return dist;
};

const collectBills = (vouchers) => {
  const out = [];
  for (const v of vouchers || []) {
    const bills = v?.imageAnalysis?.bills || v?.bills || [];
    for (const bill of bills) {
      out.push({
        ...bill,
        auditorName: v.auditorName,
        sheetName: v.sheetName,
        employeeNo: v.employeeNo,
      });
    }
  }
  return out;
};

/** Per-image / per-auditor OCR flags that don't need the whole workbook. */
export const auditBillsForVoucher = (voucher) => {
  const flags = [];
  const bills = voucher?.imageAnalysis?.bills || [];

  for (const bill of bills) {
    const label = bill.date || bill.billNumber || bill.vendorName || 'bill';

    if ((bill.ocrConfidence || 0) <= 0 || bill.suspiciousNotes === 'OCR failed to parse') {
      flags.push(
        flag('orange', 'OCR_FAILED', `OCR failed on image (${label})`, {
          imageUrl: bill.imageUrl,
        }),
      );
    } else if (bill.suspiciousNotes) {
      flags.push(
        flag('orange', 'OCR_SUSPICIOUS', `${label}: ${bill.suspiciousNotes}`, {
          imageUrl: bill.imageUrl,
          ocrConfidence: bill.ocrConfidence,
        }),
      );
    }

    if (bill.gstin) {
      if (!GSTIN_REGEX.test(String(bill.gstin).toUpperCase())) {
        flags.push(
          flag('orange', 'GSTIN_INVALID', `${label}: Invalid GSTIN ${bill.gstin}`, {
            gstin: bill.gstin,
            imageUrl: bill.imageUrl,
          }),
        );
      }
    } else if ((bill.amount || 0) > GSTIN_HIGH_VALUE_INR) {
      flags.push(
        flag(
          'orange',
          'GSTIN_MISSING_HIGH_VALUE',
          `${label}: Amount ₹${bill.amount} with no GSTIN on bill`,
          { amount: bill.amount, imageUrl: bill.imageUrl },
        ),
      );
    }

    if (Array.isArray(bill.lineItems) && bill.lineItems.length > 0) {
      const lineSum =
        bill.lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0) +
        (Number(bill.taxAmount) || 0);
      if (Math.abs(lineSum - (bill.amount || 0)) > 2) {
        flags.push(
          flag(
            'orange',
            'LINE_ITEMS_MISMATCH',
            `${label}: Line items ₹${lineSum} ≠ bill total ₹${bill.amount || 0}`,
            { lineSum, amount: bill.amount, imageUrl: bill.imageUrl },
          ),
        );
      }
    }

    if (bill.tamperScore != null) {
      if (bill.tamperScore >= TAMPER_RED) {
        flags.push(
          flag(
            'red',
            'TAMPERED_IMAGE',
            `${label}: Image looks edited (ELA score ${bill.tamperScore})`,
            { tamperScore: bill.tamperScore, imageUrl: bill.imageUrl },
          ),
        );
      } else if (bill.tamperScore >= TAMPER_ORANGE) {
        flags.push(
          flag(
            'orange',
            'TAMPERED_IMAGE',
            `${label}: Possible local edit on bill (ELA score ${bill.tamperScore}) — review`,
            { tamperScore: bill.tamperScore, imageUrl: bill.imageUrl },
          ),
        );
      }
    }
  }

  return flags;
};

/** Workbook-level fraud checks (duplicates across auditors, round amounts, route). */
export const auditBillsForFraud = (vouchers, { attendanceRecords = [], pjpRecords = [] } = {}) => {
  const allBills = collectBills(vouchers);
  const byVoucher = new Map();

  const push = (sheetName, f) => {
    if (!byVoucher.has(sheetName)) byVoucher.set(sheetName, []);
    byVoucher.get(sheetName).push(f);
  };

  // Seed with per-voucher OCR flags
  for (const v of vouchers || []) {
    const local = auditBillsForVoucher(v);
    local.forEach((f) => push(v.sheetName, f));
  }

  // DUPLICATE_BILL_IMAGE via dHash across workbook
  for (let i = 0; i < allBills.length; i++) {
    for (let j = i + 1; j < allBills.length; j++) {
      const a = allBills[i];
      const b = allBills[j];
      if (!a.dHash || !b.dHash) continue;
      const dist = hammingHex(a.dHash, b.dHash);
      if (dist <= DHASH_DUPLICATE_THRESHOLD) {
        const msg = `Duplicate bill image (hash distance ${dist}): ${a.auditorName || a.sheetName} ↔ ${b.auditorName || b.sheetName}`;
        push(
          a.sheetName,
          flag('red', 'DUPLICATE_BILL_IMAGE', msg, {
            otherSheet: b.sheetName,
            otherAuditor: b.auditorName,
            imageUrl: a.imageUrl,
            otherImageUrl: b.imageUrl,
          }),
        );
        push(
          b.sheetName,
          flag('red', 'DUPLICATE_BILL_IMAGE', msg, {
            otherSheet: a.sheetName,
            otherAuditor: a.auditorName,
            imageUrl: b.imageUrl,
            otherImageUrl: a.imageUrl,
          }),
        );
      }
    }
  }

  // CROSS_AUDITOR_DUPLICATE_BILL_NUMBER
  for (let i = 0; i < allBills.length; i++) {
    for (let j = i + 1; j < allBills.length; j++) {
      const a = allBills[i];
      const b = allBills[j];
      if (!a.billNumber || !b.billNumber) continue;
      if (String(a.billNumber).trim() !== String(b.billNumber).trim()) continue;
      if (Math.abs((a.amount || 0) - (b.amount || 0)) > 1) continue;
      if (a.date && b.date && String(a.date) !== String(b.date)) continue;
      const sameVendor =
        !a.vendorName || !b.vendorName || namesMatch(a.vendorName, b.vendorName);
      if (!sameVendor) continue;
      if (namesMatch(a.auditorName, b.auditorName) && a.sheetName === b.sheetName) continue;

      const msg = `Same bill #${a.billNumber} claimed by ${a.auditorName} and ${b.auditorName}`;
      push(a.sheetName, flag('red', 'CROSS_AUDITOR_DUPLICATE_BILL_NUMBER', msg, { billNumber: a.billNumber }));
      push(b.sheetName, flag('red', 'CROSS_AUDITOR_DUPLICATE_BILL_NUMBER', msg, { billNumber: b.billNumber }));
    }
  }

  // ROUND_NUMBER_PATTERN per auditor
  for (const v of vouchers || []) {
    const bills = (v.imageAnalysis?.bills || []).filter((b) => (b.amount || 0) > 0);
    if (bills.length < 4) continue;
    const roundish = bills.filter((b) => {
      const a = Math.round(b.amount || 0);
      return a % 50 === 0;
    }).length;
    if (roundish / bills.length >= ROUND_NUMBER_RATIO) {
      push(
        v.sheetName,
        flag(
          'orange',
          'ROUND_NUMBER_PATTERN',
          `${v.auditorName}: ${roundish}/${bills.length} bill amounts are multiples of ₹50 — review for fabrication`,
          { roundish, total: bills.length },
        ),
      );
    }
  }

  // ROUTE_INFEASIBLE — bill location vs attendance/PJP that day
  for (const v of vouchers || []) {
    for (const bill of v.imageAnalysis?.bills || []) {
      if (!bill.date || (!bill.fromLocation && !bill.toLocation)) continue;
      const billDigits = String(bill.date).replace(/[^0-9]/g, '');
      const att = (attendanceRecords || []).find((r) => {
        if (!namesMatch(r.name, v.auditorName)) return false;
        const key = String(r.chooseDateKey || r.chooseDate || r.date || '');
        const digits = key.replace(/[^0-9]/g, '');
        if (!digits || !billDigits) return false;
        return (
          digits === billDigits ||
          digits.slice(-6) === billDigits.slice(-6) ||
          digits.includes(billDigits.slice(-4))
        );
      });
      const pjpDay = (pjpRecords || []).filter((r) => {
        if (!namesMatch(r.employeeName || r.name, v.auditorName)) return false;
        const digits = String(r.date || '').replace(/[^0-9]/g, '');
        return (
          digits &&
          billDigits &&
          (digits === billDigits || digits.slice(-6) === billDigits.slice(-6))
        );
      });

      const billLocs = [bill.fromLocation, bill.toLocation].filter(Boolean);
      const knownLocs = [
        att?.location,
        att?.currentCity,
        ...pjpDay.flatMap((r) => [r.fromTown, r.toTown]),
      ].filter(Boolean);

      if (!knownLocs.length || !billLocs.length) continue;
      const near = billLocs.some((bl) => knownLocs.some((kl) => townsMatch(bl, kl)));
      if (!near) {
        push(
          v.sheetName,
          flag(
            'orange',
            'ROUTE_INFEASIBLE',
            `${bill.date}: Bill route ${billLocs.join('→')} not near attendance/PJP locations`,
            { billLocs, knownLocs: knownLocs.slice(0, 4), imageUrl: bill.imageUrl },
          ),
        );
      }
    }
  }

  // Attach + summary
  const results = (vouchers || []).map((v) => {
    const fraudFlags = byVoucher.get(v.sheetName) || [];
    // de-dupe identical messages
    const seen = new Set();
    const unique = fraudFlags.filter((f) => {
      const key = `${f.code}|${f.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      sheetName: v.sheetName,
      auditorName: v.auditorName,
      fraudFlags: unique,
      summary: {
        red: unique.filter((f) => f.severity === 'red').length,
        orange: unique.filter((f) => f.severity === 'orange').length,
      },
    };
  });

  const summary = {
    auditors: results.length,
    redFlags: results.reduce((s, r) => s + r.summary.red, 0),
    orangeFlags: results.reduce((s, r) => s + r.summary.orange, 0),
    duplicateBills: results.reduce(
      (s, r) => s + r.fraudFlags.filter((f) => f.code === 'DUPLICATE_BILL_IMAGE').length,
      0,
    ),
    tamperedImages: results.reduce(
      (s, r) => s + r.fraudFlags.filter((f) => f.code === 'TAMPERED_IMAGE').length,
      0,
    ),
    missingGstin: results.reduce(
      (s, r) => s + r.fraudFlags.filter((f) => f.code === 'GSTIN_MISSING_HIGH_VALUE').length,
      0,
    ),
  };

  return { results, summary };
};

/** Merge fraud flags onto vouchers (mutates copies). */
export const attachFraudFlagsToVouchers = (vouchers, fraudAudit) => {
  const bySheet = new Map((fraudAudit?.results || []).map((r) => [r.sheetName, r]));
  return (vouchers || []).map((v) => {
    const row = bySheet.get(v.sheetName);
    return {
      ...v,
      fraudFlags: row?.fraudFlags || [],
      fraudSummary: row?.summary || { red: 0, orange: 0 },
    };
  });
};
