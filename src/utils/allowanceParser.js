import * as XLSX from 'xlsx';
import { parseExcelDate } from './sheetFetcher.js';
import { downloadSpreadsheetXlsx } from './sheetDownload.js';

const canonHeader = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const GENERIC_TAB_NAMES =
  /^(sheet\d*|form responses?\d*|allowance|summary|total|template|data|master|index|dashboard|pivot|expense|claims?|travel|conveyance|report)$/i;

const buildRowAccessor = (row) => {
  const map = {};
  Object.keys(row).forEach((key) => {
    const k = canonHeader(key);
    if (!k) return;
    const val = row[key];
    map[k] = typeof val === 'string' ? val.trim() : val;
  });
  return map;
};

const CANDIDATES = {
  date: [
    'date', 'claimdate', 'expensedate', 'traveldate', 'visitdate', 'billdate',
    'dated', 'ondate', 'journeydate', 'submissiondate', 'timestamp', 'datetime',
    'workdate', 'day', 'expensedate',
  ],
  employeeName: [
    'employeename', 'auditorname', 'name', 'staffname', 'claimant', 'chooseyourname',
    'yourname', 'executivename', 'salesmanname', 'auditor', 'employee',
    'salesman', 'fieldofficer', 'fo', 'se', 'executive', 'rep', 'representative',
    'salesrep', 'mr', 'medicalrepresentative', 'username', 'submittedby',
    'nameofemployee', 'nameoftheemployee', 'nameofauditor', 'auditornam',
  ],
  fromTown: [
    'fromtown', 'from', 'fromcity', 'startingpoint', 'origin', 'fromplace',
    'startlocation', 'startingfrom', 'fromlocation', 'departure', 'starttown',
    'placefrom', 'startingplace', 'start', 'fromstation',
  ],
  toTown: [
    'totown', 'to', 'tocity', 'destination', 'endpoint', 'toplace',
    'endlocation', 'goingto', 'tolocation', 'arrival', 'destinationtown',
    'placeto', 'endingplace', 'end', 'tostation', 'placevisited', 'visitplace',
    'cityvisited', 'locationvisited',
  ],
  kms: [
    'kms', 'km', 'distance', 'kmstravelled', 'kilometers', 'kilometres',
    'distancekm', 'travelledkm', 'totalkms', 'kmtravelled', 'noofkms',
    'traveldistance', 'totaldistance',
  ],
  petrolAmount: [
    'petrol', 'petrolamount', 'fuel', 'fuelamount', 'petrolclaim', 'petrolamt',
    'fuelclaim', 'twowheeler', 'bike', 'conveyancepetrol', 'petrolexpense',
    'petrolcharges', 'fuelcharges', 'twowheeleramount', 'bikeallowance',
  ],
  busAmount: [
    'bus', 'busticket', 'busfare', 'publictransport', 'busamount', 'busclaim',
    'travelbus', 'busexpense', 'train', 'trainfare', 'auto', 'autofare',
    'buscharges', 'ticketamount', 'transport', 'travelmodebus',
  ],
  totalAmount: [
    'total', 'totalamount', 'claimamount', 'amount', 'expense', 'totalclaim',
    'grandtotal', 'netamount', 'conveyance', 'travelamount', 'da',
    'totalconveyance', 'totalexpense', 'claimtotal', 'payable',
  ],
  tripType: ['triptype', 'roundtrip', 'journeytype', 'onewayroundtrip', 'journey', 'modeoftravel'],
  billType: ['billtype', 'expensetype', 'category', 'mode', 'expensehead', 'particulars', 'type'],
  busBillImage: [
    'busbill', 'busbillimage', 'busimage', 'trainbill', 'trainbillimage', 'ticketimage',
    'busortrainbill', 'travelbillimage', 'ticketphoto', 'ticketproof',
  ],
  petrolBillImage: [
    'petrolbill', 'petrolbillimage', 'fuelbill', 'fuelbillimage', 'petrolimage',
    'fuelimage', 'gpayimage', 'petrolproof', 'fuelproof',
  ],
  travelMapImage: [
    'travelmap', 'mapimage', 'travelmapimage', 'routeimage', 'journeymap',
    'googlemap', 'mapproof', 'travelproof',
  ],
};

const pickField = (accessor, field) => {
  const keys = CANDIDATES[field] || [];
  for (const k of keys) {
    if (accessor[k] !== undefined && accessor[k] !== '') return accessor[k];
  }
  return '';
};

