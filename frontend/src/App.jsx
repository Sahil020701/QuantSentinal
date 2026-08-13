import React, { useState, useEffect } from 'react';
import './App.css';

import DashboardTab from './components/DashboardTab';
import LogTab from './components/LogTab';
import ScannerTab from './components/ScannerTab';
import LedgerTab from './components/LedgerTab';
import ConfigTab from './components/ConfigTab';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export default function App() {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    fetchPortfolio();
  }, []);

  const fetchPortfolio = async () => {
    setLoading(true);
    setError(null);
    try {
      // API call automatically triggers catch-up simulation in backend
      const res = await fetch(`${API_URL}/api/portfolio`);
      if (!res.ok) throw new Error("Failed to load portfolio statistics");
      const data = await res.json();
      setPortfolio(data);
    } catch (err) {
      console.error(err);
      setError("Could not establish connection to the Quant Sentinal Trading Server. Please verify the backend is running on port 5001.");
    } finally {
      setLoading(false);
    }
  };

  // Determine market open status (Indian Stock Market: Monday to Friday)
  const getMarketStatusText = () => {
    const today = new Date();
    const day = today.getDay(); // 0 is Sunday, 6 is Saturday
    const hours = today.getHours();
    const minutes = today.getMinutes();
    const time = hours * 100 + minutes;

    if (day === 0 || day === 6) {
      return { open: false, text: "MARKET CLOSED (WEEKEND)" };
    }

    // Market hours: 9:15 AM (0915) to 3:30 PM (1530)
    if (time >= 915 && time <= 1530) {
      return { open: true, text: "MARKET LIVE (09:15 - 15:30)" };
    }

    return { open: false, text: "MARKET CLOSED (AFTER HOURS)" };
  };

  const marketStatus = getMarketStatusText();

  if (loading) {
    return (
      <div className="spinner-container" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: '500' }}>
          Loading Portfolio & Running Catch-up Simulation...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="glass-panel" style={{ maxWidth: '500px', textAlign: 'center', padding: '3rem 2rem' }}>
          <span style={{ fontSize: '3rem' }}>⚠️</span>
          <h2 style={{ margin: '1rem 0 0.5rem', color: 'var(--red)' }}>Server Connection Offline</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.6' }}>
            {error}
          </p>
          <button onClick={fetchPortfolio} className="btn btn-primary">
            🔄 Attempt Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header bar */}
      <header className="header-bar">
        <div className="brand-section">
          <div className="logo-badge">QS</div>
          <div className="brand-info">
            <h1>Quant Sentinal Trading Desk</h1>
            <p>Aggressive Indian Equities Portfolio Simulator</p>
          </div>
        </div>

        <div className={`status-badge ${marketStatus.open ? 'live' : 'closed'}`}>
          <div className="status-dot" />
          <span>{marketStatus.text}</span>
        </div>
      </header>

      {/* Tab Navs */}
      <nav className="tabs-navigation">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
        >
          💼 Portfolio Dashboard
        </button>
        <button
          onClick={() => setActiveTab('scanner')}
          className={`tab-btn ${activeTab === 'scanner' ? 'active' : ''}`}
        >
          🔍 Market Scanner
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
        >
          📝 Quant Sentinal Logs
        </button>
        <button
          onClick={() => setActiveTab('ledger')}
          className={`tab-btn ${activeTab === 'ledger' ? 'active' : ''}`}
        >
          📊 Closed Trades ({portfolio.history.length})
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
        >
          ⚙️ Strategy Config
        </button>
      </nav>

      {/* Main Tab Render */}
      <main style={{ flex: 1 }}>
        {activeTab === 'dashboard' && (
          <DashboardTab portfolio={portfolio} />
        )}

        {activeTab === 'scanner' && (
          <ScannerTab />
        )}

        {activeTab === 'logs' && (
          <LogTab logs={portfolio.logs} />
        )}

        {activeTab === 'ledger' && (
          <LedgerTab history={portfolio.history} />
        )}

        {activeTab === 'config' && (
          <ConfigTab
            portfolio={portfolio}
            onConfigUpdate={(newConfig) => {
              setPortfolio(prev => ({ ...prev, config: newConfig }));
            }}
            onReset={(newState) => {
              setPortfolio(newState);
              setActiveTab('dashboard');
            }}
            onDeposit={(newState) => {
              setPortfolio(newState);
            }}
            onTriggerRun={(newState) => {
              setPortfolio(newState);
            }}
          />
        )}
      </main>

      {/* Footer copyright */}
      <footer style={{ marginTop: '3rem', padding: '1rem 0', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        <span>Quant Sentinal Trading System • Aim: 15%-20% Annual Target</span>
        <span>Simulated on National Stock Exchange (NSE) Indices</span>
      </footer>
    </div>
  );
}
