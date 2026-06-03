import * as XLSX from 'xlsx';
import { parseExcelDate } from './sheetFetcher.js';
import { downloadSpreadsheetXlsx } from './sheetDownload.js';

const pad = (n) => String(n).padStart(2, '0');

const toDateStr = (d) =>
  d ? `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}` : '';

const parseMoney = (val) => {
  const n = parseFloat(String(val ?? '').replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findCell = (matrix, needle) => {
  const t = norm(needle);
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < (matrix[r] || []).length; c++) {
      if (norm(matrix[r][c]).includes(t)) return { r, c, row: matrix[r] };
    }
  }
  return null;
};

const findLabelInRow = (matrix, re) => {
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < Math.min(4, (matrix[r] || []).length); c++) {
      if (re.test(String(matrix[r][c] || '').trim())) return { r, c, row: matrix[r] };
    }
  }
  return null;
};

const valueAfterLabel = (hit) => {
  if (!hit?.row) return '';
  for (let i = hit.c + 1; i < hit.row.length; i++) {
    const v = String(hit.row[i] ?? '').trim();
    if (v) return v;
  }
  return '';
};

const amountAfterLabel = (hit) => {
  if (!hit?.row) return 0;
  for (let i = hit.c + 1; i < hit.row.length; i++) {
    const n = parseMoney(hit.row[i]);
    if (n > 0) return n;
  }
  for (let i = 0; i < hit.row.length; i++) {
    const n = parseMoney(hit.row[i]);
    if (n > 0) return n;
  }
  return 0;
};

const parseDateCell = (cell) => {
  const s = String(cell ?? '').trim();
  if (!s) return null;
  const d = parseExcelDate(cell);
  if (d) return d;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) return parseExcelDate(s);
  return null;
};

const isDateInColA = (matrix, r) => parseDateCell(matrix[r]?.[0]);

const looksLikeVoucher = (matrix) =>
  Boolean(
    findCell(matrix, 'requested by') ||
      findCell(matrix, 'fuel expenses') ||
      findCell(matrix, 'expenses claim voucher'),
  );

/** Rows under a date: travel, local convience, grand total (per screenshot layout). */
const parseDateWiseBlocks = (matrix) => {
  const blocks = [];
  for (let r = 0; r < matrix.length; r++) {
    const date = isDateInColA(matrix, r);
    if (!date) continue;

    let travel = 0;
    let localConveyance = 0;
    let grandTotal = 0;
    let hasBusTrainHint = false;

    for (let rr = r + 1; rr < Math.min(r + 25, matrix.length); rr++) {
      if (isDateInColA(matrix, rr)) break;
      const row = matrix[rr] || [];
      const label = norm(row[0] || row[1]);
      if (!label) continue;

      if (label === 'travel' || label.startsWith('travel')) {
        travel = amountAfterLabel({ r: rr, c: 0, row });
      }
      if (label.includes('localconv') || label.includes('localconveyance')) {
        localConveyance = amountAfterLabel({ r: rr, c: 0, row });
      }
      if (label.includes('grandtotal') || label === 'total') {
        const g = amountAfterLabel({ r: rr, c: 0, row });
        if (g > 0) grandTotal = g;
      }
      if (label.includes('bus') || label.includes('train') || label.includes('ticket')) {
        hasBusTrainHint = true;
      }
    }

    if (!grandTotal && (travel || localConveyance)) {
      grandTotal = travel + localConveyance;
    }

    if (travel || localConveyance || grandTotal) {
      blocks.push({
        date: toDateStr(date),
        dateKey: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        travel,
        localConveyance,
        grandTotal,
        computedSum: travel + localConveyance,
        hasBusTrainHint,
        billImagesLikely: hasBusTrainHint,
      });
    }
  }
  return blocks;
};

const parseMapLegs = (matrix) => {
  const legs = [];
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const line = row.map((c) => String(c ?? '')).join(' ');
    const kmsMatch = line.match(/(\d+(?:\.\d+)?)\s*km/i);
    if (!kmsMatch) continue;
    const kms = parseFloat(kmsMatch[1]);
    const fromTo = line.match(/from[:\s]+([^→\-]+)[→\-]+to[:\s]+(.+)/i);
    const fromTown = fromTo ? fromTo[1].trim() : '';
    const toTown = fromTo ? fromTo[2].trim().split(/\s{2,}|km/i)[0].trim() : '';
    const roundTrip =
      /round\s*trip/i.test(line) || norm(fromTown) === norm(toTown);
    legs.push({ fromTown, toTown, kms, roundTrip, raw: line.slice(0, 120) });
  }
  return legs;
};

