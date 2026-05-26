import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, Loader2 } from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';
import SheetLinkUpload from './SheetLinkUpload';
import ClaimFlagCard from './ClaimFlagCard';
import { fetchAllowanceSheets } from '../utils/allowanceParser';
import {
  verifyAllowanceClaims,
  buildVerificationPayloadForAI,
} from '../utils/claimVerifier';
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
  const [filterStatus, setFilterStatus] = useState('flag');
  const [syncError, setSyncError] = useState('');

  const handleAllowanceSync = async () => {
    if (!allowanceSpreadsheetUrl.trim()) return;
    setIsFetching(true);
    setAiReport('');
    setSyncError('');
    try {
      const result = await fetchAllowanceSheets(allowanceSpreadsheetUrl.trim());
      setAllowanceClaims(result.claims);
      setAllowanceSheetSummary(result.sheetSummary);
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
        <h1 style={{ margin: 0, fontSize: '1.35rem' }}>Allowance Audit</h1>
      </div>

      <SheetLinkUpload
        title="Allowance sheet"
        url={allowanceSpreadsheetUrl}
        onUrlChange={(v) => {
          setAllowanceSpreadsheetUrl(v);
          setSyncError('');
        }}
        onSync={handleAllowanceSync}
        isLoading={isFetching}
        loadedCount={allowanceSheetSummary.filter((s) => s.status === 'loaded').length}
        totalSheets={allowanceSheetSummary.length}
        syncLabel="Sync"
      />

      {syncError && (
        <p style={{ color: '#f85149', fontSize: '0.85rem', marginBottom: '1rem' }}>{syncError}</p>
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
            {['flag', 'pass', 'all'].map((f) => (
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
              AI review
            </button>
          </div>

          {filteredResults.length === 0 ? (
            <div className="glass-card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No rows in this filter.
            </div>
          ) : (
            filteredResults.map((row) => <ClaimFlagCard key={row.id} result={row} />)
          )}

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
