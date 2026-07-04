import * as XLSX from 'xlsx';
import { extractSpreadsheetId } from './spreadsheetUrl.js';
import { downloadSpreadsheetXlsx } from './sheetDownload.js';

export { extractSpreadsheetId };

/**
 * Safely parses Excel date values (strings, serial numbers, Date objects)
 * to return a true Javascript Date.
 */
export const parseExcelDate = (val) => {
  if (val === null || val === undefined || val === '') return null;
  
  // 1. If it's already a JS Date object
  if (val instanceof Date) {
    if (!isNaN(val.getTime())) {
      // Shift date by timezone offset to prevent GMT/UTC date conversion shifts
      const date = new Date(val.getTime());
      const userTimezoneOffset = date.getTimezoneOffset() * 60000;
      return new Date(date.getTime() + userTimezoneOffset);
    }
  }

  // 2. If it's a number (Excel Serial Date number)
  const num = Number(val);
  if (typeof val === 'number' || (!isNaN(num) && String(val).trim() !== '')) {
    // Excel serial dates: days since Jan 1 1900
    const date = new Date((num - 25569) * 86400 * 1000);
    const userTimezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() + userTimezoneOffset);
  }

  // 3. If it's a string, try standard formats
  const str = String(val).trim();
  if (!str) return null;

  // Check split formats like dd-mm-yyyy or dd/mm/yyyy or dd-MMM-yyyy
  const parts = str.split(/[-/]/);
  if (parts.length === 3) {
    const monthsMap = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      january: 0, february: 1, march: 2, april: 3, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    };

    if (parts[0].length === 4) {
      // yyyy-mm-dd
      const y = parseInt(parts[0], 10);
      let m = parseInt(parts[1], 10) - 1;
      if (isNaN(m)) {
        const mLower = parts[1].toLowerCase();
        if (mLower in monthsMap) m = monthsMap[mLower];
      }
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        return new Date(y, m, d);
      }
    } else {
      // dd-mm-yyyy or mm-dd-yyyy or dd-MMM-yyyy
      const d = parseInt(parts[0], 10);
      let m = parseInt(parts[1], 10) - 1;
      if (isNaN(m)) {
        const mLower = parts[1].toLowerCase();
        if (mLower in monthsMap) m = monthsMap[mLower];
      }
      const y = parseInt(parts[2], 10);
      const fullY = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
      if (!isNaN(d) && !isNaN(m) && !isNaN(fullY)) {
        return new Date(fullY, m, d);
      }
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
};

/**
 * Aggressively normalize a header key:
 *  - lower case
 *  - strip everything that isn't a-z or 0-9
 * So "Employee Name", "Employee_Name", "EmployeeName ", "EMP NAME" all
 * map to the same canonical key. This is what lets us match real-world
 * spreadsheets where typists use spaces, dots, slashes or punctuation
 * inconsistently.
 */
const canonHeader = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Build a forgiving accessor map for one row by normalising each header
 * and pointing at the original value.
 */
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
  date: ['date', 'logdate', 'travelldate', 'traveldate', 'day', 'visitdate'],
  employeeCode: ['employeecode', 'empcode', 'employeeid', 'empid', 'staffcode'],
  employeeName: ['employeename', 'empname', 'name', 'auditorname', 'staffname', 'nameofemployee'],
  workType: ['worktype', 'typeofwork', 'activity', 'work', 'visittype'],
  state: ['state', 'statename'],
  fromTown: ['fromtownname', 'fromtown', 'from', 'origintown', 'startingtown', 'startpoint', 'departureplace', 'fromcity'],
  toTown: ['totownname', 'totown', 'to', 'destinationtown', 'endingtown', 'endpoint', 'destinationplace', 'tocity'],
  kms: ['kmstravelled', 'kmstraveled', 'kms', 'km', 'distance', 'distancekm', 'distancetravelled', 'kilometers', 'kilometres'],
  asmName: ['asmname', 'asm', 'areasalesmanager'],
  hotelStay: ['hotelstayyesno', 'hotelstay', 'hotel', 'stay', 'overnight'],
  plannedRSName: ['plannedrsname', 'plannedrs', 'plannedretailstore', 'planneddistributor', 'plannedshop'],
  pincode: ['pincode', 'pincodeofdestination', 'topincode', 'destinationpincode', 'pin', 'postalcode', 'zipcode'],
  channel: ['channel', 'channelname'],
};

const pickField = (accessor, field) => {
  const keys = CANDIDATES[field] || [];
  for (const k of keys) {
    if (accessor[k] !== undefined && accessor[k] !== '') return accessor[k];
  }
  return '';
};

