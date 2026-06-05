import * as XLSX from 'xlsx';
import { parseExcelDate } from './sheetFetcher.js';
import { extractSpreadsheetId } from './spreadsheetUrl.js';
import { downloadSpreadsheetXlsx } from './sheetDownload.js';
import { fetchSpreadsheetTabs } from './sheetTabsApi.js';

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

const findCellInHeader = (matrix, needle, maxRow = 18) => {
  const t = norm(needle);
  for (let r = 0; r < Math.min(maxRow, matrix.length); r++) {
    for (let c = 0; c < (matrix[r] || []).length; c++) {
      if (norm(matrix[r][c]).includes(t)) return { r, c, row: matrix[r] };
    }
  }
  return null;
};

const findLabelInHeader = (matrix, re, maxRow = 18) => {
  for (let r = 0; r < Math.min(maxRow, matrix.length); r++) {
    for (let c = 0; c < Math.min(6, (matrix[r] || []).length); c++) {
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

/** Amount in column D (index 3) or first positive number after label. */
const amountAfterLabel = (hit) => {
  if (!hit?.row) return 0;
  const direct = parseMoney(hit.row[3]);
  if (direct > 0) return direct;
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

const parseAmountFromCell = (cell) => {
  const s = String(cell ?? '').trim();
  if (!s) return 0;
  const eqMatch = s.match(/=\s*([\d,]+(?:\.\d+)?)\s*$/);
  if (eqMatch) return parseMoney(eqMatch[1]);
  const nums = [...s.matchAll(/[\d,]+(?:\.\d+)?/g)].map((m) => parseMoney(m[0])).filter((n) => n > 0);
  if (!nums.length) return parseMoney(s);
  return nums[nums.length - 1];
};

const findAmountInRow = (row, labelTest) => {
  for (let c = 0; c < (row || []).length; c++) {
    const label = norm(row[c]);
    if (!label || !labelTest(label)) continue;
    for (let j = c + 1; j < row.length; j++) {
      const amt = parseAmountFromCell(row[j]);
      if (amt > 0) return amt;
    }
  }
  return 0;
};

const parseExcelSerialDate = (serial) => {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 40000 || n > 55000) return null;
  const days = Math.floor(n);
  const utc = new Date(Date.UTC(1899, 11, days));
  const y = utc.getUTCFullYear();
  if (y < 2020 || y > 2035) return null;
  return new Date(y, utc.getUTCMonth(), utc.getUTCDate());
};

const parseDateCell = (cell) => {
  if (cell === null || cell === undefined || cell === '') return null;
  const s = String(cell).trim();
  if (!s) return null;

  if (typeof cell === 'number' || (/^\d{5}(\.\d+)?$/.test(s) && !s.includes('/'))) {
    const serial = parseExcelSerialDate(cell);
    if (serial) return serial;
  }

  const d = parseExcelDate(cell);
  if (d && !Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    if (y >= 2020 && y <= 2035) return d;
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) {
    const parts = s.split(/[/-]/);
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    // HEPL vouchers use DD/MM/YY (India)
    if (p0 >= 1 && p0 <= 31 && p1 >= 1 && p1 <= 12) {
      return new Date(year, p1 - 1, p0);
    }
    const parsed = parseExcelDate(s);
    if (parsed) return parsed;
  }

  return null;
};

const isDateInColA = (matrix, r) => parseDateCell(matrix[r]?.[0]);

const isTravelLabel = (n) =>
  n === 'travel' || (n.startsWith('travel') && !n.includes('rs') && !n.includes('km'));

const isLocalLabel = (n) => n.includes('localconv');
const isAccLabel = (n) => n.includes('accom');
const isGrandLabel = (n) => n.includes('grandtotal');
const isDayTotalLabel = (n) => n === 'total';
const isPetrolTravelLabel = (n) => n.includes('travelrs');
const isKmLabel = (n) => n.includes('kmtraveled') || n.includes('kmtravel');
const isFoodLabel = (n) => n === 'food';

const looksLikeVoucher = (matrix) =>
  Boolean(
    findCell(matrix, 'requested by') ||
      findCell(matrix, 'fuel expenses') ||
      findCell(matrix, 'expenses claim voucher'),
  );

const parseDateWiseBlocks = (matrix) => {
  const blocks = [];
  for (let r = 0; r < matrix.length; r++) {
    const date = isDateInColA(matrix, r);
    if (!date) continue;

    let travel = 0;
    let localConveyance = 0;
    let accommodation = 0;
    let grandTotal = 0;
    let petrolTravel = 0;
    let kmTraveled = 0;
    let food = 0;
    let dayTotal = 0;

    for (let rr = r + 1; rr < matrix.length; rr++) {
      if (isDateInColA(matrix, rr)) break;
      const row = matrix[rr] || [];
      if (!row.some((c) => String(c ?? '').trim())) continue;

      const t = findAmountInRow(row, isTravelLabel);
      if (t > 0) travel = t;

      const l = findAmountInRow(row, isLocalLabel);
      if (l > 0) localConveyance = l;

      const a = findAmountInRow(row, isAccLabel);
      if (a > 0) accommodation = a;

      const g = findAmountInRow(row, isGrandLabel);
      if (g > 0) grandTotal = g;

      const p = findAmountInRow(row, isPetrolTravelLabel);
      if (p > 0) petrolTravel = p;

      const dt = findAmountInRow(row, (n) => isDayTotalLabel(n) && !n.includes('thousand'));
      if (dt > 0) dayTotal = dt;

      const f = findAmountInRow(row, isFoodLabel);
      if (f > 0) food = f;

      for (let c = 0; c < row.length; c++) {
        if (isKmLabel(norm(row[c]))) {
          const kmCell = String(row[c + 1] ?? row[c] ?? '');
          const kmMatch = kmCell.match(/(\d+(?:\.\d+)?)/);
          if (kmMatch) kmTraveled = parseFloat(kmMatch[1]);
        }
      }
    }

    const isPetrolDay = petrolTravel > 0 || (dayTotal > 0 && travel === 0 && localConveyance === 0);
    const ticketsSubtotal = travel + localConveyance;
    const petrolDayAmount = petrolTravel || dayTotal;

    if (!grandTotal) {
      if (isPetrolDay) grandTotal = petrolDayAmount + accommodation + food;
      else grandTotal = ticketsSubtotal + accommodation;
    }

    const ticketComparable = isPetrolDay ? petrolDayAmount : ticketsSubtotal;

    if (ticketComparable > 0 || accommodation > 0 || grandTotal > 0) {
      blocks.push({
        date: toDateStr(date),
        dateKey: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        travel,
        localConveyance,
        accommodation,
        food,
        petrolTravel: petrolDayAmount,
        kmTraveled,
        grandTotal,
        dayTotal,
        ticketsSubtotal,
        ticketComparable,
        computedSum: ticketsSubtotal + accommodation,
        isPetrolDay,
        hasBusTrainHint: !isPetrolDay && (travel > 0 || localConveyance > 0),
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

  const requestedBy = findCellInHeader(matrix, 'requested by');
  const employeeNoHit = findCellInHeader(matrix, 'employee no');
  const fuelRow = findCellInHeader(matrix, 'fuel expenses');
  const ticketRow =
    findCellInHeader(matrix, 'tickets') || findCellInHeader(matrix, 'local conv');
  const accommodationRow =
    findCellInHeader(matrix, 'accomdation') || findCellInHeader(matrix, 'accommodation');
  const totalRow = findLabelInHeader(matrix, /^total$/i);

  const auditorName =
    (requestedBy ? valueAfterLabel(requestedBy) : '') || (sheetName || '').trim();
  const employeeNo = employeeNoHit ? valueAfterLabel(employeeNoHit) : '';

  const fuelTotal = fuelRow ? amountAfterLabel(fuelRow) : 0;
  const ticketsTotal = ticketRow ? amountAfterLabel(ticketRow) : 0;
  const accommodationTotal = accommodationRow ? amountAfterLabel(accommodationRow) : 0;
  const declaredTotal = totalRow ? amountAfterLabel(totalRow) : 0;

  const dateBlocks = parseDateWiseBlocks(matrix);
  const petrolDays = dateBlocks.filter((b) => b.isPetrolDay);
  const busDays = dateBlocks.filter((b) => !b.isPetrolDay);

  const dateWiseTicketsSum = busDays.reduce((s, b) => s + b.ticketComparable, 0);
  const dateWisePetrolSum = petrolDays.reduce((s, b) => s + b.ticketComparable, 0);
  const dateWiseAccommodationSum = dateBlocks.reduce((s, b) => s + b.accommodation, 0);
  const dateWiseGrandSum = dateBlocks.reduce((s, b) => s + b.grandTotal, 0);
  const dateWiseBusTrainSum = dateBlocks.reduce((s, b) => s + b.ticketsSubtotal, 0);

  const voucherMode =
    petrolDays.length && busDays.length
      ? 'mixed'
      : petrolDays.length
        ? 'petrol'
        : 'bus_train';

  const mapLegs = parseMapLegs(matrix);

  return {
    sheetName,
    auditorName,
    employeeNo,
    fuelTotal,
    ticketsTotal,
    accommodationTotal,
    declaredTotal,
    dateBlocks,
    dateWiseBusTrainSum,
    dateWiseTicketsSum,
    dateWisePetrolSum,
    dateWiseAccommodationSum,
    dateWiseGrandSum,
    voucherMode,
    mapLegs,
  };
};

const fetchTabMatrix = async (spreadsheetId, gid) => {
  const res = await fetch(
    `/api/sheet/tab-csv?id=${encodeURIComponent(spreadsheetId)}&gid=${encodeURIComponent(gid)}`,
  );
  if (!res.ok) return null;
  const csv = await res.text();
  if (!csv?.trim()) return null;
  const parsed = XLSX.read(csv, { type: 'string' });
  const first = parsed.SheetNames[0];
  if (!first) return null;
  return XLSX.utils.sheet_to_json(parsed.Sheets[first], {
    header: 1,
    raw: false,
    defval: '',
  });
};

const buildWorkbookFromTabs = async (spreadsheetId, tabs) => {
  const merged = XLSX.utils.book_new();
  let loaded = 0;
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const matrix = await fetchTabMatrix(spreadsheetId, tab.gid);
    if (!matrix?.length) continue;
    const ws = XLSX.utils.aoa_to_sheet(matrix);
    const safeName = String(tab.name || `Sheet${i + 1}`)
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 31);
    XLSX.utils.book_append_sheet(merged, ws, safeName || `Sheet${i + 1}`);
    loaded++;
  }
  return loaded > 0 ? merged : null;
};

/**
 * One link (any tab/gid) → entire workbook: list all tabs, download every auditor sheet.
 */
export const fetchAllExpenseVouchers = async (url) => {
  const spreadsheetId = extractSpreadsheetId(url);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheets URL — paste the full spreadsheet link.');
  }

  let tabs = [];
  try {
    tabs = await fetchSpreadsheetTabs(spreadsheetId);
  } catch (e) {
    console.warn('Tab list unavailable:', e.message);
  }

  let workbook = null;

  // Prefer per-tab CSV when we know multiple tabs — most reliable for full workbook.
  if (tabs.length > 1) {
    workbook = await buildWorkbookFromTabs(spreadsheetId, tabs);
  }

  if (!workbook) {
    const { buffer } = await downloadSpreadsheetXlsx(url, { allTabs: true });
    workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    if (tabs.length > 1 && workbook.SheetNames.length < tabs.length) {
      const merged = await buildWorkbookFromTabs(spreadsheetId, tabs);
      if (merged && merged.SheetNames.length > workbook.SheetNames.length) {
        workbook = merged;
      }
    }
  }

  const matricesBySheet = {};
  const vouchers = [];
  const sheetSummary = [];

  workbook.SheetNames.forEach((sheetName) => {
    const ws = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    matricesBySheet[sheetName] = matrix;
    const parsed = parseVoucherSheet(matrix, sheetName);

    if (parsed) {
      vouchers.push(parsed);
      sheetSummary.push({
        sheetName,
        auditorName: parsed.auditorName,
        employeeNo: parsed.employeeNo,
        status: 'loaded',
        dateRows: parsed.dateBlocks.length,
        declaredTotal: parsed.declaredTotal,
        reason: `${parsed.dateBlocks.length} date row(s) · mode ${parsed.voucherMode}`,
      });
    } else {
      sheetSummary.push({
        sheetName,
        status: 'skipped',
        reason: looksLikeVoucher(matrix)
          ? 'Voucher layout found but missing Requested By, amounts, or date rows'
          : 'Index/summary tab (not an auditor voucher)',
      });
    }
  });

  const tabCountInLink = tabs.length || workbook.SheetNames.length;
  let syncError = null;

  if (vouchers.length === 0 && workbook.SheetNames.length > 0) {
    syncError = {
      title: 'No auditor vouchers parsed',
      message:
        workbook.SheetNames.length === 1
          ? 'Only 1 tab returned. Share workbook as Anyone with link → Viewer so ALL auditor tabs download.'
          : 'Tabs downloaded but none matched the Expenses Claim Voucher form.',
      failedTabs: sheetSummary,
    };
  } else if (tabCountInLink > 1 && workbook.SheetNames.length < tabCountInLink) {
    syncError = {
      title: `Partial download — ${workbook.SheetNames.length} of ${tabCountInLink} tabs`,
      message:
        'Could not download every auditor tab. Share the whole workbook: Anyone with the link → Viewer (not Restricted), then sync again.',
      failedTabs: sheetSummary.filter((s) => s.status !== 'loaded'),
      partial: true,
    };
  }

  return {
    vouchers,
    sheetSummary,
    matricesBySheet,
    tabs,
    spreadsheetId,
    totalSheets: workbook.SheetNames.length,
    totalTabsInWorkbook: tabCountInLink,
    totalAuditors: vouchers.length,
    syncError,
  };
};

export const DEFAULT_EXPENSE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1txSfkx3ITPJe_K0g8vJrZDVy1RbL2aD0SG1XYWe70MY/edit?gid=0#gid=0';
