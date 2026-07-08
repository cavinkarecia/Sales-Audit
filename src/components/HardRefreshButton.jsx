import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { requestHardRefresh } from '../utils/auditStorage.js';

/**
 * Global Hard Refresh — flags every live-link section for a fresh re-fetch,
 * drops derived caches, then reloads so the whole app rebuilds from scratch
 * using only the currently uploaded datasets. No manual browser refresh needed.
 */
const HardRefreshButton = () => {
  const [busy, setBusy] = useState(false);

  const handleClick = () => {
    if (busy) return;
    const ok = window.confirm(
      'Hard Refresh will clear all cached results and rebuild every dashboard from the ' +
        'currently uploaded files and links. Continue?',
    );
    if (!ok) return;
    setBusy(true);
    requestHardRefresh();
    window.location.reload();
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
      Hard Refresh
    </button>
  );
};

export default HardRefreshButton;