export const parseVoucherSheet = (matrix, sheetName) => {
  if (!matrix?.length || !looksLikeVoucher(matrix)) return null;

  const requestedBy = findCell(matrix, 'requested by');
  const employeeNoHit = findCell(matrix, 'employee no');
  const fuelRow = findCell(matrix, 'fuel expenses');
  const ticketRow =
    findCell(matrix, 'tickets') || findCell(matrix, 'local conv');
  const accommodationRow = findCell(matrix, 'accommodation');
  const totalRow = findLabelInRow(matrix, /^total$/i);

  const auditorName =
    (requestedBy ? valueAfterLabel(requestedBy) : '') || (sheetName || '').trim();
  const employeeNo = employeeNoHit ? valueAfterLabel(employeeNoHit) : '';

  const fuelTotal = fuelRow ? amountAfterLabel(fuelRow) : 0;
  const ticketsTotal = ticketRow ? amountAfterLabel(ticketRow) : 0;
  const accommodationTotal = accommodationRow ? amountAfterLabel(accommodationRow) : 0;
  const declaredTotal = totalRow ? amountAfterLabel(totalRow) : 0;

  const dateBlocks = parseDateWiseBlocks(matrix);
  const dateWiseBusTrainSum = dateBlocks.reduce((s, b) => s + b.grandTotal, 0);
  const mapLegs = parseMapLegs(matrix);

  const headerBusTrain = ticketsTotal;
  const expectedFromDates = dateWiseBusTrainSum;

  return {
    sheetName,
    auditorName,
    employeeNo,
    fuelTotal,
    ticketsTotal: headerBusTrain,
    accommodationTotal,
    declaredTotal,
    dateBlocks,
    dateWiseBusTrainSum,
    mapLegs,
    petrolNote: fuelTotal > 0 ? 'Petrol claimed — verified separately (lower priority)' : '',
  };
};

export const fetchAllExpenseVouchers = async (url) => {
  const { buffer } = await downloadSpreadsheetXlsx(url);
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  const vouchers = [];
  const sheetSummary = [];

  workbook.SheetNames.forEach((sheetName) => {
    const ws = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const parsed = parseVoucherSheet(matrix, sheetName);

    if (parsed) {
      vouchers.push(parsed);
      sheetSummary.push({
        sheetName,
        auditorName: parsed.auditorName,
        employeeNo: parsed.employeeNo,
        status: 'loaded',
        dateRows: parsed.dateBlocks.length,
        reason: `Voucher parsed — ${parsed.dateBlocks.length} date block(s)`,
      });
    } else {
      sheetSummary.push({
        sheetName,
        status: 'skipped',
        reason: looksLikeVoucher(matrix)
          ? 'Voucher form found but missing Requested By / amounts / date rows'
          : 'Not a voucher tab (expected Requested By, Fuel Expenses, date in column A)',
      });
    }
  });

  let syncError = null;
  if (vouchers.length === 0 && workbook.SheetNames.length > 0) {
    syncError = {
      title:
        workbook.SheetNames.length === 1
          ? 'Only 1 tab downloaded'
          : 'No auditor vouchers parsed',
      message:
        workbook.SheetNames.length === 1
          ? 'Share the full workbook (Anyone with link → Viewer) so every auditor tab is fetched.'
          : 'Tabs were fetched but none matched the Expenses Claim Voucher layout.',
      failedTabs: sheetSummary.filter((s) => s.status !== 'loaded'),
    };
  }

  return {
    vouchers,
    sheetSummary,
    totalSheets: workbook.SheetNames.length,
    totalAuditors: vouchers.length,
    syncError,
  };
};

export const DEFAULT_EXPENSE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1txSfkx3ITPJe_K0g8vJrZDVy1RbL2aD0SG1XYWe70MY/edit?gid=0#gid=0';