const pad = (n) => String(n).padStart(2, '0');

const toDateStr = (dateObj) =>
  `${pad(dateObj.getDate())}-${pad(dateObj.getMonth() + 1)}-${dateObj.getFullYear()}`;

const parseMoney = (val) => {
  const s = String(val ?? '').replace(/[^\d.-]/g, '');
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
};

const parseKms = (val) => {
  const n = parseFloat(String(val ?? '').replace(/[^\d.]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

const normTown = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const isRoundTrip = (tripType, fromTown, toTown) => {
  const t = String(tripType || '').toLowerCase();
  if (t.includes('round')) return true;
  if (fromTown && toTown && normTown(fromTown) === normTown(toTown)) return true;
  return false;
};

const looksLikeHeaderRow = (acc) => {
  const dateStr = String(pickField(acc, 'date') || '').toLowerCase();
  const nameStr = String(pickField(acc, 'employeeName') || '').toLowerCase();
  return (
    dateStr === 'date' ||
    nameStr === 'employee name' ||
    nameStr === 'name' ||
    nameStr === 'auditor name' ||
    nameStr.includes('chooseyour')
  );
};

const headerSetFromRow = (row) => new Set((row || []).map((c) => canonHeader(c)));

const rowHasClaimHeaders = (headerRow) => {
  const set = headerSetFromRow(headerRow);
  const hasDate = CANDIDATES.date.some((c) => set.has(c));
  const hasName = CANDIDATES.employeeName.some((c) => set.has(c));
  return hasDate && hasName;
};

/** Scan first rows — allowance sheets often have title rows before headers. */
const findHeaderRowIndex = (rows) => {
  const limit = Math.min(20, rows.length);
  for (let i = 0; i < limit; i++) {
    if (rowHasClaimHeaders(rows[i])) return i;
  }
  return 0;
};

const rowsToObjects = (rows, headerIdx) => {
  const headers = (rows[headerIdx] || []).map((h) => String(h ?? '').trim());
  return rows.slice(headerIdx + 1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i] ?? '';
    });
    return obj;
  });
};

const sheetHasClaimHeaders = (jsonData) => {
  if (!jsonData?.length) return false;
  const headers = Object.keys(jsonData[0] || {}).map(canonHeader);
  const set = new Set(headers);
  return CANDIDATES.date.some((c) => set.has(c)) && CANDIDATES.employeeName.some((c) => set.has(c));
};

const countDistinctAuditors = (jsonData) => {
  const names = new Set();
  jsonData.forEach((row) => {
    const n = pickField(buildRowAccessor(row), 'employeeName');
    if (n && !looksLikeHeaderRow(buildRowAccessor(row))) names.add(String(n).trim());
  });
  return names.size;
};

/** Consolidated allowance log (all auditors in one tab) vs PJP-style one tab per auditor. */
const detectLayout = (sheetName, jsonData, hasNameColumn) => {
  if (hasNameColumn && countDistinctAuditors(jsonData) > 1) {
    return 'consolidated';
  }
  if (GENERIC_TAB_NAMES.test(sheetName.trim())) {
    return 'consolidated';
  }
  if (hasNameColumn) {
    return 'consolidated';
  }
  if (!GENERIC_TAB_NAMES.test(sheetName.trim()) && sheetName.trim().length > 2) {
    return 'per-auditor-tab';
  }
  return 'unknown';
};

