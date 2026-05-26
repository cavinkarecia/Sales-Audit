import React, { useState } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from 'lucide-react';
import { parseAttendanceExcel } from '../utils/ExcelParser';

const ExcelUpload = ({ onDataLoaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleFile = async (file) => {
    if (!file.name.match(/\.(xlsx|xls|csv)$/)) {
      setError('Please upload a valid Excel or CSV file.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const data = await parseAttendanceExcel(file);
      onDataLoaded(data);
      setSuccess(true);
    } catch (err) {
      console.error(err);
      setError('Failed to parse file. Ensure it matches the GoSurvey format.');
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="upload-container" style={{ marginBottom: '2rem' }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${isDragging ? 'var(--accent-brand)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: '16px',
          padding: '3rem',
          textAlign: 'center',
          background: isDragging ? 'rgba(88, 166, 255, 0.05)' : 'rgba(255,255,255,0.02)',
          transition: 'all 0.3s ease',
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden'
        }}
        onClick={() => document.getElementById('fileInput').click()}
      >
        <input
          id="fileInput"
          type="file"
          hidden
          onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
          accept=".xlsx, .xls, .csv"
        />
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          {loading ? (
            <div className="spinner" style={{ width: '40px', height: '40px', border: '4px solid rgba(88, 166, 255, 0.1)', borderTop: '4px solid var(--accent-brand)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          ) : success ? (
            <CheckCircle2 size={48} color="#3fb950" />
          ) : (
            <Upload size={48} color={isDragging ? 'var(--accent-brand)' : 'var(--text-secondary)'} />
          )}
          
          <div>
            <h3 style={{ margin: '0 0 0.5rem 0' }}>
              {success ? 'File Uploaded Successfully' : 'Upload GoSurvey Attendance'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              Drag & Drop the Excel attendance sheet or click to browse
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <FileSpreadsheet size={16} /> .XLSX / .CSV SUPPORTED
            </div>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: '1.5rem', padding: '0.75rem', borderRadius: '8px', background: 'rgba(248, 81, 73, 0.1)', color: '#f85149', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default ExcelUpload;
