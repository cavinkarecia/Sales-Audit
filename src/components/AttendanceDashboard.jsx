import React, { useState, useMemo } from 'react';
import ExcelUpload from './ExcelUpload';
import IndiaLiveMap from './IndiaLiveMap';
import auditorsMaster from '../data/auditors.json';
import asmMapping from '../data/asm_mapping.json';
import { ReasonAnalysis } from './analytics/ReasonAnalysis';
import { AbsenteeismRCA } from './analytics/AbsenteeismRCA';
import { AsmCoverageMap } from './analytics/AsmCoverageMap';
import {
  Users, 
  MapPin, 
  Calendar, 
  Clock, 
  AlertTriangle, 
  CheckCircle,
  TrendingUp,
  ChevronRight,
  Filter,
  Upload
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell, PieChart, Pie, Legend
} from 'recharts';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import { getDistance, findNearestCity } from '../utils/geoUtils';

const AttendanceDashboard = () => {
  const [reportData, setReportData] = useState([]);
  const [timeFilter, setTimeFilter] = useState('daily'); 
  const [activePeriod, setActivePeriod] = useState(null); 
  const [expandedKpi, setExpandedKpi] = useState(null); 
  const [selectedCluster, setSelectedCluster] = useState(null); 

  React.useEffect(() => {
    if (reportData.length > 0) {
      const dates = reportData.map(d => d.date).filter(Boolean);
      if (dates.length > 0) {
        setActivePeriod(null);
        setExpandedKpi(null);
      }
    }
  }, [reportData]);

  const toggleKpiExpand = (kpi) => {
    setExpandedKpi(expandedKpi === kpi ? null : kpi);
  };

  const CLUSTER_CENTROIDS = {
    'TN': { lat: 11.1271, lng: 78.6569 },
    'KAR': { lat: 15.3173, lng: 75.7139 },
    'RAPT': { lat: 17.3850, lng: 78.4867 },
    'JOBC': { lat: 22.9868, lng: 87.8550 },
    'North': { lat: 28.6139, lng: 77.2090 },
    'West': { lat: 19.0760, lng: 72.8777 }
  };

  const detectClusterFromCoords = (locationStr) => {
    if (!locationStr) return null;
    const parts = locationStr.split(/[,\s]+/).map(p => parseFloat(p)).filter(p => !isNaN(p));
    if (parts.length < 2) return null;
    const [lat, lng] = parts;
    let nearestCluster = 'Unknown';
    let minDistance = Infinity;
    Object.entries(CLUSTER_CENTROIDS).forEach(([cluster, centroid]) => {
      const dist = Math.sqrt(Math.pow(lat - centroid.lat, 2) + Math.pow(lng - centroid.lng, 2));
      if (dist < minDistance) {
        minDistance = dist;
        nearestCluster = cluster;
      }
    });
    return nearestCluster;
  };

  const processedData = useMemo(() => {
    if (reportData.length === 0) return [];
    return reportData.map(record => {
      const masterInfo = auditorsMaster.find(a => 
        a.name.toLowerCase().includes(record.name.toLowerCase()) ||
        record.name.toLowerCase().includes(a.name.toLowerCase())
      );
      const date = record.date;
      const geoCluster = detectClusterFromCoords(record.location);
      const parts = record.location ? record.location.split(/[,\s]+/).map(p => parseFloat(p)).filter(p => !isNaN(p)) : [];
      const currentCity = parts.length >= 2 ? findNearestCity(parts[0], parts[1]) : 'Offline';
      const distance = (parts.length >= 2 && masterInfo?.coords) 
        ? getDistance(masterInfo.coords.lat, masterInfo.coords.lng, parts[0], parts[1]) 
        : 'N/A';

      let mappedAsmName = record.asmName || 'N/A';
      if (record.name) {
        const lowerName = record.name.toLowerCase().trim();
        mappedAsmName = asmMapping[lowerName] || mappedAsmName;
        if (mappedAsmName === 'N/A') {
          const match = Object.keys(asmMapping).find(k => k.includes(lowerName) || lowerName.includes(k));
          if (match) mappedAsmName = asmMapping[match];
        }
      }

      return {
        ...record,
        asmName: mappedAsmName,
        baseLocation: masterInfo?.location || 'Unknown',
        currentCity: currentCity,
        distanceFromBase: distance,
        cluster: geoCluster || masterInfo?.cluster || 'Unknown',
        empCode: masterInfo?.empCode || 'N/A',
        weekKey: date ? format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd') : null,
        monthKey: date ? format(startOfMonth(date), 'yyyy-MM') : null,
        dayKey: date ? format(date, 'yyyy-MM-dd') : null
      };
    });
  }, [reportData]);

  const availablePeriods = useMemo(() => {
    if (processedData.length === 0) return [];
    const periods = new Set();
    processedData.forEach(item => {
      if (timeFilter === 'daily') periods.add(item.dayKey);
      if (timeFilter === 'weekly') periods.add(item.weekKey);
      if (timeFilter === 'monthly') periods.add(item.monthKey);
    });
    return Array.from(periods).filter(Boolean).sort().reverse().map(key => {
      let label = key;
      const date = new Date(key);
      if (timeFilter === 'daily') label = format(date, 'eee, dd MMM yyyy');
      if (timeFilter === 'weekly') label = `Week of ${format(date, 'dd MMM yyyy')}`;
      if (timeFilter === 'monthly') label = format(date, 'MMMM yyyy');
      return { key, label };
    });
  }, [processedData, timeFilter]);

  React.useEffect(() => {
    if (availablePeriods.length > 0 && !activePeriod) {
      setActivePeriod(availablePeriods[0].key);
    }
  }, [availablePeriods, activePeriod]);

  const filteredData = useMemo(() => {
    if (processedData.length === 0 || !activePeriod) return [];
    return processedData.filter(item => {
      if (timeFilter === 'daily') return item.dayKey === activePeriod;
      if (timeFilter === 'weekly') return item.weekKey === activePeriod;
      if (timeFilter === 'monthly') return item.monthKey === activePeriod;
      return false;
    });
  }, [processedData, timeFilter, activePeriod]);

  const stats = useMemo(() => {
    if (filteredData.length === 0) return null;
    const allNames = filteredData.map(d => d.name);
    const uniqueNames = Array.from(new Set(allNames));
    const presentRecords = filteredData.filter(d => d.isPresent);
    const absentRecords = filteredData.filter(d => !d.isPresent);
    const uniqueAbsentees = Array.from(new Set(absentRecords.map(d => d.name)));
    const planned = filteredData.filter(d => d.isPlanned).length;
    const totalRecords = filteredData.length;
    
    const absenceReasons = filteredData.reduce((acc, curr) => {
      if (!curr.isPresent && curr.absentReason) {
        acc[curr.absentReason] = (acc[curr.absentReason] || 0) + 1;
      }
      return acc;
    }, {});

    const clusterAudits = filteredData.reduce((acc, curr) => {
      const cluster = curr.cluster || 'Unknown';
      acc[cluster] = (acc[cluster] || 0) + 1;
      return acc;
    }, {});

    return {
      total: uniqueNames.length,
      totalAuditorNames: uniqueNames,
      absent: uniqueAbsentees.length,
      absenteeNames: uniqueAbsentees,
      attendanceRate: Math.round((presentRecords.length / totalRecords) * 100),
      plannedRate: Math.round((planned / totalRecords) * 100),
      absenceReasons: Object.entries(absenceReasons).map(([name, value]) => ({ name, value })),
      clusterAudits: Object.entries(clusterAudits).map(([name, value]) => ({ name, value }))
    };
  }, [filteredData]);

  const trendData = useMemo(() => {
    if (filteredData.length === 0 || timeFilter === 'daily') return [];
    const dayGroups = filteredData.reduce((acc, curr) => {
      const day = curr.dayKey;
      if (!acc[day]) acc[day] = { date: day, present: 0, total: 0 };
      acc[day].total++;
      if (curr.isPresent) acc[day].present++;
      return acc;
    }, {});
    return Object.values(dayGroups).sort((a, b) => new Date(a.date) - new Date(b.date)).map(d => ({
      ...d,
      label: format(new Date(d.date), 'dd MMM'),
      rate: Math.round((d.present / d.total) * 100)
    }));
  }, [filteredData, timeFilter]);

  const auditorPerformanceData = useMemo(() => {
    if (filteredData.length === 0 || timeFilter === 'daily') return [];
    const auditorGroups = filteredData.reduce((acc, curr) => {
      if (!acc[curr.name]) acc[curr.name] = { name: curr.name, present: 0, total: 0 };
      acc[curr.name].total++;
      if (curr.isPresent) acc[curr.name].present++;
      return acc;
    }, {});
    return Object.values(auditorGroups)
      .map(d => ({ name: d.name, count: d.present, rate: Math.round((d.present / d.total) * 100) }))
      .sort((a, b) => b.rate - a.rate).slice(0, 15);
  }, [filteredData, timeFilter]);

  const advancedAnalytics = useMemo(() => {
    if (filteredData.length === 0) return null;
    
    const delayReasons = {};
    const issueCategories = {};
    const beatChanges = {};
    const asmCoverage = {};
    const regionalAttendance = {};
    const absenteeismByEmp = {};

    filteredData.forEach(curr => {
      if (!curr.isPresent) {
         if (!absenteeismByEmp[curr.name]) absenteeismByEmp[curr.name] = {};
         const r = curr.absentReason || 'Unknown';
         absenteeismByEmp[curr.name][r] = (absenteeismByEmp[curr.name][r] || 0) + 1;
      }
      if (curr.delayReason) {
         delayReasons[curr.delayReason] = (delayReasons[curr.delayReason] || 0) + 1;
      }
      if (curr.issueCategory) {
         issueCategories[curr.issueCategory] = (issueCategories[curr.issueCategory] || 0) + 1;
      }
      if (curr.beatName && curr.beatName !== 'Unknown Beat') {
         beatChanges[curr.beatName] = (beatChanges[curr.beatName] || 0) + 1;
      }
      const asm = curr.asmName || 'N/A';
      if (!asmCoverage[asm]) asmCoverage[asm] = { total: 0, present: 0, auditors: new Set() };
      asmCoverage[asm].total++;
      if (curr.isPresent) asmCoverage[asm].present++;
      asmCoverage[asm].auditors.add(curr.name);

      const city = curr.currentCity || 'Unknown';
      if (!regionalAttendance[city]) regionalAttendance[city] = { total: 0, present: 0 };
      regionalAttendance[city].total++;
      if (curr.isPresent) regionalAttendance[city].present++;
    });

    const formatData = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

    return {
      delayReasons: formatData(delayReasons),
      issueCategories: formatData(issueCategories),
      beatChanges: formatData(beatChanges).slice(0, 10),
      asmCoverage: Object.entries(asmCoverage).map(([name, data]) => ({
        name, 
        coverage: data.auditors.size, 
        rate: Math.round((data.present/data.total)*100) || 0
      })).sort((a,b) => b.coverage - a.coverage),
      regionalAttendance: Object.entries(regionalAttendance).map(([name, data]) => ({
        name, 
        total: data.total,
        rate: Math.round((data.present/data.total)*100) || 0
      })).sort((a,b) => b.total - a.total).slice(0, 15),
      absenteeismByEmp: Object.entries(absenteeismByEmp).map(([name, reasons]) => ({
        name,
        reasons: Object.entries(reasons).map(([r, c]) => `${r} (${c})`).join(', '),
        total: Object.values(reasons).reduce((a,b)=>a+b, 0)
      })).sort((a,b) => b.total - a.total)
    };
  }, [filteredData]);

  const churnTrendData = useMemo(() => {
    if (filteredData.length === 0) return [];
    const dayGroups = filteredData.reduce((acc, curr) => {
      const day = curr.dayKey;
      if (!day) return acc;
      if (!acc[day]) acc[day] = { date: day, additions: 0, cancellations: 0 };
      acc[day].additions += (curr.distAdditions || 0);
      acc[day].cancellations += (curr.distCancellations || 0);
      return acc;
    }, {});
    return Object.values(dayGroups).sort((a, b) => new Date(a.date) - new Date(b.date)).map(d => ({
      ...d,
      label: format(new Date(d.date), 'dd MMM')
    }));
  }, [filteredData]);

  const CHART_COLORS = ['#58a6ff', '#3fb950', '#f85149', '#d29922', '#bc8cff'];

  if (reportData.length === 0) {
    return <ExcelUpload onDataLoaded={setReportData} />;
  }

  return (
    <div className="dashboard-content animate-in">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-main)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '800', background: 'linear-gradient(to right, #fff, #58a6ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Field Intelligence Dashboard
          </h1>
          <p style={{ fontSize: '0.85rem', margin: '4px 0 0' }}>Monitoring {stats?.total || 0} active field auditors</p>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
          {['daily', 'weekly', 'monthly'].map(f => (
            <button
              key={f}
              onClick={() => { setTimeFilter(f); setActivePeriod(null); setExpandedKpi(null); }}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                border: 'none',
                background: timeFilter === f ? 'var(--accent-primary)' : 'transparent',
                color: timeFilter === f ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: '600',
                textTransform: 'uppercase',
                transition: 'all 0.2s ease'
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      {/* Control Bar */}
      <div className="card" style={{ display: 'flex', gap: '16px', marginBottom: '24px', alignItems: 'center', padding: '10px 16px' }}>
        <button 
          onClick={() => setReportData([])} 
          style={{ background: 'transparent', border: '1px solid var(--border-main)', color: 'var(--text-primary)', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Upload size={14} /> New Upload
        </button>

        <div style={{ width: '1px', height: '20px', background: 'var(--border-main)' }}></div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Calendar size={14} color="var(--accent-primary)" />
          <select 
            value={activePeriod || ''} 
            onChange={(e) => { setActivePeriod(e.target.value); setExpandedKpi(null); }}
            style={{ background: 'var(--bg-secondary)', color: '#fff', border: '1px solid var(--border-main)', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', outline: 'none' }}
          >
            {availablePeriods.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Filter size={12} /> <strong>{filteredData.length}</strong> Records
        </div>
      </div>

      {stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* KPI Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            {[
              { id: 'rate', label: 'Attendance Rate', value: `${stats.attendanceRate}%`, icon: <CheckCircle size={20} />, color: 'var(--accent-success)' },
              { id: 'total', label: 'Active Auditors', value: stats.total, icon: <Users size={20} />, color: 'var(--accent-primary)', interactive: true },
              { id: 'planned', label: 'Planned Coverage', value: `${stats.plannedRate}%`, icon: <Clock size={20} />, color: '#bc8cff' },
              { id: 'absent', label: 'Absentees', value: stats.absent, icon: <AlertTriangle size={20} />, color: 'var(--accent-danger)', interactive: true }
            ].map(kpi => (
              <div 
                key={kpi.id} 
                className="card" 
                onClick={() => kpi.interactive && toggleKpiExpand(kpi.id)}
                style={{ 
                  cursor: kpi.interactive ? 'pointer' : 'default',
                  borderLeft: `4px solid ${kpi.color}`,
                  padding: '12px 16px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '500' }}>{kpi.label}</span>
                  <div style={{ color: kpi.color }}>{kpi.icon}</div>
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: '800', margin: '4px 0' }}>{kpi.value}</div>
                {kpi.interactive && (
                  <div style={{ fontSize: '0.65rem', color: kpi.color, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    View List <ChevronRight size={10} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Expanded KPI List */}
          {expandedKpi && (
            <div className="card animate-in" style={{ padding: '16px', background: 'rgba(88, 166, 255, 0.05)' }}>
              <h4 style={{ marginBottom: '12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={14} /> {expandedKpi === 'total' ? 'Active Roster' : 'Absent Members'}
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {(expandedKpi === 'total' ? stats.totalAuditorNames : stats.absenteeNames).map((name, i) => (
                  <span key={i} style={{ padding: '4px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-main)', borderRadius: '16px', fontSize: '0.7rem' }}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Map & Clusters */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
            <div className="card" style={{ padding: '20px' }}>
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={18} color="var(--accent-primary)" /> Geographic Footprint
                </h3>
              </div>
              <IndiaLiveMap data={filteredData} auditorsMaster={auditorsMaster} />
            </div>

            <div className="card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '0.9rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={18} color="var(--accent-primary)" /> Cluster Summary
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {stats.clusterAudits.map((cluster, i) => (
                  <div 
                    key={i} 
                    onClick={() => setSelectedCluster(selectedCluster === cluster.name ? null : cluster.name)}
                    style={{ 
                      padding: '10px', 
                      borderRadius: '8px', 
                      background: selectedCluster === cluster.name ? 'rgba(88, 166, 255, 0.1)' : 'rgba(255,255,255,0.03)', 
                      border: `1px solid ${selectedCluster === cluster.name ? 'var(--accent-primary)' : 'transparent'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <span style={{ fontSize: '0.8rem', fontWeight: '600' }}>{cluster.name}</span>
                    <span style={{ fontSize: '0.9rem', fontWeight: '800', color: 'var(--accent-primary)' }}>{cluster.value}</span>
                  </div>
                ))}
              </div>
              
              {selectedCluster && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-main)' }}>
                  <h4 style={{ fontSize: '0.75rem', marginBottom: '8px', color: 'var(--accent-primary)' }}>Auditors in {selectedCluster}</h4>
                  <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {filteredData.filter(d => d.cluster === selectedCluster).reduce((acc, c) => acc.includes(c.name) ? acc : [...acc, c.name], []).map((name, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                        <div style={{ width: '4px', height: '4px', background: 'var(--accent-primary)', borderRadius: '50%' }}></div>
                        {name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          </div>
      )}

      {/* Field Force Status Table */}
      <div className="chart-card" style={{ marginTop: '24px' }}>
        <h3 className="chart-title">Field Force Live Status</h3>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Auditor</th>
                <th>Base Location</th>
                <th>Current Location</th>
                <th>Proximity (KM)</th>
                <th>Status</th>
                <th>ASM</th>
                <th>Total Shops</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.slice(0, 20).map((item, index) => (
                <tr key={index}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                        {item.empName || item.employeeName || item.name || 'Unknown Auditor'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {item.empCode}
                      </span>
                    </div>
                  </td>
                  <td>{item.baseLocation}</td>
                  <td>{item.currentCity}</td>
                  <td>
                    <span style={{ 
                      color: item.distanceFromBase === 'N/A' ? 'var(--text-muted)' : (item.distanceFromBase > 50 ? '#f85149' : '#3fb950'),
                      fontWeight: item.distanceFromBase !== 'N/A' ? 'bold' : 'normal'
                    }}>
                      {item.distanceFromBase}
                    </span>
                  </td>
                  <td>
                    {item.isPresent ? (
                      <span className="status-badge status-active">On Field</span>
                    ) : (
                      <span className="status-badge status-inactive">Offline</span>
                    )}
                  </td>
                  <td>{item.asmName || 'N/A'}</td>
                  <td>{item.totalShops || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Advanced Analytics Views */}
      {advancedAnalytics && (
        <div style={{ marginTop: '40px', borderTop: '1px solid var(--border-main)', paddingTop: '24px' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '800', marginBottom: '16px', color: 'var(--text-primary)' }}>Advanced Analytics Hub</h2>
          
          <h3 style={{ fontSize: '1.2rem', color: 'var(--accent-primary)', marginBottom: '16px' }}>Reason & Issue Analysis</h3>
          <ReasonAnalysis data={advancedAnalytics} />

          <h3 style={{ fontSize: '1.2rem', color: 'var(--accent-primary)', marginTop: '40px', marginBottom: '16px' }}>Absenteeism Analysis (RCA)</h3>
          <AbsenteeismRCA data={filteredData} />

          <h3 style={{ fontSize: '1.2rem', color: 'var(--accent-primary)', marginTop: '40px', marginBottom: '16px' }}>ASM Territory Coverage</h3>
          <AsmCoverageMap data={filteredData} auditorsMaster={auditorsMaster} />
        </div>
      )}

    </div>
  );
};

export default AttendanceDashboard;
