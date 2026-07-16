import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';

/**
 * Global Hard Refresh — re-fetches every live-link section (PJP + Expense)
 * from its saved link right now and rebuilds every dashboard in-app, with no
 * manual browser refresh required.
 */
const HardRefreshButton = () => {
  const { hardRefresh, hardRefreshStatus } = useAuditData();
  const busy = hardRefreshStatus?.running;

  const handleClick = () => {
    if (busy) return;
    const ok = window.confirm(
      'Hard Refresh will clear browser + server caches, then rebuild PJP and Expense ' +
        'from saved links (data sync only — open Expense and Fetch to re-run bill OCR). Continue?',
    );
    if (!ok) return;
    hardRefresh();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title="Hard Refresh — clear all caches and rebuild every dashboard"
      aria-label="Hard Refresh"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-main)',
        background: 'var(--bg-secondary)',
        color: 'var(--accent-primary)',
        cursor: busy ? 'not-allowed' : 'pointer',
        fontSize: '0.72rem',
        fontWeight: 700,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <RefreshCw size={14} className={busy ? 'spin' : undefined} />
      {busy ? 'Refreshing…' : 'Hard Refresh'}
    </button>
  );
};

export default HardRefreshButton;
