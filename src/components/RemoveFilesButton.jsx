import React from 'react';
import { Trash2 } from 'lucide-react';
import { useAuditData } from '../context/AuditDataContext';

/** Clears every uploaded file/link and all cached dashboard data. */
const RemoveFilesButton = () => {
  const { removeAllFiles, hardRefreshStatus } = useAuditData();
  const busy = hardRefreshStatus?.running;

  const handleClick = () => {
    if (busy) return;
    const ok = window.confirm(
      'Remove all uploaded files and links?\n\n' +
        'This clears Attendance, PJP, and Expense data from this browser. ' +
        'You will need to upload or paste links again.',
    );
    if (!ok) return;
    removeAllFiles();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title="Remove all uploaded files and cached data"
      aria-label="Remove all files"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-main)',
        background: 'var(--bg-secondary)',
        color: '#f85149',
        cursor: busy ? 'not-allowed' : 'pointer',
        fontSize: '0.72rem',
        fontWeight: 700,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Trash2 size={14} />
      Rmv Files
    </button>
  );
};

export default RemoveFilesButton;
