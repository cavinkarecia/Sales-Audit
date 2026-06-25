import React, { useState, useMemo } from 'react';
import LeafletTravelMap from './LeafletTravelMap';
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
  ChevronDown,
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
import { toDayKey, parseLocalDate, formatDayLabel, weekdayFromDayKey, WEEKDAY_OPTIONS } from '../utils/attendanceProcessor';
import { fetchAllSheets, groupByEmployee, groupByMonth, calculateTravelStats } from '../utils/sheetFetcher';
import { buildTravelLegs, dayColor } from '../utils/travelMapUtils';
import { getAIInsights, analyzeAllAuditorsTravel } from '../utils/deepseekAgent';
import { useAuditData } from '../context/AuditDataContext';

const normalizeReportData = (data) =>
  (Array.isArray(data) ? data : [])
    .map((record) => {
      const chooseDate = parseLocalDate(record.chooseDate ?? record.date);
      return {
        ...record,
        chooseDate,
        date: chooseDate,
      };
    })
    .filter((record) => record.name && record.chooseDate);

const dropdownPanelStyle = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  zIndex: 120,
  minWidth: '260px',
  maxHeight: '280px',
  overflowY: 'auto',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-main)',
  borderRadius: '8px',
  boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
  padding: '8px',
};

const FilterDropdown = ({ label, summary, icon, isOpen, onToggle, onClose, children, minWidth = 220 }) => {
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isOpen, onClose]);

  return (
    <div ref={ref} style={{ position: 'relative', minWidth }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          background: 'var(--bg-secondary)',
          color: '#fff',
          border: '1px solid var(--border-main)',
          padding: '7px 12px',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '0.78rem',
          textAlign: 'left',
        }}
      >
        {icon}
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{label}</span>
          <span style={{ fontWeight: '600' }}>{summary}</span>
        </span>
        <ChevronDown size={14} style={{ marginLeft: 'auto', opacity: 0.7 }} />
      </button>
      {isOpen && <div style={{ ...dropdownPanelStyle, minWidth }}>{children}</div>}
    </div>
  );
};

