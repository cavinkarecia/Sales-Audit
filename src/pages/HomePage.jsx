import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Loader2, Users, MapPin, Route, ChevronRight } from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';
import { parseAttendanceExcel } from '../utils/ExcelParser';
import { fetchAllSheets } from '../utils/sheetFetcher';
import SheetLinkUpload from '../components/SheetLinkUpload';
import AttendanceMap from '../components/AttendanceMap';
const HomePage = () => {
  const {
    attendanceRecords,
    setAttendanceRecords,
    pjpRecords,
    setPjpRecords,
    pjpSheetSummary,
    setPjpSheetSummary,
    pjpSpreadsheetUrl,
    setPjpSpreadsheetUrl,
  } = useAuditData();

  const [isParsing, setIsParsing] = useState(false);
  const [isFetchingPjp, setIsFetchingPjp] = useState(false);
  const fileInputRef = useRef(null);

  const handleAttendanceUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsParsing(true);
    try {
      const data = await parseAttendanceExcel(file);
      setAttendanceRecords(data);
      alert(`Loaded ${data.length} attendance rows (latest entry per auditor per day).`);
    } catch (err) {
      alert(`Attendance parse failed: ${err.message}`);
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePjpSync = async () => {
    if (!pjpSpreadsheetUrl.trim()) return;
    setIsFetchingPjp(true);
    try {
      const result = await fetchAllSheets(pjpSpreadsheetUrl.trim());
      setPjpRecords(result.records);
      setPjpSheetSummary(result.sheetSummary);
      alert(
        `PJP: loaded ${result.totalLoadedSheets} of ${result.totalSheets} auditor sheets (${result.totalRecords} travel rows).`,
      );
    } catch (err) {
      alert(`PJP sync failed: ${err.message}`);
    } finally {
      setIsFetchingPjp(false);
    }
  };

  const stats = useMemo(() => {
    if (!attendanceRecords.length) return null;
    const present = attendanceRecords.filter((r) => r.isPresent).length;
    const unique = new Set(attendanceRecords.map((r) => r.name)).size;
    return {
      total: attendanceRecords.length,
      unique,
      present,
      rate: Math.round((present / attendanceRecords.length) * 100),
    };
  }, [attendanceRecords]);

  const pjpPreview = useMemo(() => pjpRecords.slice(0, 12), [pjpRecords]);

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Field Intelligence — Attendance & PJP</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 6 }}>
          Upload attendance (GoSurvey) and sync PJP travel sheets. Then verify allowance claims on the{' '}
          <Link to="/allowance" style={{ color: 'var(--accent-primary)' }}>
            Allowance Audit
          </Link>{' '}
          page.
        </p>
      </header>

      {/* 1 — Attendance */}
      <div className="glass-card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>1. Auditors attendance upload</h3>
        <p style={{ margin: '0 0 12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Maps: <strong>Choose Your Name</strong> → auditor, <strong>Location</strong> → lat/long,{' '}
          <strong>Are You on field Today?</strong> → Yes = present. Duplicate rows on the same date use the{' '}
          <em>latest</em> submission (e.g. morning Yes, later No → marked absent).
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={handleAttendanceUpload}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isParsing}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 8,
            border: '1px solid var(--border-main)',
            background: 'var(--accent-primary)',
            color: '#fff',
            cursor: isParsing ? 'wait' : 'pointer',
            fontWeight: 600,
            fontSize: '0.8rem',
          }}
        >
          {isParsing ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
          {isParsing ? 'Processing…' : 'Upload attendance Excel / CSV'}
        </button>
        {stats && (
          <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
            <span>
              <Users size={14} /> {stats.unique} auditors
            </span>
            <span>
              {stats.present} / {stats.total} present ({stats.rate}%)
            </span>
          </div>
        )}
      </div>

      {/* 2 — PJP */}
      <SheetLinkUpload
        title="2. Auditors PJP upload (From, To, Kms…)"
        description="Paste the public Google Sheet with one tab per auditor. All sheets are fetched automatically."
        url={pjpSpreadsheetUrl}
        onUrlChange={setPjpSpreadsheetUrl}
        onSync={handlePjpSync}
        isLoading={isFetchingPjp}
        loadedCount={pjpSheetSummary.filter((s) => s.status === 'loaded').length}
        totalSheets={pjpSheetSummary.length}
      />

      {attendanceRecords.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={16} /> Step 1 — Attendance locations (latest per day)
          </h3>
          <AttendanceMap records={attendanceRecords} />
        </div>
      )}

      {pjpSheetSummary.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.85rem' }}>
            PJP sync — {pjpSheetSummary.filter((s) => s.status === 'loaded').length} of{' '}
            {pjpSheetSummary.length} auditor sheets loaded
          </h3>
          <div style={{ maxHeight: 160, overflow: 'auto', fontSize: '0.72rem' }}>
            {pjpSheetSummary.map((s) => (
              <div key={s.sheetName} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-main)' }}>
                <strong>{s.sheetName}</strong> — {s.employeeName || '—'} ({s.recordCount} rows){' '}
                <span style={{ color: s.status === 'loaded' ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pjpRecords.length > 0 && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Route size={16} /> Step 2 — PJP preview (from → to, kms)
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Auditor</th>
                  <th style={{ padding: 8 }}>Date</th>
                  <th style={{ padding: 8 }}>From</th>
                  <th style={{ padding: 8 }}>To</th>
                  <th style={{ padding: 8 }}>Kms</th>
                  <th style={{ padding: 8 }}>Sheet</th>
                </tr>
              </thead>
              <tbody>
                {pjpPreview.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-main)' }}>
                    <td style={{ padding: 8 }}>{r.employeeName}</td>
                    <td style={{ padding: 8 }}>{r.date}</td>
                    <td style={{ padding: 8 }}>{r.fromTown || '—'}</td>
                    <td style={{ padding: 8 }}>{r.toTown || '—'}</td>
                    <td style={{ padding: 8 }}>{r.kms || '—'}</td>
                    <td style={{ padding: 8 }}>{r.sheetName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pjpRecords.length > 12 && (
            <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 8 }}>
              Showing 12 of {pjpRecords.length} rows
            </p>
          )}
        </div>
      )}

      <Link
        to="/allowance"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 20px',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: '#fff',
          borderRadius: 8,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: '0.85rem',
        }}
      >
        Continue to Allowance & claim audit <ChevronRight size={16} />
      </Link>
    </div>
  );
};

export default HomePage;
