import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEYS = {
  attendance: 'sales_audit_report_data',
  pjp: 'sales_audit_pjp_v2',
  pjpSummary: 'sales_audit_pjp_summary_v2',
  allowance: 'sales_audit_allowance_v2',
  allowanceSummary: 'sales_audit_allowance_summary_v2',
  pjpUrl: 'sales_audit_pjp_url',
  allowanceUrl: 'sales_audit_allowance_url',
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
  const [allowanceClaims, setAllowanceClaims] = useState(() =>
    loadJson(STORAGE_KEYS.allowance, []),
  );
  const [allowanceSheetSummary, setAllowanceSheetSummary] = useState(() =>
    loadJson(STORAGE_KEYS.allowanceSummary, []),
  );
  const [pjpSpreadsheetUrl, setPjpSpreadsheetUrl] = useState(
    () => localStorage.getItem(STORAGE_KEYS.pjpUrl) || '',
  );
  const DEFAULT_ALLOWANCE_URL =
    'https://docs.google.com/spreadsheets/d/1txSfkx3ITPJe_K0g8vJrZDVy1RbL2aD0SG1XYWe70MY/edit?gid=0#gid=0';

  const [allowanceSpreadsheetUrl, setAllowanceSpreadsheetUrl] = useState(
    () => localStorage.getItem(STORAGE_KEYS.allowanceUrl) || DEFAULT_ALLOWANCE_URL,
  );

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
    localStorage.setItem(STORAGE_KEYS.allowance, JSON.stringify(allowanceClaims));
  }, [allowanceClaims]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.allowanceSummary, JSON.stringify(allowanceSheetSummary));
  }, [allowanceSheetSummary]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.pjpUrl, pjpSpreadsheetUrl);
  }, [pjpSpreadsheetUrl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.allowanceUrl, allowanceSpreadsheetUrl);
  }, [allowanceSpreadsheetUrl]);

  const value = useMemo(
    () => ({
      attendanceRecords,
      setAttendanceRecords,
      pjpRecords,
      setPjpRecords,
      pjpSheetSummary,
      setPjpSheetSummary,
      allowanceClaims,
      setAllowanceClaims,
      allowanceSheetSummary,
      setAllowanceSheetSummary,
      pjpSpreadsheetUrl,
      setPjpSpreadsheetUrl,
      allowanceSpreadsheetUrl,
      setAllowanceSpreadsheetUrl,
      hasAttendance: attendanceRecords.length > 0,
      hasPjp: pjpRecords.length > 0,
      hasAllowance: allowanceClaims.length > 0,
    }),
    [
      attendanceRecords,
      pjpRecords,
      pjpSheetSummary,
      allowanceClaims,
      allowanceSheetSummary,
      pjpSpreadsheetUrl,
      allowanceSpreadsheetUrl,
    ],
  );

  return <AuditDataContext.Provider value={value}>{children}</AuditDataContext.Provider>;
};

export const useAuditData = () => {
  const ctx = useContext(AuditDataContext);
  if (!ctx) throw new Error('useAuditData must be used within AuditDataProvider');
  return ctx;
};
