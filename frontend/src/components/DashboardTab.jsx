import React, { useState, useMemo } from 'react';
import MiniChart from './MiniChart';

// ── Time-range definitions ──────────────────────────────────────────────────
const RANGES = [
  { label: '1D', days: 1 },
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: 'YTD', days: null, ytd: true },
  { label: '1Y', days: 365 },
  { label: 'All', days: null },
];

function filterByRange(history, range) {
  if (!history || history.length === 0) return history;
  if (range.days === null && !range.ytd) return history; // All / Since Inception

  const now = new Date();
  let cutoff;

  if (range.ytd) {
    cutoff = new Date(now.getFullYear(), 0, 1); // Jan 1 of current year
  } else {
    cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - range.days);
  }

  const filtered = history.filter(item => {
    const d = new Date(item.date);
    return !isNaN(d) && d >= cutoff;
  });

  // Always return at least one data point
  return filtered.length > 0 ? filtered : history.slice(-1);
}

export default function DashboardTab({ portfolio }) {
  const { cash, holdings, valuationHistory } = portfolio;
  const [activeRange, setActiveRange] = useState('All');
  const [chartMode, setChartMode] = useState('total'); // 'total' | 'invested'

  // Latest valuation details
  const latestValuation = valuationHistory[valuationHistory.length - 1] || {
    totalValue: 50000.0,
    profitPercent: 0.0,
    totalDeposited: 50000.0,
    holdingsValue: 0.0,
  };

  const totalValue = latestValuation.totalValue;
  const holdingsValue = latestValuation.holdingsValue || 0;
  const profitPercent = latestValuation.profitPercent || 0;
  const totalDeposited = latestValuation.totalDeposited || 50000.0;
  const netProfit = totalValue - totalDeposited;
  const activeCount = holdings.length;

  // ── Filtered chart data ─────────────────────────────────────────────────
  const selectedRange = RANGES.find(r => r.label === activeRange) || RANGES[RANGES.length - 1];
  const filteredHistory = useMemo(
    () => filterByRange(valuationHistory, selectedRange),
    [valuationHistory, selectedRange]
  );

  // Chart mode derivations
  const isInvestedMode = chartMode === 'invested';
  const chartValueKey = isInvestedMode ? 'holdingsValue' : 'totalValue';
  const chartTitle = isInvestedMode ? 'Invested Holdings Value' : 'Portfolio Net Worth';

  // Period-level performance — deposit-adjusted (total mode)
  // We use the stored profitPercent (= (totalValue - totalDeposited) / totalDeposited × 100)
  // which the backend already corrects for monthly injections.
  const periodStartROI = filteredHistory[0]?.profitPercent ?? 0;
  const periodEndROI = filteredHistory[filteredHistory.length - 1]?.profitPercent ?? 0;

  // Invested-only mode: simple diff of holdingsValue (no deposit distortion in holdings)
  const periodStartHV = filteredHistory[0]?.holdingsValue ?? holdingsValue;
  const periodEndHV = filteredHistory[filteredHistory.length - 1]?.holdingsValue ?? holdingsValue;

  const periodChangePct = isInvestedMode
    ? (periodStartHV !== 0 ? ((periodEndHV - periodStartHV) / periodStartHV) * 100 : 0)
    : (periodEndROI - periodStartROI);   // delta of deposit-adjusted ROI
  const periodIsUp = periodChangePct >= 0;

  // ₹ change for the period
  const periodStartCapital = filteredHistory[0]?.totalDeposited ?? totalDeposited;
  const periodStartValue = filteredHistory[0]?.totalValue ?? totalValue;
  const periodStartTradingPL = periodStartValue - periodStartCapital;
  const periodEndTradingPL = totalValue - totalDeposited;
  const periodChangeAmt = isInvestedMode
    ? (periodEndHV - periodStartHV)
    : (periodEndTradingPL - periodStartTradingPL);

  return (
    <div className="tab-content">
      {/* KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi-card accent">
          <div className="kpi-label">Portfolio Value</div>
          <div className="kpi-value">₹{totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="kpi-sub neutral">Total Assets Under Management</div>
        </div>

        <div className="kpi-card green">
          <div className="kpi-label">Trading P&amp;L</div>
          <div className="kpi-value" style={{ color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {netProfit >= 0 ? '+' : ''}₹{netProfit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`kpi-sub ${profitPercent >= 0 ? 'positive' : 'negative'}`}>
            {profitPercent >= 0 ? '▲' : '▼'} {Math.abs(profitPercent).toFixed(2)}% ROI (excl. deposits)
          </div>
        </div>

        <div className="kpi-card amber">
          <div className="kpi-label">Cash Balance</div>
          <div className="kpi-value">₹{cash.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="kpi-sub neutral">
            {((cash / totalValue) * 100).toFixed(0)}% Liquid Capital
          </div>
        </div>

        <div className="kpi-card accent">
          <div className="kpi-label">Active Holdings</div>
          <div className="kpi-value">{activeCount} / {portfolio.config.maxPositions}</div>
          <div className="kpi-sub neutral">
            Invested Value: ₹{holdingsValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Main Grid: Chart & Holdings */}
      <div className="grid-2col">
        {/* Growth Chart */}
        <div className="glass-panel">
          {/* Chart Header */}
          <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {chartTitle}
              </h2>

            </div>

            {/* Controls row: mode toggle + time range buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>

              {/* Chart Mode Toggle */}
              <div style={{
                display: 'flex', borderRadius: '8px', overflow: 'hidden',
                border: '1px solid var(--border-color)', flexShrink: 0
              }}>
                {[{ key: 'total', label: 'Total' }, { key: 'invested', label: 'Invested Only' }].map(m => (
                  <button
                    key={m.key}
                    onClick={() => setChartMode(m.key)}
                    style={{
                      padding: '5px 12px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      border: 'none',
                      borderRight: m.key === 'total' ? '1px solid var(--border-color)' : 'none',
                      background: chartMode === m.key ? 'var(--accent)' : 'transparent',
                      color: chartMode === m.key ? '#ffffff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      fontFamily: 'inherit',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Time Range Buttons */}
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {RANGES.map(r => (
                  <button
                    key={r.label}
                    onClick={() => setActiveRange(r.label)}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      borderRadius: '6px',
                      border: activeRange === r.label
                        ? '1px solid var(--accent)'
                        : '1px solid var(--border-color)',
                      background: activeRange === r.label
                        ? 'var(--accent)'
                        : 'transparent',
                      color: activeRange === r.label
                        ? '#ffffff'
                        : 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => {
                      if (activeRange !== r.label) {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.color = 'var(--accent)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (activeRange !== r.label) {
                        e.currentTarget.style.borderColor = 'var(--border-color)';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }
                    }}
                  >
                    {r.label === 'All' ? 'Since Inception' : r.label}
                  </button>
                ))}
              </div>

            </div>
          </div>

          {/* Chart */}
          <div style={{ height: '300px', marginTop: '0.25rem' }}>
            <MiniChart
              data={filteredHistory}
              valueKey={chartValueKey}
              dateKey="date"
              fillGradId="netWorthGrad"
              baselineValue={isInvestedMode ? null : totalDeposited}
            />
          </div>

          {/* Bottom meta row */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: '0.75rem', paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.75rem', color: 'var(--text-secondary)'
          }}>
            <span>Invested Capital: <strong style={{ color: 'var(--text-primary)' }}>₹{totalDeposited.toLocaleString('en-IN')}</strong></span>
            <span>Data Points: <strong style={{ color: 'var(--text-primary)' }}>{filteredHistory.length}</strong></span>
            <span>Last Updated: <strong style={{ color: 'var(--accent)' }}>{portfolio.lastSimulationDate}</strong></span>
          </div>
        </div>

        {/* Short Summary / Trader Stats */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="panel-header">
            <h2>Quant Sentinal Trading Status</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Risk Setting:</span>
              <span style={{ fontWeight: '600', color: 'var(--accent)', textTransform: 'capitalize' }}>
                {portfolio.config.aggressiveness}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Profit Target:</span>
              <span style={{ fontWeight: '600', color: 'var(--green)' }}>+{portfolio.config.targetProfitPercent * 100}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Stop Loss:</span>
              <span style={{ fontWeight: '600', color: 'var(--red)' }}>-{portfolio.config.stopLossPercent * 100}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total Completed Trades:</span>
              <span style={{ fontWeight: '600' }}>{portfolio.history.length}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Last Updated Date:</span>
              <span style={{ fontWeight: '600', color: 'var(--accent)' }}>{portfolio.lastSimulationDate}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Holdings Section */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Active Holdings</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Showing {holdings.length} open position{holdings.length === 1 ? '' : 's'}
          </span>
        </div>

        {holdings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            No active stock holdings. Currently holding 100% cash. Running scans on market open.
          </div>
        ) : (
          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Quantity</th>
                  <th>Entry Price</th>
                  <th>Current Price</th>
                  <th>Value</th>
                  <th>Returns (P&amp;L)</th>
                  <th>SL / Target Progress</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((position, idx) => {
                  const range = position.targetPrice - position.stopLoss;
                  const progressOffset = Math.max(0, Math.min(100, ((position.currentPrice - position.stopLoss) / range) * 100));
                  const isProfit = position.profit >= 0;

                  return (
                    <tr key={idx}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span className="stock-badge">{position.symbol.replace('.NS', '')}</span>
                            {position.isAccumulated && (
                              <span style={{ fontSize: '0.62rem', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', background: 'rgba(56,189,248,0.18)', color: '#38bdf8', letterSpacing: '0.04em' }}>
                                PYRAMID
                              </span>
                            )}
                          </div>
                          <span className="company-name">{position.name}</span>
                        </div>
                      </td>
                      <td>{position.quantity}</td>
                      <td>₹{position.buyPrice.toFixed(2)}</td>
                      <td>₹{position.currentPrice.toFixed(2)}</td>
                      <td>₹{position.value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={isProfit ? 'positive-cell' : 'negative-cell'}>
                        {isProfit ? '+' : ''}₹{position.profit.toFixed(2)} ({isProfit ? '+' : ''}{position.profitPercent.toFixed(2)}%)
                      </td>
                      <td>
                        <div className="sl-target-track">
                          <div style={{ position: 'relative', width: '120px', height: '6px', background: '#1e293b', borderRadius: '3px' }}>
                            {/* Marker line showing current price position */}
                            <div
                              style={{
                                position: 'absolute',
                                left: `${progressOffset}%`,
                                top: '-3px',
                                width: '4px',
                                height: '12px',
                                background: isProfit ? 'var(--green)' : 'var(--red)',
                                borderRadius: '2px',
                                boxShadow: `0 0 6px ${isProfit ? 'var(--green)' : 'var(--red)'}`,
                                transform: 'translateX(-50%)'
                              }}
                            />
                            {/* Gradient colors showing Stop Loss (red) -> Entry (blue) -> Target (green) */}
                            <div
                              style={{
                                position: 'absolute',
                                left: '0',
                                top: '0',
                                height: '100%',
                                width: '100%',
                                background: 'linear-gradient(to right, rgba(220, 38, 38, 0.4) 0%, rgba(37, 99, 235, 0.2) 50%, rgba(22, 163, 74, 0.4) 100%)',
                                borderRadius: '3px'
                              }}
                            />
                          </div>
                          <div className="sl-target-labels">
                            <span>SL: ₹{position.stopLoss.toFixed(0)}</span>
                            <span>Tgt: ₹{position.targetPrice.toFixed(0)}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

