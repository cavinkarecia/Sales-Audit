import { ATTENDANCE_META_KEY } from './attendanceProcessor.js';

/** Bump when stored browser data must be reset (fresh start, no old uploads). */
export const STORAGE_SCHEMA_VERSION = '36';

export const STORAGE_VERSION_KEY = 'sales_audit_storage_version';

export const AUDIT_STORAGE_KEYS = {
  attendance: 'sales_audit_report_data',
  attendanceMeta: ATTENDANCE_META_KEY,
  pjp: 'sales_audit_pjp_v2',
  pjpSummary: 'sales_audit_pjp_summary_v2',
  pjpUrl: 'sales_audit_pjp_url',
  expenseVouchers: 'sales_audit_expense_v5_vouchers',
  expenseSummary: 'sales_audit_expense_v5_summary',
  expenseUrl: 'sales_audit_expense_v5_url',
  expenseSyncBuild: 'sales_audit_expense_v5_build',
  expenseDateAudit: 'sales_audit_expense_v5_date_audit',
};

const LEGACY_KEYS = [
  'sales_audit_allowance_v3',
  'sales_audit_allowance_summary_v3',
  'sales_audit_allowance_url_v3',
  'sales_audit_allowance_v2',
  'sales_audit_allowance_summary_v2',
  'sales_audit_allowance_url',
  'sales_audit_expense_v2_vouchers',
  'sales_audit_expense_v2_summary',
  'sales_audit_expense_v2_url',
  'sales_audit_expense_v4_vouchers',
  'sales_audit_expense_v4_summary',
  'sales_audit_expense_v4_url',
  'sales_audit_expense_v4_build',
  'sales_audit_report_data_v1',
  'sales_audit_expense_upload_mode',
  'sales_audit_expense_v5_url_part2',
];

/** Remove every saved upload / filter cache from this browser. */
export const purgeAllAuditData = () => {
  Object.values(AUDIT_STORAGE_KEYS).forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  });
  LEGACY_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  });
  try {
    localStorage.removeItem(STORAGE_VERSION_KEY);
  } catch {
    /* ignore */
  }
};

export const purgeLegacyAuditKeys = () => {
  LEGACY_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  });
};

/** Clear only one section's cached data + stored state (independent per module). */
export const clearSectionCache = (section) => {
  const keysBySection = {
    attendance: [AUDIT_STORAGE_KEYS.attendance, AUDIT_STORAGE_KEYS.attendanceMeta],
    pjp: [AUDIT_STORAGE_KEYS.pjp, AUDIT_STORAGE_KEYS.pjpSummary],
    expense: [
      AUDIT_STORAGE_KEYS.expenseVouchers,
      AUDIT_STORAGE_KEYS.expenseSummary,
      AUDIT_STORAGE_KEYS.expenseDateAudit,
    ],
  };
  (keysBySection[section] || []).forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  });
};

/**
 * On a new schema version, wipe all cached uploads so the app starts empty.
 * Always strips legacy keys left from older builds.
 */
export const ensureStorageSchema = () => {
  purgeLegacyAuditKeys();
  try {
    const stored = localStorage.getItem(STORAGE_VERSION_KEY);
    if (stored !== STORAGE_SCHEMA_VERSION) {
      purgeAllAuditData();
      localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_SCHEMA_VERSION);
    }
  } catch {
    /* ignore */
  }
};
