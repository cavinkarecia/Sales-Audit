import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

const DataBlock = ({ title, rows }) => (
  <div
    style={{
      background: 'rgba(0,0,0,0.25)',
      borderRadius: 8,
      padding: '10px 12px',
      fontSize: '0.75rem',
    }}
  >
    <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--accent-brand)' }}>{title}</div>
    {rows.map(([label, value]) => (
      <div
        key={label}
        style={{
          display: 'grid',
          gridTemplateColumns: '110px 1fr',
          gap: 8,
          marginBottom: 4,
          color: 'var(--text-secondary)',
        }}
      >
        <span>{label}</span>
        <span style={{ color: '#e6edf3' }}>{value}</span>
      </div>
    ))}
  </div>
);

const ClaimFlagCard = ({ result }) => {
  const [open, setOpen] = useState(result.status === 'flag');
  const { claim, comparison, flags, verdict, status } = result;
  const isFlag = status === 'flag';

  return (
    <div
      className="glass-card"
      style={{
        marginBottom: 12,
        border: `1px solid ${isFlag ? 'rgba(248,81,73,0.45)' : 'rgba(63,185,80,0.35)'}`,
        borderLeft: `4px solid ${isFlag ? 'var(--accent-danger)' : 'var(--accent-success)'}`,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {isFlag ? (
          <AlertTriangle size={20} color="var(--accent-danger)" />
        ) : (
          <CheckCircle2 size={20} color="var(--accent-success)" />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
            {result.auditor} · {claim.date}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            {claim.fromTown || '—'} → {claim.toTown || '—'}
            {claim.roundTrip ? ' (round trip)' : ''} · Sheet: {claim.sheetName}
          </div>
          {isFlag && (
            <div style={{ fontSize: '0.78rem', color: '#f85149', marginTop: 6 }}>{verdict}</div>
          )}
        </div>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          {isFlag && flags.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, marginBottom: 8, color: '#f85149' }}>
                WHY FLAGGED
              </div>
              {flags.map((f) => (
                <div
                  key={f.code}
                  style={{
                    background: 'rgba(248,81,73,0.08)',
                    border: '1px solid rgba(248,81,73,0.25)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{f.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    {f.detail}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            <DataBlock
              title="Step 1 — Attendance"
              rows={[
                ['Found', comparison.attendance.found ? 'Yes' : 'No'],
                ['On field', comparison.attendance.present === true ? 'Yes' : comparison.attendance.present === false ? 'No' : '—'],
                ['GPS', comparison.attendance.location],
                ['Near city', comparison.attendance.nearestCity],
              ]}
            />
            <DataBlock
              title="Step 2 — Auditor footprint (GPS + PJP)"
              rows={[
                ['Footprint found', comparison.footprint?.hasData ? 'Yes' : 'No'],
                ['Actual route', comparison.footprint?.routeSummary || '—'],
                ['Towns visited', comparison.footprint?.townsVisited || '—'],
                ['Attendance GPS', comparison.footprint?.gps || '—'],
                ['Claim vs footprint', comparison.footprint?.matchesClaim || '—'],
                ['Note', comparison.footprint?.detail || '—'],
              ]}
            />
            <DataBlock
              title="PJP legs (detail)"
              rows={[
                ['Found', comparison.pjp.found ? 'Yes' : 'No'],
                ['Route towns', comparison.pjp.towns],
                ['Total kms', String(comparison.pjp.totalKms)],
                ...(comparison.pjp.legs.length
                  ? comparison.pjp.legs.map((l, i) => [
                      `Leg ${i + 1}`,
                      `${l.from} → ${l.to} (${l.kms} km)`,
                    ])
                  : [['Legs', '—']]),
              ]}
            />
            <DataBlock
              title="Step 3 — Allowance claim"
              rows={[
                ['From → To', `${comparison.allowance.from} → ${comparison.allowance.to}`],
                ['Kms', String(comparison.allowance.kms)],
                ['Petrol', comparison.allowance.petrol],
                ['Bus', comparison.allowance.bus],
                ['Total', comparison.allowance.total],
                ['Round trip', comparison.allowance.roundTrip],
              ]}
            />
            <DataBlock
              title="Step 4 — Petrol check"
              rows={[
                ['Rate', `₹${comparison.petrolCheck.ratePerKm}/km`],
                ['Reference kms', String(comparison.petrolCheck.referenceKms)],
                ['Expected', comparison.petrolCheck.expected],
                ['Claimed', comparison.petrolCheck.claimed],
                [
                  'Match',
                  comparison.petrolCheck.match === true
                    ? 'Yes'
                    : comparison.petrolCheck.match === false
                      ? 'No'
                      : '—',
                ],
                ['GPS vs destination', comparison.gpsDistanceKm],
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ClaimFlagCard;
