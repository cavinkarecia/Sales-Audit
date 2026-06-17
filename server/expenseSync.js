import XLSX from 'xlsx';
import { parseVoucherSheet } from '../src/utils/expenseVoucherParser.js';
import { extractSpreadsheetId } from '../src/utils/spreadsheetUrl.js';
import { auditAllVouchers } from '../src/utils/expenseDateAudit.js';

const matrixFromCsv = (csv) => {
  const parsed = XLSX.read(csv, { type: 'string' });
  const first = parsed.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json(parsed.Sheets[first], {
    header: 1,
    raw: false,
    defval: '',
  });
};

const sanitizeSheetName = (name, index) => {
  const cleaned = String(name || `Sheet${index + 1}`)
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim();
  return (cleaned || `Sheet${index + 1}`).slice(0, 31);
};

const fetchTabCsv = async (spreadsheetId, gid) => {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}&single=true&output=csv`;
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) return null;
  const csv = await resp.text();
  return csv?.trim() ? csv : null;
};

const runPool = async (items, worker, concurrency = 6) => {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
};

/**
 * Server-side sync: list all tabs → download each tab CSV → parse every voucher.
 * Avoids browser timeouts when workbook has 30+ auditor sheets.
 */
export const syncExpenseWorkbook = async (urlOrId, listWorkbookTabs) => {
  const spreadsheetId = extractSpreadsheetId(urlOrId);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheets URL');
  }

  const tabs = await listWorkbookTabs(spreadsheetId);
  const tabResults = await runPool(tabs, async (tab) => {
    const csv = await fetchTabCsv(spreadsheetId, tab.gid);
    if (!csv) return { tab, matrix: null, error: 'CSV export failed' };
    return { tab, matrix: matrixFromCsv(csv), error: null };
  });

  const matricesBySheet = {};
  const vouchers = [];
  const sheetSummary = [];
  let loadedTabs = 0;

  tabResults.forEach(({ tab, matrix, error }, i) => {
    const sheetName = sanitizeSheetName(tab.name, i);
    if (!matrix?.length) {
      sheetSummary.push({
        sheetName,
        gid: tab.gid,
        status: 'failed',
        reason: error || 'Empty tab',
      });
      return;
    }

    loadedTabs++;
    matricesBySheet[sheetName] = matrix;
    const parsed = parseVoucherSheet(matrix, sheetName);

    if (parsed) {
      vouchers.push(parsed);
      sheetSummary.push({
        sheetName,
        gid: tab.gid,
        auditorName: parsed.auditorName,
        employeeNo: parsed.employeeNo,
        status: 'loaded',
        dateRows: parsed.dateBlocks.length,
        declaredTotal: parsed.declaredTotal,
        reason: `${parsed.dateBlocks.length} date row(s) · ${parsed.voucherMode}`,
      });
    } else {
      sheetSummary.push({
        sheetName,
        gid: tab.gid,
        status: 'skipped',
        reason: 'Not an auditor voucher tab',
      });
    }
  });

  const tabCountInLink = tabs.length;
  let syncError = null;

  if (vouchers.length === 0 && loadedTabs > 0) {
    syncError = {
      title: 'No auditor vouchers parsed',
      message: 'Tabs downloaded but none matched the Expenses Claim Voucher form.',
      failedTabs: sheetSummary,
    };
  } else if (tabCountInLink > 1 && loadedTabs < tabCountInLink) {
    syncError = {
      title: `Partial download — ${loadedTabs} of ${tabCountInLink} tabs`,
      message:
        'Some auditor tabs could not be downloaded. Share workbook: Anyone with the link → Viewer.',
      failedTabs: sheetSummary.filter((s) => s.status !== 'loaded'),
      partial: true,
    };
  }

  const dateAudit = auditAllVouchers(vouchers);

  return {
    vouchers,
    sheetSummary,
    matricesBySheet,
    tabs,
    spreadsheetId,
    totalSheets: loadedTabs,
    totalTabsInWorkbook: tabCountInLink,
    totalAuditors: vouchers.length,
    dateAudit,
    syncError,
    syncMode: 'server-csv',
  };
};
