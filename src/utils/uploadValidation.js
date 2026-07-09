import { extractSpreadsheetId } from './spreadsheetUrl.js';

/** Show a blocking popup for upload / format errors. */
export const showUploadError = (title, message) => {
  const body = [title, message].filter(Boolean).join('\n\n');
  window.alert(body || 'Upload failed. Please check the file or link and try again.');
};

export const validateAttendanceFile = (file) => {
  if (!file) {
    return { ok: false, message: 'No file was selected. Choose a GoSurvey attendance Excel file (.xlsx or .xls).' };
  }
  const name = String(file.name || '').toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return {
      ok: false,
      message:
        'Wrong file type. Attendance upload accepts only Excel files (.xlsx or .xls).\n' +
        'Please upload the GoSurvey attendance export — not PJP, expense, or other spreadsheets.',
    };
  }
  return { ok: true };
};

export const validateAttendanceData = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ok: false,
      message:
        'Could not read any attendance rows from this file.\n' +
        'The format looks different from a GoSurvey attendance export. Expected columns such as "Choose Date" and "Choose Your Name".',
    };
  }
  const withDates = rows.filter((r) => r.chooseDate || r.date);
  if (withDates.length === 0) {
    return {
      ok: false,
      message:
        'No valid dates were found in this attendance file.\n' +
        'Check that the "Choose Date" column is present and filled in the GoSurvey export format.',
    };
  }
  return { ok: true };
};

export const validateGoogleSheetLink = (url, sectionLabel = 'this section') => {
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      message: `Paste a Google Spreadsheet link for ${sectionLabel} before fetching.`,
    };
  }
  if (!extractSpreadsheetId(trimmed)) {
    return {
      ok: false,
      message:
        `Invalid Google Sheets link for ${sectionLabel}.\n` +
        'Use the full URL from Share → Anyone with the link → Viewer, e.g.\n' +
        'https://docs.google.com/spreadsheets/d/…/edit?gid=0',
    };
  }
  return { ok: true };
};

const PJP_FORMAT_STATUSES = new Set([
  'headers-not-recognised',
  'all-dates-unparseable',
  'all-rows-missing-name',
  'empty',
  'no-valid-rows',
]);

export const validatePjpFetchResult = (result) => {
  const records = result?.records || [];
  const summary = result?.sheetSummary || [];

  if (records.length > 0) return { ok: true };

  if (summary.length > 0 && summary.every((s) => PJP_FORMAT_STATUSES.has(s.status))) {
    const sample = summary[0];
    return {
      ok: false,
      message:
        'This spreadsheet does not match the PJP format.\n' +
        'Each auditor tab needs Date and Employee Name columns (plus travel fields).\n' +
        (sample?.reason ? `\nExample: ${sample.reason}` : ''),
    };
  }

  if (summary.length > 0) {
    return {
      ok: false,
      message:
        'Fetched the link but no PJP travel records could be parsed.\n' +
        'Check that you pasted the PJP workbook — not attendance or expense — and that each tab follows the PJP column layout.',
    };
  }

  return {
    ok: false,
    message:
      'Could not load any sheets from this PJP link.\n' +
      'Check the URL, that the workbook exists, and that it is shared as Viewer (Anyone with the link).',
  };
};

export const validateExpenseFetchResult = (result) => {
  const vouchers = result?.vouchers || [];
  if (vouchers.length > 0) return { ok: true };

  const syncErr = result?.syncError;
  if (syncErr) {
    const title = typeof syncErr === 'object' ? syncErr.title : '';
    const msg = typeof syncErr === 'object' ? syncErr.message : String(syncErr);
    return {
      ok: false,
      message: [title, msg].filter(Boolean).join('\n') ||
        'Expense workbook format not recognised.',
    };
  }

  const summary = result?.sheetSummary || [];
  const loaded = summary.filter((s) => s.status === 'loaded').length;
  const skipped = summary.filter((s) => s.status === 'skipped' || s.status === 'failed');

  if (loaded === 0 && skipped.length > 0) {
    const hint = skipped[0]?.reason;
    return {
      ok: false,
      message:
        'Tabs were downloaded but none matched the Expenses Claim Voucher format.\n' +
        'Use the standard expense claim workbook with dated rows (Travel, Local, Fuel, Stay).\n' +
        (hint ? `\nExample: ${hint}` : ''),
    };
  }

  return {
    ok: false,
    message:
      'Could not load any auditor expense tabs from this link.\n' +
      'Check the URL, sharing permissions, and that this is the expense claim workbook — not PJP or attendance.',
  };
};

/** Returns true when an error popup was shown. */
export const alertIfInvalid = (validation, title = 'Upload error') => {
  if (validation?.ok) return false;
  showUploadError(title, validation.message);
  return true;
};

export const alertUploadException = (err, sectionLabel) => {
  const msg =
    err?.message ||
    `Something went wrong while uploading ${sectionLabel}. Please check the file or link and try again.`;
  showUploadError('Upload error', msg);
};