const parseSheetRows = (jsonData, sheetName, layout) => {
  const claims = [];
  if (!jsonData?.length) return claims;

  const hasNameColumn = sheetHasClaimHeaders(jsonData);
  const useTabAsAuditor = layout === 'per-auditor-tab' && !hasNameColumn;

  jsonData.forEach((row, rowIndex) => {
    const acc = buildRowAccessor(row);
    if (looksLikeHeaderRow(acc)) return;

    const dateRaw = pickField(acc, 'date');
    let employeeName = pickField(acc, 'employeeName');

    if (!employeeName && useTabAsAuditor) {
      employeeName = sheetName;
    }

    if (!employeeName || !dateRaw) return;

    const dateObj = parseExcelDate(dateRaw);
    if (!dateObj) return;

    const fromTown = String(pickField(acc, 'fromTown') || '').trim();
    const toTown = String(pickField(acc, 'toTown') || '').trim();
    const kms = parseKms(pickField(acc, 'kms'));
    const petrolAmount = parseMoney(pickField(acc, 'petrolAmount'));
    const busAmount = parseMoney(pickField(acc, 'busAmount'));
    const totalAmount = parseMoney(pickField(acc, 'totalAmount'));
    const tripType = pickField(acc, 'tripType');
    const billType = String(pickField(acc, 'billType') || 'travel').trim();
    const busBillImage = String(pickField(acc, 'busBillImage') || '').trim();
    const petrolBillImage = String(pickField(acc, 'petrolBillImage') || '').trim();
    const travelMapImage = String(pickField(acc, 'travelMapImage') || '').trim();

    if (!fromTown && !toTown && !kms && !petrolAmount && !busAmount && !totalAmount) return;

    claims.push({
      sheetName,
      rowIndex: rowIndex + 2,
      date: toDateStr(dateObj),
      dateKey: `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`,
      employeeName: String(employeeName).trim(),
      fromTown,
      toTown,
      kms,
      petrolAmount,
      busAmount,
      totalAmount: totalAmount || petrolAmount + busAmount,
      billType,
      roundTrip: isRoundTrip(tripType, fromTown, toTown),
      layout,
      busBillImage,
      petrolBillImage,
      travelMapImage,
    });
  });

  return claims;
};

const parseWorksheet = (worksheet, sheetName) => {
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });
  if (!matrix.length) {
    return { jsonData: [], headerRow: 0, headers: [], matrix: [] };
  }

  const headerRow = findHeaderRowIndex(matrix);
  const jsonData = rowsToObjects(matrix, headerRow);
  const headers = (matrix[headerRow] || []).map((h) => String(h ?? '').trim()).filter(Boolean);

  return { jsonData, headerRow, headers, matrix };
};

const parseDateFromMatrix = (matrix) => {
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < (matrix[r] || []).length; c++) {
      const v = matrix[r][c];
      const d = parseExcelDate(v);
      if (d) return d;
      const s = String(v || '').trim();
      if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) {
        const d2 = parseExcelDate(s);
        if (d2) return d2;
      }
    }
  }
  return null;
};

const parseNumberFromRow = (row) => {
  if (!row) return 0;
  for (let i = 0; i < row.length; i++) {
    const n = parseMoney(row[i]);
    if (n > 0) return n;
  }
  return 0;
};

const parseNumberAfterLabel = (hit) => {
  if (!hit?.row) return 0;
  for (let i = hit.c + 1; i < hit.row.length; i++) {
    const n = parseMoney(hit.row[i]);
    if (n > 0) return n;
  }
  return parseNumberFromRow(hit.row);
};

const findVoucherTotalRow = (matrix) => {
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < Math.min(3, row.length); c++) {
      const s = String(row[c] || '').trim().toLowerCase();
      if (s === 'total') return { r, c, row };
    }
  }
  return findCellByContains(matrix, 'fuel expenses')
    ? findRowByLabel(matrix, /^grand total$/i)
    : null;
};

const findRowByLabel = (matrix, re) => {
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (re.test(String(row[c] || '').toLowerCase().trim())) {
        return { r, c, row };
      }
    }
  }
  return null;
};

const findCellByContains = (matrix, needle) => {
  const target = String(needle || '').toLowerCase();
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) {
      const s = String(row[c] || '').toLowerCase();
      if (s.includes(target)) return { r, c, row };
    }
  }
  return null;
};

const nextNonEmptyInRow = (row, startCol) => {
  for (let c = startCol + 1; c < row.length; c++) {
    const v = String(row[c] ?? '').trim();
    if (v) return v;
  }
  return '';
};

/** Date in column A below the voucher header (e.g. A20 = 01/04/26). */
const parseVoucherDateFromColumnA = (matrix) => {
  for (let r = 10; r < matrix.length; r++) {
    const cell = matrix[r]?.[0];
    const s = String(cell ?? '').trim();
    if (!s) continue;
    const d = parseExcelDate(cell);
    if (d) return d;
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) {
      const d2 = parseExcelDate(s);
      if (d2) return d2;
    }
  }
  return null;
};

const looksLikeVoucherForm = (matrix) =>
  Boolean(
    findCellByContains(matrix, 'requested by') ||
      findCellByContains(matrix, 'fuel expenses') ||
      findCellByContains(matrix, 'expenses claim voucher'),
  );

