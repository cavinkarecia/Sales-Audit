import * as XLSX from 'xlsx';
import { parseExcelDate } from './sheetFetcher.js';
import { downloadSpreadsheetXlsx } from './sheetDownload.js';

const canonHeader = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
    'dated', 'ondate', 'journeydate', 'submissiondate',
  ],
  employeeName: [
    'employeename', 'auditorname', 'name', 'staffname', 'claimant', 'chooseyourname',
    'yourname', 'executivename', 'salesmanname', 'auditor', 'employee',
  ],
  fromTown: [
    'fromtown', 'from', 'fromcity', 'startingpoint', 'origin', 'fromplace',
    'startlocation', 'startingfrom', 'fromlocation', 'departure', 'starttown',
  ],
  toTown: [
    'totown', 'to', 'tocity', 'destination', 'endpoint', 'toplace',
    'endlocation', 'goingto', 'tolocation', 'arrival', 'destinationtown',
  ],
  kms: [
    'kms', 'km', 'distance', 'kmstravelled', 'kilometers', 'kilometres',
    'distancekm', 'travelledkm', 'totalkms', 'kmtravelled', 'noofkms',
  ],
  petrolAmount: [
    'petrol', 'petrolamount', 'fuel', 'fuelamount', 'petrolclaim', 'petrolamt',
    'fuelclaim', 'twowheeler', 'bike', 'conveyancepetrol', 'petrolexpense',
  ],
  busAmount: [
    'bus', 'busticket', 'busfare', 'publictransport', 'busamount', 'busclaim',
    'travelbus', 'busexpense', 'train', 'trainfare', 'auto', 'autofare',
  ],
  totalAmount: [
    'total', 'totalamount', 'claimamount', 'amount', 'expense', 'totalclaim',
    'grandtotal', 'netamount', 'conveyance', 'travelamount', 'da',
  ],
  tripType: ['triptype', 'roundtrip', 'journeytype', 'onewayroundtrip', 'journey'],
  billType: ['billtype', 'expensetype', 'category', 'mode', 'expensehead', 'particulars'],
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

const sheetHasClaimHeaders = (jsonData) => {
  if (!jsonData?.length) return false;
  const headers = Object.keys(jsonData[0] || {}).map(canonHeader);
  const set = new Set(headers);
  const hasDate = CANDIDATES.date.some((c) => set.has(c));
  const hasName = CANDIDATES.employeeName.some((c) => set.has(c));
  return hasDate && hasName;
};

const parseSheetRows = (jsonData, sheetName) => {
  const claims = [];
  if (!jsonData?.length) return claims;

  jsonData.forEach((row, rowIndex) => {
    const acc = buildRowAccessor(row);
    if (looksLikeHeaderRow(acc)) return;

    const dateRaw = pickField(acc, 'date');
    let employeeName = pickField(acc, 'employeeName');

    // Fallback: sheet tab name is often the auditor name
    if (!employeeName && sheetName && !/sheet\d|summary|total/i.test(sheetName)) {
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
    });
  });

  return claims;
};

export const fetchAllowanceSheets = async (url) => {
  const { buffer } = await downloadSpreadsheetXlsx(url);
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  const claims = [];
  const sheetSummary = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

    if (!jsonData.length) {
      sheetSummary.push({
        sheetName,
        recordCount: 0,
        status: 'empty',
        reason: 'Sheet is blank',
        headers: [],
      });
      return;
    }

    const headerSample = Object.keys(jsonData[0] || {});

    if (!sheetHasClaimHeaders(jsonData)) {
      // Try row 2+ as data with sheet name as auditor (common layout)
      const parsed = parseSheetRows(jsonData, sheetName);
      if (parsed.length === 0) {
        sheetSummary.push({
          sheetName,
          recordCount: 0,
          status: 'headers-not-recognised',
          reason: `Could not find Date + Name columns. Found: ${headerSample.slice(0, 8).join(', ')}`,
          headers: headerSample,
        });
        return;
      }
      claims.push(...parsed);
      sheetSummary.push({
        sheetName,
        recordCount: parsed.length,
        status: 'loaded',
        reason: 'Matched using sheet tab name as auditor',
        headers: headerSample,
      });
      return;
    }

    const parsed = parseSheetRows(jsonData, sheetName);
    sheetSummary.push({
      sheetName,
      recordCount: parsed.length,
      status: parsed.length > 0 ? 'loaded' : 'no-valid-rows',
      reason:
        parsed.length > 0
          ? ''
          : 'Headers found but no rows with date, auditor name, and an amount or route.',
      headers: headerSample,
    });
    claims.push(...parsed);
  });

  if (claims.length === 0 && workbook.SheetNames.length > 0) {
    throw new Error(
      `Fetched ${workbook.SheetNames.length} sheet(s) but no allowance rows parsed. Check column names (Date, Auditor/Name, From, To, Kms, Petrol/Bus amount) or share a sample layout.`,
    );
  }

  return {
    claims,
    sheetSummary,
    totalRecords: claims.length,
    totalSheets: workbook.SheetNames.length,
  };
};