const cleanValue = (val) => {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (!s) return '';
  if (s.toLowerCase() === 'n/a' || s.toLowerCase() === 'na' || s === '-' || s === '--') return '';
  return s;
};

const looksLikeHeaderRow = (raw, dateRaw, employeeName) => {
  const dateStr = String(dateRaw || '').toLowerCase().trim();
  const nameStr = String(employeeName || '').toLowerCase().trim();
  return dateStr === 'date' || nameStr === 'employee name' || nameStr === 'name' || nameStr === 'employee_name';
};

/**
 * Fetches the entire Google Spreadsheet as XLSX and parses ALL sheets.
 * Returns rich diagnostics so callers can show which sheets failed and why.
 *
 * Return shape:
 *   {
 *     records: [...]              // all parsed travel records
 *     sheetSummary: [             // ONE entry PER workbook sheet (loaded or not)
 *       { sheetName, employeeName, recordCount, status, reason, headers }
 *     ],
 *     loadedSheets, skippedSheets,
 *     totalSheets, totalRecords
 *   }
 *
 *   status is one of: 'loaded' | 'empty' | 'headers-not-recognised'
 *                    | 'no-valid-rows' | 'all-dates-unparseable'
 *                    | 'all-rows-missing-name'
 */
export const fetchAllSheets = async (url) => {
  const { buffer } = await downloadSpreadsheetXlsx(url);
  const data = new Uint8Array(buffer);
  const workbook = XLSX.read(data, { type: 'array' });

  const allRecords = [];
  const sheetSummary = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

    if (!jsonData || jsonData.length === 0) {
      sheetSummary.push({
        sheetName, employeeName: '', recordCount: 0,
        status: 'empty', reason: 'Sheet is blank (no rows)', headers: [],
      });
      return;
    }

    const headerSample = Object.keys(jsonData[0] || {});
    const canonHeaders = new Set(headerSample.map(canonHeader));
    const hasDateHeader = CANDIDATES.date.some(c => canonHeaders.has(c));
    const hasNameHeader = CANDIDATES.employeeName.some(c => canonHeaders.has(c));

    if (!hasDateHeader || !hasNameHeader) {
      sheetSummary.push({
        sheetName, employeeName: '', recordCount: 0,
        status: 'headers-not-recognised',
        reason: `Could not find ${!hasDateHeader ? 'a Date column' : ''}${!hasDateHeader && !hasNameHeader ? ' or ' : ''}${!hasNameHeader ? 'an Employee Name column' : ''}. Found headers: ${headerSample.join(', ')}`,
        headers: headerSample,
      });
      return;
    }

    let sheetRecordCount = 0;
    let firstEmployeeName = '';
    let dateAttemptCount = 0;
    let dateFailCount = 0;
    let missingNameCount = 0;

    jsonData.forEach((row) => {
      const acc = buildRowAccessor(row);

      const dateRaw = pickField(acc, 'date');
      const employeeName = pickField(acc, 'employeeName');

      if (looksLikeHeaderRow(row, dateRaw, employeeName)) return;
      if (!dateRaw && !employeeName) return;

      if (!employeeName) {
        missingNameCount++;
        return;
      }
      if (!dateRaw) return;

      dateAttemptCount++;
      const dateObj = parseExcelDate(dateRaw);
      if (!dateObj) {
        dateFailCount++;
        return;
      }

      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${pad(dateObj.getDate())}-${pad(dateObj.getMonth() + 1)}-${dateObj.getFullYear()}`;

      const employeeCode = pickField(acc, 'employeeCode');
      const workType = pickField(acc, 'workType');
      const state = pickField(acc, 'state');
      const fromTown = pickField(acc, 'fromTown');
      const toTown = pickField(acc, 'toTown');
      const kmsRaw = pickField(acc, 'kms');
      const asmName = pickField(acc, 'asmName');
      const hotelStay = pickField(acc, 'hotelStay');
      const plannedRSName = pickField(acc, 'plannedRSName');
      const pincode = pickField(acc, 'pincode');
      const channel = pickField(acc, 'channel');

      let parsedKms = 0;
      const kmsStr = cleanValue(String(kmsRaw));
      if (kmsStr && !isNaN(parseFloat(kmsStr))) {
        parsedKms = parseFloat(kmsStr);
      }

      if (!firstEmployeeName) {
        firstEmployeeName = String(employeeName).trim();
      }

      allRecords.push({
        date: dateStr,
        employeeCode: String(employeeCode || ''),
        employeeName: String(employeeName).trim(),
        workType: cleanValue(workType),
        state: cleanValue(state),
        fromTown: cleanValue(fromTown),
        toTown: cleanValue(toTown),
        kms: parsedKms,
        asmName: cleanValue(asmName),
        hotelStay: cleanValue(hotelStay),
        plannedRSName: cleanValue(plannedRSName),
        pincode: cleanValue(String(pincode || '').replace(/\D/g, '').slice(0, 6)),
        channel: cleanValue(channel),
        sheetName,
        isWorkingDay: !!cleanValue(workType),
      });
      sheetRecordCount++;
    });

    if (sheetRecordCount > 0) {
      sheetSummary.push({
        sheetName,
        employeeName: firstEmployeeName || sheetName,
        recordCount: sheetRecordCount,
        status: 'loaded',
        reason: '',
        headers: headerSample,
      });
      return;
    }

    let status = 'no-valid-rows';
    let reason = 'Headers were recognised but no rows contained both a parseable date and an employee name.';
    if (dateAttemptCount > 0 && dateFailCount === dateAttemptCount) {
      status = 'all-dates-unparseable';
      reason = `Found ${dateAttemptCount} rows with dates but none could be parsed (check the Date column format).`;
    } else if (missingNameCount > 0 && dateAttemptCount === 0) {
      status = 'all-rows-missing-name';
      reason = `Found ${missingNameCount} rows without an Employee Name value.`;
    }

    sheetSummary.push({
      sheetName, employeeName: '', recordCount: 0,
      status, reason, headers: headerSample,
    });
  });

  const loadedSheets = sheetSummary.filter(s => s.status === 'loaded');
  const skippedSheets = sheetSummary.filter(s => s.status !== 'loaded');

  return {
    records: allRecords,
    sheetSummary,
    loadedSheets,
    skippedSheets,
    totalSheets: workbook.SheetNames.length,
    totalLoadedSheets: loadedSheets.length,
    totalSkippedSheets: skippedSheets.length,
    totalRecords: allRecords.length,
  };
};

/**
 * Groups travel records by employee name
 */
export const groupByEmployee = (records) => {
  const grouped = {};
  records.forEach(record => {
    const name = record.employeeName;
    if (!grouped[name]) {
      grouped[name] = [];
    }
    grouped[name].push(record);
  });
  return grouped;
};

/**
 * Groups travel records by month
 */
export const groupByMonth = (records) => {
  const grouped = {};
  records.forEach(record => {
    const dateStr = record.date; // "dd-MM-yyyy"
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const month = parts[1]; // "MM"
      const year = parts[2]; // "yyyy"
      
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const mIdx = parseInt(month, 10) - 1;
      if (mIdx >= 0 && mIdx < 12) {
        const monthKey = `${year}-${month}`; // "yyyy-MM"
        const monthLabel = `${monthNames[mIdx]} ${year}`; // e.g. "April 2026"
        
        if (!grouped[monthKey]) {
          grouped[monthKey] = { key: monthKey, label: monthLabel, records: [] };
        }
        grouped[monthKey].records.push(record);
      }
    }
  });
  
  return Object.values(grouped).sort((a, b) => a.key.localeCompare(b.key));
};

/**
 * Calculate travel statistics for an auditor
 */
export const calculateTravelStats = (records, baseLocation) => {
  const workingDays = records.filter(r => r.isWorkingDay);
  const leaves = records.filter(r => !r.isWorkingDay);
  const totalKms = records.reduce((sum, r) => sum + (r.kms || 0), 0);
  const townsVisited = new Set(records.map(r => r.toTown).filter(Boolean));
  const statesVisited = new Set(records.map(r => r.state).filter(Boolean));
  const uniqueDates = new Set(records.map(r => r.date));
  const plannedVisits = records.filter(r => r.plannedRSName && r.plannedRSName.toLowerCase() !== 'n/a');

  return {
    totalDays: uniqueDates.size,
    workingDays: workingDays.length,
    leaveDays: leaves.length,
    totalKms: Math.round(totalKms * 10) / 10,
    townsVisited: townsVisited.size,
    townsList: Array.from(townsVisited),
    statesVisited: statesVisited.size,
    statesList: Array.from(statesVisited),
    baseLocation: baseLocation || 'Unknown',
    plannedCount: plannedVisits.length,
    plannedAdherence: workingDays.length > 0 ? Math.round((plannedVisits.length / workingDays.length) * 100) : 0
  };
};