const diagnoseVoucherForm = (matrix, sheetName) => {
  if (!matrix?.length) return 'Sheet is empty';
  if (!looksLikeVoucherForm(matrix)) {
    return 'Not a voucher claim form — expected labels like Requested By, Fuel Expenses, Tickets + Local Conveyance, Total';
  }

  const requestedBy =
    findCellByContains(matrix, 'requested by') || findRowByLabel(matrix, /^requested by$/i);
  const totalRow = findVoucherTotalRow(matrix);
  const fuelRow = findCellByContains(matrix, 'fuel expenses') || findRowByLabel(matrix, /fuel expenses/i);
  const ticketRow =
    findCellByContains(matrix, 'tickets + local') ||
    findCellByContains(matrix, 'tickets') ||
    findCellByContains(matrix, 'local conv') ||
    findRowByLabel(matrix, /(tickets \+ local|tickets|local conveyance)/i);

  const employeeNameRaw = requestedBy
    ? String(nextNonEmptyInRow(requestedBy.row, requestedBy.c) || '').trim()
    : '';
  const employeeName = employeeNameRaw || (sheetName || '').trim();
  const voucherDate =
    parseVoucherDateFromColumnA(matrix) || parseDateFromMatrix(matrix);
  const petrolAmount = fuelRow ? parseNumberAfterLabel(fuelRow) : 0;
  const busAmount = ticketRow ? parseNumberAfterLabel(ticketRow) : 0;
  const totalAmount = totalRow ? parseNumberAfterLabel(totalRow) : 0;

  const issues = [];
  if (!employeeName) issues.push('missing auditor (Requested By or tab name)');
  if (!voucherDate) issues.push('missing claim date (column A, e.g. 01/04/26)');
  if (!petrolAmount && !busAmount && !totalAmount) {
    issues.push('missing amounts (Fuel Expenses / Tickets / Total rows are empty)');
  }
  if (issues.length === 0) return 'Voucher form found but row could not be built — check date and amount cells';
  return issues.join('; ');
};

const parseVoucherFormSheet = (matrix, sheetName) => {
  if (!matrix?.length) return [];

  const requestedBy =
    findCellByContains(matrix, 'requested by') || findRowByLabel(matrix, /^requested by$/i);
  const totalRow = findVoucherTotalRow(matrix);
  const fuelRow = findCellByContains(matrix, 'fuel expenses') || findRowByLabel(matrix, /fuel expenses/i);
  const ticketRow =
    findCellByContains(matrix, 'tickets + local') ||
    findCellByContains(matrix, 'tickets') ||
    findCellByContains(matrix, 'local conv') ||
    findRowByLabel(matrix, /(tickets \+ local|tickets|local conveyance)/i);
  const travelKmsRow =
    findRowByLabel(matrix, /^travel$/i) || findCellByContains(matrix, 'local convience');
  const voucherDateCell = findCellByContains(matrix, 'voucher date');

  let voucherDate = null;
  if (voucherDateCell) {
    const right = nextNonEmptyInRow(voucherDateCell.row, voucherDateCell.c);
    voucherDate = parseExcelDate(right);
  }
  if (!voucherDate) {
    voucherDate = parseVoucherDateFromColumnA(matrix);
  }
  if (!voucherDate) {
    voucherDate = parseDateFromMatrix(matrix);
  }

  const employeeNameRaw = requestedBy
    ? String(nextNonEmptyInRow(requestedBy.row, requestedBy.c) || '').trim()
    : '';
  const employeeName = employeeNameRaw || (sheetName || '').trim();
  const petrolAmount = fuelRow ? parseNumberAfterLabel(fuelRow) : 0;
  const busAmount = ticketRow ? parseNumberAfterLabel(ticketRow) : 0;
  const totalAmount = totalRow ? parseNumberAfterLabel(totalRow) : petrolAmount + busAmount;
  const kms = travelKmsRow ? parseNumberAfterLabel(travelKmsRow) : 0;

  if (!employeeName || !voucherDate || (!petrolAmount && !busAmount && !totalAmount)) {
    return [];
  }

  return [
    {
      sheetName,
      rowIndex: 1,
      date: toDateStr(voucherDate),
      dateKey: `${voucherDate.getFullYear()}-${pad(voucherDate.getMonth() + 1)}-${pad(voucherDate.getDate())}`,
      employeeName,
      fromTown: '',
      toTown: '',
      kms,
      petrolAmount,
      busAmount,
      totalAmount: totalAmount || petrolAmount + busAmount,
      billType: 'voucher',
      roundTrip: false,
      layout: 'voucher-form',
      busBillImage: '',
      petrolBillImage: '',
      travelMapImage: '',
    },
  ];
};

