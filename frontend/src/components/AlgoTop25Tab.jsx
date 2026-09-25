import React, { useState, useEffect } from 'react';
import MiniChart from './MiniChart';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export default function AlgoTop25Tab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState('ALL');
  const [minPassed, setMinPassed] = useState('ALL');
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'cards'
  const [inspectStock, setInspectStock] = useState(null);

  useEffect(() => {
    fetchTop25();
  }, []);

  const fetchTop25 = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/algo-top25`);
      if (!res.ok) throw new Error("Failed to load algorithm rankings");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
      setError("Could not load Top 25 algorithm candidates. Ensure backend is running.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="spinner-container">
        <div className="spinner" />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: '500' }}>
          Scanning 300+ NSE Assets & Computing Multi-Factor Indicator Models...
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--red)' }}>
        <p style={{ fontWeight: '500', marginBottom: '1rem' }}>{error || "No data available."}</p>
        <button onClick={fetchTop25} className="btn btn-secondary">
          Retry Algo Scan
        </button>
      </div>
    );
  }

  const { date, marketRegime, totalScanned, top25 = [] } = data;

  // Unique sectors for filtering
  const sectors = ['ALL', ...new Set(top25.map(s => s.sector).filter(Boolean))];

  // Filtering
  const filteredStocks = top25.filter(stock => {
    const matchesSearch =
      stock.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      stock.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSector = selectedSector === 'ALL' || stock.sector === selectedSector;
    const matchesPassed =
      minPassed === 'ALL' ||
      (minPassed === '8' && stock.passedCount === 8) ||
      (minPassed === '7+' && stock.passedCount >= 7) ||
      (minPassed === '6+' && stock.passedCount >= 6);
    return matchesSearch && matchesSector && matchesPassed;
  });

  const getRankClass = (rank) => {
    if (rank === 1) return 'rank-top-1';
    if (rank === 2) return 'rank-top-2';
    if (rank === 3) return 'rank-top-3';
    return 'rank-standard';
  };

  const getScoreChipClass = (score) => {
    if (score >= 90) return 'score-chip-super';
    if (score >= 75) return 'score-chip-high';
    return 'score-chip-mid';
  };

  const getSignalBadgeStyle = (signal) => {
    if (signal === 'STRONG BUY') {
      return {
        background: 'var(--green-glow)',
        color: 'var(--green)',
        border: '1px solid var(--green-border)',
        fontWeight: '700'
      };
    }
    if (signal === 'BUY SETUP') {
      return {
        background: 'var(--accent-glow)',
        color: 'var(--accent)',
        border: '1px solid var(--accent-border)',
        fontWeight: '600'
      };
    }
    if (signal === 'ACCUMULATE') {
      return {
        background: 'rgba(202, 138, 4, 0.08)',
        color: 'var(--amber)',
        border: '1px solid rgba(202, 138, 4, 0.25)',
        fontWeight: '600'
      };
    }
    return {
      background: 'rgba(15, 23, 42, 0.05)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border-color)',
      fontWeight: '500'
    };
  };

  const getExecutionBadgeStyle = (status) => {
    if (status === 'QUALIFIED_BUY') {
      return {
        background: 'var(--green-glow)',
        color: 'var(--green)',
        border: '1px solid var(--green-border)',
        fontWeight: '700'
      };
    }
    if (status === 'ACTIVE_HOLDING') {
      return {
        background: 'rgba(37, 99, 235, 0.12)',
        color: 'var(--accent)',
        border: '1px solid var(--accent-border)',
        fontWeight: '600'
      };
    }
    if (status === 'NO_BAR_TODAY') {
      return {
        background: 'rgba(239, 68, 68, 0.08)',
        color: '#dc2626',
        border: '1px solid rgba(239, 68, 68, 0.25)',
        fontWeight: '600'
      };
    }
    if (status === 'SECTOR_CAP' || status === 'PORTFOLIO_FULL') {
      return {
        background: 'rgba(202, 138, 4, 0.1)',
        color: 'var(--amber)',
        border: '1px solid rgba(202, 138, 4, 0.3)',
        fontWeight: '600'
      };
    }
    // Execution filter pending (e.g. CLV, breakout, rvol)
    return {
      background: 'rgba(15, 23, 42, 0.04)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border-color)',
      fontWeight: '600'
    };
  };

  return (
    <div className="algo-top25-container">
      {/* Top Header Card */}
      <div className="glass-panel">
        <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h2>Top 25 Algo Candidates</h2>
              <span style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                background: marketRegime === 'BULLISH' ? 'var(--green-glow)' : marketRegime === 'RISK_OFF' ? 'var(--red-glow)' : 'var(--accent-glow)',
                color: marketRegime === 'BULLISH' ? 'var(--green)' : marketRegime === 'RISK_OFF' ? 'var(--red)' : 'var(--accent)',
                border: `1px solid ${marketRegime === 'BULLISH' ? 'var(--green-border)' : marketRegime === 'RISK_OFF' ? 'var(--red-border)' : 'var(--accent-border)'}`,
                fontWeight: '700'
              }}>
                MARKET REGIME: {marketRegime}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Evaluated for: <strong>{date}</strong> • {totalScanned} Assets Scanned
              </span>
            </div>

          </div>

          <button onClick={fetchTop25} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>
            Re-scan All
          </button>
        </div>

        {/* Indicator Legend Strip */}
        <div className="indicator-legend-strip" style={{ marginTop: '0.5rem' }}>
          <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Indicator Criteria:</div>
          <div className="legend-item">
            <span className="legend-dot-pass" />
            <span><strong>Satisfied (Pass)</strong></span>
          </div>
          <div className="legend-item">
            <span className="legend-dot-fail" />
            <span><strong>Failed (Reject)</strong></span>
          </div>
          <span style={{ color: 'var(--border-color-hover)' }}>|</span>
          <span title="Price >= 20 EMA and 20 EMA >= 50 EMA"><strong>Trend:</strong> 20 &gt; 50 EMA</span>
          <span title="Alpha >= +1.5% outperformance vs Nifty 50"><strong>RS Alpha:</strong> &gt;= +1.5% vs Nifty</span>
          <span title="Institutional volume >= 1.50x 20-day avg"><strong>RVOL:</strong> &gt;= 1.5x Vol</span>
          <span title="RSI between 52.0 and 76.5"><strong>RSI:</strong> 52 - 76.5 Sweet Spot</span>
          <span title="New 20-day high or within 1.5% of resistance"><strong>Breakout:</strong> 20D High Setup</span>
          <span title="Close Location Value >= 60%"><strong>CLV:</strong> &gt;= 60% Close</span>
          <span title="ADX >= 22.0 directional velocity"><strong>ADX:</strong> &gt;= 22 Trend Strength</span>
          <span title="<= 8.5% above 20 EMA to avoid extended trap"><strong>Safety:</strong> &lt;= 8.5% from 20 EMA</span>
        </div>

        {/* Filter and View Controls Toolbar */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
          {/* Search box */}
          <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
            <input
              type="text"
              placeholder="Search by Symbol or Company..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="config-input"
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Sector filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Sector:</span>
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="config-select"
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
            >
              {sectors.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Minimum Passed filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Passed:</span>
            <select
              value={minPassed}
              onChange={(e) => setMinPassed(e.target.value)}
              className="config-select"
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
            >
              <option value="ALL">All (Top 25)</option>
              <option value="8">8 / 8 Clean Sweep</option>
              <option value="7+">7+ Indicators Passed</option>
              <option value="6+">6+ Indicators Passed</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div style={{ display: 'flex', background: 'rgba(15, 23, 42, 0.04)', borderRadius: '8px', padding: '2px', border: '1px solid var(--border-color)', marginLeft: 'auto' }}>
            <button
              onClick={() => setViewMode('table')}
              className={`btn ${viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', borderRadius: '6px' }}
            >
              Table View
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`btn ${viewMode === 'cards' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', borderRadius: '6px' }}
            >
              Cards View
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {filteredStocks.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          No stocks match the current filter criteria ({searchTerm || selectedSector}).
        </div>
      ) : viewMode === 'table' ? (
        /* ================= Table View ================= */
        <div className="glass-panel" style={{ padding: '0' }}>
          <div className="table-container" style={{ margin: '0' }}>
            <table className="custom-table" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={{ width: '45px', textAlign: 'center' }}>#</th>
                  <th>Stock / Asset</th>
                  <th style={{ textAlign: 'right' }}>Price (₹)</th>
                  <th style={{ textAlign: 'center' }}>Algo Score</th>
                  <th style={{ textAlign: 'center' }}>Signal</th>
                  <th style={{ textAlign: 'center' }}>Pass Ratio</th>
                  <th style={{ textAlign: 'center' }}>Why Not Bought Today?</th>
                  <th style={{ textAlign: 'center' }}>Stage 2 Trend</th>
                  <th style={{ textAlign: 'center' }}>RS Alpha</th>
                  <th style={{ textAlign: 'center' }}>RVOL</th>
                  <th style={{ textAlign: 'center' }}>RSI</th>
                  <th style={{ textAlign: 'center' }}>20D Breakout</th>
                  <th style={{ textAlign: 'center' }}>CLV</th>
                  <th style={{ textAlign: 'center' }}>ADX</th>
                  <th style={{ textAlign: 'center' }}>Safety</th>
                  <th style={{ textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredStocks.map((stock) => {
                  const indMap = {};
                  stock.indicators.forEach(i => { indMap[i.id] = i; });

                  return (
                    <tr key={stock.symbol} style={{ cursor: 'pointer' }} onClick={() => setInspectStock(stock)}>
                      {/* Rank */}
                      <td style={{ textAlign: 'center' }}>
                        <span className={`rank-badge ${getRankClass(stock.rank)}`}>
                          {stock.rank}
                        </span>
                      </td>

                      {/* Stock info */}
                      <td>
                        <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                          {stock.symbol.replace('.NS', '')}
                        </div>
                        <span className="company-name" style={{ maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {stock.name}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {stock.sector}
                        </span>
                      </td>

                      {/* Price & Change */}
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '600' }}>₹{stock.price.toFixed(2)}</div>
                        <div style={{
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          color: stock.change >= 0 ? 'var(--green)' : 'var(--red)'
                        }}>
                          {stock.change >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                        </div>
                      </td>

                      {/* Algo Confluence Score */}
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span className={`score-chip ${getScoreChipClass(stock.algoScore)}`}>
                            {stock.algoScore} <span style={{ fontSize: '0.65rem', fontWeight: '500' }}>/100</span>
                          </span>
                          <div className="score-progress-bar">
                            <div
                              className="score-progress-fill"
                              style={{
                                width: `${stock.algoScore}%`,
                                background: stock.algoScore >= 90 ? 'var(--green)' : stock.algoScore >= 75 ? 'var(--accent)' : 'var(--amber)'
                              }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Signal */}
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          fontSize: '0.7rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          display: 'inline-block',
                          ...getSignalBadgeStyle(stock.signal)
                        }}>
                          {stock.signal}
                        </span>
                      </td>

                      {/* Pass Ratio */}
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          padding: '0.2rem 0.45rem',
                          borderRadius: '4px',
                          background: stock.passedCount === 8 ? 'var(--green-glow)' : stock.passedCount >= 6 ? 'var(--accent-glow)' : 'rgba(15, 23, 42, 0.05)',
                          color: stock.passedCount === 8 ? 'var(--green)' : stock.passedCount >= 6 ? 'var(--accent)' : 'var(--text-secondary)',
                          border: `1px solid ${stock.passedCount === 8 ? 'var(--green-border)' : stock.passedCount >= 6 ? 'var(--accent-border)' : 'var(--border-color)'}`
                        }}>
                          {stock.passedCount}/{stock.totalIndicators}
                        </span>
                      </td>

                      {/* Why Not Bought Today? Execution Status */}
                      <td style={{ textAlign: 'center' }}>
                        {stock.executionStatus && (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '5px',
                              maxWidth: '170px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              display: 'inline-block',
                              cursor: 'help',
                              ...getExecutionBadgeStyle(stock.executionStatus.status)
                            }}
                            title={`Execution Diagnostic:\n${stock.executionStatus.reason}`}
                          >
                            {stock.executionStatus.label}
                          </span>
                        )}
                      </td>

                      {/* 1. Stage 2 Trend */}
                      <td style={{ textAlign: 'center' }}>
                        {indMap.trend && (
                          <span
                            className={`indicator-badge ${indMap.trend.passed ? 'indicator-badge-pass' : 'indicator-badge-fail'}`}
                            title={`${indMap.trend.name}\nCriteria: ${indMap.trend.criteria}\nMetric: ${indMap.trend.metric}`}
                          >
                            {indMap.trend.passed ? '✓' : '✗'} {indMap.trend.value}
                          </span>
                        )}
                      </td>

                      {/* 2. RS Alpha */}
                      <td style={{ textAlign: 'center' }}>
                        {indMap.rs && (
                          <span
                            className={`indicator-badge ${indMap.rs.passed ? 'indicator-badge-pass' : 'indicator-badge-fail'}`}
                            title={`${indMap.rs.name}\nCriteria: ${indMap.rs.criteria}\nMetric: ${indMap.rs.metric}`}
                          >
                            {indMap.rs.passed ? '✓' : '✗'} {indMap.rs.value}
                          </span>
                        )}
                      </td>

                      {/* 3. RVOL */}
                      <td style={{ textAlign: 'center' }}>
                        {indMap.rvol && (
                          <span
                            className={`indicator-badge ${indMap.rvol.passed ? 'indicator-badge-pass' : 'indicator-badge-fail'}`}
                            title={`${indMap.rvol.name}\nCriteria: ${indMap.rvol.criteria}\nMetric: ${indMap.rvol.metric}`}
                          >
                            {indMap.rvol.passed ? '✓' : '✗'} {indMap.rvol.value}
                          </span>
                        )}
                      </td>

                      {/* 4. RSI Momentum */}
                      <td style={{ textAlign: 'center' }}>
                        {indMap.rsi && (
                          <span
                            className={`indicator-badge ${indMap.rsi.passed ? 'indicator-badge-pass' : 'indicator-badge-fail'}`}
                            title={`${indMap.rsi.name}\nCriteria: ${indMap.rsi.criteria}\nMetric: ${indMap.rsi.metric}`}
                          >
                            {indMap.rsi.passed ? '✓' : '✗'} {indMap.rsi.value}
                          </span>
                        )}
                      </td>

                      {/* 5. 20D Breakout */}
                      <td style={{ textAlign: 'center' }}>
                        {indMap.breakout && (
                          <span
                            className={`indicator-badge ${indMap.breakout.passed ? 'indicator-badge-pass' : 'indicator-badge-fail'}`}
                            title={`${indMap.breakout.name}\nCriteria: ${indMap.breakout.criteria}\nMetric: ${indMap.breakout.metric}`}
                          >
                            {indMap.breakout.passed ? '✓' : '✗'} {indMap.breakout.value}
                          </span>
                        )}
                      </td>

                      {/* 6. CLV Pressure */}
                      <td style={{ textAlign: 'center' }}>
                        {indMap.clv && (
                          <span
                            className={`indicator-badge ${indMap.clv.passed ? 'indicator-badge-pass' : 'indicator-badge-fail'}`}
                            title={`${indMap.clv.name}\nCriteria: ${indMap.clv.criteria}\nMetric: ${indMap.clv.metric}`}
                          >
                            {indMap.clv.passed ? '✓' : '✗'} {indMap.clv.value}
                          </span>
                        )}
                      </td>

                      {/* 7. ADX Velocity */}
                      <td style={{ textAlign: 'center' }}>
                        {indMap.adx && (
                          <span
                            className={`indicator-badge ${indMap.adx.passed ? 'indicator-badge-pass' : 'indicator-badge-fail'}`}
                            title={`${indMap.adx.name}\nCriteria: ${indMap.adx.criteria}\nMetric: ${indMap.adx.metric}`}
                          >
                            {indMap.adx.passed ? '✓' : '✗'} {indMap.adx.value}
                          </span>
                        )}
                      </td>

                      {/* 8. Extension Safety */}
                      <td style={{ textAlign: 'center' }}>
                        {indMap.safety && (
                          <span
                            className={`indicator-badge ${indMap.safety.passed ? 'indicator-badge-pass' : 'indicator-badge-fail'}`}
                            title={`${indMap.safety.name}\nCriteria: ${indMap.safety.criteria}\nMetric: ${indMap.safety.metric}`}
                          >
                            {indMap.safety.passed ? '✓' : '✗'} {indMap.safety.value}
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td style={{ textAlign: 'center' }} onClick={(e) => { e.stopPropagation(); setInspectStock(stock); }}>
                        <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}>
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ================= Cards View ================= */
        <div className="card-grid-top25">
          {filteredStocks.map((stock) => (
            <div
              key={stock.symbol}
              className="algo-card"
              onClick={() => setInspectStock(stock)}
              style={{ cursor: 'pointer' }}
            >
              <div className="algo-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span className={`rank-badge ${getRankClass(stock.rank)}`}>
                    #{stock.rank}
                  </span>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--text-primary)' }}>
                      {stock.symbol.replace('.NS', '')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {stock.name} • {stock.sector}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.95rem' }}>₹{stock.price.toFixed(2)}</div>
                  <div style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    color: stock.change >= 0 ? 'var(--green)' : 'var(--red)'
                  }}>
                    {stock.change >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* Score and Signal banner */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'rgba(15, 23, 42, 0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`score-chip ${getScoreChipClass(stock.algoScore)}`}>
                    Score: {stock.algoScore}/100
                  </span>
                  <span style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)' }}>
                    ({stock.passedCount}/8 Passed)
                  </span>
                </div>
                <span style={{
                  fontSize: '0.7rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  ...getSignalBadgeStyle(stock.signal)
                }}>
                  {stock.signal}
                </span>
              </div>

              {/* Execution Status / Why Not Bought */}
              {stock.executionStatus && (
                <div style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '8px',
                  background: stock.executionStatus.status === 'QUALIFIED_BUY' ? 'var(--green-glow)' : 'rgba(15, 23, 42, 0.02)',
                  border: `1px solid ${stock.executionStatus.status === 'QUALIFIED_BUY' ? 'var(--green-border)' : 'var(--border-color)'}`,
                  fontSize: '0.75rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: '600', color: 'var(--text-muted)' }}>Why Not Bought Today:</span>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.45rem',
                      borderRadius: '4px',
                      ...getExecutionBadgeStyle(stock.executionStatus.status)
                    }}>
                      {stock.executionStatus.label}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {stock.executionStatus.reason}
                  </div>
                </div>
              )}

              {/* 8 Indicators Grid */}
              <div className="algo-card-indicators-grid">
                {stock.indicators.map((ind) => (
                  <div
                    key={ind.id}
                    className={`indicator-badge ${ind.passed ? 'indicator-badge-pass' : 'indicator-badge-fail'}`}
                    style={{ justifyContent: 'space-between', padding: '0.35rem 0.55rem' }}
                    title={`${ind.name}: ${ind.criteria}\nMetric: ${ind.metric}`}
                  >
                    <span>{ind.shortName}:</span>
                    <span>{ind.passed ? '✓' : '✗'} {ind.value}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                <button
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: '0.8rem', padding: '0.4rem' }}
                  onClick={(e) => { e.stopPropagation(); setInspectStock(stock); }}
                >
                  Inspect Full Setup & Chart →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ================= Detail Inspection Modal ================= */}
      {inspectStock && (
        <div className="modal-overlay" onClick={() => setInspectStock(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto' }}>

            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span className={`rank-badge ${getRankClass(inspectStock.rank)}`} style={{ width: '36px', height: '36px', fontSize: '1rem' }}>
                  #{inspectStock.rank}
                </span>
                <div>
                  <h2 style={{ margin: '0', fontSize: '1.25rem' }}>{inspectStock.symbol.replace('.NS', '')}</h2>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {inspectStock.name} • {inspectStock.sector}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setInspectStock(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                ✕
              </button>
            </div>

            {/* Price and Algo Rating Highlights */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(15, 23, 42, 0.02)', borderRadius: '10px', border: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Last Traded Price</span>
                <div style={{ fontSize: '1.4rem', fontWeight: '700' }}>
                  ₹{inspectStock.price.toFixed(2)}
                  <span style={{
                    fontSize: '0.85rem',
                    marginLeft: '0.5rem',
                    fontWeight: '600',
                    color: inspectStock.change >= 0 ? 'var(--green)' : 'var(--red)'
                  }}>
                    {inspectStock.change >= 0 ? '+' : ''}{inspectStock.changePercent.toFixed(2)}%
                  </span>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Algo Confluence Score</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`score-chip ${getScoreChipClass(inspectStock.algoScore)}`} style={{ fontSize: '1rem' }}>
                    {inspectStock.algoScore} / 100
                  </span>
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '5px',
                    ...getSignalBadgeStyle(inspectStock.signal)
                  }}>
                    {inspectStock.signal}
                  </span>
                </div>
              </div>
            </div>

            {/* Execution Diagnostic / Why Not Bought Box */}
            {inspectStock.executionStatus && (
              <div style={{
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                background: inspectStock.executionStatus.status === 'QUALIFIED_BUY' ? 'var(--green-glow)' : 'rgba(220, 38, 38, 0.04)',
                border: `1px solid ${inspectStock.executionStatus.status === 'QUALIFIED_BUY' ? 'var(--green-border)' : 'rgba(220, 38, 38, 0.2)'}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                    Why Was This Stock Not Bought Today?
                  </span>
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '5px',
                    ...getExecutionBadgeStyle(inspectStock.executionStatus.status)
                  }}>
                    {inspectStock.executionStatus.label}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  {inspectStock.executionStatus.reason}
                </div>
              </div>
            )}

            {/* Mini Chart */}
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Recent Price Trend (Last 20 Sessions)
              </div>
              <div style={{ height: '180px', background: 'rgba(15, 23, 42, 0.02)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem' }}>
                <MiniChart
                  data={inspectStock.history}
                  valueKey="close"
                  dateKey="date"
                  strokeColor={inspectStock.change >= 0 ? '#16a34a' : '#2563eb'}
                />
              </div>
            </div>

            {/* Indicator Checklist Audit */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  Algorithmic Indicator Audit Checklist
                </span>
                <span style={{
                  fontSize: '0.8rem',
                  fontWeight: '700',
                  color: inspectStock.passedCount === 8 ? 'var(--green)' : 'var(--accent)'
                }}>
                  {inspectStock.passedCount} of {inspectStock.totalIndicators} Indicators Satisfied
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {inspectStock.indicators.map((ind) => (
                  <div
                    key={ind.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      background: ind.passed ? 'var(--green-glow)' : 'var(--red-glow)',
                      border: `1px solid ${ind.passed ? 'var(--green-border)' : 'var(--red-border)'}`,
                      fontSize: '0.85rem'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          fontWeight: '700',
                          color: ind.passed ? 'var(--green)' : 'var(--red)'
                        }}>
                          {ind.passed ? '✓ PASS' : '✗ REJECT'}
                        </span>
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{ind.name}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                        Criteria: {ind.criteria}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontWeight: '700',
                        color: ind.passed ? 'var(--green)' : 'var(--red)'
                      }}>
                        {ind.value}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {ind.metric}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Close Button */}
            <button
              onClick={() => setInspectStock(null)}
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: '0.5rem' }}
            >
              Close Inspection
            </button>

          </div>
        </div>
      )}
    </div>
  );
}
