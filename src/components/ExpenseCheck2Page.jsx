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

const severityColor = (s) =>
  s === 'red' ? '#f85149' : s === 'orange' ? '#d29922' : '#3fb950';

const PETROL_RATE = 4;

const petrolDayAmount = (d) => (d.isPetrolDay ? d.petrolTravel || d.dayTotal || 0 : 0);
const petrolCalcFromKm = (d) => (d.kmTraveled > 0 ? Math.round(d.kmTraveled * PETROL_RATE) : 0);

const formatPetrolCell = (d) => {
  const amount = petrolDayAmount(d);
  const calc = petrolCalcFromKm(d);
  if (!amount && !calc) return '—';
  if (d.kmTraveled > 0) {
    return `₹${amount || calc} (${d.kmTraveled} km × ₹${PETROL_RATE})`;
  }
  return amount ? `₹${amount}` : `₹${calc}`;
};

const sumDateResults = (rows) =>
  rows.reduce(
    (acc, d) => {
      const travel = d.travel || 0;
      const local = d.localConveyance || 0;
      const petrol = petrolDayAmount(d);
      const petrolCalc = petrolCalcFromKm(d);
      const travelLocal = d.isPetrolDay
        ? 0
        : d.ticketComparable ?? d.ticketsSubtotal ?? travel + local;
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
  const [openDateDetail, setOpenDateDetail] = useState(() => new Set());

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
    setSyncStatus('Server: listing all tabs and downloading every auditor sheet…');
    try {
      const result = await fetchAllExpenseVouchers(expenseSpreadsheetUrl.trim());
      setExpenseSheetSummary(result.sheetSummary || []);
      setSyncError(result.syncError || null);
      setSyncStatus(
        `Parsed ${result.totalAuditors} auditor(s) from ${result.totalTabsInWorkbook} tabs. Analyzing bill images (0/${result.vouchers.length})…`,
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
      localStorage.setItem('sales_audit_expense_v3_build', result.build || liveBuild || '');
      setSyncStatus(
        `Done — ${enriched.length} auditor(s) from ${result.totalTabsInWorkbook} tabs. Build: ${result.build || liveBuild || 'live'}`,
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

      {expenseSheetSummary.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>Auditor tabs fetched</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Tab</th>
                  <th style={{ padding: 8 }}>Requested By</th>
                  <th style={{ padding: 8 }}>Emp No</th>
                  <th style={{ padding: 8 }}>Date rows</th>
                  <th style={{ padding: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {expenseSheetSummary.map((s) => (
                  <tr key={s.sheetName} style={{ borderTop: '1px solid var(--border-main)' }}>
                    <td style={{ padding: 8 }}>{s.sheetName}</td>
                    <td style={{ padding: 8 }}>{s.auditorName || '—'}</td>
                    <td style={{ padding: 8 }}>{s.employeeNo || '—'}</td>
                    <td style={{ padding: 8 }}>{s.dateRows ?? '—'}</td>
                    <td style={{ padding: 8, color: s.status === 'loaded' ? '#3fb950' : '#f85149' }}>
                      {s.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            {filtered.map((result) => (
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

                {result.voucher.totals && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      background: 'rgba(88,166,255,0.06)',
                      borderRadius: 8,
                      fontSize: '0.8rem',
                    }}
                  >
                    <h4 style={{ margin: '0 0 8px', fontSize: '0.85rem' }}>Total reconciliation</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Declared (sheet)</span>
                        <div style={{ fontWeight: 700 }}>₹{result.voucher.totals.declaredTotal}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Date-wise travel+local</span>
                        <div style={{ fontWeight: 700 }}>₹{result.voucher.totals.manualTicketsSum ?? result.voucher.totals.manualDateWiseSum}</div>
                      </div>
                      {result.voucher.totals.manualPetrolSum > 0 && (
                        <div>
                          <span style={{ color: 'var(--text-secondary)' }}>Date-wise petrol</span>
                          <div style={{ fontWeight: 700 }}>₹{result.voucher.totals.manualPetrolSum}</div>
                        </div>
                      )}
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Header Tickets+Local</span>
                        <div>₹{result.voucher.totals.headerTicketsLocal}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>From ticket images (AI)</span>
                        <div style={{ fontWeight: 700, color: '#3fb950' }}>
                          ₹{result.voucher.totals.fromTicketImages || '—'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Correct total</span>
                        <div style={{ fontWeight: 800, color: '#58a6ff' }}>
                          ₹{result.voucher.totals.correctTotal}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Fuel (secondary)</span>
                        <div>₹{result.voucher.totals.fuelHeader}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Stay</span>
                        <div>₹{result.voucher.totals.accommodation}</div>
                      </div>
                    </div>
                    {result.voucher.imageAnalysis?.note && (
                      <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                        {result.voucher.imageAnalysis.note}
                      </p>
                    )}
                  </div>
                )}

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
                        Date-wise detail ({result.dateResults.length} days)
                      </span>
                      {openDateDetail.has(result.id) ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </button>

                    {openDateDetail.has(result.id) && (() => {
                      const dt = sumDateResults(result.dateResults);
                      const headerTravelLocal =
                        result.voucher.totals?.manualTicketsSum ??
                        result.voucher.totals?.manualDateWiseSum ??
                        result.voucher.dateWiseTicketsSum ??
                        0;
                      const headerPetrol =
                        result.voucher.totals?.manualPetrolSum ??
                        result.voucher.totals?.fuelHeader ??
                        result.voucher.fuelTotal ??
                        0;
                      const headerFuel = result.voucher.totals?.fuelHeader ?? result.voucher.fuelTotal ?? 0;
                      const headerStay =
                        result.voucher.totals?.accommodation ??
                        result.voucher.dateWiseAccommodationSum ??
                        0;
                      const travelLocalOk = Math.abs(dt.travelLocal - headerTravelLocal) <= 10;
                      const petrolOk =
                        headerFuel > 0
                          ? dt.petrol > 0
                            ? Math.abs(dt.petrol - headerFuel) <= 50
                            : Math.abs(dt.petrolCalc - headerFuel) <= 50
                          : dt.petrol === 0;
                      const petrolCalcOk =
                        dt.petrol > 0 && dt.petrolCalc > 0
                          ? Math.abs(dt.petrol - dt.petrolCalc) <= 10
                          : true;
                      const stayOk = Math.abs(dt.stay - headerStay) <= 10;
                      const combinedCheck =
                        headerTravelLocal + headerFuel + headerStay;
                      const combinedSum = dt.travelLocal + (dt.petrol || headerFuel) + dt.stay;

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
                          <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                                <th style={{ padding: 6 }}>Date</th>
                                <th style={{ padding: 6 }}>Travel</th>
                                <th style={{ padding: 6 }}>Local</th>
                                <th style={{ padding: 6 }}>Petrol (₹4/km)</th>
                                <th style={{ padding: 6 }}>Stay</th>
                                <th style={{ padding: 6 }}>Grand total</th>
                                <th style={{ padding: 6 }}>From tickets</th>
                                <th style={{ padding: 6 }}>Match</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.dateResults.map((d) => (
                                <tr key={d.date} style={{ borderTop: '1px solid var(--border-main)' }}>
                                  <td style={{ padding: 6 }}>{d.date}</td>
                                  <td style={{ padding: 6 }}>₹{d.travel || '—'}</td>
                                  <td style={{ padding: 6 }}>₹{d.localConveyance || '—'}</td>
                                  <td
                                    style={{
                                      padding: 6,
                                      fontSize: '0.72rem',
                                      color:
                                        d.isPetrolDay &&
                                        d.kmTraveled > 0 &&
                                        Math.abs(petrolDayAmount(d) - petrolCalcFromKm(d)) > 10
                                          ? '#f85149'
                                          : 'inherit',
                                    }}
                                  >
                                    {formatPetrolCell(d)}
                                  </td>
                                  <td style={{ padding: 6 }}>₹{d.accommodation || '—'}</td>
                                  <td style={{ padding: 6 }}>₹{d.grandTotal}</td>
                                  <td style={{ padding: 6 }}>₹{d.ticketAmountFromImages || '—'}</td>
                                  <td
                                    style={{
                                      padding: 6,
                                      color:
                                        d.manualMatchesImages === true
                                          ? '#3fb950'
                                          : d.manualMatchesImages === false
                                            ? '#f85149'
                                            : '#8b949e',
                                    }}
                                  >
                                    {d.manualMatchesImages === true
                                      ? 'OK'
                                      : d.manualMatchesImages === false
                                        ? 'Mismatch'
                                        : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr
                                style={{
                                  borderTop: '2px solid var(--accent-primary)',
                                  fontWeight: 700,
                                  background: 'rgba(88,166,255,0.08)',
                                }}
                              >
                                <td style={{ padding: 8 }}>TOTAL</td>
                                <td style={{ padding: 8 }}>₹{dt.travel}</td>
                                <td style={{ padding: 8 }}>₹{dt.local}</td>
                                <td style={{ padding: 8 }}>
                                  ₹{dt.petrol || dt.petrolCalc || '—'}
                                  {dt.petrolCalc > 0 && dt.petrol > 0 && (
                                    <span
                                      style={{
                                        display: 'block',
                                        fontSize: '0.68rem',
                                        color: petrolCalcOk ? '#3fb950' : '#f85149',
                                        fontWeight: 500,
                                      }}
                                    >
                                      calc ₹{dt.petrolCalc}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: 8 }}>₹{dt.stay}</td>
                                <td style={{ padding: 8 }}>₹{dt.grand}</td>
                                <td style={{ padding: 8 }}>
                                  ₹{dt.fromTickets > 0 ? dt.fromTickets : '—'}
                                </td>
                                <td style={{ padding: 8 }}>—</td>
                              </tr>
                            </tfoot>
                          </table>
                          <div
                            style={{
                              marginTop: 10,
                              padding: '8px 10px',
                              borderRadius: 6,
                              background: 'rgba(88,166,255,0.06)',
                              fontSize: '0.75rem',
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 12,
                            }}
                          >
                            <span>
                              Travel + Local total:{' '}
                              <strong style={{ color: travelLocalOk ? '#3fb950' : '#f85149' }}>
                                ₹{dt.travelLocal}
                              </strong>
                              {' '}(header Tickets+Local ₹{headerTravelLocal})
                            </span>
                            <span>
                              Petrol total:{' '}
                              <strong style={{ color: petrolOk ? '#3fb950' : '#f85149' }}>
                                ₹{dt.petrol || dt.petrolCalc || 0}
                              </strong>
                              {' '}(header Fuel ₹{headerFuel})
                              {dt.petrolCalc > 0 && (
                                <span style={{ color: petrolCalcOk ? '#3fb950' : '#f85149' }}>
                                  {' '}
                                  · km calc ₹{dt.petrolCalc}
                                </span>
                              )}
                            </span>
                            <span>
                              Stay total:{' '}
                              <strong style={{ color: stayOk ? '#3fb950' : '#f85149' }}>
                                ₹{dt.stay}
                              </strong>
                              {' '}(header ₹{headerStay})
                            </span>
                            <span>
                              Grand total (all dates): <strong>₹{dt.grand}</strong>
                            </span>
                            <span>
                              Travel+Local + Fuel + Stay:{' '}
                              <strong
                                style={{
                                  color:
                                    Math.abs(combinedSum - combinedCheck) <= 50
                                      ? '#3fb950'
                                      : '#f85149',
                                }}
                              >
                                ₹{combinedSum}
                              </strong>
                              {' '}(reconciliation ₹{combinedCheck})
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: '0.78rem' }}>
                  {result.flags.map((f, i) => (
                    <li key={i} style={{ color: severityColor(f.severity), marginBottom: 4 }}>
                      {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
