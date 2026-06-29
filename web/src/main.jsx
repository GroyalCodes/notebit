import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e) { return { e }; }
  render() {
    if (!this.state.e) return this.props.children;
    return (
      <div style={{ padding: 40, fontFamily: 'monospace', color: '#ffb4b4', background: '#0c0a10', minHeight: '100vh', whiteSpace: 'pre-wrap', fontSize: 13 }}>
        <div style={{ color: '#e1a845', fontSize: 18, marginBottom: 12 }}>⚠ Something errored — here's what:</div>
        {String(this.state.e?.stack || this.state.e)}
        <div style={{ marginTop: 20 }}><button onClick={() => location.reload()} style={{ padding: '8px 16px', cursor: 'pointer' }}>Reload</button></div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
