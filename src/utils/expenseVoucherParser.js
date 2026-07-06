import * as XLSX from 'xlsx';
import { parseExcelDate } from './sheetFetcher.js';
import { extractSpreadsheetId } from './spreadsheetUrl.js';

const pad = (n) => String(n).padStart(2, '0');
export const PETROL_KM_RATE = 4;

/** Reject employee IDs / phone numbers mistaken for rupee amounts in header cells. */
export const MAX_HEADER_LINE_RS = 500_000;
export const MAX_VOUCHER_TOTAL_RS = 1_000_000;

export const sanitizeExpenseAmount = (raw, { kind = 'line', employeeNo = '' } = {}) => {
  const n = Math.round(parseMoney(raw));
  if (n <= 0) return 0;

  const empDigits = String(employeeNo || '').replace(/\D/g, '');
  const asStr = String(n);

  if (empDigits && asStr === empDigits) return 0;
  if (asStr.length >= 8 && n > 999_999) return 0;

  const cap = kind === 'total' ? MAX_VOUCHER_TOTAL_RS : MAX_HEADER_LINE_RS;
  if (n > cap) return 0;

  return n;
};

/** Travel + local for one bus/train day — excludes petrol, fuel, and stay. */
export const ticketsLocalForBlock = (block) => {
  if (!block) return 0;
  if (block.isKmPetrolDay || block.splitType === 'petrol_km') return 0;
  if (block.isPetrolDay && block.splitType === 'petrol') return 0;
  if (block.splitType === 'stay' && !(block.travel || block.localConveyance)) return 0;

  const travel = block.travel || 0;
  const local = block.localConveyance || 0;
  const stay = block.accommodation || 0;
  const grand = block.grandTotal || 0;
  let amount = travel + local;

  if (amount <= 0 && grand > stay) {
    if (block.hasBusTrainHint || block.splitType === 'bus_train' || block.splitType === 'mixed') {
      amount = grand - stay;
    }
  }

  if (stay > 0 && grand > 0 && amount > grand - stay + 5) {
    amount = Math.max(0, grand - stay);
  }

  return Math.max(0, amount);
};

export const computeDateWiseTicketsLocalSum = (blocks) =>
  (blocks || []).reduce((sum, block) => sum + ticketsLocalForBlock(block), 0);

const toDateStr = (d) =>
  d ? `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}` : '';

const parseMoney = (val) => {
  const n = parseFloat(String(val ?? '').replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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

const amountAfterLabel = (hit, options = {}) => {
  if (!hit?.row) return 0;

  if (hit.c <= 2 && hit.row.length > 3) {
    const fromColD = sanitizeExpenseAmount(hit.row[3], options);
    if (fromColD > 0) return fromColD;
  }

  for (let i = hit.c + 1; i < hit.row.length; i++) {
    const n = sanitizeExpenseAmount(hit.row[i], options);
    if (n > 0) return n;
  }

  return 0;
};

/** Extract final amount from cells like "91 * 4 = 364" or "364". */
export const parseAmountFromCell = (cell) => {
  const s = String(cell ?? '').trim();
  if (!s) return 0;
  const eqMatch = s.match(/=\s*([\d,]+(?:\.\d+)?)\s*$/);
  if (eqMatch) return parseMoney(eqMatch[1]);
  const nums = [...s.matchAll(/[\d,]+(?:\.\d+)?/g)].map((m) => parseMoney(m[0])).filter((n) => n > 0);
  if (!nums.length) return parseMoney(s);
  return nums[nums.length - 1];
};

/** Parse "46 + 45 = 91" or "91" → total km. */
export const parseKmFromCell = (cell) => {
  const s = String(cell ?? '').trim();
  if (!s) return { total: 0, legs: [], raw: '' };

  const eqMatch = s.match(/=\s*(\d+(?:\.\d+)?)\s*$/);
  if (eqMatch) {
    const total = parseFloat(eqMatch[1]);
    const legs = [...s.matchAll(/(\d+(?:\.\d+)?)/g)]
      .map((m) => parseFloat(m[1]))
      .filter((n) => n < total || s.includes('+'));
    return { total, legs: legs.length > 1 ? legs.slice(0, -1) : legs, raw: s };
  }

  if (/\+/.test(s)) {
    const legs = [...s.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
    const total = legs.reduce((a, b) => a + b, 0);
    return { total, legs, raw: s };
  }

  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? { total: parseFloat(m[1]), legs: [parseFloat(m[1])], raw: s } : { total: 0, legs: [], raw: s };
};

const MONTH_NAME_INDEX = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

const monthIndexFromName = (name) => MONTH_NAME_INDEX[String(name || '').toLowerCase()];

/** Infer month/year from sheet title, Activity Date row, and date headers in the grid. */
const inferExpensePeriod = (matrix, sheetName, workbookTitle = '') => {
  let year = new Date().getFullYear();
  let month = null;
  const blob = [workbookTitle, sheetName, ...(matrix || []).flat()]
    .map((x) => String(x ?? ''))
    .join('\n');

  const activityRange = blob.match(
    /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2}|\d{2})\s*[-–to]+\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2}|\d{2})/i,
  );
  if (activityRange) {
    month = parseInt(activityRange[2], 10) - 1;
    year = parseInt(activityRange[3], 10);
    if (year < 100) year += 2000;
  }

  if (month == null) {
    const named = blob.match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b(?:\s+(20\d{2}))?/i,
    );
    if (named) {
      month = monthIndexFromName(named[1]);
      if (named[2]) year = parseInt(named[2], 10);
    }
  }

  if (month == null) {
    const dateHeaders = [...blob.matchAll(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/gi)];
    if (dateHeaders.length) {
      month = monthIndexFromName(dateHeaders[0][2]);
    }
  }

  const yearOnly = blob.match(/\b(20\d{2})\b/);
  if (yearOnly && !activityRange) year = parseInt(yearOnly[1], 10);

  return { year, month };
};

