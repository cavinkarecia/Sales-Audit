import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EXPENSE_SHEET_URL,
  fetchAllExpenseVouchers,
} from '../utils/expenseVoucherParser.js';
import { fetchAllSheets } from '../utils/sheetFetcher.js';
import { enrichAllVouchersWithImages } from '../utils/expenseImageAnalysis.js';
import { normalizeAttendanceRecords } from '../utils/attendanceProcessor.js';
import {
  AUDIT_STORAGE_KEYS,
  ensureStorageSchema,
  purgeLegacyAuditKeys,
  clearSectionCache,
} from '../utils/auditStorage.js';

ensureStorageSchema();

const loadJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 50000) return fallback;
    return parsed;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return fallback;
  }
};

const AuditDataContext = createContext(null);

export const AuditDataProvider = ({ children }) => {
  const [attendanceRecords, setAttendanceRecordsRaw] = useState(() =>
    normalizeAttendanceRecords(loadJson(AUDIT_STORAGE_KEYS.attendance, [])),
  );

  const setAttendanceRecords = useCallback((data) => {
    setAttendanceRecordsRaw(normalizeAttendanceRecords(data));
  }, []);
  const [pjpRecords, setPjpRecords] = useState(() => loadJson(AUDIT_STORAGE_KEYS.pjp, []));
  const [pjpSheetSummary, setPjpSheetSummary] = useState(() =>
    loadJson(AUDIT_STORAGE_KEYS.pjpSummary, []),
  );
  const [pjpSpreadsheetUrl, setPjpSpreadsheetUrl] = useState(
    () => localStorage.getItem(AUDIT_STORAGE_KEYS.pjpUrl) || '',
  );
  const [expenseVouchers, setExpenseVouchers] = useState(() =>
    loadJson(AUDIT_STORAGE_KEYS.expenseVouchers, []),
  );
  const [expenseSheetSummary, setExpenseSheetSummary] = useState(() =>
    loadJson(AUDIT_STORAGE_KEYS.expenseSummary, []),
  );
  const [expenseSpreadsheetUrl, setExpenseSpreadsheetUrl] = useState(
    () => localStorage.getItem(AUDIT_STORAGE_KEYS.expenseUrl) || DEFAULT_EXPENSE_SHEET_URL,
  );

  // Bumping refreshKey remounts every page so it rebuilds from current context.
  const [refreshKey, setRefreshKey] = useState(0);
  const [hardRefreshStatus, setHardRefreshStatus] = useState({
    running: false,
    step: '',
    error: '',
  });

  useEffect(() => {
    purgeLegacyAuditKeys();
  }, []);

  useEffect(() => {
    localStorage.setItem(AUDIT_STORAGE_KEYS.attendance, JSON.stringify(attendanceRecords));
  }, [attendanceRecords]);

  useEffect(() => {
    localStorage.setItem(AUDIT_STORAGE_KEYS.pjp, JSON.stringify(pjpRecords));
  }, [pjpRecords]);

  useEffect(() => {
    localStorage.setItem(AUDIT_STORAGE_KEYS.pjpSummary, JSON.stringify(pjpSheetSummary));
  }, [pjpSheetSummary]);

  useEffect(() => {
    localStorage.setItem(AUDIT_STORAGE_KEYS.pjpUrl, pjpSpreadsheetUrl);
  }, [pjpSpreadsheetUrl]);

  useEffect(() => {
    localStorage.setItem(AUDIT_STORAGE_KEYS.expenseVouchers, JSON.stringify(expenseVouchers));
  }, [expenseVouchers]);

  useEffect(() => {
    localStorage.setItem(AUDIT_STORAGE_KEYS.expenseSummary, JSON.stringify(expenseSheetSummary));
  }, [expenseSheetSummary]);

  useEffect(() => {
    localStorage.setItem(AUDIT_STORAGE_KEYS.expenseUrl, expenseSpreadsheetUrl);
  }, [expenseSpreadsheetUrl]);

  /**
   * Global Hard Refresh — re-fetch every live-link section (PJP + Expense) from
   * its saved link right now, rebuild all shared data, then remount every page.
   * Attendance is kept as-is (a local Excel file cannot be silently re-read).
   */
  const hardRefresh = useCallback(async () => {
    setHardRefreshStatus({ running: true, step: 'Starting hard refresh…', error: '' });
    let error = '';

    if (pjpSpreadsheetUrl && pjpSpreadsheetUrl.trim()) {
      setHardRefreshStatus({ running: true, step: 'Refreshing PJP from live link…', error: '' });
      try {
        clearSectionCache('pjp');
        const r = await fetchAllSheets(pjpSpreadsheetUrl.trim());
        setPjpRecords(r.records || []);
        setPjpSheetSummary(r.sheetSummary || []);
      } catch (e) {
        error += `PJP: ${e?.message || e}. `;
      }
    }

    if (expenseSpreadsheetUrl && expenseSpreadsheetUrl.trim()) {
      setHardRefreshStatus({
        running: true,
        step: 'Refreshing Expense from live link…',
        error: '',
      });
      try {
        clearSectionCache('expense');
        const r = await fetchAllExpenseVouchers(expenseSpreadsheetUrl.trim());
        setExpenseSheetSummary(r.sheetSummary || []);
        const enriched = await enrichAllVouchersWithImages(
          r.vouchers,
          r.tabs,
          r.spreadsheetId,
          r.matricesBySheet,
          (n, total) => {
            setHardRefreshStatus({
              running: true,
              step: `Analyzing bill images (${n}/${total})…`,
              error: '',
            });
          },
        );
        setExpenseVouchers(enriched);
        if (r.dateAudit) {
          try {
            localStorage.setItem(
              AUDIT_STORAGE_KEYS.expenseDateAudit,
              JSON.stringify(r.dateAudit),
            );
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        error += `Expense: ${e?.message || e}. `;
      }
    }

    setRefreshKey((k) => k + 1);
    setHardRefreshStatus({ running: false, step: '', error });
    if (error) {
      try {
        window.alert(`Hard Refresh completed with issues:\n${error}`);
      } catch {
        /* ignore */
      }
    }
  }, [pjpSpreadsheetUrl, expenseSpreadsheetUrl]);

  const value = useMemo(
    () => ({
      attendanceRecords,
      setAttendanceRecords,
      pjpRecords,
      setPjpRecords,
      pjpSheetSummary,
      setPjpSheetSummary,
      pjpSpreadsheetUrl,
      setPjpSpreadsheetUrl,
      expenseVouchers,
      setExpenseVouchers,
      expenseSheetSummary,
      setExpenseSheetSummary,
      expenseSpreadsheetUrl,
      setExpenseSpreadsheetUrl,
      hasAttendance: attendanceRecords.length > 0,
      hasPjp: pjpRecords.length > 0,
      hasExpense: expenseVouchers.length > 0,
      refreshKey,
      hardRefresh,
      hardRefreshStatus,
    }),
    [
      attendanceRecords,
      pjpRecords,
      pjpSheetSummary,
      pjpSpreadsheetUrl,
      expenseVouchers,
      expenseSheetSummary,
      expenseSpreadsheetUrl,
      refreshKey,
      hardRefresh,
      hardRefreshStatus,
    ],
  );

  return <AuditDataContext.Provider value={value}>{children}</AuditDataContext.Provider>;
};

export const useAuditData = () => {
  const ctx = useContext(AuditDataContext);
  if (!ctx) throw new Error('useAuditData must be used within AuditDataProvider');
  return ctx;
};
