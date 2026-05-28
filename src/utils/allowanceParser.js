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
    return { jsonData: [], headerRow: 0, headers: [] };
  }

  const headerRow = findHeaderRowIndex(matrix);
  const jsonData = rowsToObjects(matrix, headerRow);
  const headers = (matrix[headerRow] || []).map((h) => String(h ?? '').trim()).filter(Boolean);

  return { jsonData, headerRow, headers };
};

export const fetchAllowanceSheets = async (url) => {
  const { buffer } = await downloadSpreadsheetXlsx(url);
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  const claims = [];
  const sheetSummary = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const { jsonData, headerRow, headers } = parseWorksheet(worksheet, sheetName);

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
        sheetSummary.push({
          sheetName,
          recordCount: 0,
          status: 'headers-not-recognised',
          reason: `No Date + Auditor/Name columns (header row ${headerRow + 1}). Found: ${headers.slice(0, 10).join(', ')}`,
          headers,
          layout,
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
    sheetSummary.push({
      sheetName,
      recordCount: parsed.length,
      status: parsed.length > 0 ? 'loaded' : 'no-valid-rows',
      reason:
        parsed.length > 0
          ? layout === 'consolidated'
            ? 'Consolidated allowance log (all auditors in rows — compared to footprint, not PJP tabs)'
            : ''
          : 'Headers found but no rows with date, auditor name, and amount/route.',
      headers,
      layout,
    });
    claims.push(...parsed);
  });

  if (claims.length === 0 && workbook.SheetNames.length > 0) {
    throw new Error(
      `Fetched ${workbook.SheetNames.length} sheet(s) but no allowance rows parsed. Need columns like Date, Auditor/Name, From/To, Kms, Petrol/Bus. Share sheet as Anyone with link can view.`,
    );
  }

  return {
    claims,
    sheetSummary,
    totalRecords: claims.length,
    totalSheets: workbook.SheetNames.length,
  };
};
