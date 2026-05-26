import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

const CHART_COLORS = ['#f85149', '#58a6ff', '#d29922', '#bc8cff', '#3fb950', '#ff7b72'];

export const ReasonAnalysis = ({ data }) => {
  if (!data) return null;

  return (
    <div className="metrics-grid" style={{ marginTop: '24px' }}>
      {/* Reschedule/Delay RCA */}
      <div className="chart-card">
        <h3 className="chart-title">Delay & Reschedule RCA</h3>
        <div className="chart-container">
          {data.delayReasons.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.delayReasons} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {data.delayReasons.map((entry, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#c9d1d9' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              No Delay Data Available
            </div>
          )}
        </div>
      </div>

      {/* Issue Category Breakdown */}
      <div className="chart-card">
        <h3 className="chart-title">Issue Category Breakdown</h3>
        <div className="chart-container">
          {data.issueCategories.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.issueCategories}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" vertical={false} />
                <XAxis dataKey="name" stroke="#8b949e" fontSize={12} tickLine={false} />
                <YAxis stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#c9d1d9' }} />
                <Bar dataKey="value" fill="#d29922" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              No Issue Category Data Available
            </div>
          )}
        </div>
      </div>

      {/* Absenteeism Table */}
      <div className="chart-card" style={{ gridColumn: '1 / -1' }}>
        <h3 className="chart-title">Absenteeism RCA by Auditor</h3>
        <div className="table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Auditor Name</th>
                <th>Total Absences</th>
                <th>Reasons Breakdown</th>
              </tr>
            </thead>
            <tbody>
              {data.absenteeismByEmp.length > 0 ? data.absenteeismByEmp.map((emp, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: '500' }}>{emp.name}</td>
                  <td style={{ color: '#f85149', fontWeight: 'bold' }}>{emp.total}</td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{emp.reasons}</td>
                </tr>
              )) : (
                <tr><td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No Absenteeism Data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
