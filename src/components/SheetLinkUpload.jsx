import React from 'react';
import { Link2, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';

const SheetLinkUpload = ({
  title,
  description,
  url,
  onUrlChange,
  onSync,
  isLoading,
  loadedCount = 0,
  totalSheets = 0,
  placeholder = 'https://docs.google.com/spreadsheets/d/.../edit?gid=0',
  syncLabel = 'Fetch all auditor sheets',
  loadingLabel = 'Fetching all sheets…',
  refreshTitle = 'Refresh data from the same link',
  hideActions = false,
}) => {
  const canRefresh = Boolean(url?.trim()) && !isLoading;
  const handleRefresh = () => {
    if (!canRefresh) return;
    onSync();
  };

  return (
  <div
    className="glass-card"
    style={{
      padding: '1rem 1.25rem',
      marginBottom: '1rem',
      border: '1px solid var(--border-main)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
      <Link2 size={18} style={{ color: 'var(--accent-primary)', marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{title}</h3>
        {description ? (
          <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {description}
          </p>
        ) : null}
      </div>
      {loadedCount > 0 && (
        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--accent-success)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <CheckCircle2 size={14} />
          {loadedCount} loaded{totalSheets > 0 ? ` / ${totalSheets} tabs` : ''}
        </span>
      )}
      {!hideActions && (
        <button
          type="button"
          onClick={handleRefresh}
          disabled={!canRefresh}
          title={refreshTitle}
          aria-label={refreshTitle}
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 8,
            border: '1px solid var(--border-main)',
            background: canRefresh ? 'var(--bg-secondary)' : 'transparent',
            color: canRefresh ? 'var(--accent-primary)' : 'var(--text-secondary)',
            cursor: canRefresh ? 'pointer' : 'not-allowed',
            opacity: canRefresh ? 1 : 0.45,
          }}
        >
          {isLoading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
        </button>
      )}
    </div>
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <input
        type="url"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: '1 1 280px',
          background: 'var(--bg-secondary)',
          color: '#fff',
          border: '1px solid var(--border-main)',
          padding: '10px 14px',
          borderRadius: '8px',
          fontSize: '0.8rem',
          outline: 'none',
        }}
      />
      {!hideActions && (
        <button
          type="button"
          onClick={onSync}
          disabled={isLoading || !url?.trim()}
          style={{
            background: 'var(--accent-primary)',
            color: '#fff',
            border: 'none',
            padding: '10px 18px',
            borderRadius: '8px',
            cursor: isLoading || !url?.trim() ? 'not-allowed' : 'pointer',
            opacity: isLoading || !url?.trim() ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.8rem',
            fontWeight: 600,
          }}
        >
          {isLoading ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
          {isLoading ? loadingLabel : syncLabel}
        </button>
      )}
    </div>
  </div>
  );
};

export default SheetLinkUpload;