/** Detect DD/MM vs MM/DD from Activity Date and date-column patterns (April workbook). */
const detectDateOrder = (matrix, period) => {
  const blob = (matrix || [])
    .flat()
    .map((x) => String(x ?? ''))
    .join('\n');

  if (/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2}|\d{2})\s*[-–to]+\s*(\d{1,2})[\/\-.](\d{1,2})/i.test(blob)) {
    return 'dmy';
  }

  const monthIdx = period?.month;
  if (monthIdx == null) return 'dmy';

  let mdyVotes = 0;
  let dmyVotes = 0;
  const slashDateRe = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
  let m;
  while ((m = slashDateRe.exec(blob)) !== null) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a === monthIdx + 1 && b >= 1 && b <= 31) mdyVotes++;
    if (b === monthIdx + 1 && a >= 1 && a <= 31) dmyVotes++;
  }

  if (mdyVotes > dmyVotes) return 'mdy';
  return 'dmy';
};

const parseSlashDate = (s, dateContext = {}) => {
  const parts = s.split(/[\/\-.]/);
  if (parts.length !== 3) return null;
  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);
  if (year < 100) year += 2000;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(year)) return null;

  let day;
  let month;
  const order = dateContext.dateOrder || 'dmy';
  if (order === 'mdy') {
    month = a - 1;
    day = b;
  } else {
    day = a;
    month = b - 1;
  }
  if (day < 1 || day > 31 || month < 0 || month > 11) return null;
  return new Date(year, month, day);
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

const parseDateCell = (cell, dateContext = {}) => {
  if (cell === null || cell === undefined || cell === '') return null;
  const s = String(cell).trim();
  if (!s || s.length > 28) return null;
  if (/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*[-–to]/i.test(s)) return null;

  if (typeof cell === 'number' || (/^\d{5}(\.\d+)?$/.test(s) && !s.includes('/'))) {
    const serial = parseExcelSerialDate(cell);
    if (serial) return serial;
  }

  const dayMonth = s.match(/^(\d{1,2})\s+([a-z]{3,9})(?:\s+(20\d{2}|\d{2}))?$/i);
  if (dayMonth) {
    const day = parseInt(dayMonth[1], 10);
    const monthIdx = monthIndexFromName(dayMonth[2]);
    if (monthIdx != null && day >= 1 && day <= 31) {
      let year = dayMonth[3] ? parseInt(dayMonth[3], 10) : dateContext.year;
      if (year != null && year < 100) year += 2000;
      if (!year) year = new Date().getFullYear();
      return new Date(year, monthIdx, day);
    }
  }

  const d = parseExcelDate(cell);
  if (d && !Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    if (y >= 2020 && y <= 2035) return d;
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) {
    const parsed = parseSlashDate(s, dateContext);
    if (parsed) return parsed;
    const parts = s.split(/[/-]/);
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    if (p0 >= 1 && p0 <= 31 && p1 >= 1 && p1 <= 12) {
      return new Date(year, p1 - 1, p0);
    }
    const parsedExcel = parseExcelDate(s);
    if (parsedExcel) return parsedExcel;
  }

  return null;
};

const isDateHeaderCell = (cellStr, dateContext) => {
  const s = String(cellStr ?? '').trim();
  if (!s) return false;
  if (/^\d{1,2}\s+[a-z]{3,}/i.test(s)) return true;
  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(s)) return true;
  return parseDateCell(s, dateContext) != null && s.length <= 14;
};

