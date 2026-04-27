import * as XLSX from 'xlsx';

/**
 * Maps GoSurvey Excel columns to structured auditor attendance data
 * Column Mapping:
 * A: ID -> externalId
 * B: Date Collected -> date
 * G: Location -> coordinates (Lat/Long)
 * H: Choose your name -> name
 * J: Are You on field Today? -> isPresent
 * K: Is today's audit as per planned? -> isPlanned
 * L: Absent reason -> absentReason
 * M: Delay/Reschedule reason (Placeholder) -> delayReason
 * N: Issue Category (Placeholder) -> issueCategory
 * O: Distributor Additions (Placeholder) -> distAdditions
 * P: Distributor Cancellations (Placeholder) -> distCancellations
 * Q: Beat Name (Placeholder) -> beatName
 * V: ASM name -> asmName
 * AG: Total Shops in beat -> totalShops
 */
export const parseAttendanceExcel = async (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON with column headers
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });
        
        // Skip header row if necessary, here we map manually from column letters
        const formattedData = jsonData.slice(1).map(row => ({
          id: row['A'],
          date: parseExcelDate(row['B']),
          location: row['G'],
          name: row['H'],
          isPresent: row['J'] === 'Yes',
          isPlanned: row['K'] === 'Yes',
          absentReason: row['L'] || null,
          delayReason: row['M'] || null, // PLACEHOLDER COLUMN
          issueCategory: row['N'] || null, // PLACEHOLDER COLUMN
          distAdditions: parseInt(row['O']) || 0, // PLACEHOLDER COLUMN
          distCancellations: parseInt(row['P']) || 0, // PLACEHOLDER COLUMN
          beatName: row['Q'] || 'Unknown Beat', // PLACEHOLDER COLUMN
          asmName: row['V'],
          totalShops: parseInt(row['AG']) || 0
        })).filter(item => item.name); // Filter out empty rows

        resolve(formattedData);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

const parseExcelDate = (excelDate) => {
  if (!excelDate) return null;
  // If it's a number (Excel serial date)
  if (typeof excelDate === 'number') {
    const date = new Date((excelDate - 25569) * 86400 * 1000);
    return date;
  }
  // If it's already a string/date
  return new Date(excelDate);
};
