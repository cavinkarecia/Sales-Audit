import * as XLSX from 'xlsx';
import { parseExcelDate } from './sheetFetcher.js';

const extractSpreadsheetId = (url) => {
  const match = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

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
  date: ['date', 'claimdate', 'expensedate', 'traveldate', 'visitdate'],
  employeeName: ['employeename', 'auditorname', 'name', 'staffname', 'claimant'],
  fromTown: ['fromtown', 'from', 'fromcity', 'startingpoint', 'origin'],
  toTown: ['totown', 'to', 'tocity', 'destination', 'endpoint'],
  kms: ['kms', 'km', 'distance', 'kmstravelled', 'kilometers'],
  petrolAmount: ['petrol', 'petrolamount', 'fuel', 'fuelamount', 'petrolclaim'],
  busAmount: ['bus', 'busticket', 'busfare', 'publictransport'],
  totalAmount: ['total', 'totalamount', 'claimamount', 'amount', 'expense'],
  tripType: ['triptype', 'roundtrip', 'journeytype', 'onewayroundtrip'],
  billType: ['billtype', 'expensetype', 'category', 'mode'],
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

const isRoundTrip = (tripType, fromTown, toTown) => {
  const t = String(tripType || '').toLowerCase();
  if (t.includes('round')) return true;
  if (fromTown && toTown && normTown(fromTown) === normTown(toTown)) return true;
  return false;
};

const normTown = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const fetchAllowanceSheets = async (url) => {
  const spreadsheetId = extractSpreadsheetId(url);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheets URL.');
  }

  const exportUrl = `/api/sheet?id=${spreadsheetId}`;
  const response = await fetch(exportUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch allowance sheet (HTTP ${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });

  const claims = [];
  const sheetSummary = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' });
    if (!jsonData.length) {
      sheetSummary.push({ sheetName, recordCount: 0, status: 'empty' });
      return;
    }

    let count = 0;
    jsonData.forEach((row) => {
      const acc = buildRowAccessor(row);
      const dateRaw = pickField(acc, 'date');
      const employeeName = pickField(acc, 'employeeName');
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

      claims.push({
        sheetName,
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
      count += 1;
    });

    sheetSummary.push({
      sheetName,
      recordCount: count,
      status: count > 0 ? 'loaded' : 'no-valid-rows',
    });
  });

  return {
    claims,
    sheetSummary,
    totalRecords: claims.length,
    totalSheets: workbook.SheetNames.length,
  };
};

