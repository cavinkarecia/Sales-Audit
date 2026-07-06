import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, Loader2, Users } from 'lucide-react';
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
  fmtRs,
  diffLabel,
  near,
  TOL,
  getAuditorColumnFlags,
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
  if (d.splitType === 'da') return 'DA only';
  return '—';
};

const isMismatch = (a, b, tol = 10) => !near(a, b, tol);

const DateWiseSplitTable = ({ dateResults, amounts }) => {
  const totals = sumDaySplits(dateResults);
  const ticketsHeader = amounts?.header?.ticketsLocal || 0;
  const showConveyance = dateResults.some((d) => (d.conveyance || 0) > 0);
  const showCash = dateResults.some((d) => (d.cash || 0) > 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      <p style={{ margin: '0 0 8px', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
        <strong>Travel</strong> = bus/train ticket · <strong>Local</strong> = local allowance ·{' '}
        {showConveyance && <><strong>Conveyance</strong> = local transport · </>}
        {showCash && <><strong>Cash</strong> = cash expenses (in Tickets+Local) · </>}
        <strong>Petrol</strong> = fuel (km × ₹4 one-way, × ₹8 round trip) · <strong>Stay</strong> = accommodation ·{' '}
        <strong>Day total</strong> = all columns for that date
      </p>
      <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(88,166,255,0.1)', color: 'var(--text-secondary)', textAlign: 'left' }}>
            <th style={{ padding: 6 }}>#</th>
            <th style={{ padding: 6 }}>Date</th>
            <th style={{ padding: 6 }}>Travel (tickets)</th>
            <th style={{ padding: 6 }}>Local allowance</th>
            {showConveyance && <th style={{ padding: 6 }}>Conveyance</th>}
            {showCash && <th style={{ padding: 6 }}>Cash</th>}
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
                {showConveyance && <td style={{ padding: 6 }}>{fmtRs(a.conveyance)}</td>}
                {showCash && <td style={{ padding: 6 }}>{fmtRs(a.cash)}</td>}
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
            {showConveyance && <td style={{ padding: 8 }}>{fmtRs(totals.conveyance)}</td>}
            {showCash && <td style={{ padding: 8 }}>{fmtRs(totals.cash)}</td>}
            <td style={{ padding: 8 }}>{fmtRs(totals.petrol)}</td>
            <td style={{ padding: 8 }}>{fmtRs(totals.stay)}</td>
            <td style={{ padding: 8, color: '#58a6ff' }}>{fmtRs(totals.daySplitTotal)}</td>
            <td colSpan={2} style={{ padding: 8 }} />
          </tr>
          <tr style={{ background: 'rgba(88,166,255,0.04)', fontSize: '0.68rem' }}>
            <td colSpan={9 + (showConveyance ? 1 : 0) + (showCash ? 1 : 0)} style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
              <strong>Page totals from dates:</strong>{' '}
              Fuel {fmtRs(amounts?.fromDates?.fuel ?? totals.petrol)} ·{' '}
              {showConveyance && <>Conveyance {fmtRs(amounts?.fromDates?.conveyance ?? totals.conveyance)} · </>}
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
  vouchers.forEach((v) => map.set(v.sheetName, v));
  return map;
};

const dropdownPanelStyle = {
  position: 'fixed',
  zIndex: 10000,
  minWidth: '260px',
  maxHeight: '320px',
  overflowY: 'auto',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-main)',
  borderRadius: '8px',
  boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
  padding: '8px',
};

const selectAllBtnStyle = {
  flex: 1,
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid var(--accent-primary)',
  background: 'rgba(88, 166, 255, 0.12)',
  color: 'var(--accent-primary)',
  fontSize: '0.72rem',
  fontWeight: '700',
  cursor: 'pointer',
};

const unselectAllBtnStyle = {
  flex: 1,
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border-main)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: '0.72rem',
  fontWeight: '700',
  cursor: 'pointer',
};

const filterSelectRowStyle = {
  display: 'flex',
  gap: '6px',
  marginBottom: '8px',
};

const FilterDropdown = ({ label, summary, icon, isOpen, onToggle, onClose, children, minWidth = 220 }) => {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: minWidth });
  const rafRef = useRef(0);

  const updatePanelPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelPos({
      top: rect.bottom + 6,
      left: rect.left,
      width: Math.max(rect.width, minWidth),
    });
  }, [minWidth]);

  const schedulePanelPos = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updatePanelPos);
  }, [updatePanelPos]);

  useEffect(() => {
    if (!isOpen) return undefined;
    updatePanelPos();
    window.addEventListener('scroll', schedulePanelPos, true);
    window.addEventListener('resize', schedulePanelPos);
    return () => {
      window.removeEventListener('scroll', schedulePanelPos, true);
      window.removeEventListener('resize', schedulePanelPos);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, updatePanelPos, schedulePanelPos]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onDocClick = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isOpen, onClose]);

  const ChevronIcon = isOpen ? ChevronUp : ChevronDown;

  const panel =
    isOpen &&
    createPortal(
      <div
        ref={panelRef}
        style={{
          ...dropdownPanelStyle,
          top: panelPos.top,
          left: panelPos.left,
          minWidth: panelPos.width,
        }}
      >
        {children}
      </div>,
      document.body,
    );

  return (
    <div ref={triggerRef} style={{ position: 'relative', minWidth }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          background: 'var(--bg-secondary)',
          color: '#fff',
          border: '1px solid var(--border-main)',
          padding: '7px 12px',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '0.78rem',
          textAlign: 'left',
        }}
      >
        {icon}
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{label}</span>
          <span style={{ fontWeight: '600' }}>{summary}</span>
        </span>
        <ChevronIcon size={14} style={{ marginLeft: 'auto', opacity: 0.85, flexShrink: 0 }} />
      </button>
      {panel}
    </div>
  );
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
  const cols = getAuditorColumnFlags(voucher);
  const activeCols = [
    cols.fuel && { key: 'fuel', label: 'Fuel', header: header.fuel, dates: fromDates.fuel, ok: checks.fuelOk },
    cols.conveyance && {
      key: 'conveyance',
      label: 'Conveyance',
      header: 0,
      dates: fromDates.conveyance,
      ok: true,
    },
    cols.ticketsLocal && {
      key: 'ticketsLocal',
      label: 'Tickets + Local',
      header: header.ticketsLocal,
      dates: fromDates.ticketsLocal,
      ok: checks.ticketsOk,
    },
    cols.stay && { key: 'stay', label: 'Stay', header: header.stay, dates: fromDates.stay, ok: checks.stayOk },
  ].filter(Boolean);

  if (!activeCols.length) {
    activeCols.push({
      key: 'ticketsLocal',
      label: 'Tickets + Local',
      header: header.ticketsLocal,
      dates: fromDates.ticketsLocal,
      ok: checks.ticketsOk,
    });
  }

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
            {activeCols.map((col) => (
              <th key={col.key} style={thStyle}>{col.label}</th>
            ))}
            <th style={{ ...thStyle, fontWeight: 800 }}>Grand total</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid var(--border-main)' }}>
            <td style={labelStyle}>1. Auditor entered (sheet header)</td>
            {activeCols.map((col) => (
              <td key={col.key} style={amtStyle}>
                <SplitAmount amount={col.header} />
              </td>
            ))}
            <td style={amtStyle}><SplitAmount amount={declaredUsed} /></td>
          </tr>
          <tr style={{ borderBottom: '1px solid var(--border-main)' }}>
            <td style={labelStyle}>2. Sum of all date rows</td>
            {activeCols.map((col) => (
              <td key={col.key} style={amtStyle}>
                <SplitAmount amount={col.dates} match={col.ok} />
              </td>
            ))}
            <td style={amtStyle}><SplitAmount amount={fromDates.grand} match={checks.grandOk} /></td>
          </tr>
          <tr>
            <td style={labelStyle}>3. Header parts check (Fuel + Tickets + Stay)</td>
            <td colSpan={Math.max(1, activeCols.length)} style={{ ...amtStyle, textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
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

const collectAuditorMistakes = (result, tabAudit) => {
  const amounts = computeAuditorAmounts(result.voucher);
  const items = [];

  const add = (severity, message) => {
    const msg = String(message || '').trim();
    if (!msg || items.some((i) => i.message === msg)) return;
    items.push({ severity, message: msg });
  };

  // Page-level total mismatches only (declared vs header vs date sums)
  amounts.issues.forEach((issue) => add(issue.severity, issue.message));

  (tabAudit?.headerIssues || []).forEach((h) => {
    if (!amounts.issues.some((i) => i.message === h.message)) {
      add('red', h.message);
    }
  });

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
  const [selectedAuditorIds, setSelectedAuditorIds] = useState(() => new Set());
  const [auditorFilterOpen, setAuditorFilterOpen] = useState(false);
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

  const auditorOptions = useMemo(() => {
    if (!verification?.results?.length) return [];
    return verification.results
      .map((r) => ({
        id: r.id,
        name: r.voucher.auditorName || r.voucher.sheetName,
        sheetName: r.voucher.sheetName,
        status: r.summary.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [verification]);

  const auditorIdsKey = useMemo(
    () => auditorOptions.map((a) => a.id).join('\0'),
    [auditorOptions],
  );

  useEffect(() => {
    if (!auditorOptions.length) {
      setSelectedAuditorIds(new Set());
      return;
    }
    setSelectedAuditorIds(new Set(auditorOptions.map((a) => a.id)));
  }, [auditorIdsKey, auditorOptions]);

  const auditorFilterSummary = useMemo(() => {
    if (!auditorOptions.length) return 'No auditors loaded';
    if (selectedAuditorIds.size === 0) return 'None selected';
    if (selectedAuditorIds.size === auditorOptions.length) {
      return `All ${auditorOptions.length} auditors`;
    }
    return `${selectedAuditorIds.size} of ${auditorOptions.length} selected`;
  }, [auditorOptions, selectedAuditorIds]);

  const toggleAuditorSelection = (id) => {
    setSelectedAuditorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllAuditors = () => {
    setSelectedAuditorIds(new Set(auditorOptions.map((a) => a.id)));
  };

  const unselectAllAuditors = () => {
    setSelectedAuditorIds(new Set());
  };

  const filtered = useMemo(() => {
    if (!verification) return [];
    let rows = verification.results;
    if (filter !== 'all') {
      rows = rows.filter((r) => r.summary.status === filter);
    }
    if (selectedAuditorIds.size > 0) {
      rows = rows.filter((r) => selectedAuditorIds.has(r.id));
    } else {
      rows = [];
    }
    return rows;
  }, [verification, filter, selectedAuditorIds]);

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

          <div
            className="glass-card"
            style={{
              padding: '12px 16px',
              marginBottom: '1rem',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
              Filter
            </div>
            <FilterDropdown
              label="Auditors"
              summary={auditorFilterSummary}
              icon={<Users size={14} color="var(--accent-primary)" />}
              isOpen={auditorFilterOpen}
              onToggle={() => setAuditorFilterOpen((v) => !v)}
              onClose={() => setAuditorFilterOpen(false)}
              minWidth={300}
            >
              <div style={filterSelectRowStyle}>
                <button type="button" onClick={selectAllAuditors} style={selectAllBtnStyle}>
                  Select all
                </button>
                <button type="button" onClick={unselectAllAuditors} style={unselectAllBtnStyle}>
                  Unselect all
                </button>
              </div>
              {auditorOptions.map((a) => (
                <label
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.78rem',
                    padding: '5px 6px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: selectedAuditorIds.has(a.id) ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedAuditorIds.has(a.id)}
                    onChange={() => toggleAuditorSelection(a.id)}
                  />
                  <span style={{ flex: 1 }}>{a.name}</span>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      textTransform: 'uppercase',
                      color:
                        a.status === 'pass' ? '#3fb950' : a.status === 'review' ? '#d29922' : '#f85149',
                    }}
                  >
                    {a.status}
                  </span>
                </label>
              ))}
            </FilterDropdown>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              Showing {filtered.length} of {verification.results.length} auditor card(s)
            </span>
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
            {!filtered.length && (
              <div
                className="glass-card"
                style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}
              >
                No auditors match the current filters. Use <strong>Select all</strong> in the auditor filter or change the status filter.
              </div>
            )}
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
