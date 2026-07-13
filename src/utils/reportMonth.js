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

/** dd-MM-yyyy from canonical dateKey (yyyy-MM-dd). */
export const formatDayKeyLabel = (dateKey) => {
  if (!dateKey) return '';
  const [y, m, d] = String(dateKey).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
};

/** Min/max dated rows for the dominant reporting month (ignores stray wrong-year dates). */
export const getExpenseDateRange = (vouchers) => {
  const allKeys = [];
  for (const v of vouchers || []) {
    for (const b of v?.dateBlocks || []) {
      const k = b?.dateKey;
      if (k && /^\d{4}-\d{2}-\d{2}$/.test(k)) allKeys.push(k);
    }
  }
  if (!allKeys.length) return null;

  const reportMonth = getExpenseReportMonth(vouchers);
  let keys = allKeys;

  if (reportMonth && Number.isFinite(reportMonth.year) && Number.isFinite(reportMonth.month)) {
    const { year, month } = reportMonth;
    const inMainMonth = allKeys.filter((k) => {
      const [y, m] = k.split('-').map(Number);
      return y === year && m - 1 === month;
    });
    if (inMainMonth.length > 0) keys = inMainMonth;
  }

  keys.sort();
  const fromKey = keys[0];
  const toKey = keys[keys.length - 1];
  const [fy, fm] = fromKey.split('-').map(Number);

  const monthPart = reportMonth
    ? formatReportMonth(reportMonth)
    : `${MONTH_NAMES[fm - 1]} ${fy}`;

  const from = formatDayKeyLabel(fromKey);
  const to = formatDayKeyLabel(toKey);

  return {
    monthLabel: monthPart,
    from,
    to,
    line: `${monthPart} from ${from} to ${to}`,
    reportingMonth: reportMonth,
    datesInMonth: keys.length,
    totalDates: allKeys.length,
  };
};
