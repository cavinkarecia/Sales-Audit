import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';
import SheetLinkUpload from './SheetLinkUpload';
import { fetchAllExpenseVouchers } from '../utils/expenseVoucherParser';
import { enrichAllVouchersWithImages } from '../utils/expenseImageAnalysis';
import {
  verifyAllExpenseVouchers,
  buildExpenseAIPayload,
} from '../utils/expenseVerifier';
import { analyzeExpenseWithAI } from '../utils/deepseekAgent';
import { analyzeExpenseDay, sumDaySplits } from '../utils/expenseDayCheck';
import {
  computeAuditorAmounts,
  computeWorkbookTotals,
  fmtRs,
  diffLabel,
  near,
  TOL,
} from '../utils/expenseTotals';

const severityColor = (s) =>
  s === 'red' ? '#f85149' : s === 'orange' ? '#d29922' : '#3fb950';

const splitLabel = (d) => {
  if (d.splitType === 'petrol_km' || d.isKmPetrolDay) {
    return d.isRoundTrip ? 'Petrol (KM×8 round)' : 'Petrol (KM×4)';
  }
  if (d.splitType === 'petrol' || (d.isPetrolDay && (d.petrolTravel || 0) > 0)) return 'Petrol';
  if (d.splitType === 'bus_train' || d.hasBusTrainHint) return 'Bus/Train';
  if (d.splitType === 'mixed') return 'Mixed';
  if (d.splitType === 'stay') return 'Stay';
  return '—';
};

const isMismatch = (a, b, tol = 10) => !near(a, b, tol);