export const fetchAllowanceSheets = async (url) => {
  const { buffer } = await downloadSpreadsheetXlsx(url);
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  const claims = [];
  const sheetSummary = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const { jsonData, headerRow, headers, matrix } = parseWorksheet(worksheet, sheetName);

    if (!jsonData.length) {
      sheetSummary.push({
        sheetName,
        recordCount: 0,
        status: 'empty',
        reason: 'Sheet is blank',
        headers: [],
        layout: 'empty',
      });
      return;
    }

    const hasHeaders = sheetHasClaimHeaders(jsonData);
    const layout = detectLayout(sheetName, jsonData, hasHeaders);

    if (!hasHeaders) {
      const parsed = parseSheetRows(jsonData, sheetName, layout);
      if (parsed.length === 0) {
        const voucherParsed = parseVoucherFormSheet(matrix, sheetName);
        if (voucherParsed.length > 0) {
          claims.push(...voucherParsed);
          sheetSummary.push({
            sheetName,
            recordCount: voucherParsed.length,
            status: 'loaded',
            reason: 'Parsed voucher-style claim form',
            headers,
            layout: 'voucher-form',
          });
          return;
        }
        sheetSummary.push({
          sheetName,
          recordCount: 0,
          status: 'parse-failed',
          reason: diagnoseVoucherForm(matrix, sheetName),
          headers,
          layout: looksLikeVoucherForm(matrix) ? 'voucher-form' : layout,
        });
        return;
      }
      claims.push(...parsed);
      sheetSummary.push({
        sheetName,
        recordCount: parsed.length,
        status: 'loaded',
        reason: layout === 'per-auditor-tab' ? 'Tab name used as auditor' : 'Parsed with detected columns',
        headers,
        layout,
      });
      return;
    }

    const parsed = parseSheetRows(jsonData, sheetName, layout);
    const voucherParsed = parsed.length === 0 ? parseVoucherFormSheet(matrix, sheetName) : [];
    const finalParsed = parsed.length > 0 ? parsed : voucherParsed;
    sheetSummary.push({
      sheetName,
      recordCount: finalParsed.length,
      status: finalParsed.length > 0 ? 'loaded' : 'parse-failed',
      reason:
        finalParsed.length > 0
          ? layout === 'consolidated'
            ? 'Consolidated allowance log (all auditors in rows)'
            : voucherParsed.length > 0
              ? 'Parsed voucher-style claim form'
              : ''
          : diagnoseVoucherForm(matrix, sheetName),
      headers,
      layout: voucherParsed.length > 0 ? 'voucher-form' : layout,
    });
    claims.push(...finalParsed);
  });

  const loadedCount = sheetSummary.filter((s) => s.status === 'loaded').length;
  const failedTabs = sheetSummary.filter((s) => s.status !== 'loaded');

  let syncError = null;
  if (claims.length === 0 && workbook.SheetNames.length > 0) {
    if (workbook.SheetNames.length === 1) {
      syncError = {
        title: 'Only 1 tab downloaded',
        message:
          'Google returned a single tab. This workbook should have one tab per auditor (e.g. Erapogu bajari). Use the edit link and set Share → Anyone with the link → Viewer.',
        failedTabs,
      };
    } else {
      syncError = {
        title: 'No claims parsed from any auditor tab',
        message:
          'Tabs were fetched but none matched the voucher layout (Requested By, Fuel Expenses, Tickets + Local Conveyance, date in column A, Total). See per-tab reasons below.',
        failedTabs,
      };
    }
  } else if (failedTabs.length > 0) {
    syncError = {
      title: `Partial sync — ${loadedCount} of ${workbook.SheetNames.length} tabs loaded`,
      message: `${failedTabs.length} tab(s) could not be parsed. Loaded claims will still be checked against attendance and PJP.`,
      failedTabs,
      partial: true,
    };
  }

  return {
    claims,
    sheetSummary,
    totalRecords: claims.length,
    totalSheets: workbook.SheetNames.length,
    loadedSheets: loadedCount,
    syncError,
  };
};
