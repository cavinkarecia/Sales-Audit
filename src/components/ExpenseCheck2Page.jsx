import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';
import SheetLinkUpload from './SheetLinkUpload';
import { fetchAllExpenseVouchers, ticketsLocalForBlock } from '../utils/expenseVoucherParser';
import { enrichAllVouchersWithImages } from '../utils/expenseImageAnalysis';
import {
  verifyAllExpenseVouchers,
  buildExpenseAIPayload,
} from '../utils/expenseVerifier';
import { analyzeExpenseWithAI } from '../utils/deepseekAgent';

const severityColor = (s) =>
  s === 'red' ? '#f85149' : s === 'orange' ? '#d29922' : '#3fb950';

const PETROL_RATE = 4;

const petrolDayAmount = (d) => d.petrolTravel || 0;
const petrolCalcFromKm = (d) => (d.kmTraveled > 0 ? Math.round(d.kmTraveled * PETROL_RATE) : 0);

const splitLabel = (d) => {
  if (d.splitType === 'petrol_km' || d.isKmPetrolDay) return 'Petrol (KM×4)';
  if (d.splitType === 'petrol' || (d.isPetrolDay && petrolDayAmount(d) > 0)) return 'Petrol';
  if (d.splitType === 'bus_train' || d.hasBusTrainHint) return 'Bus/Train';
  if (d.splitType === 'mixed') return 'Mixed';
  if (d.splitType === 'stay') return 'Stay';
  return '—';
};

const formatPetrolCell = (d) => {
  const amount = petrolDayAmount(d);
  const calc = d.kmCalcAmount || petrolCalcFromKm(d);
  if (!amount && !calc) return '—';
  if (d.kmTraveled > 0) {
    const kmPart =
      d.kmLegs?.length > 1
        ? `${d.kmLegs.join('+')}=${d.kmTraveled} km`
        : `${d.kmTraveled} km`;
    return `₹${amount || calc} (${kmPart} × ₹${PETROL_RATE})`;
  }
  return `₹${amount || calc}`;
};

const fmtRs = (n) => (Number(n) > 0 ? `₹${n}` : '—');
const isMismatch = (a, b, tol = 10) => Math.abs((a || 0) - (b || 0)) > tol;

