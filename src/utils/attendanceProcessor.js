import { format, startOfDay } from 'date-fns';
import { namesMatch } from './nameMatcher.js';

const norm = (s) => String(s || '').trim().toLowerCase();

export const toDayKey = (date) => {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return format(startOfDay(d), 'yyyy-MM-dd');
};

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
    const dateKey = toDayKey(record.date);
    if (!name || !dateKey) return;

    const key = `${norm(name)}|${dateKey}`;
    const sortKey = entrySortKey(record, rowIndex);
    const existing = byKey.get(key);

    if (!existing || sortKey >= existing._sortKey) {
      byKey.set(key, {
        ...record,
        name,
        date: record.date instanceof Date ? record.date : new Date(record.date),
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
    (r) => namesMatch(r.name, auditorName) && toDayKey(r.date) === dateKey,
  );
};
