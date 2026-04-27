import React, { useState, useMemo } from 'react';
import auditorsData from '../data/auditors.json';
import IndiaMap from './IndiaMap';
import { 
  Users, 
  Calendar, 
  MapPin, 
  Search, 
  Filter, 
  TrendingUp,
  Award,
  Building2
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';

const SalesAuditDashboard = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCluster, setSelectedCluster] = useState('All');
  const [selectedOrg, setSelectedOrg] = useState('All');

  // Stats calculation
  const stats = useMemo(() => {
    const avgTenure = Math.round(auditorsData.reduce((acc, curr) => acc + curr.tenure, 0) / auditorsData.length);
    const orgSplit = auditorsData.reduce((acc, curr) => {
      acc[curr.org] = (acc[curr.org] || 0) + 1;
      return acc;
    }, {});
    
    return {
      total: auditorsData.length,
      avgTenure,
      organizations: Object.keys(orgSplit).length,
      clusters: [...new Set(auditorsData.map(a => a.cluster))].length
    };
  }, []);

  // Filtered data
  const filteredData = useMemo(() => {
    return auditorsData.filter(auditor => {
      const matchesSearch = auditor.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           auditor.empCode.includes(searchTerm) ||
                           auditor.location.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCluster = selectedCluster === 'All' || auditor.cluster === selectedCluster;
      const matchesOrg = selectedOrg === 'All' || auditor.org === selectedOrg;
      return matchesSearch && matchesCluster && matchesOrg;
    });
  }, [searchTerm, selectedCluster, selectedOrg]);

  // Chart Data
  const clusterData = useMemo(() => {
    const counts = auditorsData.reduce((acc, curr) => {
      acc[curr.cluster] = (acc[curr.cluster] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, []);

  const tenureData = useMemo(() => {
    // Group tenure into buckets
    const buckets = { '0-3 months': 0, '3-6 months': 0, '6-12 months': 0, '12+ months': 0 };
    auditorsData.forEach(a => {
      if (a.tenure < 90) buckets['0-3 months']++;
      else if (a.tenure < 180) buckets['3-6 months']++;
      else if (a.tenure < 365) buckets['6-12 months']++;
      else buckets['12+ months']++;
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, []);

  const COLORS = ['#58a6ff', '#3fb950', '#f85149', '#d29922', '#bc8cff', '#1f6feb'];

  return (
    <div className="dashboard-wrapper" style={{ animation: 'fadeIn 0.5s ease-out' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 className="title-glow" style={{ fontSize: '2.5rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <TrendingUp size={36} color="var(--accent-brand)" />
          Auditor Intelligence Dashboard
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>Tracking attendance and productivity lifecycle across pan-India clusters.</p>
      </header>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2.5rem' }}>
        {[
          { label: 'Total Auditors', value: stats.total, icon: <Users size={24} />, color: '#58a6ff' },
          { label: 'Avg. Tenure (Days)', value: stats.avgTenure, icon: <Calendar size={24} />, color: '#3fb950' },
          { label: 'Organizations', value: stats.organizations, icon: <Building2 size={24} />, color: '#f85149' },
          { label: 'Active Clusters', value: stats.clusters, icon: <MapPin size={24} />, color: '#d29922' }
        ].map((kpi, i) => (
          <div key={i} className="glass-card" style={{ padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(10px)', transition: 'transform 0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ padding: '0.5rem', background: `${kpi.color}22`, borderRadius: '8px', color: kpi.color }}>{kpi.icon}</div>
              <span style={{ fontSize: '2rem', fontWeight: 'bold' }}>{kpi.value}</span>
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', marginBottom: '2.5rem' }}>
        {/* Geographical Insights */}
        <div className="glass-card" style={{ padding: '1.5rem', borderRadius: '16px', background: 'rgba(255,255,255,0.02)' }}>
          <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MapPin size={20} color="var(--accent-brand)" /> Regional Spread & Cluster Density
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'center' }}>
            <IndiaMap data={auditorsData} activeRegion={selectedCluster} onRegionClick={(id) => setSelectedCluster(id === selectedCluster ? 'All' : id)} />
            <div style={{ height: '300px' }}>
               <ResponsiveContainer width="100%" height="100%">
                <BarChart data={clusterData} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" stroke="var(--text-secondary)" width={60} />
                  <Tooltip 
                    contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px' }}
                    itemStyle={{ color: '#58a6ff' }}
                  />
                  <Bar dataKey="value" fill="var(--accent-brand)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Tenure Distribution */}
        <div className="glass-card" style={{ padding: '1.5rem', borderRadius: '16px', background: 'rgba(255,255,255,0.02)' }}>
          <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Calendar size={20} color="var(--accent-brand)" /> Tenure Lifecycle
          </h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={tenureData}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {tenureData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                   contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px' }}
                />
                <Legend iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Auditor Table */}
      <div className="glass-card" style={{ padding: '1.5rem', borderRadius: '16px', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={20} color="var(--accent-brand)" /> Auditor Directory
          </h3>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ position: 'relative' }}>
              <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} size={16} />
              <input 
                type="text" 
                placeholder="Search name, code, location..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ 
                  padding: '8px 12px 8px 34px', 
                  borderRadius: '8px', 
                  border: '1px solid #30363d', 
                  background: '#0d1117', 
                  color: 'white',
                  width: '240px'
                }}
              />
            </div>
            <select 
              value={selectedOrg}
              onChange={(e) => setSelectedOrg(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #30363d', background: '#0d1117', color: 'white' }}
            >
              <option value="All">All Organizations</option>
              <option value="CKPL">CKPL</option>
              <option value="HEPL">HEPL</option>
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #30363d', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '1rem' }}>Survey ID</th>
                <th style={{ padding: '1rem' }}>Name</th>
                <th style={{ padding: '1rem' }}>Cluster</th>
                <th style={{ padding: '1rem' }}>Location</th>
                <th style={{ padding: '1rem' }}>Org</th>
                <th style={{ padding: '1rem' }}>Tenure</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((auditor, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #21262d', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '1rem', color: 'var(--accent-glow)', fontWeight: 'bold' }}>{auditor.surveyId || 'N/A'}</td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: 500 }}>{auditor.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{auditor.empCode}</div>
                  </td>
                  <td style={{ padding: '1rem' }}>
                     <span style={{ padding: '2px 8px', borderRadius: '12px', background: 'rgba(88, 166, 255, 0.1)', color: '#58a6ff', fontSize: '0.9rem' }}>
                       {auditor.cluster}
                     </span>
                  </td>
                  <td style={{ padding: '1rem' }}>{auditor.location}</td>
                  <td style={{ padding: '1rem' }}>{auditor.org}</td>
                  <td style={{ padding: '1rem' }}>{auditor.tenure} days</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SalesAuditDashboard;
