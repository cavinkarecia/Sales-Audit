import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EXPENSE_SHEET_URL,
  fetchAllExpenseVouchers,
} from '../utils/expenseVoucherParser.js';
import { fetchAllSheets } from '../utils/sheetFetcher.js';
import {
  mergeSheetSummaries,
  mergeDateAuditSummaries,
} from '../utils/expenseMerge.js';
import { normalizeAttendanceRecords } from '../utils/attendanceProcessor.js';
import {
  AUDIT_STORAGE_KEYS,
  ensureStorageSchema,
  purgeLegacyAuditKeys,
  purgeAllAuditData,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clearServerCaches = async () => {
  try {
    await fetch('/api/cache/clear', { method: 'POST' });
  } catch {
    /* ignore — still continue refresh */
  }
};

const wakeServer = async () => {
  try {
    await fetch('/api/health');
  } catch {
    /* ignore */
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
   * Global Hard Refresh — clear all caches, re-fetch PJP + Expense data only
   * (no OCR during refresh — OCR runs when you open Expense and fetch).
   */
  const hardRefresh = useCallback(async () => {
    setHardRefreshStatus({ running: true, step: 'Clearing caches…', error: '' });
    let error = '';

    clearSectionCache('pjp');
    clearSectionCache('expense');
    await clearServerCaches();
    await wakeServer();
    await sleep(400);

    if (pjpSpreadsheetUrl && pjpSpreadsheetUrl.trim()) {
      setHardRefreshStatus({ running: true, step: 'Refreshing PJP from live link…', error: '' });
      try {
        const r = await fetchAllSheets(pjpSpreadsheetUrl.trim());
        setPjpRecords(r.records || []);
        setPjpSheetSummary(r.sheetSummary || []);
      } catch (e) {
        error += `PJP: ${e?.message || e}. `;
      }
    }

    if (expenseSpreadsheetUrl && expenseSpreadsheetUrl.trim()) {
      const mode = localStorage.getItem('sales_audit_expense_upload_mode') || 'single';
      const part2Url = (localStorage.getItem('sales_audit_expense_v5_url_part2') || '').trim();

      const fetchExpensePart = async (url, label) => {
        setHardRefreshStatus({
          running: true,
          step: `Refreshing Expense ${label} (data sync, no OCR)…`,
          error: '',
        });
        // Hard refresh: data only — skip matrices + OCR to avoid 502 timeouts
        const r = await fetchAllExpenseVouchers(url, {
          includeMatrices: false,
          retries: 3,
        });
        const vouchers = (r.vouchers || []).map((v) => ({
          ...v,
          imageUrls: [],
          imageAnalysis: {
            bills: [],
            tickets: [],
            totalFromTickets: 0,
            imageCount: 0,
            note: 'Hard Refresh synced voucher data. Open Expense and Fetch to run bill OCR.',
            provider: '',
            cacheHits: 0,
          },
          fraudFlags: [],
        }));
        return { r, vouchers };
      };

      try {
        if (mode === 'sections' && part2Url) {
          const p1 = await fetchExpensePart(expenseSpreadsheetUrl.trim(), 'Part 1 (days 1–15)');
          const p2 = await fetchExpensePart(part2Url, 'Part 2 (days 16–end)');
          setExpenseSheetSummary(
            mergeSheetSummaries(p1.r.sheetSummary || [], p2.r.sheetSummary || []),
          );
          const mergedAudit = mergeDateAuditSummaries(p1.r.dateAudit, p2.r.dateAudit);
          // Prefer part2 then part1 by employee for merge-lite without OCR
          const byKey = new Map();
          [...p1.vouchers, ...p2.vouchers].forEach((v) => {
            const key = `${String(v.employeeNo || '').trim()}|${String(v.auditorName || '')
              .trim()
              .toLowerCase()}`;
            const prev = byKey.get(key);
            if (!prev) {
              byKey.set(key, v);
              return;
            }
            byKey.set(key, {
              ...prev,
              ...v,
              dateBlocks: [...(prev.dateBlocks || []), ...(v.dateBlocks || [])],
              declaredTotal: Math.max(prev.declaredTotal || 0, v.declaredTotal || 0),
            });
          });
          setExpenseVouchers([...byKey.values()]);
          if (mergedAudit) {
            try {
              localStorage.setItem(
                AUDIT_STORAGE_KEYS.expenseDateAudit,
                JSON.stringify(mergedAudit),
              );
            } catch {
              /* ignore */
            }
          }
        } else {
          const p1 = await fetchExpensePart(expenseSpreadsheetUrl.trim(), 'from live link');
          setExpenseSheetSummary(p1.r.sheetSummary || []);
          setExpenseVouchers(p1.vouchers);
          if (p1.r.dateAudit) {
            try {
              localStorage.setItem(
                AUDIT_STORAGE_KEYS.expenseDateAudit,
                JSON.stringify(p1.r.dateAudit),
              );
            } catch {
              /* ignore */
            }
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

  /** Wipe every upload, link, and cached result — fresh empty state. */
  const removeAllFiles = useCallback(async () => {
    purgeAllAuditData();
    await clearServerCaches();
    setAttendanceRecords([]);
    setPjpRecords([]);
    setPjpSheetSummary([]);
    setPjpSpreadsheetUrl('');
    setExpenseVouchers([]);
    setExpenseSheetSummary([]);
    setExpenseSpreadsheetUrl('');
    setRefreshKey((k) => k + 1);
  }, [setAttendanceRecords]);

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
      removeAllFiles,
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
      removeAllFiles,
    ],
  );

  return <AuditDataContext.Provider value={value}>{children}</AuditDataContext.Provider>;
};

export const useAuditData = () => {
  const ctx = useContext(AuditDataContext);
  if (!ctx) throw new Error('useAuditData must be used within AuditDataProvider');
  return ctx;
};
