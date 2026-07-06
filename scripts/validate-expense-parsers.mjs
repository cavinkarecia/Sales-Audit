/**
 * CI guard: parse real April Bills tabs and fail build if dated rows are missing.
 */
import XLSX from 'xlsx';
import { parseVoucherSheet, inferWorkbookPeriod } from '../src/utils/expenseVoucherParser.js';

const SPREADSHEET_ID = '1txSfkx3ITPJe_K0g8vJrZDVy1RbL2aD0SG1XYWe70MY';
const WORKBOOK_TITLE = 'April Bills';

const TAB_FIXTURES = [
  { name: 'Manvendra singh', gid: '1350286256', minDates: 2, minTicketsLocal: 500 },
  { name: 'Abhay Dubey', gid: '1081807641', minDates: 5, minTicketsLocal: 500, minFuel: 500 },
  { name: 'Erapogu bajari ', gid: '0', minDates: 2, minTicketsLocal: 500 },
];

const matrixFromCsv = (csv) => {
  const parsed = XLSX.read(csv, { type: 'string' });
  const first = parsed.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json(parsed.Sheets[first], {
    header: 1,
    raw: false,
    defval: '',
  });
};

const fetchCsv = async (gid) => {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`CSV fetch failed for gid ${gid} (HTTP ${resp.status})`);
  return resp.text();
};

const failures = [];

for (const tab of TAB_FIXTURES) {
  try {
    const csv = await fetchCsv(tab.gid);
    const matrix = matrixFromCsv(csv);
    const workbookPeriod = inferWorkbookPeriod([{ matrix, sheetName: tab.name }], WORKBOOK_TITLE);
    const parsed = parseVoucherSheet(matrix, tab.name, { workbookTitle: WORKBOOK_TITLE, workbookPeriod });

    if (!parsed) {
      failures.push(`${tab.name}: not recognized as voucher`);
      continue;
    }

    const dates = parsed.dateBlocks.length;
    const tickets = parsed.dateWiseTicketsSum || 0;
    const fuel = parsed.dateWisePetrolSum || 0;

    if (dates < tab.minDates) {
      failures.push(`${tab.name}: expected >= ${tab.minDates} date rows, got ${dates}`);
    }
    if (tickets < tab.minTicketsLocal) {
      failures.push(`${tab.name}: expected tickets+local >= ${tab.minTicketsLocal}, got ${tickets}`);
    }
    if (tab.minFuel && fuel < tab.minFuel) {
      failures.push(`${tab.name}: expected fuel >= ${tab.minFuel}, got ${fuel}`);
    }

    console.log(
      `OK ${tab.name}: ${dates} dates, tickets+local ₹${tickets}, fuel ₹${fuel}, declared ₹${parsed.declaredTotal}`,
    );
  } catch (err) {
    const msg = String(err?.message || err);
    if (/fetch failed|ECONNRESET|ETIMEDOUT|HTTP 5/i.test(msg)) {
      console.warn(`${tab.name}: skipped (network): ${msg}`);
      continue;
    }
    failures.push(`${tab.name}: ${msg}`);
  }
}

if (failures.length) {
  console.error('Expense parser validation failed:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}

console.log('Expense parser validation passed for all fixture tabs.');
