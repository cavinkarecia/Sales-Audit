import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AttendanceDashboard from './components/AttendanceDashboard';
import './App.css';

function App() {
  return (
    <div className="app-root">
      <nav className="app-nav">
        <span className="app-brand">Sales Audit 2.0</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.65rem',
            color: 'var(--text-secondary)',
            opacity: 0.7,
          }}
          title="Deploy build — if you still see Allowance Audit, hard-refresh (Ctrl+Shift+R)"
        >
          build: no-allowance-v5
        </span>
      </nav>
      <Routes>
        <Route
          path="/"
          element={
            <div className="app-container">
              <AttendanceDashboard />
            </div>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
