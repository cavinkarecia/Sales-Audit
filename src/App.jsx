import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Map, Receipt, RefreshCw } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import AttendanceDashboard from './components/AttendanceDashboard';
import ExpenseCheck2Page from './components/ExpenseCheck2Page';
import HardRefreshButton from './components/HardRefreshButton';
import RemoveFilesButton from './components/RemoveFilesButton';
import { useAuditData } from './context/AuditDataContext';
import './App.css';

function HardRefreshOverlay() {
  const { hardRefreshStatus } = useAuditData();
  if (!hardRefreshStatus?.running) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="glass-card"
        style={{
          padding: '20px 28px',
          textAlign: 'center',
          maxWidth: 380,
          fontSize: '0.85rem',
        }}
      >
        <div className="spin" style={{ display: 'inline-block', marginBottom: 10 }}>
          <RefreshCw size={22} color="var(--accent-primary)" />
        </div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Hard Refresh in progress…</div>
        <div style={{ color: 'var(--text-secondary)' }}>
          {hardRefreshStatus.step || 'Rebuilding dashboards from current uploads…'}
        </div>
      </div>
    </div>
  );
}

function App() {
  const { refreshKey } = useAuditData();
  return (
    <div className="app-root">
      <HardRefreshOverlay />
      <nav className="app-nav">
        <span className="app-brand">Sales Audit 2.0</span>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          <Map size={16} /> Attendance
        </NavLink>
        <NavLink
          to="/expense-check-2"
          className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
        >
          <Receipt size={16} /> Expense Check
        </NavLink>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: '0.65rem',
              color: 'var(--text-secondary)',
              opacity: 0.7,
            }}
          >
            build: v57-expense-onetime-period-line
          </span>
          <RemoveFilesButton />
          <HardRefreshButton />
        </div>
      </nav>
      <Routes>
        <Route
          path="/"
          element={
            <div className="app-container" key={refreshKey}>
              <AttendanceDashboard />
            </div>
          }
        />
        <Route path="/expense-check-2" element={<ExpenseCheck2Page key={refreshKey} />} />
        <Route path="/allowance" element={<Navigate to="/expense-check-2" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