const expectedDayGrand = (d) => {
  if (d.isKmPetrolDay || d.splitType === 'petrol_km') {
    return d.kmCalcAmount || petrolCalcFromKm(d) || petrolDayAmount(d);
  }
  if (d.isPetrolDay) return petrolDayAmount(d) + (d.accommodation || 0);
  return (d.travel || 0) + (d.localConveyance || 0) + (d.accommodation || 0);
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

const sumDateResults = (rows) =>
  rows.reduce(
    (acc, d) => {
      const travel = d.travel || 0;
      const local = d.localConveyance || 0;
      const petrol = petrolDayAmount(d);
      const petrolCalc = petrolCalcFromKm(d);
      const travelLocal = d.isPetrolDay || d.isKmPetrolDay
        ? 0
        : ticketsLocalForBlock(d);
      return {
        travel: acc.travel + travel,
        local: acc.local + local,
        petrol: acc.petrol + petrol,
        petrolCalc: acc.petrolCalc + petrolCalc,
        stay: acc.stay + (d.accommodation || 0),
        grand: acc.grand + (d.grandTotal || 0),
        fromTickets: acc.fromTickets + (d.ticketAmountFromImages || 0),
        travelLocal: acc.travelLocal + travelLocal,
      };
    },
    {
      travel: 0,
      local: 0,
      petrol: 0,
      petrolCalc: 0,
      stay: 0,
      grand: 0,
      fromTickets: 0,
      travelLocal: 0,
    },
  );

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
  const dt = sumDateResults(voucher.dateBlocks || []);

  const headerFuel = voucher.fuelTotal || 0;
  const headerTickets = voucher.ticketsTotal || 0;
  const headerStay = voucher.accommodationTotal || 0;
  const headerTotal = voucher.declaredTotal || headerFuel + headerTickets + headerStay;

  const dayFuel = voucher.dateWisePetrolSum || dt.petrol || 0;
  const dayTickets = voucher.dateWiseTicketsSum ?? dt.travelLocal ?? 0;
  const dayStay = voucher.dateWiseAccommodationSum || dt.stay || 0;
  const dayTotal = dayFuel + dayTickets + dayStay;

  const fuelOk = !isMismatch(headerFuel, dayFuel, 50);
  const ticketsOk = !isMismatch(headerTickets, dayTickets, 10);
  const stayOk = !isMismatch(headerStay, dayStay, 10);
  const totalOk = !isMismatch(headerTotal, dayTotal, 15);
  const allOk = fuelOk && ticketsOk && stayOk && totalOk;

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
        border: `1px solid ${allOk ? 'var(--border-main)' : 'rgba(248,81,73,0.4)'}`,
        overflowX: 'auto',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-main)' }}>
            <th style={{ ...thStyle, textAlign: 'left' }} />
            <th style={thStyle}>Fuel</th>
            <th style={thStyle}>Tickets + Local</th>
            <th style={thStyle}>Accommodation</th>
            <th style={{ ...thStyle, fontWeight: 800 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid var(--border-main)' }}>
            <td style={labelStyle}>1. Auditor entered (sheet header)</td>
            <td style={amtStyle}>
              <SplitAmount amount={headerFuel} />
            </td>
            <td style={amtStyle}>
              <SplitAmount amount={headerTickets} />
            </td>
            <td style={amtStyle}>
              <SplitAmount amount={headerStay} />
            </td>
            <td style={amtStyle}>
              <SplitAmount amount={headerTotal} />
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>2. Date-wise splits total (all days)</td>
            <td style={amtStyle}>
              <SplitAmount amount={dayFuel} match={fuelOk} />
            </td>
            <td style={amtStyle}>
              <SplitAmount amount={dayTickets} match={ticketsOk} />
            </td>
            <td style={amtStyle}>
              <SplitAmount amount={dayStay} match={stayOk} />
            </td>
            <td style={amtStyle}>
              <SplitAmount amount={dayTotal} match={totalOk} />
            </td>
          </tr>
        </tbody>
      </table>
      {!allOk && (
        <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: '#f85149' }}>
          Red = date-wise total does not match what auditor entered in header.
        </p>
      )}
      {voucher.imageAnalysis?.note && (
        <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          {voucher.imageAnalysis.note}
        </p>
      )}
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
  const [selectedLoadedTab, setSelectedLoadedTab] = useState('');

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

  const loadedSheets = useMemo(
    () => expenseSheetSummary.filter((s) => s.status === 'loaded'),
    [expenseSheetSummary],
  );

  const selectedSheetInfo = useMemo(
    () => loadedSheets.find((s) => s.sheetName === selectedLoadedTab) || loadedSheets[0] || null,
    [loadedSheets, selectedLoadedTab],
  );

  useEffect(() => {
    if (!loadedSheets.length) {
      setSelectedLoadedTab('');
      return;
    }
    if (!loadedSheets.some((s) => s.sheetName === selectedLoadedTab)) {
      setSelectedLoadedTab(loadedSheets[0].sheetName);
    }
  }, [loadedSheets, selectedLoadedTab]);

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
          <ArrowLeft size={16} /> Full Dashboard
        </Link>
        <h1 style={{ margin: 0, fontSize: '1.35rem' }}>Expense Check 2</h1>
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
          Load attendance and PJP on Full Dashboard for stronger cross-checks (optional but recommended).
        </div>
      )}

      {loadedSheets.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <label
            htmlFor="loaded-sheets-select"
            style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 6 }}
          >
            Sheets loaded ({loadedSheets.length} of {expenseSheetSummary.length})
          </label>
          <select
            id="loaded-sheets-select"
            value={selectedSheetInfo?.sheetName || ''}
            onChange={(e) => setSelectedLoadedTab(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-main)',
              background: 'rgba(0,0,0,0.25)',
              color: '#fff',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            {loadedSheets.map((s) => (
              <option key={s.sheetName} value={s.sheetName}>
                {s.sheetName} — {s.auditorName || '—'} — Emp {s.employeeNo || '—'} — {s.dateRows ?? 0} dates
              </option>
            ))}
          </select>
          {selectedSheetInfo && (
            <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Tab: <strong>{selectedSheetInfo.sheetName}</strong> · Requested by:{' '}
              <strong>{selectedSheetInfo.auditorName || '—'}</strong> · Emp No:{' '}
              <strong>{selectedSheetInfo.employeeNo || '—'}</strong> · Date rows:{' '}
              <strong>{selectedSheetInfo.dateRows ?? '—'}</strong>
            </p>
          )}
        </div>
      )}

      {verification && (
        <>
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
                      Emp No: {result.voucher.employeeNo || '—'} · Tab: {result.voucher.sheetName} · Total ₹
                      {result.voucher.declaredTotal}
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
                        Date-wise comparison ({result.dateResults.length} days) — auditor vs system
                      </span>
                      {openDateDetail.has(result.id) ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </button>

                    {openDateDetail.has(result.id) && (() => {
                      const dt = sumDateResults(result.dateResults);

                      return (
                        <div
                          style={{
                            marginTop: 8,
                            padding: 10,
                            borderRadius: 8,
                            border: '1px solid var(--border-main)',
                            overflowX: 'auto',
                          }}
                        >
                          <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: 'rgba(88,166,255,0.08)', color: 'var(--text-secondary)' }}>
                                <th rowSpan={2} style={{ padding: 6, verticalAlign: 'bottom' }}>#</th>
                                <th rowSpan={2} style={{ padding: 6, verticalAlign: 'bottom' }}>Date</th>
                                <th rowSpan={2} style={{ padding: 6, verticalAlign: 'bottom' }}>Type</th>
                                <th colSpan={5} style={{ padding: 6, textAlign: 'center', borderBottom: '1px solid var(--border-main)' }}>
                                  Auditor entered (in sheet)
                                </th>
                                <th colSpan={2} style={{ padding: 6, textAlign: 'center', borderBottom: '1px solid var(--border-main)' }}>
                                  System check
                                </th>
                                <th rowSpan={2} style={{ padding: 6, verticalAlign: 'bottom' }}>Status</th>
                              </tr>
                              <tr style={{ color: 'var(--text-secondary)', fontSize: '0.68rem' }}>
                                <th style={{ padding: 4 }}>Travel</th>
                                <th style={{ padding: 4 }}>Local</th>
                                <th style={{ padding: 4 }}>Petrol</th>
                                <th style={{ padding: 4 }}>Stay</th>
                                <th style={{ padding: 4 }}>Grand</th>
                                <th style={{ padding: 4 }}>Should be</th>
                                <th style={{ padding: 4 }}>Formula</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.dateResults.map((d, idx) => {
                                const auditorGrand = d.grandTotal || 0;
                                const systemExpected = expectedDayGrand(d);
                                const dayMatch = !isMismatch(auditorGrand, systemExpected, 5);
                                let formula = '';
                                if (d.isKmPetrolDay || d.splitType === 'petrol_km') {
                                  const km =
                                    d.kmLegs?.length > 1
                                      ? `${d.kmLegs.join('+')}=${d.kmTraveled}`
                                      : `${d.kmTraveled}`;
                                  formula = `${km} km × ₹4`;
                                } else if (d.isPetrolDay) {
                                  formula = 'Petrol = Grand';
                                } else {
                                  formula = 'Travel+Local+Stay';
                                }

                                return (
                                  <tr
                                    key={d.date}
                                    style={{
                                      borderTop: '1px solid var(--border-main)',
                                      background: dayMatch ? 'transparent' : 'rgba(248,81,73,0.06)',
                                    }}
                                  >
                                    <td style={{ padding: 6, color: 'var(--text-secondary)' }}>{idx + 1}</td>
                                    <td style={{ padding: 6, fontWeight: 600 }}>{d.date}</td>
                                    <td style={{ padding: 6, fontSize: '0.68rem' }}>{splitLabel(d)}</td>
                                    <td style={{ padding: 6 }}>{fmtRs(d.travel)}</td>
                                    <td style={{ padding: 6 }}>{fmtRs(d.localConveyance)}</td>
                                    <td style={{ padding: 6 }}>{fmtRs(petrolDayAmount(d))}</td>
                                    <td style={{ padding: 6 }}>{fmtRs(d.accommodation)}</td>
                                    <CmpCell value={fmtRs(auditorGrand)} match={dayMatch} />
                                    <CmpCell value={fmtRs(systemExpected)} match={dayMatch} />
                                    <td style={{ padding: 6, fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                                      {formula}
                                    </td>
                                    <CmpCell value={dayMatch ? 'OK' : 'ERROR'} match={dayMatch} bold />
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr
                                style={{
                                  borderTop: '2px solid var(--accent-primary)',
                                  fontWeight: 700,
                                  background: 'rgba(88,166,255,0.08)',
                                }}
                              >
                                <td colSpan={3} style={{ padding: 8 }}>TOTAL</td>
                                <td style={{ padding: 8 }}>{fmtRs(dt.travel)}</td>
                                <td style={{ padding: 8 }}>{fmtRs(dt.local)}</td>
                                <td style={{ padding: 8 }}>{fmtRs(dt.petrol)}</td>
                                <td style={{ padding: 8 }}>{fmtRs(dt.stay)}</td>
                                <CmpCell
                                  value={fmtRs(dt.grand)}
                                  match={!isMismatch(
                                    result.voucher.declaredTotal,
                                    dt.grand,
                                    50,
                                  )}
                                />
                                <CmpCell
                                  value={fmtRs(dt.travelLocal + dt.petrol + dt.stay)}
                                  match={!isMismatch(dt.grand, dt.travelLocal + dt.petrol + dt.stay, 15)}
                                />
                                <td style={{ padding: 8 }}>—</td>
                                <CmpCell
                                  value={
                                    isMismatch(dt.grand, dt.travelLocal + dt.petrol + dt.stay, 15)
                                      ? 'CHECK'
                                      : 'OK'
                                  }
                                  match={!isMismatch(dt.grand, dt.travelLocal + dt.petrol + dt.stay, 15)}
                                  bold
                                />
                              </tr>
                              <tr style={{ background: 'rgba(88,166,255,0.04)', fontSize: '0.68rem' }}>
                                <td colSpan={11} style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
                                  Tickets + Local (bus/train days only):{' '}
                                  <strong style={{ color: !isMismatch(result.voucher.ticketsTotal, dt.travelLocal, 10) ? '#3fb950' : '#f85149' }}>
                                    {fmtRs(dt.travelLocal)}
                                  </strong>
                                  {' '}(header ₹{result.voucher.ticketsTotal || 0})
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {result.flags.filter((f) => f.severity === 'red').length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #f85149',
                      background: 'rgba(248,81,73,0.08)',
                      fontSize: '0.75rem',
                    }}
                  >
                    <strong style={{ color: '#f85149' }}>Mistakes found:</strong>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {result.flags
                        .filter((f) => f.severity === 'red')
                        .map((f, i) => (
                          <li key={i} style={{ color: '#f85149', marginBottom: 4 }}>
                            {f.message}
                          </li>
                        ))}
                    </ul>
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
