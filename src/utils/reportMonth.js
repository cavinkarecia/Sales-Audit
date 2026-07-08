import { parseLocalDate } from './attendanceProcessor.js';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Pick the {year, month} bucket with the most rows (month is 0-indexed). */
const topMonthBucket = (counts) => {
  let best = null;
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestCount = count;
      const [year, month] = key.split('-').map(Number);
      best = { year, month };
    }
  }
  return best;
};

/** Reporting month from the current attendance upload (most common Choose Date). */
export const getAttendanceReportMonth = (records) => {
  const counts = {};
  for (const r of records || []) {
    const d = r?.chooseDate instanceof Date ? r.chooseDate : parseLocalDate(r?.chooseDate ?? r?.date);
    if (!d || Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return topMonthBucket(counts);
};

/** Reporting month from the current expense upload (most common dated-row month). */
export const getExpenseReportMonth = (vouchers) => {
  const counts = {};
  for (const v of vouchers || []) {
    for (const b of v?.dateBlocks || []) {
      const key = b?.dateKey; // e.g. "2026-04-01"
      if (!key) continue;
      const [y, m] = key.split('-').map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
      const bucket = `${y}-${m - 1}`;
      counts[bucket] = (counts[bucket] || 0) + 1;
    }
  }
  return topMonthBucket(counts);
};

export const formatReportMonth = (m) =>
  m && Number.isFinite(m.month) && Number.isFinite(m.year) ? `${MONTH_NAMES[m.month]} ${m.year}` : '';

export const reportMonthsMatch = (a, b) =>
  Boolean(a && b && a.year === b.year && a.month === b.month);
