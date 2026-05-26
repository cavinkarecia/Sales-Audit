import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  AlertTriangle,
  MapPin,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';
import SheetLinkUpload from './SheetLinkUpload';
import ClaimFlagCard from './ClaimFlagCard';
import { fetchAllowanceSheets } from '../utils/allowanceParser';
import {
  verifyAllowanceClaims,
  buildVerificationPayloadForAI,
} from '../utils/claimVerifier';
import { verifyClaimsWithAI } from '../utils/deepseekAgent';
import AttendanceMap from './AttendanceMap';
import PjpRouteMap from './PjpRouteMap';
import { namesMatch } from '../utils/nameMatcher';

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
    hasAttendance,
    hasPjp,
  } = useAuditData();

  const [isFetching, setIsFetching] = useState(false);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [aiReport, setAiReport] = useState('');
  const [filterStatus, setFilterStatus] = useState('flag');
  const [selectedAuditor, setSelectedAuditor] = useState('');
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
      const failed = result.sheetSummary.filter((s) => s.status !== 'loaded');
      if (failed.length > 0 && result.totalRecords > 0) {
        setSyncError(
          `Loaded ${result.totalRecords} rows. ${failed.length} tab(s) skipped — expand sheet summary below.`,
        );
      }
    } catch (err) {
      console.error(err);
      setSyncError(err.message || 'Allowance sync failed');
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

  const auditorOptions = useMemo(() => {
    const names = new Set(allowanceClaims.map((c) => c.employeeName).filter(Boolean));
    return Array.from(names).sort();
  }, [allowanceClaims]);

  const pjpLegsForMap = useMemo(() => {
    if (!pjpRecords.length) return [];
    if (!selectedAuditor) return pjpRecords.slice(0, 30);
    return pjpRecords.filter((r) => namesMatch(r.employeeName, selectedAuditor));
  }, [pjpRecords, selectedAuditor]);

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
      alert(`AI verification failed: ${err.message}`);
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
          <ArrowLeft size={16} /> Attendance & PJP
        </Link>
        <h1 style={{ margin: 0, fontSize: '1.35rem' }}>Allowance & Claim Audit</h1>
      </div>

      {(!hasAttendance || !hasPjp) && (
        <div
          className="glass-card"
          style={{
            padding: '1rem',
            marginBottom: '1rem',
            borderLeft: '4px solid var(--accent-danger)',
            fontSize: '0.85rem',
          }}
        >
          <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Upload <strong>Attendance</strong> on the Full Dashboard and sync <strong>PJP</strong> on the
          Uploads page first. Claim checks cross-reference both datasets.
        </div>
      )}

      <SheetLinkUpload
        title="2. Allowance Sheet upload"
        description='Single consolidated claim sheet (all auditors in rows). Each claim is checked against that auditor’s footprint from Attendance GPS + PJP — not parsed like PJP tabs. Share: Anyone with the link → Viewer.'
        url={allowanceSpreadsheetUrl}
        onUrlChange={(v) => {
          setAllowanceSpreadsheetUrl(v);
          setSyncError('');
        }}
        onSync={handleAllowanceSync}
        isLoading={isFetching}
        loadedCount={allowanceSheetSummary.filter((s) => s.status === 'loaded').length}
        totalSheets={allowanceSheetSummary.length}
      />

      {syncError && (
        <div
          className="glass-card"
          style={{
            padding: '1rem',
            marginBottom: '1rem',
            borderLeft: '4px solid var(--accent-danger)',
            fontSize: '0.85rem',
            color: '#f85149',
          }}
        >
          <strong>Allowance sync failed</strong>
          <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)' }}>{syncError}</p>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            <li>Use the browser address bar URL: <code>docs.google.com/spreadsheets/d/…/edit</code></li>
            <li>Sharing: Anyone with the link → Viewer</li>
            <li>Sheet must contain Date, Name/Auditor, and route or amount columns</li>
          </ul>
        </div>
      )}

      {allowanceSheetSummary.length > 0 && (
        <details className="glass-card" style={{ padding: '1rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Sheet tabs ({allowanceSheetSummary.filter((s) => s.status === 'loaded').length}/
            {allowanceSheetSummary.length} loaded)
          </summary>
          <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                <th style={{ padding: 6 }}>Tab</th>
                <th style={{ padding: 6 }}>Layout</th>
                <th style={{ padding: 6 }}>Status</th>
                <th style={{ padding: 6 }}>Rows</th>
                <th style={{ padding: 6 }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {allowanceSheetSummary.map((s) => (
                <tr key={s.sheetName} style={{ borderTop: '1px solid var(--border-main)' }}>
                  <td style={{ padding: 6 }}>{s.sheetName}</td>
                  <td style={{ padding: 6 }}>{s.layout || '—'}</td>
                  <td style={{ padding: 6 }}>{s.status}</td>
                  <td style={{ padding: 6 }}>{s.recordCount ?? 0}</td>
                  <td style={{ padding: 6, color: 'var(--text-secondary)' }}>
                    {s.reason || (s.headers?.slice(0, 5).join(', ') ?? '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
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
              { label: 'Claims checked', value: verification.summary.total },
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
              AI Agent — Review flagged claims
            </button>
          </div>

          {attendanceRecords.length > 0 && (
            <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <MapPin size={16} /> Step 1 — Attendance GPS (latest entry per day)
              </h3>
              <AttendanceMap records={attendanceRecords} height="320px" />
            </div>
          )}

          {pjpRecords.length > 0 && (
            <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Step 2 — PJP routes (from → to, kms)</h3>
              {auditorOptions.length > 0 && (
                <select
                  value={selectedAuditor}
                  onChange={(e) => setSelectedAuditor(e.target.value)}
                  style={{
                    marginBottom: 10,
                    background: 'var(--bg-secondary)',
                    color: '#fff',
                    border: '1px solid var(--border-main)',
                    padding: '6px 10px',
                    borderRadius: 6,
                    fontSize: '0.8rem',
                  }}
                >
                  <option value="">All auditors (sample)</option>
                  {auditorOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
              <PjpRouteMap pjpLegs={pjpLegsForMap} height="280px" />
            </div>
          )}

          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>
              Allowance vs auditor footprint — flagged claims
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              Compares each allowance row to where the auditor actually was (attendance GPS + PJP route), not
              to the allowance sheet layout. Flags include footprint mismatch, petrol ₹4/₹8 per km, and bus
              without PJP.
            </p>
            {filteredResults.length === 0 ? (
              <div className="glass-card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No claims in this filter.
              </div>
            ) : (
              filteredResults.map((row) => <ClaimFlagCard key={row.id} result={row} />)
            )}
          </div>

          {aiReport && (
            <div
              className="glass-card"
              style={{
                padding: '1.25rem',
                borderLeft: '4px solid #8b5cf6',
                whiteSpace: 'pre-wrap',
                fontSize: '0.85rem',
                lineHeight: 1.6,
              }}
            >
              <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bot size={18} /> AI Claim Audit Report
              </h3>
              {aiReport}
            </div>
          )}
        </>
      )}

      {!allowanceClaims.length && !syncError && (
        <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
          <FileSpreadsheet size={40} style={{ opacity: 0.4, marginBottom: 12 }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Upload the allowance spreadsheet link above to verify petrol & bus claims against attendance
            GPS and PJP routes.
          </p>
        </div>
      )}
    </div>
  );
};

export default AllowanceAuditPage;