/** Date may be in any column — bills sheets often use column E for "1 April". */
const findDateInRow = (row, dateContext = {}) => {
  if (!row?.length) return null;
  for (let c = 0; c < row.length; c++) {
    const cellStr = String(row[c] ?? '').trim();
    if (!cellStr) continue;
    const d = parseDateCell(row[c], dateContext);
    if (!d) continue;
    if (isDateHeaderCell(cellStr, dateContext)) return { date: d, col: c };
  }
  return null;
};

const isTravelLabel = (n) =>
  (n === 'travel' || (n.startsWith('travel') && !n.includes('rs') && !n.includes('km'))) &&
  !n.includes('expense');

const isTicketsLabel = (n) => n.startsWith('ticket');
const isTicketsLocalCombinedLabel = (n) =>
  n.includes('tickets') && (n.includes('localconv') || n.includes('localcon'));
const isConveyanceLabel = (n) => n.includes('conveyance') && !n.includes('localconv');
const isCabLabel = (n) => n === 'cab' || n.startsWith('cab');
const isBusTrainLabel = (n) =>
  (n === 'bus' || n === 'train' || n === 'busticket' || n === 'trainticket') && !n.includes('business');
const isAutoLabel = (n) => n === 'auto' || n.startsWith('auto') || n.includes('rickshaw') || n.includes('rapido');
const isParkingLabel = (n) => n.includes('parking') || n.includes('helmet');
const isLocalLabel = (n) => n.includes('localconv') || n === 'local';
const isAccLabel = (n) => n.includes('accom');
const isGrandLabel = (n) => n.includes('grandtotal');
const isDayTotalLabel = (n) => n === 'total' || (n.startsWith('total') && !n.includes('thousand'));
const isPetrolTravelLabel = (n) => n.includes('travelrs') || n === 'travelrs';
const isPetrolLabel = (n) =>
  n === 'petrol' || n === 'fuel' || (n.endsWith('petrol') && !n.includes('expense')) || n.startsWith('fuel');
const isKmLabel = (n) => n.includes('kmtraveled') || n.includes('kmtravel') || n === 'km';
const isFoodLabel = (n) => n === 'food';
const isDaLabel = (n) => n === 'da' || n === 'onlyda' || n.includes('onlyda');

const findCellAnywhere = (matrix, needle, minRow = 0) => {
  const t = norm(needle);
  for (let r = minRow; r < matrix.length; r++) {
    for (let c = 0; c < (matrix[r] || []).length; c++) {
      if (norm(matrix[r][c]).includes(t)) return { r, c, row: matrix[r] };
    }
  }
  return null;
};

const getDateScanStartRow = (matrix) => {
  const totalHit = findCellInHeader(matrix, 'total');
  if (totalHit) return totalHit.r + 2;
  const cashier = findCellAnywhere(matrix, 'cashier');
  if (cashier) return cashier.r + 1;
  return 15;
};

const looksLikeVoucher = (matrix) =>
  Boolean(
    findCellInHeader(matrix, 'requested by') ||
      findCellInHeader(matrix, 'fuel expenses') ||
      findCellInHeader(matrix, 'expenses claim voucher'),
  );

/** Find label anywhere in row; value may be to the right OR in cells below. */
const findLabeledValueInBlock = (matrix, startR, endR, labelTest, parseValue) => {
  for (let rr = startR; rr < endR; rr++) {
    const row = matrix[rr] || [];
    for (let c = 0; c < row.length; c++) {
      const label = norm(row[c]);
      if (!label || !labelTest(label)) continue;

      for (let j = c + 1; j < row.length; j++) {
        const raw = String(row[j] ?? '').trim();
        if (raw) return parseValue(row[j], raw, rr, j);
      }

      for (let dr = 1; dr <= 2 && rr + dr < endR; dr++) {
        const below = matrix[rr + dr] || [];
        for (let j = c; j < Math.min(c + 4, below.length); j++) {
          const raw = String(below[j] ?? '').trim();
          if (raw && !labelTest(norm(raw))) return parseValue(below[j], raw, rr + dr, j);
        }
      }
    }
  }
  return null;
};

const extractInlineAmount = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  const labeled = s.match(/[-–:\s]+\s*([\d,]+(?:\.\d+)?)/);
  if (labeled) {
    const amt = parseAmountFromCell(labeled[1]);
    if (amt > 0) return amt;
  }
  return parseAmountFromCell(s);
};

const findAmountInRow = (row, labelTest) => {
  for (let c = 0; c < (row || []).length; c++) {
    const raw = String(row[c] ?? '').trim();
    const label = norm(row[c]);
    if (!raw || !label || !labelTest(label)) continue;

    const amt = extractInlineAmount(raw);
    if (amt > 0 && /[-–:\d]/.test(raw)) return amt;

    for (let j = c + 1; j < row.length; j++) {
      const nextAmt = parseAmountFromCell(row[j]);
      if (nextAmt > 0) return nextAmt;
    }
  }
  return 0;
};

