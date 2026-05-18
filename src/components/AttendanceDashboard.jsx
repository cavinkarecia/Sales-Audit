import React, { useState, useMemo } from 'react';
import IndiaLiveMap from './IndiaLiveMap';
import auditorsMaster from '../data/auditors.json';
import asmMapping from '../data/asm_mapping.json';
import { ReasonAnalysis } from './analytics/ReasonAnalysis';
import { AbsenteeismRCA } from './analytics/AbsenteeismRCA';

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
  Upload,
  Compass,
  FileText,
  Activity
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell, PieChart, Pie, Legend
} from 'recharts';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import { getDistance, findNearestCity } from '../utils/geoUtils';
import { parseAttendanceExcel } from '../utils/ExcelParser';
import { fetchAllSheets, groupByEmployee, groupByMonth, calculateTravelStats } from '../utils/sheetFetcher';
import { getAIInsights, analyzeAllAuditorsTravel } from '../utils/deepseekAgent';

const AttendanceDashboard = () => {
  const [reportData, setReportData] = useState(() => {
    try {
      const saved = localStorage.getItem('sales_audit_report_data');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Error loading data from localStorage:', e);
      return [];
    }
  });
  const [timeFilter, setTimeFilter] = useState('daily'); 
  const [activePeriod, setActivePeriod] = useState(null); 
  const [expandedKpi, setExpandedKpi] = useState(null); 
  const [selectedCluster, setSelectedCluster] = useState(null); 
  const [isParsing, setIsParsing] = useState(false);
  
  // Advanced Geographic Footprint states
  const [historyUrl, setHistoryUrl] = useState('');
  const [historyData, setHistoryData] = useState([]);
  const [historySheetsSummary, setHistorySheetsSummary] = useState([]);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [selectedHistoryAuditor, setSelectedHistoryAuditor] = useState('');
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState('');
  const [selectedHistoryDate, setSelectedHistoryDate] = useState('');
  
  // AI Agent states
  const [isAnalyzingTravel, setIsAnalyzingTravel] = useState(false);
  const [aiAnalysisText, setAiAnalysisText] = useState('');
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [allAuditorsInsights, setAllAuditorsInsights] = useState('');
  
  const fileInputRef = React.useRef(null);

  // Persist data to localStorage
  React.useEffect(() => {
    localStorage.setItem('sales_audit_report_data', JSON.stringify(reportData));
  }, [reportData]);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsParsing(true);
    try {
      const data = await parseAttendanceExcel(file);
      setReportData(data);
    } catch (err) {
      console.error('Error parsing file:', err);
      alert('Failed to parse file. Please ensure it is a valid GoSurvey attendance export.');
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleHistorySync = async () => {
    if (!historyUrl) return;
    setIsFetchingHistory(true);
    setAiAnalysisText('');
    setAllAuditorsInsights('');
    try {
      const result = await fetchAllSheets(historyUrl);
      setHistoryData(result.records);
      setHistorySheetsSummary(result.sheetSummary);
      
      // Determine unique auditors and months
      const uniqueAuditors = Array.from(new Set(result.records.map(r => r.employeeName))).filter(Boolean);
      
      // Basic grouping to set defaults
      if (result.records.length > 0) {
        const firstRecord = result.records[0];
        setSelectedHistoryAuditor(firstRecord.employeeName || '');
        
        // Find months
        const monthGroup = groupByMonth(result.records);
        if (monthGroup.length > 0) {
          setSelectedHistoryMonth(monthGroup[0].key);
        }
        
        setSelectedHistoryDate(''); // Default to 'All' or empty
        alert(`Successfully fetched all travel history! Loaded ${result.totalSheets} sheets with ${result.totalRecords} daily travel records.`);
      } else {
        alert('Successfully fetched spreadsheet, but no valid travel records were found. Check headers (Date, Employee Name, To Town Name).');
      }
    } catch (err) {
      console.error('Error fetching history:', err);
      alert(`Failed to fetch data from Google Sheets: ${err.message}`);
    } finally {
      setIsFetchingHistory(false);
    }
  };

  const handleFetchAIInsights = async (auditorName, monthKey, recordsForMonth, stats) => {
    if (recordsForMonth.length === 0) return;
    setIsAnalyzingTravel(true);
    setAiAnalysisText('');
    try {
      const monthLabel = availableHistoryMonths.find(m => m.key === monthKey)?.label || monthKey;
      const insights = await getAIInsights(auditorName, monthLabel, recordsForMonth, stats);
      setAiAnalysisText(insights);
    } catch (err) {
      console.error('Error getting AI insights:', err);
      alert('Failed to get insights from DeepSeek AI. Please check your API connection.');
    } finally {
      setIsAnalyzingTravel(false);
    }
  };

  const handleFetchAllAIInsights = async () => {
    if (historyData.length === 0) return;
    setIsAnalyzingAll(true);
    setAllAuditorsInsights('');
    try {
      const grouped = groupByEmployee(historyData);
      const insights = await analyzeAllAuditorsTravel(grouped, auditorsMaster);
      setAllAuditorsInsights(insights);
    } catch (err) {
      console.error('Error getting all insights:', err);
      alert('Failed to get team insights from DeepSeek AI.');
    } finally {
      setIsAnalyzingAll(false);
    }
  };

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

  // History-specific selectors
  const availableHistoryMonths = useMemo(() => {
    if (historyData.length === 0) return [];
    return groupByMonth(historyData);
  }, [historyData]);

  const filteredHistoryRecords = useMemo(() => {
    if (historyData.length === 0) return [];
    return historyData.filter(record => {
      // Filter by Auditor
      if (selectedHistoryAuditor && record.employeeName !== selectedHistoryAuditor) {
        return false;
      }
      
      // Filter by Month
      if (selectedHistoryMonth) {
        const parts = record.date.split('-');
        if (parts.length === 3) {
          const mKey = `${parts[2]}-${parts[1]}`; // "yyyy-MM"
          if (mKey !== selectedHistoryMonth) return false;
        } else {
          return false;
        }
      }
      
      // Filter by Date
      if (selectedHistoryDate && record.date !== selectedHistoryDate) {
        return false;
      }
      
      return true;
    });
  }, [historyData, selectedHistoryAuditor, selectedHistoryMonth, selectedHistoryDate]);

  const activeHistoryDates = useMemo(() => {
    if (historyData.length === 0 || !selectedHistoryAuditor) return [];
    
    // Filter records of selected auditor and selected month
    const audRecords = historyData.filter(record => {
      if (record.employeeName !== selectedHistoryAuditor) return false;
      if (selectedHistoryMonth) {
        const parts = record.date.split('-');
        if (parts.length === 3) {
          const mKey = `${parts[2]}-${parts[1]}`;
          if (mKey !== selectedHistoryMonth) return false;
        } else {
          return false;
        }
      }
      return true;
    });

    return Array.from(new Set(audRecords.map(r => r.date))).filter(Boolean);
  }, [historyData, selectedHistoryAuditor, selectedHistoryMonth]);

  const historyStats = useMemo(() => {
    if (historyData.length === 0 || !selectedHistoryAuditor) return null;
    
    // Filter records of this auditor in this specific month
    const audMonthRecords = historyData.filter(record => {
      if (record.employeeName !== selectedHistoryAuditor) return false;
      if (selectedHistoryMonth) {
        const parts = record.date.split('-');
        if (parts.length === 3) {
          const mKey = `${parts[2]}-${parts[1]}`;
          if (mKey !== selectedHistoryMonth) return false;
        } else {
          return false;
        }
      }
      return true;
    });

    // Lookup base location from master list
    const masterInfo = auditorsMaster.find(a => 
      a.name.toLowerCase().includes(selectedHistoryAuditor.toLowerCase()) ||
      selectedHistoryAuditor.toLowerCase().includes(a.name.toLowerCase())
    );
    
    const baseLoc = masterInfo?.location || 'Unknown';
    return calculateTravelStats(audMonthRecords, baseLoc);
  }, [historyData, selectedHistoryAuditor, selectedHistoryMonth]);

  // We no longer return the ExcelUpload component as a separate page.
  // Instead, we always show the dashboard shell.

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
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept=".xlsx, .xls, .csv" 
          onChange={handleFileUpload}
        />
        <button 
          onClick={() => fileInputRef.current?.click()} 
          disabled={isParsing}
          style={{ 
            background: isParsing ? 'rgba(88, 166, 255, 0.2)' : 'transparent', 
            border: '1px solid var(--border-main)', 
            color: 'var(--text-primary)', 
            padding: '6px 12px', 
            borderRadius: '6px', 
            cursor: isParsing ? 'wait' : 'pointer', 
            fontSize: '0.75rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px' 
          }}
        >
          {isParsing ? (
            <div className="spinner-small" style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          ) : (
            <Upload size={14} />
          )}
          {isParsing ? 'Processing...' : 'New Upload'}
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

      {reportData.length === 0 ? (
        <div className="card" style={{ padding: '60px', textAlign: 'center', background: 'rgba(88, 166, 255, 0.02)', border: '2px dashed var(--border-main)' }}>
          <div style={{ marginBottom: '20px', color: 'var(--accent-primary)' }}>
            <Upload size={48} style={{ opacity: 0.5 }} />
          </div>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>No Data Available</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>Please upload a GoSurvey attendance file to populate the dashboard.</p>
          <button 
            onClick={() => fileInputRef.current?.click()}
            style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}
          >
            Select File
          </button>
        </div>
      ) : stats && (
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


        </div>
      )}

      {/* Auditor's Geographic Footprint - History Section */}
      <div className="card" style={{ marginTop: '40px', padding: '24px', background: 'rgba(88, 166, 255, 0.02)', border: '1px solid var(--border-main)', borderRadius: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '1.45rem', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Compass size={28} color="var(--accent-primary)" /> Auditor's Geographic Footprint
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>AI-Powered historical movement and route efficiency analyzer (Multi-Sheet Sync)</p>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input 
              type="text" 
              placeholder="Paste Google Spreadsheet Link here..." 
              value={historyUrl}
              onChange={(e) => setHistoryUrl(e.target.value)}
              style={{ 
                width: '320px',
                background: 'var(--bg-secondary)', 
                color: '#fff', 
                border: '1px solid var(--border-main)', 
                padding: '10px 14px', 
                borderRadius: '8px', 
                fontSize: '0.8rem',
                outline: 'none',
                transition: 'border 0.2s'
              }}
            />
            <button 
              onClick={handleHistorySync}
              disabled={isFetchingHistory || !historyUrl}
              style={{ 
                background: 'var(--accent-primary)', 
                color: '#fff', 
                border: 'none', 
                padding: '10px 22px', 
                borderRadius: '8px', 
                cursor: 'pointer', 
                fontWeight: '600',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                opacity: (isFetchingHistory || !historyUrl) ? 0.6 : 1,
                boxShadow: '0 4px 12px rgba(88, 166, 255, 0.15)'
              }}
            >
              {isFetchingHistory ? <div className="spinner-small"></div> : <Upload size={14} />}
              Sync Spreadsheet
            </button>

            {historyData.length > 0 && (
              <button 
                onClick={handleFetchAllAIInsights}
                disabled={isAnalyzingAll}
                style={{ 
                  background: 'rgba(188, 140, 255, 0.1)', 
                  color: '#bc8cff', 
                  border: '1px solid rgba(188, 140, 255, 0.3)', 
                  padding: '10px 16px', 
                  borderRadius: '8px', 
                  cursor: 'pointer', 
                  fontWeight: '600',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  opacity: isAnalyzingAll ? 0.6 : 1
                }}
              >
                {isAnalyzingAll ? <div className="spinner-small"></div> : <Activity size={14} />}
                Team AI Summary
              </button>
            )}
          </div>
        </div>

        {/* Global Team AI Insights if active */}
        {allAuditorsInsights && (
          <div className="animate-in" style={{ padding: '16px', background: 'rgba(188, 140, 255, 0.05)', borderRadius: '12px', border: '1px solid rgba(188, 140, 255, 0.15)', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '0.9rem', color: '#bc8cff', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 10px 0' }}>
              <Activity size={16} /> Regional Field Telemetry (DeepSeek AI Analysis)
            </h3>
            <div style={{ whiteSpace: 'pre-line', fontSize: '0.8rem', color: '#c9d1d9', lineHeight: '1.5' }}>
              {allAuditorsInsights}
            </div>
          </div>
        )}

        {historyData.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Filters panel */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              
              {/* Select Auditor */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Auditor Name</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-secondary)', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
                  <Users size={14} color="var(--accent-primary)" />
                  <select 
                    value={selectedHistoryAuditor}
                    onChange={(e) => {
                      setSelectedHistoryAuditor(e.target.value);
                      setAiAnalysisText('');
                      setSelectedHistoryDate('');
                    }}
                    style={{ background: 'var(--bg-secondary)', color: '#fff', border: 'none', padding: '6px 12px 6px 4px', fontSize: '0.8rem', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="" style={{ background: '#161b22', color: '#fff' }}>Show All Auditors</option>
                    {Array.from(new Set(historyData.map(d => d.employeeName))).filter(Boolean).sort().map(name => (
                      <option key={name} value={name} style={{ background: '#161b22', color: '#fff' }}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Select Month */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Select Month</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-secondary)', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
                  <Calendar size={14} color="var(--accent-primary)" />
                  <select 
                    value={selectedHistoryMonth}
                    onChange={(e) => {
                      setSelectedHistoryMonth(e.target.value);
                      setAiAnalysisText('');
                      setSelectedHistoryDate('');
                    }}
                    style={{ background: 'var(--bg-secondary)', color: '#fff', border: 'none', padding: '6px 12px 6px 4px', fontSize: '0.8rem', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="" style={{ background: '#161b22', color: '#fff' }}>Show All Months</option>
                    {availableHistoryMonths.map(month => (
                      <option key={month.key} value={month.key} style={{ background: '#161b22', color: '#fff' }}>{month.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Select Specific Date */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date Filter</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-secondary)', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
                  <Filter size={14} color="var(--accent-primary)" />
                  <select 
                    value={selectedHistoryDate}
                    onChange={(e) => setSelectedHistoryDate(e.target.value)}
                    style={{ background: 'var(--bg-secondary)', color: '#fff', border: 'none', padding: '6px 12px 6px 4px', fontSize: '0.8rem', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="" style={{ background: '#161b22', color: '#fff' }}>Show All Month Dates</option>
                    {activeHistoryDates.map(date => (
                      <option key={date} value={date} style={{ background: '#161b22', color: '#fff' }}>{date}</option>
                    ))}
                  </select>
                </div>
              </div>

            </div>

            {/* Travel Stats Summary Dashboard */}
            {historyStats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                <div style={{ padding: '16px', background: 'rgba(88, 166, 255, 0.05)', borderRadius: '12px', border: '1px solid rgba(88, 166, 255, 0.1)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Home Base Location</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#fff', marginTop: '6px' }}>{historyStats.baseLocation}</div>
                </div>

                <div style={{ padding: '16px', background: 'rgba(63, 185, 80, 0.05)', borderRadius: '12px', border: '1px solid rgba(63, 185, 80, 0.1)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Distance Travelled</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#3fb950', marginTop: '6px' }}>
                    {historyStats.totalKms} <span style={{ fontSize: '0.75rem', fontWeight: '400' }}>KM</span>
                  </div>
                </div>

                <div style={{ padding: '16px', background: 'rgba(210, 153, 34, 0.05)', borderRadius: '12px', border: '1px solid rgba(210, 153, 34, 0.1)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Towns Visited</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#d29922', marginTop: '6px' }}>{historyStats.townsVisited}</div>
                </div>

                <div style={{ padding: '16px', background: 'rgba(188, 140, 255, 0.05)', borderRadius: '12px', border: '1px solid rgba(188, 140, 255, 0.1)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Travel Plan Adherence</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#bc8cff', marginTop: '6px' }}>
                    {historyStats.plannedCount} <span style={{ fontSize: '0.75rem', fontWeight: '400', color: 'var(--text-secondary)' }}>Visits ({historyStats.plannedAdherence}%)</span>
                  </div>
                </div>

                <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Log Days Breakdown</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#fff', marginTop: '6px', display: 'flex', gap: '10px' }}>
                    <span style={{ color: '#3fb950' }}>{historyStats.workingDays}d <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Work</span></span>
                    <span style={{ color: '#8b949e' }}>{historyStats.leaveDays}d <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Off</span></span>
                  </div>
                </div>
              </div>
            )}

            {/* DeepSeek Travel Analysis AI Agent Block */}
            {historyStats && (
              <div style={{ background: 'rgba(88, 166, 255, 0.02)', padding: '20px', borderRadius: '14px', border: '1px solid rgba(88, 166, 255, 0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', background: '#58a6ff', borderRadius: '50%' }}></div>
                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#58a6ff' }}>DeepSeek AI Travel Agent Insights</span>
                  </div>
                  
                  <button
                    onClick={() => handleFetchAIInsights(
                      selectedHistoryAuditor, 
                      selectedHistoryMonth, 
                      filteredHistoryRecords.filter(r => r.employeeName === selectedHistoryAuditor),
                      historyStats
                    )}
                    disabled={isAnalyzingTravel}
                    style={{ 
                      background: 'rgba(88, 166, 255, 0.1)', 
                      color: 'var(--accent-primary)', 
                      border: '1px solid rgba(88, 166, 255, 0.3)', 
                      padding: '6px 14px', 
                      borderRadius: '6px', 
                      cursor: 'pointer', 
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    {isAnalyzingTravel ? <div className="spinner-small"></div> : <Compass size={12} />}
                    Analyze Travel Strategy
                  </button>
                </div>

                {isAnalyzingTravel && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    <div className="spinner-small"></div>
                    DeepSeek is analyzing coordinates, base proximity and travel efficiency patterns...
                  </div>
                )}

                {aiAnalysisText && (
                  <div className="animate-in" style={{ padding: '14px', background: 'rgba(255,255,255,0.01)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)', fontSize: '0.8rem', lineHeight: '1.6', color: '#c9d1d9', whiteSpace: 'pre-wrap' }}>
                    {aiAnalysisText}
                  </div>
                )}
              </div>
            )}

            {/* Travel Map */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
              <div className="card" style={{ padding: '16px', background: 'rgba(0,0,0,0.2)' }}>
                <h3 style={{ fontSize: '0.85rem', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={16} color="#ffd700" /> Auditor Travel Footprint Map (Yellow: History Points)
                </h3>
                <IndiaLiveMap 
                  data={[]} 
                  historyData={filteredHistoryRecords}
                  auditorsMaster={auditorsMaster} 
                />
              </div>
            </div>

            {/* Detailed Travel Log Table */}
            <div className="chart-card" style={{ padding: '16px' }}>
              <h3 className="chart-title" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={16} color="var(--accent-primary)" /> Travel & Route Logs ({filteredHistoryRecords.length} records)
              </h3>
              <div className="table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>From Town</th>
                      <th>To Town</th>
                      <th>Distance</th>
                      <th>Work Type</th>
                      <th>Planned Retail Store</th>
                      <th>Hotel Stay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistoryRecords.slice().sort((a,b) => new Date(a.date) - new Date(b.date)).map((item, index) => (
                      <tr key={index}>
                        <td style={{ fontSize: '0.75rem', fontWeight: '600' }}>{item.date}</td>
                        <td style={{ fontSize: '0.75rem' }}>{item.fromTown || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                        <td style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--accent-primary)' }}>{item.toTown || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                        <td style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{item.kms ? `${item.kms} km` : <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                        <td style={{ fontSize: '0.75rem' }}>
                          <span className={`status-badge ${item.isWorkingDay ? 'status-active' : 'status-inactive'}`} style={{ padding: '2px 6px', fontSize: '0.65rem' }}>
                            {item.workType || 'Holiday/Off'}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.75rem' }}>{item.plannedRSName || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                        <td style={{ fontSize: '0.75rem' }}>{item.hotelStay || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', background: 'rgba(255,255,255,0.01)', borderRadius: '12px', border: '1px dashed var(--border-main)' }}>
            <Compass size={40} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No travel history synchronised yet. Paste a public Google Spreadsheet link above and click "Sync Spreadsheet" to analyze auditor footprints.</div>
          </div>
        )}
      </div>

    </div>
  );
};

export default AttendanceDashboard;
