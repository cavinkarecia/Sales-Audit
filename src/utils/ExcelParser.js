import * as XLSX from 'xlsx';
import { consolidateLatestAttendance, isFieldPresent } from './attendanceProcessor.js';

const LETTER_MAP = {
  id: 'A',
  date: 'B',
  location: 'G',
  name: 'H',
  isPresent: 'J',
  isPlanned: 'K',
  absentReason: 'L',
  delayReason: 'M',
  issueCategory: 'N',
  distAdditions: 'O',
  distCancellations: 'P',
  beatName: 'Q',
  asmName: 'V',
  totalShops: 'AG',
};

const canonHeader = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const HEADER_CANDIDATES = {
  date: ['datecollected', 'date', 'submissiondate', 'timestamp'],
  name: ['chooseyourname', 'auditorname', 'employeename', 'name'],
  location: ['location', 'latlong', 'gps', 'coordinates'],
  isPresent: ['areyouonfieldtoday', 'onfield', 'fieldtoday', 'present'],
  isPlanned: ['istodaysauditasperplanned', 'planned', 'asperplanned'],
  absentReason: ['absentreason', 'reason'],
  asmName: ['asmname', 'asm'],
  totalShops: ['totalshopsinbeat', 'totalshops', 'shopcount'],
  submittedAt: ['submittedat', 'submissiontime', 'timestamp', 'datetime'],
};

const pickByHeaders = (row, field) => {
  const keys = HEADER_CANDIDATES[field] || [];
  for (const [key, val] of Object.entries(row)) {
    if (keys.includes(canonHeader(key))) return val;
  }
  return undefined;
};

const parseExcelDate = (excelDate) => {
  if (!excelDate) return null;
  if (excelDate instanceof Date && !Number.isNaN(excelDate.getTime())) return excelDate;
  const num = Number(excelDate);
  if (!Number.isNaN(num) && String(excelDate).trim() !== '') {
    return new Date((num - 25569) * 86400 * 1000);
  }
  const parsed = new Date(excelDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const mapRowLetter = (row) => ({
  id: row[LETTER_MAP.id],
  date: parseExcelDate(row[LETTER_MAP.date]),
  location: row[LETTER_MAP.location],
  name: row[LETTER_MAP.name],
  isPresentRaw: row[LETTER_MAP.isPresent],
  isPlanned: row[LETTER_MAP.isPlanned] === 'Yes',
  absentReason: row[LETTER_MAP.absentReason] || null,
  delayReason: row[LETTER_MAP.delayReason] || null,
  issueCategory: row[LETTER_MAP.issueCategory] || null,
  distAdditions: parseInt(row[LETTER_MAP.distAdditions], 10) || 0,
  distCancellations: parseInt(row[LETTER_MAP.distCancellations], 10) || 0,
  beatName: row[LETTER_MAP.beatName] || 'Unknown Beat',
  asmName: row[LETTER_MAP.asmName],
  totalShops: parseInt(row[LETTER_MAP.totalShops], 10) || 0,
  submittedAt: null,
  rowIndex: row.__rowIndex,
});

const mapRowHeaders = (row) => ({
  id: row.id ?? row.ID,
  date: parseExcelDate(pickByHeaders(row, 'date')),
  location: pickByHeaders(row, 'location'),
  name: pickByHeaders(row, 'name'),
  isPresentRaw: pickByHeaders(row, 'isPresent'),
  isPlanned: String(pickByHeaders(row, 'isPlanned') || '').toLowerCase() === 'yes',
  absentReason: pickByHeaders(row, 'absentReason') || null,
  delayReason: row.delayReason || null,
  issueCategory: row.issueCategory || null,
  distAdditions: 0,
  distCancellations: 0,
  beatName: row.beatName || 'Unknown Beat',
  asmName: pickByHeaders(row, 'asmName'),
  totalShops: parseInt(pickByHeaders(row, 'totalShops'), 10) || 0,
  submittedAt: parseExcelDate(pickByHeaders(row, 'submittedAt')),
  rowIndex: row.__rowIndex,
});

export const parseAttendanceExcel = async (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonLetter = XLSX.utils.sheet_to_json(worksheet, { header: 'A', defval: '' });
        const jsonHeaders = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        const useHeaders =
          jsonHeaders.length > 0 &&
          Object.keys(jsonHeaders[0] || {}).some((k) =>
            canonHeader(k).includes('chooseyourname'),
          );

        const rawRows = useHeaders ? jsonHeaders : jsonLetter.slice(1);
        const mapped = rawRows
          .map((row, idx) => {
            const withIdx = { ...row, __rowIndex: idx };
            return useHeaders ? mapRowHeaders(withIdx) : mapRowLetter(withIdx);
          })
          .filter((item) => item.name && item.date)
          .map((item) => ({
            ...item,
            isPresent: isFieldPresent(item.isPresentRaw),
          }));

        resolve(consolidateLatestAttendance(mapped));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};