/** Regex fallback when labels are in images / odd layout — scan whole date block text. */
const scanBlockTextFallback = (matrix, startR, endR) => {
  const text = matrix
    .slice(startR, endR)
    .map((row) => (row || []).join('\t'))
    .join('\n');

  const out = {
    kmTraveled: 0,
    kmLegs: [],
    kmRaw: '',
    petrolTravel: 0,
    travelRsRaw: '',
    travel: 0,
    localConveyance: 0,
    dayTotal: 0,
    accommodation: 0,
  };

  const kmPlus = text.match(/km\s*traveled[^\d]{0,30}(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)/i);
  if (kmPlus) {
    out.kmLegs = [parseFloat(kmPlus[1]), parseFloat(kmPlus[2])];
    out.kmTraveled = parseFloat(kmPlus[3]);
    out.kmRaw = `${kmPlus[1]} + ${kmPlus[2]} = ${kmPlus[3]}`;
  } else {
    const kmSingle = text.match(/km\s*traveled[^\d]{0,30}(\d+(?:\.\d+)?)/i);
    if (kmSingle) {
      out.kmTraveled = parseFloat(kmSingle[1]);
      out.kmLegs = [out.kmTraveled];
      out.kmRaw = kmSingle[1];
    }
  }

  const travelRs = text.match(/travel\s*rs\.?[^\d]{0,30}(\d+)\s*\*\s*(4|8)\s*=\s*(\d+)/i);
  if (travelRs) {
    out.petrolTravel = parseFloat(travelRs[3]);
    out.travelRsRaw = `${travelRs[1]} * ${travelRs[2]} = ${travelRs[3]}`;
  } else {
    const travelRs4 = text.match(/travel\s*rs\.?[^\d]{0,30}(\d+)\s*\*\s*4\s*=\s*(\d+)/i);
    if (travelRs4) {
      out.petrolTravel = parseFloat(travelRs4[2]);
      out.travelRsRaw = `${travelRs4[1]} * 4 = ${travelRs4[2]}`;
    }
  }

  const petrolLine = text.match(/\bpetrol\b[^\d]{0,20}(\d+(?:\.\d+)?)/i);
  if (petrolLine && !out.petrolTravel) {
    out.petrolTravel = parseFloat(petrolLine[1]);
  }

  const convAll = [...text.matchAll(/conveyance\s*[-–:\s]+([\d,]+(?:\.\d+)?)/gi)];
  convAll.forEach((m) => {
    out.localConveyance = Math.max(out.localConveyance || 0, parseMoney(m[1]));
  });
  const ticketAll = [...text.matchAll(/tickets?\s*[-–:\s]+([\d,]+(?:\.\d+)?)/gi)];
  ticketAll.forEach((m) => {
    out.travel = (out.travel || 0) + parseMoney(m[1]);
  });
  const ticketsLocalAll = [
    ...text.matchAll(/tickets?\s*\+\s*local\s*conveyance?\s*[-–:\s]*([\d,]+(?:\.\d+)?)/gi),
  ];
  ticketsLocalAll.forEach((m) => {
    out.travel = (out.travel || 0) + parseMoney(m[1]);
  });
  const totalMatch = text.match(/^total\s*[-–:\s]+([\d,]+(?:\.\d+)?)/im);
  if (totalMatch) out.dayTotal = parseMoney(totalMatch[1]);
  const stayAll = [...text.matchAll(/(?:accom|accommodation|hotel)\s*[-–:\s]+([\d,]+(?:\.\d+)?)/gi)];
  stayAll.forEach((m) => {
    out.accommodation = Math.max(out.accommodation || 0, parseMoney(m[1]));
  });

  return out;
};

/**
 * Bills-style sheets put label + amount in one cell, e.g. "Conveyance - 290", "Tickets - 193".
 * Scan every cell in a date block for these patterns.
 */
