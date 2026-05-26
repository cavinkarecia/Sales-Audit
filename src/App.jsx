import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { Map, Receipt } from 'lucide-react';
import AllowanceAuditPage from './components/AllowanceAuditPage';
import AttendanceDashboard from './components/AttendanceDashboard';
import './App.css';

function App() {
  return (
    <div className="app-root">
      <nav className="app-nav">
        <span className="app-brand">Sales Audit 2.0</span>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          <Map size={16} /> Full Dashboard
        </NavLink>
        <NavLink to="/allowance" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          <Receipt size={16} /> Allowance Audit
        </NavLink>
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
        <Route path="/allowance" element={<AllowanceAuditPage />} />
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
