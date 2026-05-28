import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, Loader2 } from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';
import SheetLinkUpload from './SheetLinkUpload';
import { fetchAllowanceSheets } from '../utils/allowanceParser';
import { verifyAllowanceClaims, buildVerificationPayloadForAI } from '../utils/claimVerifier';
import { verifyClaimsWithAI } from '../utils/deepseekAgent';

const AllowanceAuditPage = () => {
  const {
    attendanceRecords,
    pjpRecords,
    allowanceClaims,
    setAllowanceClaims,
    allowanceSheetSummary,
    setAllowanceSheetSummary,
    allowanceSpreadsheetUrl,
    setAllowanceSpreadsheetUrl,
  } = useAuditData();

  const [isFetching, setIsFetching] = useState(false);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [aiReport, setAiReport] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [syncError, setSyncError] = useState('');

  const handleAllowanceSync = async () => {
    if (!allowanceSpreadsheetUrl.trim()) return;
    setIsFetching(true);
    setAiReport('');
    setSyncError('');
    try {
      const result = await fetchAllowanceSheets(allowanceSpreadsheetUrl.trim());
      setAllowanceClaims(result.claims);
      setAllowanceSheetSummary(result.sheetSummary || []);
    } catch (err) {
      console.error(err);
      setSyncError(err.message || 'Sync failed');
      setAllowanceClaims([]);
      setAllowanceSheetSummary([]);
    } finally {
      setIsFetching(false);
    }
  };

  const verification = useMemo(() => {
    if (!allowanceClaims.length) return null;
    return verifyAllowanceClaims(attendanceRecords, pjpRecords, allowanceClaims);
  }, [attendanceRecords, pjpRecords, allowanceClaims]);

  const filteredResults = useMemo(() => {
    if (!verification) return [];
    if (filterStatus === 'all') return verification.results;
    return verification.results.filter((r) => r.status === filterStatus);
  }, [verification, filterStatus]);

  const handleAiVerify = async () => {
    if (!verification) return;
    setIsAiRunning(true);
    setAiReport('');
    try {
      const payload = buildVerificationPayloadForAI(verification);
      const text = await verifyClaimsWithAI(payload);
      setAiReport(text);
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setIsAiRunning(false);
    }
  };

  const colorDot = (c) =>
    c === 'green' ? '#3fb950' : c === 'orange' ? '#d29922' : c === 'red' ? '#f85149' : '#8b949e';

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
        <h1 style={{ margin: 0, fontSize: '1.35rem' }}>Auditor Allowance Audit</h1>
      </div>

      <SheetLinkUpload
        title="Upload auditor allowance sheet"
        url={allowanceSpreadsheetUrl}
        onUrlChange={(v) => {
          setAllowanceSpreadsheetUrl(v);
          setSyncError('');
        }}
        onSync={handleAllowanceSync}
        isLoading={isFetching}
        loadedCount={allowanceSheetSummary.filter((s) => s.status === 'loaded').length}
        totalSheets={allowanceSheetSummary.length}
        syncLabel="Fetch all pages"
        loadingLabel="Fetching all pages…"
      />

      {syncError && (
        <p style={{ color: '#f85149', fontSize: '0.85rem', marginBottom: '1rem' }}>{syncError}</p>
      )}

      {allowanceSheetSummary.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>Fetched Spreadsheet Pages</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: 8 }}>Page</th>
                  <th style={{ padding: 8 }}>Layout</th>
                  <th style={{ padding: 8 }}>Rows</th>
                  <th style={{ padding: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {allowanceSheetSummary.map((s) => (
                  <tr key={s.sheetName} style={{ borderTop: '1px solid var(--border-main)' }}>
                    <td style={{ padding: 8 }}>{s.sheetName}</td>
                    <td style={{ padding: 8 }}>{s.layout || '—'}</td>
                    <td style={{ padding: 8 }}>{s.recordCount || 0}</td>
                    <td style={{ padding: 8 }}>{s.status}</td>
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: '1rem',
            }}
          >
            {[
              { label: 'Checked', value: verification.summary.total },
              { label: 'Passed', value: verification.summary.passed, color: 'var(--accent-success)' },
              { label: 'Flagged', value: verification.summary.flagged, color: 'var(--accent-danger)' },
              { label: 'Green Flag', value: verification.summary.green, color: '#3fb950' },
              { label: 'Orange Flag', value: verification.summary.orange, color: '#d29922' },
              { label: 'Red Flag', value: verification.summary.red, color: '#f85149' },
              { label: 'Reject Cases', value: verification.summary.reject, color: '#f85149' },
              {
                label: 'Pass rate',
                value: `${verification.summary.passRate}%`,
                color: 'var(--accent-primary)',
              },
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
            {['all', 'flag', 'pass'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterStatus(f)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid var(--border-main)',
                  background: filterStatus === f ? 'var(--accent-primary)' : 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  textTransform: 'capitalize',
                }}
              >
                {f === 'flag' ? `Flagged (${verification.summary.flagged})` : f}
              </button>
            ))}
            <button
              type="button"
              onClick={handleAiVerify}
              disabled={isAiRunning || verification.summary.flagged === 0}
              style={{
                marginLeft: 'auto',
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff',
                cursor: isAiRunning ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontWeight: 600,
                fontSize: '0.8rem',
                opacity: verification.summary.flagged === 0 ? 0.5 : 1,
              }}
            >
              {isAiRunning ? <Loader2 size={16} className="spin" /> : <Bot size={16} />}
              AI full analysis
            </button>
          </div>

          <div className="glass-card" style={{ padding: '1rem' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>Claim Review</h3>
            {filteredResults.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No rows in this filter.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: 8 }}>Auditor</th>
                      <th style={{ padding: 8 }}>Date</th>
                      <th style={{ padding: 8 }}>Attendance Flag</th>
                      <th style={{ padding: 8 }}>Claim</th>
                      <th style={{ padding: 8 }}>Expected Petrol</th>
                      <th style={{ padding: 8 }}>Evidence</th>
                      <th style={{ padding: 8 }}>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((row) => (
                      <tr key={row.id} style={{ borderTop: '1px solid var(--border-main)' }}>
                        <td style={{ padding: 8 }}>{row.auditor}</td>
                        <td style={{ padding: 8 }}>{row.claim.date}</td>
                        <td style={{ padding: 8 }}>
                          <span style={{ color: colorDot(row.attendanceColor), fontWeight: 700 }}>
                            {row.comparison.attendanceFlag.label}
                          </span>
                        </td>
                        <td style={{ padding: 8 }}>
                          {row.claim.fromTown || '—'} → {row.claim.toTown || '—'} | {row.claim.kms || 0} km | ₹
                          {row.claim.totalAmount || 0}
                        </td>
                        <td style={{ padding: 8 }}>
                          {row.comparison.petrolCheck.expected} ({row.claim.roundTrip ? 'round ×8' : 'one-way ×4'})
                        </td>
                        <td style={{ padding: 8 }}>
                          <div>Bus/Train: {row.claim.busBillImage ? 'Yes' : 'No'}</div>
                          <div>Petrol: {row.claim.petrolBillImage ? 'Yes' : 'No'}</div>
                          <div>Map: {row.claim.travelMapImage ? 'Yes' : 'No'}</div>
                        </td>
                        <td style={{ padding: 8, color: row.shouldReject ? '#f85149' : row.status === 'flag' ? '#d29922' : '#3fb950' }}>
                          {row.shouldReject ? 'Reject' : row.status === 'flag' ? 'Review' : 'Approve'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {aiReport && (
            <div
              className="glass-card"
              style={{
                padding: '1.25rem',
                marginTop: '1rem',
                borderLeft: '4px solid #8b5cf6',
                whiteSpace: 'pre-wrap',
                fontSize: '0.85rem',
                lineHeight: 1.6,
              }}
            >
              {aiReport}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AllowanceAuditPage;
