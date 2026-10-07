import React, { useState, useEffect } from 'react';
import './App.css';

import DashboardTab from './components/DashboardTab';
import LogTab from './components/LogTab';
import ScannerTab from './components/ScannerTab';
import LedgerTab from './components/LedgerTab';
import ConfigTab from './components/ConfigTab';
import AlgoTop25Tab from './components/AlgoTop25Tab';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export default function App() {
  const [portfolioMode, setPortfolioMode] = useState(() => {
    return localStorage.getItem('qs_portfolio_mode') || 'live';
  });
  const [portfolio, setPortfolio] = useState(null);
  const [portfolioCache, setPortfolioCache] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    fetchPortfolio(portfolioMode);
  }, []);

  const updatePortfolioState = (mode, data) => {
    setPortfolio(data);
    setPortfolioCache(prev => ({ ...prev, [mode]: data }));
  };

  const fetchPortfolio = async (mode = portfolioMode) => {
    // Only show full-screen spinner if we do not have cached data for this mode yet
    if (!portfolioCache[mode] && !portfolio) {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/portfolio?mode=${mode}`);
      if (!res.ok) throw new Error("Failed to load portfolio statistics");
      const data = await res.json();
      updatePortfolioState(mode, data);
    } catch (err) {
      console.error(err);
      if (!portfolioCache[mode] && !portfolio) {
        setError("Could not establish connection to the Quant Sentinal Trading Server. Please verify the backend is running on port 5001.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchMode = (newMode) => {
    if (newMode === portfolioMode) return;
    setPortfolioMode(newMode);
    localStorage.setItem('qs_portfolio_mode', newMode);
    if (portfolioCache[newMode]) {
      setPortfolio(portfolioCache[newMode]);
    }
    fetchPortfolio(newMode);
  };

  // Determine market open status (Indian Stock Market: Monday to Friday, 09:15 - 15:30 IST)
  const getMarketStatusText = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30
    const istNow = new Date(now.getTime() + istOffset);
    const day = istNow.getUTCDay(); // 0 is Sunday, 6 is Saturday in IST
    const hours = istNow.getUTCHours();
    const minutes = istNow.getUTCMinutes();
    const time = hours * 100 + minutes;

    if (day === 0 || day === 6) {
      return { open: false, text: "MARKET CLOSED (WEEKEND)" };
    }

    // Market hours: 9:15 AM (0915) to 3:30 PM (1530) IST
    if (time >= 915 && time <= 1530) {
      return { open: true, text: "MARKET LIVE (09:15 - 15:30 IST)" };
    }

    return { open: false, text: "MARKET CLOSED (AFTER HOURS)" };
  };

  const marketStatus = getMarketStatusText();

  if (loading) {
    return (
      <div className="spinner-container" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: '500' }}>
          Loading {portfolioMode === 'live' ? 'Live Portfolio' : 'Backtest Simulation'}...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="glass-panel" style={{ maxWidth: '500px', textAlign: 'center', padding: '3rem 2rem' }}>
          <div className="status-badge closed" style={{ margin: '0 auto 1.5rem', width: 'fit-content' }}>
            <div className="status-dot" />
            <span>DISCONNECTED</span>
          </div>
          <h2 style={{ margin: '0 0 0.5rem', color: 'var(--red)' }}>Server Connection Offline</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.6' }}>
            {error}
          </p>
          <button onClick={() => fetchPortfolio(portfolioMode)} className="btn btn-primary">
            Attempt Connection
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
            <p>
              {portfolioMode === 'live'
                ? 'Forward Live Trading Desk (₹50,000 Capital Baseline)'
                : 'Historical Algorithmic Backtesting Simulator'}
            </p>
          </div>
        </div>

        {/* Portfolio Mode Switcher Toggle */}
        <div className="portfolio-switcher">
          <button
            type="button"
            className={`portfolio-toggle-btn ${portfolioMode === 'live' ? 'active-live' : ''}`}
            onClick={() => handleSwitchMode('live')}
            title="Live Trading Portfolio with ₹50,000 Starting Baseline"
          >
            <span className="mode-indicator live-dot" />
            <div className="mode-text-group">
              <span className="mode-title">Live Portfolio</span>
              <span className="mode-sub">₹50,000 Live Desk</span>
            </div>
          </button>
          <button
            type="button"
            className={`portfolio-toggle-btn ${portfolioMode === 'backtest' ? 'active-backtest' : ''}`}
            onClick={() => handleSwitchMode('backtest')}
            title="Historical Backtest Simulation (49.9% CAGR, 161 Trades)"
          >
            <span className="mode-indicator backtest-dot" />
            <div className="mode-text-group">
              <span className="mode-title">Backtesting</span>
              <span className="mode-sub">Historical Simulation</span>
            </div>
          </button>
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
          Portfolio Dashboard
        </button>
        <button
          onClick={() => setActiveTab('scanner')}
          className={`tab-btn ${activeTab === 'scanner' ? 'active' : ''}`}
        >
          Market Scanner
        </button>
        <button
          onClick={() => setActiveTab('algo')}
          className={`tab-btn ${activeTab === 'algo' ? 'active' : ''}`}
        >
          Algo Top 25
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
        >
          Quant Sentinal Logs
        </button>
        <button
          onClick={() => setActiveTab('ledger')}
          className={`tab-btn ${activeTab === 'ledger' ? 'active' : ''}`}
        >
          Closed Trades ({portfolio?.history?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
        >
          Strategy Config
        </button>
      </nav>

      {/* Main Tab Render */}
      <main style={{ flex: 1 }}>
        {activeTab === 'dashboard' && (
          <DashboardTab
            portfolio={portfolio}
            portfolioMode={portfolioMode}
            onPortfolioRefresh={() => fetchPortfolio(portfolioMode)}
          />
        )}

        {activeTab === 'scanner' && (
          <ScannerTab />
        )}

        {activeTab === 'algo' && (
          <AlgoTop25Tab
            portfolioMode={portfolioMode}
            onTradeExecuted={() => fetchPortfolio(portfolioMode)}
          />
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
            portfolioMode={portfolioMode}
            onConfigUpdate={(newConfig) => {
              setPortfolio(prev => {
                const updated = { ...prev, config: newConfig };
                setPortfolioCache(c => ({ ...c, [portfolioMode]: updated }));
                return updated;
              });
            }}
            onReset={(newState) => {
              updatePortfolioState(portfolioMode, newState);
              setActiveTab('dashboard');
            }}
            onDeposit={(newState) => {
              updatePortfolioState(portfolioMode, newState);
            }}
            onTriggerRun={(newState, liveState, backtestState) => {
              if (liveState && backtestState) {
                setPortfolioCache(prev => ({
                  ...prev,
                  live: liveState,
                  backtest: backtestState
                }));
                setPortfolio(portfolioMode === 'live' ? liveState : backtestState);
              } else {
                updatePortfolioState(portfolioMode, newState);
              }
            }}
          />
        )}
      </main>

      {/* Footer copyright */}
      <footer style={{ marginTop: '3rem', padding: '1rem 0', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        <span>Quant Sentinal Trading System - Aim: 15%-20% Annual Target</span>
        <span>Simulated on National Stock Exchange (NSE) Indices</span>
      </footer>
    </div>
  );
}
