import * as XLSX from 'xlsx';

/**
 * Extracts the spreadsheet ID from a Google Sheets URL
 */
const extractSpreadsheetId = (url) => {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

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
 * Fetches the entire Google Spreadsheet as XLSX and parses ALL sheets.
 * Each sheet typically represents one auditor's travel data.
 * 
 * @param {string} url - Google Sheets URL (any tab)
 * @returns {Promise<Array>} - Consolidated array of travel records from all sheets
 */
export const fetchAllSheets = async (url) => {
  const spreadsheetId = extractSpreadsheetId(url);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheets URL. Please provide a valid spreadsheet link.');
  }

  // Export entire spreadsheet as XLSX (includes ALL sheets)
  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  
  const response = await fetch(exportUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch spreadsheet (HTTP ${response.status}). Ensure the sheet is shared as "Anyone with the link can view".`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  
  // Use cellDates: true so XLSX parses Excel serial dates into JS Date objects
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });

  const allRecords = [];
  const sheetSummary = [];

  // Process each sheet (each sheet = one auditor typically)
  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (jsonData.length === 0) return;

    let sheetRecordCount = 0;

    jsonData.forEach((row) => {
      // Normalize column names (handle spaces, case variations)
      const normalized = {};
      Object.keys(row).forEach(key => {
        normalized[key.trim()] = typeof row[key] === 'string' ? row[key].trim() : row[key];
      });

      // Find the right column names by checking common patterns
      const dateRaw = normalized['Date'] || normalized['Date '] || normalized['date'] || '';
      const employeeCode = normalized['Employee Code'] || normalized['Employee code'] || normalized['Emp Code'] || '';
      const employeeName = normalized['Employee Name'] || normalized['Employee name'] || normalized['Name'] || '';
      const workType = normalized['Work Type'] || normalized['Work type'] || '';
      const state = normalized['State'] || normalized['state'] || '';
      const fromTown = normalized['From Town Name'] || normalized['From Town'] || normalized['From town Name'] || '';
      const toTown = normalized['To Town Name'] || normalized['To Town'] || normalized['To town Name'] || '';
      const kms = normalized['Kms Travelled'] || normalized['Kms travelled'] || normalized['KMS Travelled'] || '';
      const asmName = normalized['ASM Name'] || normalized['ASM name'] || '';
      const hotelStay = normalized['Hotel Stay (yes/No)'] || normalized['Hotel Stay'] || '';
      const plannedRSName = normalized['Planned RS Name'] || normalized['Planned RS name'] || '';
      const channel = normalized['Channel'] || '';

      // Skip empty/header rows
      if (!dateRaw || !employeeName) return;
      
      const dateObj = parseExcelDate(dateRaw);
      if (!dateObj) return;

      // Strictly pad as dd-MM-yyyy format to prevent timezone and parsing discrepancies
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${pad(dateObj.getDate())}-${pad(dateObj.getMonth() + 1)}-${dateObj.getFullYear()}`;

      // Normalize N/A values
      const cleanValue = (val) => {
        if (!val) return '';
        const s = String(val).trim();
        if (s.toLowerCase() === 'n/a' || s === '-' || s === '') return '';
        return s;
      };

      // Parse kms - handle N/A and non-numeric
      let parsedKms = 0;
      const kmsStr = cleanValue(String(kms));
      if (kmsStr && !isNaN(parseFloat(kmsStr))) {
        parsedKms = parseFloat(kmsStr);
      }

      const record = {
        date: dateStr, // "dd-MM-yyyy"
        employeeCode: String(employeeCode),
        employeeName: String(employeeName),
        workType: cleanValue(workType),
        state: cleanValue(state),
        fromTown: cleanValue(fromTown),
        toTown: cleanValue(toTown),
        kms: parsedKms,
        asmName: cleanValue(asmName),
        hotelStay: cleanValue(hotelStay),
        plannedRSName: cleanValue(plannedRSName),
        channel: cleanValue(channel),
        sheetName: sheetName,
        isWorkingDay: !!cleanValue(workType)
      };

      allRecords.push(record);
      sheetRecordCount++;
    });

    if (sheetRecordCount > 0) {
      // Get the first employee name from this sheet
      const firstRecord = jsonData.find(r => {
        const name = r['Employee Name'] || r['Employee name'] || r['Name'] || '';
        return name && String(name).trim().toLowerCase() !== 'employee name';
      });
      const empName = firstRecord 
        ? (firstRecord['Employee Name'] || firstRecord['Employee name'] || firstRecord['Name'] || sheetName)
        : sheetName;

      sheetSummary.push({
        sheetName,
        employeeName: String(empName).trim(),
        recordCount: sheetRecordCount
      });
    }
  });

  return {
    records: allRecords,
    sheetSummary,
    totalSheets: sheetSummary.length,
    totalRecords: allRecords.length
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