const scanEmbeddedExpenseLabels = (matrix, startR, endR) => {
  const out = {
    travel: 0,
    localConveyance: 0,
    petrolTravel: 0,
    dayTotal: 0,
    accommodation: 0,
    kmTraveled: 0,
    kmLegs: [],
    isRoundTrip: false,
    isDaOnly: false,
  };

  for (let rr = startR; rr < endR; rr++) {
    const row = matrix[rr] || [];
    for (let c = 0; c < row.length; c++) {
      const raw = String(row[c] ?? '').trim();
      if (!raw) continue;

      if (/^only\s*da\b/i.test(raw)) {
        out.isDaOnly = true;
        const daAmt = raw.match(/only\s*da\s*[-–:]\s*([\d,]+(?:\.\d+)?)/i);
        if (daAmt) out.localConveyance = Math.max(out.localConveyance, parseMoney(daAmt[1]));
        continue;
      }

      const conv = raw.match(/conveyance\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (conv) out.localConveyance = Math.max(out.localConveyance, parseMoney(conv[1]));

      const ticketsLocal = raw.match(
        /tickets?\s*\+\s*local\s*conveyance?\s*[-–:\s]*([\d,]+(?:\.\d+)?)/i,
      );
      if (ticketsLocal) out.travel += parseMoney(ticketsLocal[1]);

      const tickets = raw.match(/tickets?\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (tickets) out.travel += parseMoney(tickets[1]);

      const cab = raw.match(/\bcab\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (cab) out.travel += parseMoney(cab[1]);

      const bus = raw.match(/\bbus\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (bus) out.travel += parseMoney(bus[1]);

      const train = raw.match(/\btrain\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (train) out.travel += parseMoney(train[1]);

      const auto = raw.match(/\b(?:auto|rickshaw|rapido)\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (auto) out.localConveyance = Math.max(out.localConveyance, parseMoney(auto[1]));

      const parking = raw.match(/parking\/?helmet?\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (parking) out.localConveyance = Math.max(out.localConveyance, parseMoney(parking[1]));

      const stay = raw.match(/(?:accom|accommodation|hotel|stay)\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (stay) out.accommodation = Math.max(out.accommodation || 0, parseMoney(stay[1]));

      const fuel = raw.match(/\bfuel\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (fuel) {
        out.petrolTravel = Math.max(out.petrolTravel, parseMoney(fuel[1]));
        const kmRound = raw.match(/(\d+(?:\.\d+)?)\s*\*\s*8/i);
        if (kmRound) {
          out.kmTraveled = parseFloat(kmRound[1]);
          out.kmLegs = [out.kmTraveled];
          out.isRoundTrip = true;
        } else {
          const kmOne = raw.match(/(\d+(?:\.\d+)?)\s*\*\s*4/i);
          if (kmOne) {
            out.kmTraveled = parseFloat(kmOne[1]);
            out.kmLegs = [out.kmTraveled];
          }
        }
      }

      const petrol = raw.match(/\bpetrol\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (petrol) out.petrolTravel = Math.max(out.petrolTravel, parseMoney(petrol[1]));

      const total = raw.match(/^total\s*[-–:\s]+([\d,]+(?:\.\d+)?)/i);
      if (total) out.dayTotal = Math.max(out.dayTotal, parseMoney(total[1]));

      const daAmt = raw.match(/\bda\s*[-–:]\s*([\d,]+(?:\.\d+)?)/i);
      if (daAmt) out.localConveyance = Math.max(out.localConveyance, parseMoney(daAmt[1]));
    }
  }

  return out;
};

const parseDateWiseBlocks = (matrix, dateContext = {}) => {
  const blocks = [];
  const scanStart = getDateScanStartRow(matrix);
  let r = scanStart;

  while (r < matrix.length) {
    const dateHit = findDateInRow(matrix[r], dateContext);
    if (!dateHit) {
      r++;
      continue;
    }

    const date = dateHit.date;
    let endR = matrix.length;
    for (let rr = r + 1; rr < matrix.length; rr++) {
      if (findDateInRow(matrix[rr], dateContext)) {
        endR = rr;
        break;
      }
    }

    let travel = 0;
    let localConveyance = 0;
    let accommodation = 0;
    let grandTotal = 0;
    let petrolTravel = 0;
    let kmTraveled = 0;
    let kmLegs = [];
    let kmRaw = '';
    let travelRsRaw = '';
    let food = 0;
    let dayTotal = 0;

    let petrolFromLabel = false;

    const kmHit = findLabeledValueInBlock(matrix, r + 1, endR, isKmLabel, (cell, raw) => ({
      ...parseKmFromCell(cell),
      raw,
    }));
    if (kmHit?.total > 0) {
      kmTraveled = kmHit.total;
      kmLegs = kmHit.legs?.length ? kmHit.legs : [kmHit.total];
      kmRaw = kmHit.raw;
    }

    const travelRsHit = findLabeledValueInBlock(matrix, r + 1, endR, isPetrolTravelLabel, (cell, raw) => ({
      amount: parseAmountFromCell(cell),
      raw,
    }));
    if (travelRsHit?.amount > 0) {
      petrolTravel = travelRsHit.amount;
      travelRsRaw = travelRsHit.raw;
      petrolFromLabel = true;
    }

    const travelBlk = findLabeledValueInBlock(matrix, r + 1, endR, isTravelLabel, (cell) =>
      parseAmountFromCell(cell),
    );
    if (travelBlk > 0) travel = travelBlk;

    const localBlk = findLabeledValueInBlock(matrix, r + 1, endR, isLocalLabel, (cell) =>
      parseAmountFromCell(cell),
    );
    if (localBlk > 0) localConveyance = localBlk;

    const convBlk = findLabeledValueInBlock(matrix, r + 1, endR, isConveyanceLabel, (cell, raw) =>
      parseAmountFromCell(raw.includes('-') || raw.includes(':') ? raw : cell),
    );
    if (convBlk > 0) localConveyance = Math.max(localConveyance, convBlk);

    const ticketsBlk = findLabeledValueInBlock(matrix, r + 1, endR, isTicketsLabel, (cell, raw) =>
      parseAmountFromCell(raw.includes('-') || raw.includes(':') ? raw : cell),
    );
    if (ticketsBlk > 0) travel += ticketsBlk;

    const cabBlk = findLabeledValueInBlock(matrix, r + 1, endR, isCabLabel, (cell, raw) =>
      parseAmountFromCell(raw.includes('-') || raw.includes(':') ? raw : cell),
    );
    if (cabBlk > 0) travel += cabBlk;

    const accBlk = findLabeledValueInBlock(matrix, r + 1, endR, isAccLabel, (cell) =>
      parseAmountFromCell(cell),
    );
    if (accBlk > 0) accommodation = accBlk;

    const grandBlk = findLabeledValueInBlock(matrix, r + 1, endR, isGrandLabel, (cell) =>
      parseAmountFromCell(cell),
    );
    if (grandBlk > 0) grandTotal = grandBlk;

    const petrolBlk = findLabeledValueInBlock(matrix, r + 1, endR, isPetrolLabel, (cell) =>
      parseAmountFromCell(cell),
    );
    if (petrolBlk > 0) {
      petrolTravel = petrolBlk;
      petrolFromLabel = true;
    }

    const totalBlk = findLabeledValueInBlock(
      matrix,
      r + 1,
      endR,
      (n) => isDayTotalLabel(n) && !n.includes('thousand'),
      (cell) => parseAmountFromCell(cell),
    );
    if (totalBlk > 0) dayTotal = totalBlk;

    for (let rr = r + 1; rr < endR; rr++) {
      const row = matrix[rr] || [];
      if (!row.some((c) => String(c ?? '').trim())) continue;

      const t = findAmountInRow(row, isTravelLabel);
      if (t > 0) travel = t;

      const l = findAmountInRow(row, isLocalLabel);
      if (l > 0) localConveyance = l;

      const conv = findAmountInRow(row, isConveyanceLabel);
      if (conv > 0) localConveyance = Math.max(localConveyance, conv);

      const ticketsRow = findAmountInRow(row, isTicketsLabel);
      if (ticketsRow > 0) travel += ticketsRow;

      const cabRow = findAmountInRow(row, isCabLabel);
      if (cabRow > 0) travel += cabRow;

      const busRow = findAmountInRow(row, isBusTrainLabel);
      if (busRow > 0) travel += busRow;

      const autoRow = findAmountInRow(row, isAutoLabel);
      if (autoRow > 0) localConveyance = Math.max(localConveyance, autoRow);

      const parkRow = findAmountInRow(row, isParkingLabel);
      if (parkRow > 0) localConveyance = Math.max(localConveyance, parkRow);

      const combinedRow = findAmountInRow(row, isTicketsLocalCombinedLabel);
      if (combinedRow > 0) travel += combinedRow;

      const a = findAmountInRow(row, isAccLabel);
      if (a > 0) accommodation = a;

      const g = findAmountInRow(row, isGrandLabel);
      if (g > 0) grandTotal = g;

      const petrolRow = findAmountInRow(row, isPetrolLabel);
      if (petrolRow > 0) {
        petrolTravel = petrolRow;
        petrolFromLabel = true;
      }

      const dt = findAmountInRow(row, (n) => isDayTotalLabel(n) && !n.includes('thousand'));
      if (dt > 0) dayTotal = dt;

      const f = findAmountInRow(row, isFoodLabel);
      if (f > 0) food = f;

      if (!kmTraveled) {
        for (let c = 0; c < row.length; c++) {
          if (isKmLabel(norm(row[c]))) {
            const parsed = parseKmFromCell(row[c + 1] ?? row[c]);
            if (parsed.total > 0) {
              kmTraveled = parsed.total;
              kmLegs = parsed.legs;
              kmRaw = parsed.raw;
            }
          }
        }
      }
    }

    const textFallback = scanBlockTextFallback(matrix, r + 1, endR);
    const embedded = scanEmbeddedExpenseLabels(matrix, r + 1, endR);

    if (embedded.travel > 0) travel = Math.max(travel, embedded.travel);
    if (embedded.localConveyance > 0) localConveyance = Math.max(localConveyance, embedded.localConveyance);
    if (embedded.petrolTravel > 0) {
      petrolTravel = embedded.petrolTravel;
      petrolFromLabel = true;
    }
    if (embedded.dayTotal > 0) dayTotal = Math.max(dayTotal, embedded.dayTotal);
    if (embedded.accommodation > 0) accommodation = Math.max(accommodation, embedded.accommodation);
    if (embedded.kmTraveled > 0 && !kmTraveled) {
      kmTraveled = embedded.kmTraveled;
      kmLegs = embedded.kmLegs?.length ? embedded.kmLegs : [embedded.kmTraveled];
    }

    const blockText = matrix
      .slice(r + 1, endR)
      .map((row) => (row || []).map((c) => String(c ?? '')).join(' '))
      .join(' ');
    if (!kmTraveled && textFallback.kmTraveled > 0) {
      kmTraveled = textFallback.kmTraveled;
      kmLegs = textFallback.kmLegs;
      kmRaw = textFallback.kmRaw;
    }
    if (!petrolTravel && textFallback.petrolTravel > 0) {
      petrolTravel = textFallback.petrolTravel;
      travelRsRaw = textFallback.travelRsRaw;
      petrolFromLabel = true;
    }
    if (textFallback.travel > 0) travel = Math.max(travel, textFallback.travel);
    if (textFallback.localConveyance > 0) {
      localConveyance = Math.max(localConveyance, textFallback.localConveyance);
    }
    if (textFallback.dayTotal > 0) dayTotal = Math.max(dayTotal, textFallback.dayTotal);
    if (textFallback.accommodation > 0) {
      accommodation = Math.max(accommodation, textFallback.accommodation);
    }

    const isRoundTrip =
      embedded.isRoundTrip ||
      /round\s*trip/i.test(blockText) ||
      /\*\s*8\s*=/.test(travelRsRaw) ||
      /\*\s*8\s*=/.test(textFallback.travelRsRaw || '');

    const kmCalcAmount = kmTraveled > 0
      ? Math.round(kmTraveled * (isRoundTrip ? 8 : PETROL_KM_RATE))
      : 0;
    if (!petrolTravel && kmCalcAmount > 0 && kmTraveled > 0) {
      petrolTravel = kmCalcAmount;
      petrolFromLabel = true;
    }

    const isKmPetrolDay =
      petrolTravel > 0 && (kmTraveled > 0 || travelRsRaw.includes('*'));
    const isSimplePetrolDay =
      petrolFromLabel && petrolTravel > 0 && travel === 0 && localConveyance === 0;
    const isPetrolDay = isKmPetrolDay || isSimplePetrolDay;

    const ticketsSubtotal = travel + localConveyance;
    const petrolDayAmount = petrolTravel || 0;

    if (!grandTotal) {
      if (dayTotal > 0) grandTotal = dayTotal;
      else if (isPetrolDay) grandTotal = petrolDayAmount + accommodation + food;
      else grandTotal = ticketsSubtotal + accommodation;
    }

    const splitType = isKmPetrolDay
      ? 'petrol_km'
      : petrolDayAmount > 0 && ticketsSubtotal === 0
        ? 'petrol'
        : ticketsSubtotal > 0 && petrolDayAmount > 0
          ? 'mixed'
          : embedded.isDaOnly && ticketsSubtotal === 0 && petrolDayAmount === 0
            ? 'da'
            : ticketsSubtotal > 0
              ? 'bus_train'
              : accommodation > 0
                ? 'stay'
                : 'other';

    const hasBusTrainHint =
      !isPetrolDay &&
      (travel > 0 || localConveyance > 0 || splitType === 'bus_train' || splitType === 'mixed' || splitType === 'da');

    const ticketComparable = ticketsLocalForBlock({
      travel,
      localConveyance,
      accommodation,
      grandTotal,
      hasBusTrainHint,
      splitType,
      isPetrolDay,
      isKmPetrolDay,
    });

    if (ticketComparable > 0 || accommodation > 0 || grandTotal > 0 || petrolDayAmount > 0) {
      blocks.push({
        date: toDateStr(date),
        dateKey: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        travel,
        localConveyance,
        accommodation,
        food,
        petrolTravel: petrolDayAmount,
        kmTraveled,
        kmLegs,
        kmRaw,
        travelRsRaw,
        kmCalcAmount,
        kmFormula:
          kmLegs.length > 1
            ? `${kmLegs.join(' + ')} = ${kmTraveled} km × ₹${isRoundTrip ? 8 : PETROL_KM_RATE} = ₹${kmCalcAmount}`
            : kmTraveled > 0
              ? `${kmTraveled} km × ₹${isRoundTrip ? 8 : PETROL_KM_RATE} = ₹${kmCalcAmount}`
              : '',
        isRoundTrip,
        grandTotal,
        dayTotal,
        ticketsSubtotal,
        ticketComparable,
        computedSum: ticketsSubtotal + accommodation + petrolDayAmount,
        splitType,
        splitNote:
          splitType === 'petrol_km'
            ? `Sheet: KM TRAVELED ${kmRaw || kmTraveled} → TRAVEL RS ${travelRsRaw || petrolDayAmount}`
            : splitType === 'petrol'
              ? 'Sheet row: Petrol (counts toward Fuel header)'
              : splitType === 'bus_train'
                ? 'Sheet rows: Travel + Local conveyance'
                : '',
        isPetrolDay,
        isKmPetrolDay,
        hasBusTrainHint,
      });
    }

    r = endR;
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

export const parseVoucherSheet = (matrix, sheetName, options = {}) => {
  if (!matrix?.length || !looksLikeVoucher(matrix)) return null;

  const requestedBy = findCellInHeader(matrix, 'requested by');
  const employeeNoHit = findCellInHeader(matrix, 'employee no');
  const fuelRow = findCellInHeader(matrix, 'fuel expenses');
  const ticketRow =
    findCellInHeader(matrix, 'ticketslocal') ||
    findCellInHeader(matrix, 'tickets') ||
    findCellInHeader(matrix, 'local conv');
  const accommodationRow =
    findCellInHeader(matrix, 'accomdation') || findCellInHeader(matrix, 'accommodation');
  const totalRow = findLabelInHeader(matrix, /^total$/i);

  const auditorName =
    (requestedBy ? valueAfterLabel(requestedBy) : '') || (sheetName || '').trim();
  const employeeNo = employeeNoHit ? valueAfterLabel(employeeNoHit) : '';

  const amtOpts = { employeeNo };
  const dateContext = inferExpensePeriod(matrix, sheetName, options.workbookTitle);
  dateContext.dateOrder = detectDateOrder(matrix, dateContext);
  const dateBlocks = parseDateWiseBlocks(matrix, dateContext);
  const petrolDays = dateBlocks.filter((b) => b.isPetrolDay);
  const busDays = dateBlocks.filter((b) => !b.isPetrolDay);

  const dateWiseTicketsSum = computeDateWiseTicketsLocalSum(dateBlocks);
  const dateWisePetrolSum = dateBlocks.reduce((s, b) => s + (b.petrolTravel || 0), 0);
  const dateWiseAccommodationSum = dateBlocks.reduce((s, b) => s + b.accommodation, 0);
  const dateWiseGrandSum = dateBlocks.reduce((s, b) => s + b.grandTotal, 0);
  const dateWiseBusTrainSum = dateBlocks.reduce((s, b) => s + b.ticketsSubtotal, 0);

  let fuelTotal = fuelRow ? amountAfterLabel(fuelRow, { ...amtOpts, kind: 'line' }) : 0;
  let ticketsTotal = ticketRow ? amountAfterLabel(ticketRow, { ...amtOpts, kind: 'line' }) : 0;
  let accommodationTotal = accommodationRow
    ? amountAfterLabel(accommodationRow, { ...amtOpts, kind: 'line' })
    : 0;
  let declaredTotal = totalRow ? amountAfterLabel(totalRow, { ...amtOpts, kind: 'total' }) : 0;

  const headerCorrected = [];
  if (!fuelTotal && dateWisePetrolSum > 0) {
    fuelTotal = dateWisePetrolSum;
    headerCorrected.push('fuel from date rows');
  } else if (
    fuelTotal > 0 &&
    dateWisePetrolSum > 0 &&
    Math.abs(fuelTotal - dateWisePetrolSum) > 50 &&
    fuelTotal > dateWisePetrolSum * 2
  ) {
    headerCorrected.push(`fuel header ₹${fuelTotal} looked wrong — using date sum ₹${dateWisePetrolSum}`);
    fuelTotal = dateWisePetrolSum;
  }

  if (!ticketsTotal && dateWiseTicketsSum > 0) {
    ticketsTotal = dateWiseTicketsSum;
    headerCorrected.push('tickets+local from date rows');
  }

  if (!accommodationTotal && dateWiseAccommodationSum > 0) {
    accommodationTotal = dateWiseAccommodationSum;
    headerCorrected.push('stay from date rows');
  }

  const headerPartsSum = fuelTotal + ticketsTotal + accommodationTotal;
  if (!declaredTotal && headerPartsSum > 0) {
    declaredTotal = headerPartsSum;
  }

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
    headerPartsSum,
    headerCorrected,
    voucherMode,
    mapLegs,
  };
};

/** Server sync — downloads all tabs on Render. */
export const fetchAllExpenseVouchers = async (url) => {
  const spreadsheetId = extractSpreadsheetId(url);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheets URL — paste the full spreadsheet link.');
  }

  const res = await fetch('/api/expense/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url.trim() }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Sync failed (HTTP ${res.status})`);
  }

  return res.json();
};

export const DEFAULT_EXPENSE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1txSfkx3ITPJe_K0g8vJrZDVy1RbL2aD0SG1XYWe70MY/edit?gid=0#gid=0';
