import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_EXPENSE_SHEET_URL } from '../utils/expenseVoucherParser.js';

const STORAGE_KEYS = {
  attendance: 'sales_audit_report_data',
  pjp: 'sales_audit_pjp_v2',
  pjpSummary: 'sales_audit_pjp_summary_v2',
  pjpUrl: 'sales_audit_pjp_url',
  expenseVouchers: 'sales_audit_expense_v5_vouchers',
  expenseSummary: 'sales_audit_expense_v5_summary',
  expenseUrl: 'sales_audit_expense_v5_url',
  expenseSyncBuild: 'sales_audit_expense_v5_build',
  expenseDateAudit: 'sales_audit_expense_v5_date_audit',
  allowanceLegacy: [
    'sales_audit_allowance_v3',
    'sales_audit_allowance_summary_v3',
    'sales_audit_allowance_url_v3',
    'sales_audit_allowance_v2',
    'sales_audit_allowance_summary_v2',
    'sales_audit_allowance_url',
  ],
};

const loadJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const AuditDataContext = createContext(null);

export const AuditDataProvider = ({ children }) => {
  const [attendanceRecords, setAttendanceRecords] = useState(() =>
    loadJson(STORAGE_KEYS.attendance, []),
  );
  const [pjpRecords, setPjpRecords] = useState(() => loadJson(STORAGE_KEYS.pjp, []));
  const [pjpSheetSummary, setPjpSheetSummary] = useState(() =>
    loadJson(STORAGE_KEYS.pjpSummary, []),
  );
  const [pjpSpreadsheetUrl, setPjpSpreadsheetUrl] = useState(
    () => localStorage.getItem(STORAGE_KEYS.pjpUrl) || '',
  );
  const [expenseVouchers, setExpenseVouchers] = useState(() =>
    loadJson(STORAGE_KEYS.expenseVouchers, []),
  );
  const [expenseSheetSummary, setExpenseSheetSummary] = useState(() =>
    loadJson(STORAGE_KEYS.expenseSummary, []),
  );
  const [expenseSpreadsheetUrl, setExpenseSpreadsheetUrl] = useState(
    () => localStorage.getItem(STORAGE_KEYS.expenseUrl) || DEFAULT_EXPENSE_SHEET_URL,
  );

  useEffect(() => {
    STORAGE_KEYS.allowanceLegacy.forEach((key) => localStorage.removeItem(key));
    [
      'sales_audit_expense_v2_vouchers',
      'sales_audit_expense_v2_summary',
      'sales_audit_expense_v2_url',
      'sales_audit_expense_v4_vouchers',
      'sales_audit_expense_v4_summary',
      'sales_audit_expense_v4_url',
      'sales_audit_expense_v4_build',
    ].forEach((key) => localStorage.removeItem(key));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.attendance, JSON.stringify(attendanceRecords));
  }, [attendanceRecords]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.pjp, JSON.stringify(pjpRecords));
  }, [pjpRecords]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.pjpSummary, JSON.stringify(pjpSheetSummary));
  }, [pjpSheetSummary]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.pjpUrl, pjpSpreadsheetUrl);
  }, [pjpSpreadsheetUrl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.expenseVouchers, JSON.stringify(expenseVouchers));
  }, [expenseVouchers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.expenseSummary, JSON.stringify(expenseSheetSummary));
  }, [expenseSheetSummary]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.expenseUrl, expenseSpreadsheetUrl);
  }, [expenseSpreadsheetUrl]);

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
    }),
    [
      attendanceRecords,
      pjpRecords,
      pjpSheetSummary,
      pjpSpreadsheetUrl,
      expenseVouchers,
      expenseSheetSummary,
      expenseSpreadsheetUrl,
    ],
  );

  return <AuditDataContext.Provider value={value}>{children}</AuditDataContext.Provider>;
};

export const useAuditData = () => {
  const ctx = useContext(AuditDataContext);
  if (!ctx) throw new Error('useAuditData must be used within AuditDataProvider');
  return ctx;
};