const DateWiseSplitTable = ({ dateResults, amounts }) => {
  const totals = sumDaySplits(dateResults);
  const ticketsHeader = amounts?.header?.ticketsLocal || 0;

  return (
    <div style={{ overflowX: 'auto' }}>
      <p style={{ margin: '0 0 8px', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
        <strong>Travel</strong> = bus/train ticket · <strong>Local</strong> = local allowance ·{' '}
        <strong>Petrol</strong> = fuel (km × ₹4 one-way, × ₹8 round trip) · <strong>Stay</strong> = accommodation ·{' '}
        <strong>Day total</strong> = Travel + Local + Petrol + Stay for that date
      </p>
      <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(88,166,255,0.1)', color: 'var(--text-secondary)', textAlign: 'left' }}>
            <th style={{ padding: 6 }}>#</th>
            <th style={{ padding: 6 }}>Date</th>
            <th style={{ padding: 6 }}>Travel (tickets)</th>
            <th style={{ padding: 6 }}>Local allowance</th>
            <th style={{ padding: 6 }}>Petrol</th>
            <th style={{ padding: 6 }}>Stay</th>
            <th style={{ padding: 6 }}>Day total</th>
            <th style={{ padding: 6 }}>System check</th>
            <th style={{ padding: 6 }}>OK?</th>
          </tr>
        </thead>
        <tbody>
          {dateResults.map((d, idx) => {
            const a = analyzeExpenseDay(d);
            return (
              <tr
                key={d.date}
                style={{
                  borderTop: '1px solid var(--border-main)',
                  background: a.ok ? 'transparent' : 'rgba(248,81,73,0.06)',
                }}
              >
                <td style={{ padding: 6, color: 'var(--text-secondary)' }}>{idx + 1}</td>
                <td style={{ padding: 6, fontWeight: 600 }}>
                  {d.date}
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                    {splitLabel(d)}
                  </div>
                </td>
                <td style={{ padding: 6 }}>{fmtRs(a.travel)}</td>
                <td style={{ padding: 6 }}>{fmtRs(a.local)}</td>
                <td style={{ padding: 6 }}>
                  {fmtRs(a.petrolEntered)}
                  {a.petrolCheck !== '—' && (
                    <div
                      style={{
                        fontSize: '0.62rem',
                        color: a.petrolMatch ? 'var(--text-secondary)' : '#f85149',
                        marginTop: 2,
                      }}
                    >
                      {a.petrolCheck}
                    </div>
                  )}
                </td>
                <td style={{ padding: 6 }}>{fmtRs(a.stay)}</td>
                <td style={{ padding: 6, fontWeight: 700 }}>{fmtRs(a.daySplitTotal)}</td>
                <td style={{ padding: 6, fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                  {a.rowCheck}
                  {a.sheetGrand > 0 && (
                    <div>
                      Sheet grand: {fmtRs(a.sheetGrand)}
                      {!a.grandMatch && (
                        <span style={{ color: '#f85149' }}> ≠ {fmtRs(a.rowExpected)}</span>
                      )}
                    </div>
                  )}
                </td>
                <CmpCell value={a.ok ? 'OK' : 'ERROR'} match={a.ok} bold />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr
            style={{
              borderTop: '2px solid var(--accent-primary)',
              fontWeight: 700,
              background: 'rgba(88,166,255,0.1)',
            }}
          >
            <td colSpan={2} style={{ padding: 8 }}>
              Day-wise split total
            </td>
            <td style={{ padding: 8 }}>{fmtRs(totals.travel)}</td>
            <td style={{ padding: 8 }}>{fmtRs(totals.local)}</td>
            <td style={{ padding: 8 }}>{fmtRs(totals.petrol)}</td>
            <td style={{ padding: 8 }}>{fmtRs(totals.stay)}</td>
            <td style={{ padding: 8, color: '#58a6ff' }}>{fmtRs(totals.daySplitTotal)}</td>
            <td colSpan={2} style={{ padding: 8 }} />
          </tr>
          <tr style={{ background: 'rgba(88,166,255,0.04)', fontSize: '0.68rem' }}>
            <td colSpan={9} style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
              <strong>Page totals from dates:</strong>{' '}
              Fuel {fmtRs(amounts?.fromDates?.fuel ?? totals.petrol)} ·{' '}
              Tickets+Local {fmtRs(amounts?.fromDates?.ticketsLocal ?? totals.ticketsLocal)}
              {ticketsHeader > 0 && (
                <span style={{ color: !isMismatch(ticketsHeader, amounts?.fromDates?.ticketsLocal ?? totals.ticketsLocal, TOL.tickets) ? '#3fb950' : '#f85149' }}>
                  {' '}(header {fmtRs(ticketsHeader)})
                </span>
              )}
              {' · '}Stay {fmtRs(amounts?.fromDates?.stay ?? totals.stay)} ·{' '}
              <strong style={{ color: '#58a6ff' }}>
                Grand {fmtRs(amounts?.fromDates?.grand ?? totals.daySplitTotal)}
              </strong>
              {amounts?.header?.declared > 0 && (
                <span style={{ color: amounts.checks.grandOk ? '#3fb950' : '#f85149' }}>
                  {' '}(sheet total {fmtRs(amounts.header.declared)} — {diffLabel(amounts.header.declared, amounts.fromDates.grand)})
                </span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

const CmpCell = ({ value, match, bold }) => (
  <td
    style={{
      padding: '8px 10px',
      color: match ? '#3fb950' : '#f85149',
      fontWeight: bold ? 700 : 500,
    }}
  >
    {value}
  </td>
);

const voucherBySheet = (vouchers) => {
  const map = new Map();
  for (const v of vouchers || []) {
    map.set(v.sheetName, v);
  }
  return map;
};

const SplitAmount = ({ amount, match }) => (
  <span
    style={{
      fontWeight: 700,
      color: match === undefined ? 'inherit' : match ? '#3fb950' : '#f85149',
    }}
  >
    {fmtRs(amount)}
  </span>
);

const AuditorTotalSummary = ({ voucher }) => {
  const amounts = computeAuditorAmounts(voucher);
  const { header, fromDates, checks, headerPartsSum, declaredUsed } = amounts;

  const thStyle = {
    padding: '8px 10px',
    textAlign: 'right',
    fontSize: '0.72rem',
    color: 'var(--text-secondary)',
    fontWeight: 600,
  };
  const labelStyle = {
    padding: '10px 10px',
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  };
  const amtStyle = { padding: '10px 10px', textAlign: 'right', fontSize: '0.85rem' };

  return (
    <div
      style={{
        marginTop: 12,
        padding: '12px 14px',
        borderRadius: 8,
        background: 'rgba(88,166,255,0.06)',
        border: `1px solid ${checks.allOk ? 'var(--border-main)' : 'rgba(248,81,73,0.4)'}`,
        overflowX: 'auto',
      }}
    >
      <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
        <strong>How totals are checked:</strong> Sheet header (top of tab) is compared to the sum of all date rows.
        Grand total = Fuel + Tickets&amp;Local + Stay.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-main)' }}>
            <th style={{ ...thStyle, textAlign: 'left' }} />
            <th style={thStyle}>Fuel</th>
            <th style={thStyle}>Tickets + Local</th>
            <th style={thStyle}>Stay</th>
            <th style={{ ...thStyle, fontWeight: 800 }}>Grand total</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid var(--border-main)' }}>
            <td style={labelStyle}>1. Auditor entered (sheet header)</td>
            <td style={amtStyle}><SplitAmount amount={header.fuel} /></td>
            <td style={amtStyle}><SplitAmount amount={header.ticketsLocal} /></td>
            <td style={amtStyle}><SplitAmount amount={header.stay} /></td>
            <td style={amtStyle}><SplitAmount amount={declaredUsed} /></td>
          </tr>
          <tr style={{ borderBottom: '1px solid var(--border-main)' }}>
            <td style={labelStyle}>2. Sum of all date rows</td>
            <td style={amtStyle}><SplitAmount amount={fromDates.fuel} match={checks.fuelOk} /></td>
            <td style={amtStyle}><SplitAmount amount={fromDates.ticketsLocal} match={checks.ticketsOk} /></td>
            <td style={amtStyle}><SplitAmount amount={fromDates.stay} match={checks.stayOk} /></td>
            <td style={amtStyle}><SplitAmount amount={fromDates.grand} match={checks.grandOk} /></td>
          </tr>
          <tr>
            <td style={labelStyle}>3. Header parts check (Fuel + Tickets + Stay)</td>
            <td colSpan={3} style={{ ...amtStyle, textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {fmtRs(header.fuel)} + {fmtRs(header.ticketsLocal)} + {fmtRs(header.stay)} ={' '}
              <strong>{fmtRs(headerPartsSum)}</strong>
              {!checks.headerPartsOk && declaredUsed > 0 && (
                <span style={{ color: '#f85149' }}> ≠ declared {fmtRs(declaredUsed)}</span>
              )}
            </td>
            <td style={amtStyle}>
              <SplitAmount amount={headerPartsSum} match={checks.headerPartsOk} />
            </td>
          </tr>
        </tbody>
      </table>
      {!checks.allOk && (
        <div style={{ marginTop: 10, fontSize: '0.72rem', color: '#f85149' }}>
          <strong>What is wrong:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {amounts.issues.map((issue) => (
              <li key={issue.code} style={{ marginBottom: 4 }}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}
      {voucher.imageAnalysis?.note && (
        <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          {voucher.imageAnalysis.note}
        </p>
      )}
    </div>
  );
};

const WorkbookTotalsPanel = ({ vouchers }) => {
  const wb = computeWorkbookTotals(vouchers);
  if (!wb.auditors) return null;

  const headerGrand = wb.headerPartsSum;

  return (
    <div
      className="glass-card"
      style={{
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
        border: `1px solid ${wb.mismatchAuditors === 0 ? 'var(--border-main)' : 'rgba(248,81,73,0.35)'}`,
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>Workbook total — all {wb.auditors} auditor pages</h3>
      <p style={{ margin: '0 0 12px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
        <strong>Header</strong> = top of each auditor tab (Fuel + Tickets&amp;Local + Stay = Total).{' '}
        <strong>Date splits</strong> = sum of every date row in column A. Both should match per page and in total.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 520 }}>
        <thead>
          <tr style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
            <th style={{ padding: 8, textAlign: 'left' }} />
            <th style={{ padding: 8 }}>Fuel</th>
            <th style={{ padding: 8 }}>Tickets + Local</th>
            <th style={{ padding: 8 }}>Stay</th>
            <th style={{ padding: 8, fontWeight: 800 }}>Grand total</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderTop: '1px solid var(--border-main)' }}>
            <td style={{ padding: 8, color: 'var(--text-secondary)' }}>1. Header entered (all pages)</td>
            <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>{fmtRs(wb.header.fuel)}</td>
            <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>{fmtRs(wb.header.ticketsLocal)}</td>
            <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>{fmtRs(wb.header.stay)}</td>
            <td style={{ padding: 8, textAlign: 'right', fontWeight: 800, color: '#58a6ff' }}>{fmtRs(headerGrand)}</td>
          </tr>
          <tr style={{ borderTop: '1px dashed var(--border-main)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            <td style={{ padding: '4px 8px' }}>↳ Total row on sheets (declared)</td>
            <td colSpan={3} />
            <td style={{ padding: '4px 8px', textAlign: 'right' }}>
              {fmtRs(wb.header.declared)}
              {!wb.checks.headerPartsOk && wb.header.declared > 0 && (
                <span style={{ color: '#f85149' }}> ≠ parts sum</span>
              )}
            </td>
          </tr>
          <tr>
            <td style={{ padding: 8, color: 'var(--text-secondary)' }}>2. Sum of all date rows</td>
            <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, color: wb.checks.fuelOk ? '#3fb950' : '#f85149' }}>{fmtRs(wb.fromDates.fuel)}</td>
            <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, color: wb.checks.ticketsOk ? '#3fb950' : '#f85149' }}>{fmtRs(wb.fromDates.ticketsLocal)}</td>
            <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, color: wb.checks.stayOk ? '#3fb950' : '#f85149' }}>{fmtRs(wb.fromDates.stay)}</td>
            <td style={{ padding: 8, textAlign: 'right', fontWeight: 800, color: wb.checks.grandOk ? '#3fb950' : '#f85149' }}>{fmtRs(wb.fromDates.grand)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--accent-primary)', fontSize: '0.72rem' }}>
            <td colSpan={5} style={{ padding: '8px', color: 'var(--text-secondary)' }}>
              Formula: Grand = Fuel + Tickets&amp;Local + Stay · Header grand {fmtRs(headerGrand)} vs date splits {fmtRs(wb.fromDates.grand)}
              {!wb.checks.grandOk && (
                <span style={{ color: '#f85149' }}> — gap {fmtRs(Math.abs(headerGrand - wb.fromDates.grand))}</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
      {wb.mismatchAuditors > 0 && (
        <p style={{ margin: '10px 0 0', fontSize: '0.75rem', color: '#f85149' }}>
          {wb.mismatchAuditors} page{wb.mismatchAuditors === 1 ? '' : 's'} still mismatch — expand each auditor below for the exact split.
        </p>
      )}
    </div>
  );
};

const collectAuditorMistakes = (result, tabAudit) => {
  const v = result.voucher;
  const amounts = computeAuditorAmounts(v);
  const items = [];

  const add = (severity, message) => {
    const msg = String(message || '').trim();
    if (!msg || items.some((i) => i.message === msg)) return;
    items.push({ severity, message: msg });
  };

  amounts.issues.forEach((issue) => add(issue.severity, issue.message));

  (tabAudit?.headerIssues || []).forEach((h) => add('red', h.message));

  (tabAudit?.perDate || []).forEach((d) => {
    d.issues?.forEach((issue) => add('red', issue.message));
  });

  result.flags
    .filter(
      (f) =>
        (f.severity === 'red' || f.severity === 'orange') &&
        !['CORRECT_TOTAL_MISMATCH', 'PETROL_CALC', 'TOTAL_FORMULA', 'TICKETS_VS_DATE_SUM', 'FUEL_VS_DATE_SUM', 'DECLARED_VS_DAY_SPLIT', 'HEADER_TOTAL_MISMATCH'].includes(f.code),
    )
    .forEach((f) => add(f.severity, f.message));

  return items;
};

const AuditorMistakesSection = ({ result, tabAudit }) => {
  const mistakes = collectAuditorMistakes(result, tabAudit);
  if (!mistakes.length) return null;

  const redCount = mistakes.filter((m) => m.severity === 'red').length;

  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 14px',
        borderRadius: 8,
        border: `1px solid ${redCount > 0 ? '#f85149' : '#d29922'}`,
        background: redCount > 0 ? 'rgba(248,81,73,0.08)' : 'rgba(210,153,34,0.08)',
        fontSize: '0.78rem',
      }}
    >
      <strong style={{ color: redCount > 0 ? '#f85149' : '#d29922' }}>
        Mistakes found ({mistakes.length})
      </strong>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {mistakes.map((m, i) => (
          <li
            key={`${m.message}-${i}`}
            style={{
              color: severityColor(m.severity === 'orange' ? 'orange' : 'red'),
              marginBottom: 4,
            }}
          >
            {m.message}
          </li>
        ))}
      </ul>
    </div>
  );
};

const ExpenseCheck2Page = () => {
  const {
    attendanceRecords,
    pjpRecords,
    expenseVouchers,
    setExpenseVouchers,
    expenseSheetSummary,
    setExpenseSheetSummary,
    expenseSpreadsheetUrl,
    setExpenseSpreadsheetUrl,
  } = useAuditData();

  const [isFetching, setIsFetching] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [aiReport, setAiReport] = useState('');
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [liveBuild, setLiveBuild] = useState('');
  const [dateAuditSummary, setDateAuditSummary] = useState(null);
  const [openDateDetail, setOpenDateDetail] = useState(() => new Set());
  const [sheetStatusOpen, setSheetStatusOpen] = useState(false);

  const toggleDateDetail = (id) => {
    setOpenDateDetail((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => setLiveBuild(h.build || ''))
      .catch(() => {});
  }, []);

  const handleSync = async () => {
    if (!expenseSpreadsheetUrl.trim()) return;
    setIsFetching(true);
    setSyncError(null);
    setAiReport('');
    setExpenseVouchers([]);
    setExpenseSheetSummary([]);
    setDateAuditSummary(null);
    setSyncStatus('Server: listing all tabs and downloading every auditor sheet…');
    try {
      const result = await fetchAllExpenseVouchers(expenseSpreadsheetUrl.trim());
      setExpenseSheetSummary(result.sheetSummary || []);
      setDateAuditSummary(result.dateAudit || null);
      setSyncError(result.syncError || null);
      setSyncStatus(
        `Parsed ${result.totalAuditors} auditor(s), ${result.dateAudit?.summary?.totalDates ?? 0} dates checked. Analyzing bill images…`,
      );
      const enriched = await enrichAllVouchersWithImages(
        result.vouchers,
        result.tabs,
        result.spreadsheetId,
        result.matricesBySheet,
        (n, total, name) => {
          setSyncStatus(`Analyzing bill images (${n}/${total}): ${name}…`);
        },
      );
      setExpenseVouchers(enriched);
      localStorage.setItem('sales_audit_expense_v5_build', result.build || liveBuild || '');
      if (result.dateAudit) {
        localStorage.setItem('sales_audit_expense_v5_date_audit', JSON.stringify(result.dateAudit));
      }
      setSyncStatus(
        `Done — ${enriched.length} auditor(s), ${result.dateAudit?.summary?.totalDates ?? 0} dates, ${result.dateAudit?.summary?.flaggedDates ?? 0} date flag(s). Build: ${result.build || liveBuild || 'live'}`,
      );
    } catch (err) {
      console.error(err);
      setSyncError(err.message || 'Sync failed');
      setExpenseVouchers([]);
      setExpenseSheetSummary([]);
      setSyncStatus('');
    } finally {
      setIsFetching(false);
    }
  };

  const verification = useMemo(() => {
    if (!expenseVouchers.length) return null;
    return verifyAllExpenseVouchers(expenseVouchers, attendanceRecords, pjpRecords);
  }, [expenseVouchers, attendanceRecords, pjpRecords]);

  const filtered = useMemo(() => {
    if (!verification) return [];
    if (filter === 'all') return verification.results;
    return verification.results.filter((r) => r.summary.status === filter);
  }, [verification, filter]);

  const voucherMap = useMemo(() => voucherBySheet(expenseVouchers), [expenseVouchers]);

  const loadedSheetCount = useMemo(
    () => expenseSheetSummary.filter((s) => s.status === 'loaded').length,
    [expenseSheetSummary],
  );

  const handleAi = async () => {
    if (!verification) return;
    setIsAiRunning(true);
    setAiReport('');
    try {
      setAiReport(await analyzeExpenseWithAI(buildExpenseAIPayload(verification)));
    } catch (err) {
      alert(err.message);
    } finally {
      setIsAiRunning(false);
    }
  };

  return (
    <div className="dashboard-container" style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
        <Link
          to="/"
          style={{
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            textDecoration: 'none',
            fontSize: '0.85rem',
          }}
        >
          <ArrowLeft size={16} /> Attendance
        </Link>
        <h1 style={{ margin: 0, fontSize: '1.35rem' }}>Expense Check</h1>
        {liveBuild && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            Server build: {liveBuild}
          </span>
        )}
      </div>

      {expenseVouchers.length > 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
          Showing {expenseVouchers.length} auditor(s). If this looks wrong, click <strong>Fetch all auditor sheets</strong> again
          (old results are not reused after sync).
        </p>
      )}

      <SheetLinkUpload
        title="Upload expense claim workbook"
        description="Paste one Google Sheet link — we fetch ALL auditor tabs in that workbook (not only the open tab). Then we read bus/train ticket images and verify totals."
        url={expenseSpreadsheetUrl}
        onUrlChange={(v) => {
          setExpenseSpreadsheetUrl(v);
          setSyncError(null);
        }}
        onSync={handleSync}
        isLoading={isFetching}
        loadedCount={expenseSheetSummary.filter((s) => s.status === 'loaded').length}
        totalSheets={expenseSheetSummary.length}
        syncLabel="Fetch all auditor sheets"
        loadingLabel="Fetching all tabs…"
      />

      {dateAuditSummary?.summary && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>All pages — all dates audit</h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>Auditors: <strong>{dateAuditSummary.summary.auditors}</strong></span>
            <span>Dates checked: <strong>{dateAuditSummary.summary.totalDates}</strong></span>
            <span style={{ color: '#3fb950' }}>OK: <strong>{dateAuditSummary.summary.passedDates}</strong></span>
            <span style={{ color: '#f85149' }}>Flags: <strong>{dateAuditSummary.summary.flaggedDates}</strong></span>
          </div>
        </div>
      )}

      {syncStatus && (
        <p style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', marginBottom: '1rem' }}>
          {syncStatus}
        </p>
      )}

      {syncError && (
        <div
          className="glass-card"
          style={{
            padding: '1rem',
            marginBottom: '1rem',
            borderLeft: '4px solid #f85149',
            fontSize: '0.85rem',
          }}
        >
          <strong>{typeof syncError === 'object' ? syncError.title : 'Sync failed'}</strong>
          <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)' }}>
            {typeof syncError === 'string' ? syncError : syncError.message}
          </p>
        </div>
      )}

      {(!attendanceRecords.length || !pjpRecords.length) && expenseVouchers.length > 0 && (
        <div
          className="glass-card"
          style={{
            padding: '0.85rem 1rem',
            marginBottom: '1rem',
            borderLeft: '4px solid #d29922',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
          }}
        >
          Load attendance and PJP on Attendance for stronger cross-checks (optional but recommended).
        </div>
      )}

      {expenseSheetSummary.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <button
            type="button"
            onClick={() => setSheetStatusOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            <span>
              Sheet Status ({loadedSheetCount}/{expenseSheetSummary.length} loaded)
            </span>
            {sheetStatusOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {sheetStatusOpen && (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                    <th style={{ padding: 8 }}>Tab</th>
                    <th style={{ padding: 8 }}>Requested By</th>
                    <th style={{ padding: 8 }}>Emp No</th>
                    <th style={{ padding: 8 }}>Date rows</th>
                    <th style={{ padding: 8 }}>Declared total</th>
                    <th style={{ padding: 8 }}>Totals OK?</th>
                    <th style={{ padding: 8 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expenseSheetSummary.map((s) => {
                    const v = voucherMap.get(s.sheetName);
                    const amt = v ? computeAuditorAmounts(v) : null;
                    return (
                    <tr key={s.sheetName} style={{ borderTop: '1px solid var(--border-main)' }}>
                      <td style={{ padding: 8 }}>{s.sheetName}</td>
                      <td style={{ padding: 8 }}>{s.auditorName || v?.auditorName || '—'}</td>
                      <td style={{ padding: 8 }}>{s.employeeNo || v?.employeeNo || '—'}</td>
                      <td style={{ padding: 8 }}>{s.dateRows ?? v?.dateBlocks?.length ?? '—'}</td>
                      <td style={{ padding: 8 }}>{amt ? fmtRs(amt.declaredUsed) : '—'}</td>
                      <td style={{ padding: 8, color: amt ? (amt.checks.allOk ? '#3fb950' : '#f85149') : 'var(--text-secondary)' }}>
                        {amt ? (amt.checks.allOk ? 'OK' : 'Mismatch') : '—'}
                      </td>
                      <td style={{ padding: 8, color: s.status === 'loaded' ? '#3fb950' : '#f85149' }}>
                        {s.status}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {verification && (
        <>
          <WorkbookTotalsPanel vouchers={expenseVouchers} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
              marginBottom: '1rem',
            }}
          >
            {[
              { label: 'Auditors', value: verification.summary.total },
              { label: 'Passed', value: verification.summary.passed, color: '#3fb950' },
              { label: 'Review', value: verification.summary.review, color: '#d29922' },
              { label: 'Flagged', value: verification.summary.flagged, color: '#f85149' },
            ].map((k) => (
              <div key={k.label} className="glass-card" style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{k.label}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: k.color || '#fff' }}>
                  {k.value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {['all', 'pass', 'review', 'flag'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid var(--border-main)',
                  background: filter === f ? 'var(--accent-primary)' : 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  textTransform: 'capitalize',
                }}
              >
                {f}
              </button>
            ))}
            <button
              type="button"
              onClick={handleAi}
              disabled={isAiRunning}
              style={{
                marginLeft: 'auto',
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
            >
              {isAiRunning ? <Loader2 size={16} className="spin" /> : <Bot size={16} />}
              AI expense review
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filtered.map((result) => {
              const tabAudit = dateAuditSummary?.audits?.find(
                (a) =>
                  a.sheetName === result.voucher.sheetName ||
                  a.auditorName === result.voucher.auditorName,
              );
              const amounts = computeAuditorAmounts(result.voucher);
              return (
              <div
                key={result.id}
                className="glass-card"
                style={{
                  padding: '1rem 1.25rem',
                  borderLeft: `4px solid ${severityColor(
                    result.summary.status === 'pass'
                      ? 'green'
                      : result.summary.status === 'review'
                        ? 'orange'
                        : 'red',
                  )}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>{result.voucher.auditorName}</h3>
                    <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Emp No: {result.voucher.employeeNo || '—'} · Tab: {result.voucher.sheetName} ·{' '}
                      Declared {fmtRs(amounts.declaredUsed)} · Checked {fmtRs(amounts.fromDates.grand)}
                      {!amounts.checks.grandOk && (
                        <span style={{ color: '#f85149' }}> ({diffLabel(amounts.declaredUsed, amounts.fromDates.grand)})</span>
                      )}
                      {tabAudit && (
                        <span>
                          {' '}
                          · {tabAudit.dateCount} dates · {tabAudit.issueCount} flag(s)
                        </span>
                      )}
                    </p>
                  </div>
                  <span
                    style={{
                      fontWeight: 700,
                      color: severityColor(
                        result.summary.status === 'pass' ? 'green' : result.summary.status === 'review' ? 'orange' : 'red',
                      ),
                      textTransform: 'uppercase',
                      fontSize: '0.75rem',
                    }}
                  >
                    {result.summary.status}
                  </span>
                </div>

                <AuditorTotalSummary voucher={result.voucher} />

                <AuditorMistakesSection result={result} tabAudit={tabAudit} />

                {result.voucher.imageUrls?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <h4 style={{ fontSize: '0.8rem' }}>Bill images ({result.voucher.imageUrls.length})</h4>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      {result.voucher.imageUrls.slice(0, 4).map((src) => (
                        <a key={src} href={src} target="_blank" rel="noreferrer">
                          <img
                            src={src}
                            alt="Bill"
                            style={{
                              width: 120,
                              height: 80,
                              objectFit: 'cover',
                              borderRadius: 6,
                              border: '1px solid var(--border-main)',
                            }}
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {result.dateResults.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => toggleDateDetail(result.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--border-main)',
                        background: openDateDetail.has(result.id)
                          ? 'rgba(88,166,255,0.12)'
                          : 'transparent',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        width: '100%',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        Date-wise split ({result.dateResults.length} days)
                      </span>
                      {openDateDetail.has(result.id) ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </button>

                    {openDateDetail.has(result.id) && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: 10,
                            borderRadius: 8,
                            border: '1px solid var(--border-main)',
                          }}
                        >
                          <DateWiseSplitTable
                            dateResults={result.dateResults}
                            amounts={amounts}
                          />
                        </div>
                      )}
                  </div>
                )}
              </div>
            );
            })}
          </div>

          {aiReport && (
            <div
              className="glass-card"
              style={{
                padding: '1.25rem',
                marginTop: '1rem',
                whiteSpace: 'pre-wrap',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                borderLeft: '4px solid #8b5cf6',
              }}
            >
              {aiReport}
            </div>
          )}
        </>
      )}

      {!expenseVouchers.length && !syncError && !isFetching && (
        <div className="glass-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p>Paste your workbook link (format: docs.google.com/spreadsheets/d/…/edit?gid=0) and fetch all auditor tabs.</p>
          <p style={{ fontSize: '0.8rem', marginTop: 8 }}>
            Default sample: HEPL Expenses Claim Voucher — Requested By, Employee No, Fuel, Tickets, date in column A.
          </p>
        </div>
      )}
    </div>
  );
};

export default ExpenseCheck2Page;
