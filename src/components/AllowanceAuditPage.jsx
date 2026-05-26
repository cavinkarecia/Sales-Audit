import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';
import SheetLinkUpload from './SheetLinkUpload';
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
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedAuditor, setSelectedAuditor] = useState('');

  const handleAllowanceSync = async () => {
    if (!allowanceSpreadsheetUrl.trim()) return;
    setIsFetching(true);
    setAiReport('');
    try {
      const result = await fetchAllowanceSheets(allowanceSpreadsheetUrl.trim());
      setAllowanceClaims(result.claims);
      setAllowanceSheetSummary(result.sheetSummary);
      alert(
        `Loaded ${result.totalRecords} allowance rows from ${result.totalSheets} sheet(s).`,
      );
    } catch (err) {
      console.error(err);
      alert(`Allowance sync failed: ${err.message}`);
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
          Upload <strong>Attendance</strong> and <strong>PJP</strong> on the main dashboard first. Claim
          checks cross-reference both datasets.
        </div>
      )}

      <SheetLinkUpload
        title="3. Allowance Sheet upload"
        description="Paste the public Google Spreadsheet link for travel/petrol/bus claims. All sheets (tabs) are fetched automatically — one per auditor when structured that way."
        url={allowanceSpreadsheetUrl}
        onUrlChange={setAllowanceSpreadsheetUrl}
        onSync={handleAllowanceSync}
        isLoading={isFetching}
        loadedCount={allowanceSheetSummary.filter((s) => s.status === 'loaded').length}
        totalSheets={allowanceSheetSummary.length}
      />

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
            {['all', 'pass', 'flag'].map((f) => (
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
                {f}
              </button>
            ))}
            <button
              type="button"
              onClick={handleAiVerify}
              disabled={isAiRunning}
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
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                Locations from &quot;Choose Your Name&quot; + Location (lat/long). Latest row wins when duplicated on the same date.
              </p>
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

          <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>
              Steps 3–4 — Allowance claims vs PJP & attendance (₹4/km one-way, ₹8/km round trip)
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: 8 }}>Status</th>
                    <th style={{ padding: 8 }}>Auditor</th>
                    <th style={{ padding: 8 }}>Date</th>
                    <th style={{ padding: 8 }}>Claim From → To</th>
                    <th style={{ padding: 8 }}>Kms</th>
                    <th style={{ padding: 8 }}>Petrol ₹</th>
                    <th style={{ padding: 8 }}>Bus ₹</th>
                    <th style={{ padding: 8 }}>PJP match</th>
                    <th style={{ padding: 8 }}>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((row) => (
                    <tr
                      key={row.id}
                      style={{ borderTop: '1px solid var(--border-main)' }}
                    >
                      <td style={{ padding: 8 }}>
                        {row.status === 'pass' ? (
                          <CheckCircle2 size={16} color="var(--accent-success)" />
                        ) : (
                          <AlertTriangle size={16} color="var(--accent-danger)" />
                        )}
                      </td>
                      <td style={{ padding: 8 }}>{row.auditor}</td>
                      <td style={{ padding: 8 }}>{row.claim.date}</td>
                      <td style={{ padding: 8 }}>
                        {row.claim.fromTown || '—'} → {row.claim.toTown || '—'}
                        {row.claim.roundTrip && (
                          <span style={{ marginLeft: 4, fontSize: '0.65rem', opacity: 0.7 }}>
                            (round)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: 8 }}>{row.claim.kms || row.context.pjpTotalKms || '—'}</td>
                      <td style={{ padding: 8 }}>{row.claim.petrolAmount || '—'}</td>
                      <td style={{ padding: 8 }}>{row.claim.busAmount || '—'}</td>
                      <td style={{ padding: 8, maxWidth: 140 }}>
                        {row.context.pjpLegs.length
                          ? row.context.pjpLegs
                              .map((l) => `${l.from || '?'}→${l.to || '?'}`)
                              .join('; ')
                          : '—'}
                      </td>
                      <td style={{ padding: 8, color: 'var(--accent-danger)', maxWidth: 280 }}>
                        {row.issues.length ? row.issues.join(' ') : row.notes.join(' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

      {!allowanceClaims.length && (
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
