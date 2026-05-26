import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { AlertCircle, Calendar, UserX, Clock } from 'lucide-react';

const COLORS = ['#58a6ff', '#3fb950', '#f85149', '#d29922', '#bc8cff', '#00d4ff'];

export const AbsenteeismRCA = ({ data }) => {
  const stats = useMemo(() => {
    const reasons = {};
    const asmAbsenteeism = {};
    const topAbsentees = {};
    const delayReasons = {};

    data.forEach(record => {
      if (!record.isPresent) {
        const r = record.absentReason || 'Personal / Sick Leave';
        reasons[r] = (reasons[r] || 0) + 1;
        
        const asm = record.asmName || 'Unknown ASM';
        if (!asmAbsenteeism[asm]) asmAbsenteeism[asm] = 0;
        asmAbsenteeism[asm]++;

        const name = record.name || 'Unknown Auditor';
        if (!topAbsentees[name]) topAbsentees[name] = { count: 0, reason: r };
        topAbsentees[name].count++;
      }

      if (record.delayReason) {
        delayReasons[record.delayReason] = (delayReasons[record.delayReason] || 0) + 1;
      }
    });

    const formatForChart = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

    return {
      reasons: formatForChart(reasons),
      asmAbsenteeism: formatForChart(asmAbsenteeism).slice(0, 10),
      topAbsentees: Object.entries(topAbsentees)
        .map(([name, d]) => ({ name, value: d.count, reason: d.reason }))
        .sort((a,b) => b.value - a.value)
        .slice(0, 10),
      delayReasons: formatForChart(delayReasons)
    };
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Reasons Breakdown */}
      <div className="card" style={{ padding: '20px' }}>
        <h4 style={{ fontSize: '0.9rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={16} color="var(--accent-danger)" /> Absenteeism Reasons (RCA)
        </h4>
        <div style={{ height: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={stats.reasons}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {stats.reasons.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ background: 'rgba(13, 17, 23, 0.95)', border: '1px solid var(--border-main)', borderRadius: '8px' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Absent Auditors */}
      <div className="card" style={{ padding: '20px' }}>
        <h4 style={{ fontSize: '0.9rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Calendar size={16} color="#bc8cff" /> Top Absent Auditors (Frequency)
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {stats.topAbsentees.length > 0 ? stats.topAbsentees.map((auditor, idx) => (
            <div key={idx} style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              padding: '12px 16px', 
              background: 'rgba(255,255,255,0.02)', 
              borderRadius: '8px',
              borderLeft: `4px solid ${COLORS[idx % COLORS.length]}`
            }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{auditor.name}</span>
                <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>Last Reason: {auditor.reason}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#f85149' }}>{auditor.value}</div>
                <div style={{ fontSize: '0.65rem', color: '#8b949e' }}>Days Absent</div>
              </div>
            </div>
          )) : (
            <div style={{ gridColumn: 'span 2', color: '#8b949e', fontSize: '0.8rem', textAlign: 'center', padding: '40px' }}>
              No absenteeism recorded in this period.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
