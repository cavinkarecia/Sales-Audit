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
  if (!s || s.length > 14) return null;
  if (/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*[-–to]/i.test(s)) return null;

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
    if (p0 >= 1 && p0 <= 31 && p1 >= 1 && p1 <= 12) {
      return new Date(year, p1 - 1, p0);
    }
    const parsed = parseExcelDate(s);
    if (parsed) return parsed;
  }

  return null;
};

/** Date may be in column A or another column — scan the row. */
const findDateInRow = (row) => {
  if (!row?.length) return null;
  for (let c = 0; c < Math.min(row.length, 12); c++) {
    const d = parseDateCell(row[c]);
    if (!d) continue;
    const otherCells = row.filter((cell, i) => i !== c && String(cell ?? '').trim()).length;
    if (c === 0 || otherCells <= 1) return { date: d, col: c };
  }
  return null;
};

const isTravelLabel = (n) =>
  (n === 'travel' || (n.startsWith('travel') && !n.includes('rs') && !n.includes('km'))) &&
  !n.includes('expense');

const isLocalLabel = (n) => n.includes('localconv');
const isAccLabel = (n) => n.includes('accom');
const isGrandLabel = (n) => n.includes('grandtotal');
const isDayTotalLabel = (n) => n === 'total';
const isPetrolTravelLabel = (n) => n.includes('travelrs') || n === 'travelrs';
const isPetrolLabel = (n) => n === 'petrol' || (n.endsWith('petrol') && !n.includes('expense'));
const isKmLabel = (n) => n.includes('kmtraveled') || n.includes('kmtravel') || n === 'km';
const isFoodLabel = (n) => n === 'food';

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

const findAmountInRow = (row, labelTest) => {
  for (let c = 0; c < (row || []).length; c++) {
    const label = norm(row[c]);
    if (!label || !labelTest(label)) continue;
    // Amount to the right of label (same row)
    for (let j = c + 1; j < row.length; j++) {
      const amt = parseAmountFromCell(row[j]);
      if (amt > 0) return amt;
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

  const out = { kmTraveled: 0, kmLegs: [], kmRaw: '', petrolTravel: 0, travelRsRaw: '' };

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

  return out;
};

const parseDateWiseBlocks = (matrix) => {
  const blocks = [];
  const scanStart = getDateScanStartRow(matrix);
  let r = scanStart;

  while (r < matrix.length) {
    const dateHit = findDateInRow(matrix[r]);
    if (!dateHit) {
      r++;
      continue;
    }

    const date = dateHit.date;
    let endR = matrix.length;
    for (let rr = r + 1; rr < matrix.length; rr++) {
      if (findDateInRow(matrix[rr])) {
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

    const isRoundTrip =
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
      if (isPetrolDay) grandTotal = petrolDayAmount + accommodation + food;
      else grandTotal = ticketsSubtotal + accommodation;
    }

    const splitType = isKmPetrolDay
      ? 'petrol_km'
      : petrolDayAmount > 0 && ticketsSubtotal === 0
        ? 'petrol'
        : ticketsSubtotal > 0 && petrolDayAmount > 0
          ? 'mixed'
          : ticketsSubtotal > 0
            ? 'bus_train'
            : accommodation > 0
              ? 'stay'
              : 'other';

    const hasBusTrainHint =
      !isPetrolDay &&
      (travel > 0 || localConveyance > 0 || splitType === 'bus_train' || splitType === 'mixed');

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

export const parseVoucherSheet = (matrix, sheetName) => {
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
  const dateBlocks = parseDateWiseBlocks(matrix);
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