const AttendanceDashboard = () => {
  const {
    setAttendanceRecords,
    setPjpRecords,
    setPjpSheetSummary,
    setPjpSpreadsheetUrl,
    attendanceRecords: ctxAttendance,
    pjpRecords: ctxPjp,
    pjpSpreadsheetUrl: ctxPjpUrl,
    pjpSheetSummary: ctxPjpSummary,
  } = useAuditData();
  const [reportData, setReportData] = useState(() => {
    try {
      const saved = localStorage.getItem('sales_audit_report_data');
      return saved ? normalizeReportData(JSON.parse(saved)) : [];
    } catch (e) {
      console.error('Error loading data from localStorage:', e);
      return [];
    }
  });
  const [timeFilter, setTimeFilter] = useState('daily');
  const [activePeriod, setActivePeriod] = useState(null);
  const [selectedDayKeys, setSelectedDayKeys] = useState([]);
  const [selectedWeekdays, setSelectedWeekdays] = useState([]);
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
  const [dayDropdownOpen, setDayDropdownOpen] = useState(false);
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

  // Persist data to localStorage + shared context
  React.useEffect(() => {
    localStorage.setItem('sales_audit_report_data', JSON.stringify(reportData));
    if (reportData.length) setAttendanceRecords(reportData);
  }, [reportData, setAttendanceRecords]);

  React.useEffect(() => {
    if (ctxAttendance.length && reportData.length === 0) {
      setReportData(normalizeReportData(ctxAttendance));
    }
  }, [ctxAttendance]);

  React.useEffect(() => {
    if (ctxPjp.length && historyData.length === 0) {
      setHistoryData(ctxPjp);
      if (ctxPjpSummary.length) setHistorySheetsSummary(ctxPjpSummary);
      if (ctxPjpUrl) setHistoryUrl(ctxPjpUrl);
    }
  }, [ctxPjp]);

  React.useEffect(() => {
    if (historyData.length) {
      setPjpRecords(historyData);
      setPjpSheetSummary(historySheetsSummary);
      if (historyUrl) setPjpSpreadsheetUrl(historyUrl);
    }
  }, [historyData, historySheetsSummary, historyUrl]);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsParsing(true);
    try {
      const data = await parseAttendanceExcel(file);
      const uploadBatch = Date.now();
      const tagged = data.map((row) => ({ ...row, _uploadBatch: uploadBatch }));

      localStorage.removeItem('sales_audit_report_data');
      setAttendanceRecords([]);

      setTimeFilter('daily');
      setActivePeriod(null);
      setSelectedWeekdays([]);
      setExpandedKpi(null);
      setSelectedCluster(null);

      const dayKeys = [...new Set(tagged.map((d) => toDayKey(d.chooseDate)).filter(Boolean))].sort();
      setSelectedDayKeys(dayKeys);
      setReportData(tagged);
      setAttendanceRecords(tagged);

      const auditorCount = new Set(tagged.map((d) => d.name)).size;
      if (dayKeys.length > 0) {
        alert(
          `Loaded ${tagged.length} attendance record${tagged.length === 1 ? '' : 's'} for ${auditorCount} auditor${auditorCount === 1 ? '' : 's'}.\n` +
          `Choose Date: ${formatDayLabel(dayKeys[0])}${dayKeys.length > 1 ? ` → ${formatDayLabel(dayKeys[dayKeys.length - 1])}` : ''} (${dayKeys.length} day${dayKeys.length === 1 ? '' : 's'}).`,
        );
      }
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

      if (result.records.length > 0) {
        const firstRecord = result.records[0];
        setSelectedHistoryAuditor(firstRecord.employeeName || '');

        const monthGroup = groupByMonth(result.records);
        if (monthGroup.length > 0) {
          setSelectedHistoryMonth(monthGroup[0].key);
        }
        setSelectedHistoryDate('');

        const loadedCount = result.totalLoadedSheets ?? result.sheetSummary.filter(s => s.status === 'loaded').length;
        const skippedCount = result.totalSkippedSheets ?? (result.totalSheets - loadedCount);
        const skippedSheets = (result.skippedSheets || result.sheetSummary.filter(s => s.status !== 'loaded')) || [];
        const skippedNote = skippedCount > 0
          ? `\n\n${skippedCount} sheet${skippedCount === 1 ? '' : 's'} skipped:\n` +
            skippedSheets.slice(0, 6).map(s => `  • ${s.sheetName} — ${s.reason || s.status}`).join('\n') +
            (skippedSheets.length > 6 ? `\n  • … and ${skippedSheets.length - 6} more (see the Sync Summary panel)` : '')
          : '';
        alert(`Loaded ${loadedCount} of ${result.totalSheets} sheets (${result.totalRecords} travel records).${skippedNote}`);
      } else {
        alert(`Fetched the spreadsheet but no rows could be parsed across its ${result.totalSheets} sheet${result.totalSheets === 1 ? '' : 's'}. Check that the sheets contain Date and Employee Name columns.`);
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
      setExpandedKpi(null);
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

  const latestUploadBatch = useMemo(() => {
    const batches = reportData.map((r) => r._uploadBatch).filter(Boolean);
    return batches.length ? Math.max(...batches) : null;
  }, [reportData]);

  const activeReportData = useMemo(() => {
    if (latestUploadBatch == null) return reportData;
    return reportData.filter((r) => !r._uploadBatch || r._uploadBatch === latestUploadBatch);
  }, [reportData, latestUploadBatch]);

  const processedData = useMemo(() => {
    if (activeReportData.length === 0) return [];
    return activeReportData
      .map((record) => {
        const chooseDate = parseLocalDate(record.chooseDate ?? record.date);
        if (!chooseDate || !record.name) return null;

        const chooseDateKey = toDayKey(chooseDate);
        const masterInfo = auditorsMaster.find(
          (a) =>
            a.name.toLowerCase().includes(record.name.toLowerCase()) ||
            record.name.toLowerCase().includes(a.name.toLowerCase()),
        );
        const geoCluster = detectClusterFromCoords(record.location);
        const parts = record.location
          ? record.location.split(/[,\s]+/).map((p) => parseFloat(p)).filter((p) => !Number.isNaN(p))
          : [];
        const currentCity = parts.length >= 2 ? findNearestCity(parts[0], parts[1]) : 'Offline';
        const distance =
          parts.length >= 2 && masterInfo?.coords
            ? getDistance(masterInfo.coords.lat, masterInfo.coords.lng, parts[0], parts[1])
            : 'N/A';

        let mappedAsmName = record.asmName || 'N/A';
        if (record.name) {
          const lowerName = record.name.toLowerCase().trim();
          mappedAsmName = asmMapping[lowerName] || mappedAsmName;
          if (mappedAsmName === 'N/A') {
            const match = Object.keys(asmMapping).find(
              (k) => k.includes(lowerName) || lowerName.includes(k),
            );
            if (match) mappedAsmName = asmMapping[match];
          }
        }

        return {
          ...record,
          chooseDate,
          date: chooseDate,
          asmName: mappedAsmName,
          baseLocation: masterInfo?.location || 'Unknown',
          currentCity,
          distanceFromBase: distance,
          cluster: geoCluster || masterInfo?.cluster || 'Unknown',
          empCode: masterInfo?.empCode || 'N/A',
          weekKey: format(startOfWeek(chooseDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          monthKey: format(startOfMonth(chooseDate), 'yyyy-MM'),
          chooseDateKey,
          dayKey: chooseDateKey,
          weekday: weekdayFromDayKey(chooseDateKey),
        };
      })
      .filter(Boolean);
  }, [activeReportData]);

  const allChooseDateOptions = useMemo(() => {
    if (processedData.length === 0) return [];
    const keys = [...new Set(processedData.map((d) => d.chooseDateKey).filter(Boolean))].sort();
    return keys.map((key) => ({ key, label: formatDayLabel(key) }));
  }, [processedData]);

  const availableDailyDates = useMemo(() => {
    if (allChooseDateOptions.length === 0) return [];
    if (selectedWeekdays.length === 0) return allChooseDateOptions;
    return allChooseDateOptions.filter((d) => selectedWeekdays.includes(weekdayFromDayKey(d.key)));
  }, [allChooseDateOptions, selectedWeekdays]);

  const availablePeriods = useMemo(() => {
    if (processedData.length === 0) return [];
    const periods = new Set();
    processedData.forEach((item) => {
      if (timeFilter === 'weekly') periods.add(item.weekKey);
      if (timeFilter === 'monthly') periods.add(item.monthKey);
    });
    return Array.from(periods)
      .filter(Boolean)
      .sort()
      .map((key) => {
        let label = key;
        if (timeFilter === 'weekly') {
          label = `Week of ${formatDayLabel(key)}`;
        } else if (timeFilter === 'monthly') {
          const [year, month] = key.split('-');
          label = format(new Date(Number(year), Number(month) - 1, 1), 'MMMM yyyy');
        }
        return { key, label };
      });
  }, [processedData, timeFilter]);

  React.useEffect(() => {
    if (selectedDayKeys.length > 0 || allChooseDateOptions.length === 0) return;
    setSelectedDayKeys(allChooseDateOptions.map((d) => d.key));
  }, [allChooseDateOptions, selectedDayKeys.length]);

  React.useEffect(() => {
    if (selectedWeekdays.length === 0) return;
    setSelectedDayKeys(availableDailyDates.map((d) => d.key));
  }, [selectedWeekdays]);

  React.useEffect(() => {
    if (timeFilter === 'daily') return;
    if (availablePeriods.length === 0) {
      setActivePeriod(null);
      return;
    }
    const stillValid = activePeriod && availablePeriods.some((p) => p.key === activePeriod);
    if (!stillValid) {
      setActivePeriod(availablePeriods[0].key);
    }
  }, [availablePeriods, activePeriod, timeFilter]);

  const uploadSummary = useMemo(() => {
    if (processedData.length === 0) return null;
    const dayKeys = [...new Set(processedData.map((d) => d.chooseDateKey).filter(Boolean))].sort();
    const monthKeys = [...new Set(processedData.map((d) => d.monthKey).filter(Boolean))].sort();
    return {
      records: processedData.length,
      auditors: new Set(processedData.map((d) => d.name)).size,
      days: dayKeys.length,
      months: monthKeys.length,
      from: dayKeys[0],
      to: dayKeys[dayKeys.length - 1],
    };
  }, [processedData]);

  const toggleDayKey = (dayKey) => {
    setSelectedDayKeys((prev) =>
      prev.includes(dayKey) ? prev.filter((k) => k !== dayKey) : [...prev, dayKey].sort(),
    );
    setExpandedKpi(null);
  };

  const toggleWeekday = (weekday) => {
    setSelectedWeekdays((prev) =>
      prev.includes(weekday) ? prev.filter((w) => w !== weekday) : [...prev, weekday],
    );
    setExpandedKpi(null);
  };

  const handleClearAllFilters = () => {
    setSelectedWeekdays([]);
    setSelectedDayKeys(allChooseDateOptions.map((d) => d.key));
    setDateDropdownOpen(false);
    setDayDropdownOpen(false);
    setExpandedKpi(null);
  };

  const dateFilterSummary =
    selectedDayKeys.length === 0
      ? 'No dates'
      : selectedDayKeys.length === allChooseDateOptions.length
        ? `All (${allChooseDateOptions.length})`
        : `${selectedDayKeys.length} selected`;

  const dayFilterSummary =
    selectedWeekdays.length === 0 ? 'All days' : selectedWeekdays.join(', ');

  const filteredData = useMemo(() => {
    if (processedData.length === 0) return [];

    let rows = processedData;

    if (selectedDayKeys.length > 0) {
      rows = rows.filter((item) => selectedDayKeys.includes(item.chooseDateKey));
    }

    if (selectedWeekdays.length > 0) {
      rows = rows.filter((item) => selectedWeekdays.includes(item.weekday));
    }

    if (timeFilter === 'weekly' && activePeriod) {
      rows = rows.filter((item) => item.weekKey === activePeriod);
    }
    if (timeFilter === 'monthly' && activePeriod) {
      rows = rows.filter((item) => item.monthKey === activePeriod);
    }

    return rows;
  }, [processedData, timeFilter, activePeriod, selectedDayKeys, selectedWeekdays]);

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

  const emptyStats = {
    total: 0,
    totalAuditorNames: [],
    absent: 0,
    absenteeNames: [],
    attendanceRate: 0,
    plannedRate: 0,
    absenceReasons: [],
    clusterAudits: [],
  };
  const displayStats = stats || emptyStats;

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
    if (historyData.length === 0) return [];
    
    // Filter records of selected auditor (or all if empty) and selected month (or all if empty)
    const audRecords = historyData.filter(record => {
      if (selectedHistoryAuditor && record.employeeName !== selectedHistoryAuditor) return false;
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

    const uniqueDates = Array.from(new Set(audRecords.map(r => r.date))).filter(Boolean);
    
    // Sort unique dates chronologically
    return uniqueDates.sort((a, b) => {
      const aParts = a.split('-');
      const bParts = b.split('-');
      if (aParts.length === 3 && bParts.length === 3) {
        const aDateStr = `${aParts[2]}-${aParts[1]}-${aParts[0]}`;
        const bDateStr = `${bParts[2]}-${bParts[1]}-${bParts[0]}`;
        return aDateStr.localeCompare(bDateStr);
      }
      return a.localeCompare(b);
    });
  }, [historyData, selectedHistoryAuditor, selectedHistoryMonth]);

  // Date-wise travel legs (built from filtered history records, sorted chronologically)
  const travelMap = useMemo(() => {
    if (!filteredHistoryRecords || filteredHistoryRecords.length === 0) {
      return { legs: [], unmappedTowns: [], dayKeys: [] };
    }
    return buildTravelLegs(filteredHistoryRecords, auditorsMaster);
  }, [filteredHistoryRecords]);

  const historyStats = useMemo(() => {
    if (historyData.length === 0) return null;
    
    // Filter records of this auditor in this specific month and date
    const audMonthRecords = historyData.filter(record => {
      if (selectedHistoryAuditor && record.employeeName !== selectedHistoryAuditor) return false;
      
      // Filter by Month
      if (selectedHistoryMonth) {
        const parts = record.date.split('-');
        if (parts.length === 3) {
          const mKey = `${parts[2]}-${parts[1]}`;
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

    // Lookup base location from master list
    let baseLoc = 'All Regions';
    if (selectedHistoryAuditor) {
      const masterInfo = auditorsMaster.find(a => 
        a.name.toLowerCase().includes(selectedHistoryAuditor.toLowerCase()) ||
        selectedHistoryAuditor.toLowerCase().includes(a.name.toLowerCase())
      );
      baseLoc = masterInfo?.location || 'Unknown';
    }
    
    return calculateTravelStats(audMonthRecords, baseLoc);
  }, [historyData, selectedHistoryAuditor, selectedHistoryMonth, selectedHistoryDate]);

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
              onClick={() => {
                setTimeFilter(f);
                setActivePeriod(null);
                setSelectedWeekdays([]);
                setExpandedKpi(null);
              }}
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

      {/* Filter bar: Upload | Choose Date dropdown | Day dropdown | Clear all */}
      <div className="card" style={{ display: 'flex', gap: '12px', marginBottom: '24px', alignItems: 'center', padding: '12px 16px', flexWrap: 'wrap' }}>
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
            padding: '8px 14px',
            borderRadius: '8px',
            cursor: isParsing ? 'wait' : 'pointer',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            whiteSpace: 'nowrap',
          }}
        >
          {isParsing ? (
            <div
              className="spinner-small"
              style={{
                width: '12px',
                height: '12px',
                border: '2px solid rgba(255,255,255,0.1)',
                borderTop: '2px solid #fff',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
          ) : (
            <Upload size={14} />
          )}
          {isParsing ? 'Processing...' : 'Upload attendance'}
        </button>

        <div style={{ width: '1px', height: '36px', background: 'var(--border-main)' }} />

        <FilterDropdown
          label="Choose Date"
          summary={processedData.length === 0 ? 'Upload file first' : dateFilterSummary}
          icon={<Calendar size={14} color="var(--accent-primary)" />}
          isOpen={dateDropdownOpen}
          onToggle={() => {
            setDateDropdownOpen((v) => !v);
            setDayDropdownOpen(false);
          }}
          onClose={() => setDateDropdownOpen(false)}
          minWidth={280}
        >
          <button
            type="button"
            onClick={() => setSelectedDayKeys(availableDailyDates.map((d) => d.key))}
            style={{
              width: '100%',
              marginBottom: '8px',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--accent-primary)',
              background: 'rgba(88, 166, 255, 0.12)',
              color: 'var(--accent-primary)',
              fontSize: '0.72rem',
              fontWeight: '700',
              cursor: 'pointer',
            }}
          >
            Select all
          </button>
          {availableDailyDates.length === 0 ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '4px' }}>
              No Choose Date values in upload
            </span>
          ) : (
            availableDailyDates.map((d) => (
              <label
                key={d.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.78rem',
                  padding: '5px 6px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  background: selectedDayKeys.includes(d.key) ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedDayKeys.includes(d.key)}
                  onChange={() => toggleDayKey(d.key)}
                />
                <span style={{ fontFamily: 'monospace' }}>{d.label}</span>
              </label>
            ))
          )}
        </FilterDropdown>

        <FilterDropdown
          label="Day filter"
          summary={dayFilterSummary}
          icon={<Filter size={14} color="var(--accent-primary)" />}
          isOpen={dayDropdownOpen}
          onToggle={() => {
            setDayDropdownOpen((v) => !v);
            setDateDropdownOpen(false);
          }}
          onClose={() => setDayDropdownOpen(false)}
          minWidth={180}
        >
          {WEEKDAY_OPTIONS.map((day) => (
            <label
              key={day}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.78rem',
                padding: '5px 6px',
                borderRadius: '4px',
                cursor: 'pointer',
                background: selectedWeekdays.includes(day) ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={selectedWeekdays.includes(day)}
                onChange={() => toggleWeekday(day)}
              />
              <span>{day}</span>
            </label>
          ))}
        </FilterDropdown>

        {uploadSummary && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>{uploadSummary.auditors}</strong> auditors ·{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{uploadSummary.days}</strong> Choose Date days
            </div>
            <div>
              {uploadSummary.from === uploadSummary.to
                ? formatDayLabel(uploadSummary.from)
                : `${formatDayLabel(uploadSummary.from)} → ${formatDayLabel(uploadSummary.to)}`}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleClearAllFilters}
          disabled={processedData.length === 0}
          style={{
            marginLeft: 'auto',
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border-main)',
            background: 'transparent',
            color: processedData.length === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
            fontSize: '0.75rem',
            fontWeight: '600',
            cursor: processedData.length === 0 ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Clear all
        </button>

        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
          <Filter size={12} /> <strong>{filteredData.length}</strong> records
        </div>
      </div>

      {timeFilter !== 'daily' && processedData.length > 0 && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', padding: '10px 16px' }}>
          <Calendar size={14} color="var(--accent-primary)" />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {timeFilter === 'weekly' ? 'Week (Choose Date)' : 'Month (Choose Date)'}
          </span>
          <select
            value={activePeriod || ''}
            onChange={(e) => {
              setActivePeriod(e.target.value);
              setExpandedKpi(null);
            }}
            disabled={availablePeriods.length === 0}
            style={{
              background: 'var(--bg-secondary)',
              color: '#fff',
              border: '1px solid var(--border-main)',
              padding: '4px 12px',
              borderRadius: '6px',
              cursor: availablePeriods.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              outline: 'none',
            }}
          >
            {availablePeriods.length === 0 ? (
              <option value="">No periods</option>
            ) : (
              availablePeriods.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))
            )}
          </select>
        </div>
      )}

      {reportData.length === 0 && (
        <div
          className="card"
          style={{
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            borderLeft: '3px solid var(--accent-primary)',
          }}
        >
          No attendance loaded yet — use <strong>Upload attendance</strong> above, then sync PJP below.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* KPI Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            {[
              { id: 'rate', label: 'Attendance Rate', value: `${displayStats.attendanceRate}%`, icon: <CheckCircle size={20} />, color: 'var(--accent-success)' },
              { id: 'total', label: 'Active Auditors', value: displayStats.total, icon: <Users size={20} />, color: 'var(--accent-primary)', interactive: true },
              { id: 'planned', label: 'Planned Coverage', value: `${displayStats.plannedRate}%`, icon: <Clock size={20} />, color: '#bc8cff' },
              { id: 'absent', label: 'Absentees', value: displayStats.absent, icon: <AlertTriangle size={20} />, color: 'var(--accent-danger)', interactive: true }
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
                {(expandedKpi === 'total' ? displayStats.totalAuditorNames : displayStats.absenteeNames).map((name, i) => (
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
              <LeafletTravelMap data={filteredData} auditorsMaster={auditorsMaster} height="520px" />
            </div>

            <div className="card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '0.9rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={18} color="var(--accent-primary)" /> Cluster Summary
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {displayStats.clusterAudits.map((cluster, i) => (
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
              <Compass size={28} color="var(--accent-primary)" /> PJP sync (From, To, Kms)
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>Paste PJP Google Sheet — fetches all auditor tabs automatically</p>
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
              Fetch all auditor sheets
            </button>
          </div>
        </div>

        {historyData.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Sync Summary — every workbook sheet with status (loaded / skipped + reason) */}
            {historySheetsSummary && historySheetsSummary.length > 0 && (
              <div className="chart-card" style={{ padding: '14px 16px' }}>
                {(() => {
                  const loaded = historySheetsSummary.filter(s => s.status === 'loaded');
                  const skipped = historySheetsSummary.filter(s => s.status !== 'loaded');
                  return (
                    <>
                      <h3 className="chart-title" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <FileText size={16} color="var(--accent-primary)" />
                        Sync Summary — {loaded.length} of {historySheetsSummary.length} sheets loaded
                        {skipped.length > 0 && (
                          <span style={{ marginLeft: '6px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(248,81,73,0.15)', color: '#f85149', fontSize: '0.65rem', fontWeight: '700' }}>
                            {skipped.length} skipped
                          </span>
                        )}
                      </h3>
                      <div className="table-container" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Sheet</th>
                              <th>Auditor (first row)</th>
                              <th>Records</th>
                              <th>Status</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historySheetsSummary.map((s, idx) => (
                              <tr key={`sync-${idx}-${s.sheetName}`}>
                                <td style={{ fontSize: '0.75rem', fontWeight: '600' }}>{s.sheetName}</td>
                                <td style={{ fontSize: '0.75rem' }}>{s.employeeName || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                                <td style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{s.recordCount}</td>
                                <td style={{ fontSize: '0.72rem' }}>
                                  <span className={`status-badge ${s.status === 'loaded' ? 'status-active' : 'status-inactive'}`} style={{ padding: '2px 6px', fontSize: '0.65rem' }}>
                                    {s.status === 'loaded' ? 'Loaded' : s.status.replace(/-/g, ' ')}
                                  </span>
                                </td>
                                <td style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{s.reason || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

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



            {/* Travel Map */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
              <div className="card" style={{ padding: '16px', background: 'rgba(0,0,0,0.2)' }}>
                <h3 style={{ fontSize: '0.85rem', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={16} color="var(--accent-primary)" /> Auditor Travel Footprint Map — Date-wise Routes
                </h3>
                <LeafletTravelMap
                  data={[]}
                  historyData={filteredHistoryRecords}
                  travelLegs={travelMap.legs}
                  auditorsMaster={auditorsMaster}
                  height="600px"
                />
              </div>
            </div>

            {/* Day-wise route summary: one row per leg, in chronological order */}
            {travelMap.legs.length > 0 && (
              <div className="chart-card" style={{ padding: '16px' }}>
                <h3 className="chart-title" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Compass size={16} color="var(--accent-primary)" /> Date-wise Route ({travelMap.legs.length} legs across {travelMap.dayKeys.length} day{travelMap.dayKeys.length === 1 ? '' : 's'})
                </h3>
                <div className="table-container" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Date</th>
                        <th>Auditor</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Distance</th>
                        <th>Mapped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {travelMap.legs.map((leg) => (
                        <tr key={leg.id}>
                          <td style={{ fontSize: '0.75rem', fontWeight: '700' }}>
                            <span style={{
                              display: 'inline-block',
                              minWidth: '36px',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              background: `${dayColor(leg.dayIndex)}22`,
                              color: dayColor(leg.dayIndex),
                              textAlign: 'center'
                            }}>
                              D{leg.dayIndex}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.75rem', fontWeight: '600' }}>{leg.date}</td>
                          <td style={{ fontSize: '0.75rem' }}>{leg.employeeName || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                          <td style={{ fontSize: '0.75rem' }}>
                            {leg.fromTown || <span style={{ color: 'var(--text-muted)' }}>-</span>}
                            {leg.fromMatchedCity && leg.fromTown && leg.fromMatchedCity.toLowerCase() !== leg.fromTown.toLowerCase() && (
                              <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>({leg.fromMatchedCity})</span>
                            )}
                          </td>
                          <td style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--accent-primary)' }}>
                            {leg.toTown || <span style={{ color: 'var(--text-muted)' }}>-</span>}
                            {leg.toMatchedCity && leg.toTown && leg.toMatchedCity.toLowerCase() !== leg.toTown.toLowerCase() && (
                              <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>({leg.toMatchedCity})</span>
                            )}
                          </td>
                          <td style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
                            {leg.kms != null ? `${Math.round(leg.kms)} km` : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                            {leg.reportedKms == null && leg.computedKms != null && (
                              <span style={{ color: 'var(--text-muted)', marginLeft: '4px', fontWeight: 'normal' }}>(calc)</span>
                            )}
                          </td>
                          <td style={{ fontSize: '0.75rem' }}>
                            <span className={`status-badge ${leg.mapped ? 'status-active' : 'status-inactive'}`} style={{ padding: '2px 6px', fontSize: '0.65rem' }}>
                              {leg.mapped ? 'Yes' : 'Partial'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Unmapped towns — names from the sheet that don't resolve to a city in cities.json */}
            {travelMap.unmappedTowns.length > 0 && (
              <div className="chart-card" style={{ padding: '16px', border: '1px solid rgba(248, 81, 73, 0.25)', background: 'rgba(248, 81, 73, 0.04)' }}>
                <h3 className="chart-title" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', color: '#f85149' }}>
                  <AlertTriangle size={16} /> Unmapped Towns ({travelMap.unmappedTowns.length})
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '4px 0 12px' }}>
                  These town names did not match anything in <code>cities.json</code>. Add aliases in <code>src/utils/geoUtils.js</code> (the <code>TOWN_ALIASES</code> map) or correct them in the spreadsheet so they plot accurately.
                </p>
                <div className="table-container" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Town (as entered)</th>
                        <th>State</th>
                        <th>Occurrences</th>
                        <th>Reported by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {travelMap.unmappedTowns.map((u, idx) => (
                        <tr key={`unmapped-${idx}`}>
                          <td style={{ fontSize: '0.75rem', fontWeight: '600' }}>{u.town || <span style={{ color: 'var(--text-muted)' }}>(blank)</span>}</td>
                          <td style={{ fontSize: '0.75rem' }}>{u.state || <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                          <td style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{u.count}</td>
                          <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{u.employees.join(', ') || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

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
