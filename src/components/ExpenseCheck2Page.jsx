import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, Loader2 } from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';
import SheetLinkUpload from './SheetLinkUpload';
import { fetchAllExpenseVouchers } from '../utils/expenseVoucherParser';
import {
  verifyAllExpenseVouchers,
  buildExpenseAIPayload,
} from '../utils/expenseVerifier';
import { analyzeExpenseWithAI } from '../utils/deepseekAgent';

const severityColor = (s) =>
  s === 'red' ? '#f85149' : s === 'orange' ? '#d29922' : '#3fb950';

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

  const handleSync = async () => {
    if (!expenseSpreadsheetUrl.trim()) return;
    setIsFetching(true);
    setSyncError(null);
    setAiReport('');
    try {
      const result = await fetchAllExpenseVouchers(expenseSpreadsheetUrl.trim());
      setExpenseVouchers(result.vouchers);
      setExpenseSheetSummary(result.sheetSummary || []);
      setSyncError(result.syncError || null);
    } catch (err) {
      console.error(err);
      setSyncError(err.message || 'Sync failed');
      setExpenseVouchers([]);
      setExpenseSheetSummary([]);
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
      </div>

      <SheetLinkUpload
        title="Upload expense claim workbook"
        description="Paste the Google Sheet link — we fetch every auditor tab (one voucher per person). Share: Anyone with link → Viewer."
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

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 8,
                    marginTop: 12,
                    fontSize: '0.78rem',
                  }}
                >
                  <div>Fuel: ₹{result.voucher.fuelTotal}</div>
                  <div>Tickets+Local: ₹{result.voucher.ticketsTotal}</div>
                  <div>Stay: ₹{result.voucher.accommodationTotal}</div>
                  <div>Date-wise bus/train sum: ₹{result.voucher.dateWiseBusTrainSum}</div>
                </div>

                {result.dateResults.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <h4 style={{ fontSize: '0.8rem', margin: '0 0 8px' }}>Date-wise checks</h4>
                    <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                          <th style={{ padding: 6 }}>Date</th>
                          <th style={{ padding: 6 }}>Travel</th>
                          <th style={{ padding: 6 }}>Local</th>
                          <th style={{ padding: 6 }}>Grand total</th>
                          <th style={{ padding: 6 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.dateResults.map((d) => (
                          <tr key={d.date} style={{ borderTop: '1px solid var(--border-main)' }}>
                            <td style={{ padding: 6 }}>{d.date}</td>
                            <td style={{ padding: 6 }}>₹{d.travel}</td>
                            <td style={{ padding: 6 }}>₹{d.localConveyance}</td>
                            <td style={{ padding: 6 }}>₹{d.grandTotal}</td>
                            <td style={{ padding: 6, color: severityColor(d.status === 'ok' ? 'green' : d.status === 'review' ? 'orange' : 'red') }}>
                              {d.status}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
