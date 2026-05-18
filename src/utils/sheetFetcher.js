import * as XLSX from 'xlsx';

/**
 * Extracts the spreadsheet ID from a Google Sheets URL
 */
const extractSpreadsheetId = (url) => {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
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
  const workbook = XLSX.read(data, { type: 'array' });

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
      const date = normalized['Date'] || normalized['Date '] || normalized['date'] || '';
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
      if (!date || !employeeName) return;
      
      // Skip if date doesn't look like a date
      const dateStr = String(date);
      if (dateStr.toLowerCase() === 'date' || dateStr.toLowerCase() === 'date ') return;

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
        date: dateStr,
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
    const dateStr = record.date;
    // Parse dates like "01-Apr-2026"
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return;
    
    const monthKey = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = parsed.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    
    if (!grouped[monthKey]) {
      grouped[monthKey] = { key: monthKey, label: monthLabel, records: [] };
    }
    grouped[monthKey].records.push(record);
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

  return {
    totalDays: uniqueDates.size,
    workingDays: workingDays.length,
    leaveDays: leaves.length,
    totalKms: Math.round(totalKms * 10) / 10,
    townsVisited: townsVisited.size,
    townsList: Array.from(townsVisited),
    statesVisited: statesVisited.size,
    statesList: Array.from(statesVisited),
    baseLocation: baseLocation || 'Unknown'
  };
};
