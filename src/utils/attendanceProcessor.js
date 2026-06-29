import { format } from 'date-fns';
import { namesMatch } from './nameMatcher.js';

const norm = (s) => String(s || '').trim().toLowerCase();

const MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Parse survey dates as local calendar days (avoids UTC month/day shifts). */
export const parseLocalDate = (input) => {
  if (input == null || input === '') return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }

  const s = String(input).trim();
  if (!s) return null;

  const dmyText = s.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})/i);
  if (dmyText) {
    const monthIdx = MONTH_INDEX[dmyText[2].toLowerCase()];
    if (monthIdx != null) {
      return new Date(Number(dmyText[3]), monthIdx, Number(dmyText[1]));
    }
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const num = Number(input);
  if (!Number.isNaN(num) && s !== '') {
    const utc = new Date((num - 25569) * 86400 * 1000);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

export const toDayKey = (date) => {
  const d = parseLocalDate(date);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const weekdayFromDayKey = (dayKey) => {
  if (!dayKey) return null;
  const [y, m, d] = dayKey.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'EEE');
};

export const formatDayLabel = (dayKey) => {
  if (!dayKey) return '';
  const [y, m, d] = dayKey.split('-').map(Number);
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const weekday = format(new Date(y, m - 1, d), 'EEE');
  return `${dd}-${mm}-${y} | ${weekday}`;
};

export const WEEKDAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const entrySortKey = (record, rowIndex) => {
  if (record.submittedAt) {
    const t = new Date(record.submittedAt).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (record.id != null && !Number.isNaN(Number(record.id))) {
    return Number(record.id);
  }
  return rowIndex;
};

export const isFieldPresent = (val) => {
  const s = String(val ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === '1';
};

/**
 * GoSurvey may submit multiple rows per auditor per day.
 * Keep only the latest submission for each (auditor, date).
 */
export const consolidateLatestAttendance = (records) => {
  const byKey = new Map();

  records.forEach((record, rowIndex) => {
    const name = String(record.name || '').trim();
    const dateKey = toDayKey(record.chooseDate ?? record.date);
    if (!name || !dateKey) return;

    const key = `${norm(name)}|${dateKey}`;
    const sortKey = entrySortKey(record, rowIndex);
    const existing = byKey.get(key);

    if (!existing || sortKey >= existing._sortKey) {
      const chooseDate = parseLocalDate(record.chooseDate ?? record.date);
      byKey.set(key, {
        ...record,
        name,
        chooseDate,
        date: chooseDate,
        isPresent: isFieldPresent(record.isPresentRaw ?? record.isPresent),
        _sortKey: sortKey,
        _rowIndex: rowIndex,
      });
    }
  });

  return Array.from(byKey.values()).map(({ _sortKey, _rowIndex, isPresentRaw, ...rest }) => rest);
};

export const parseLocationCoords = (locationStr) => {
  if (!locationStr) return null;
  const parts = String(locationStr)
    .split(/[,\s]+/)
    .map((p) => parseFloat(p))
    .filter((p) => !Number.isNaN(p));
  if (parts.length < 2) return null;
  return { lat: parts[0], lng: parts[1] };
};

export const getAttendanceForAuditorDate = (attendanceRecords, auditorName, dateKey) => {
  return attendanceRecords.find(
    (r) => namesMatch(r.name, auditorName) && toDayKey(r.chooseDate ?? r.date) === dateKey,
  );
};
