import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Map, Receipt } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import AttendanceDashboard from './components/AttendanceDashboard';
import ExpenseCheck2Page from './components/ExpenseCheck2Page';
import './App.css';

function App() {
  return (
    <div className="app-root">
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
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.65rem',
            color: 'var(--text-secondary)',
            opacity: 0.7,
          }}
        >
          build: v42-expense-total-errors-only
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
        <Route path="/expense-check-2" element={<ExpenseCheck2Page />} />
        <Route path="/allowance" element={<Navigate to="/expense-check-2" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
