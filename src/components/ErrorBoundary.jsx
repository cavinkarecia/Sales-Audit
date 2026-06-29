import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }

  handleReset = () => {
    try {
      localStorage.removeItem('sales_audit_report_data');
      localStorage.removeItem('sales_audit_pjp_v2');
      localStorage.removeItem('sales_audit_pjp_summary_v2');
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          padding: '32px 24px',
          background: '#0d1117',
          color: '#f0f6fc',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <h1 style={{ marginTop: 0 }}>Sales Audit could not load</h1>
        <p style={{ color: '#8b949e', maxWidth: 560 }}>
          The page hit an error — often caused by old cached data in the browser. Try clearing saved
          data and reloading.
        </p>
        <pre
          style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: 12,
            fontSize: '0.75rem',
            overflow: 'auto',
            maxWidth: 720,
          }}
        >
          {error.message}
        </pre>
        <button
          type="button"
          onClick={this.handleReset}
          style={{
            marginTop: 16,
            padding: '10px 18px',
            borderRadius: 8,
            border: 'none',
            background: '#58a6ff',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Clear saved data &amp; reload
        </button>
      </div>
    );
  }
}
