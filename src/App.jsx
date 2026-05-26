import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { Map, Receipt, Upload } from 'lucide-react';
import HomePage from './pages/HomePage';
import AllowanceAuditPage from './components/AllowanceAuditPage';
import AttendanceDashboard from './components/AttendanceDashboard';
import './App.css';

function App() {
  return (
    <div className="app-root">
      <nav className="app-nav">
        <span className="app-brand">Sales Audit 2.0</span>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          <Upload size={16} /> Uploads
        </NavLink>
        <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          <Map size={16} /> Full Dashboard
        </NavLink>
        <NavLink to="/allowance" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          <Receipt size={16} /> Allowance Audit
        </NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/dashboard"
          element={
            <div className="app-container">
              <AttendanceDashboard />
            </div>
          }
        />
        <Route path="/allowance" element={<AllowanceAuditPage />} />
      </Routes>
    </div>
  );
}

export default App;
