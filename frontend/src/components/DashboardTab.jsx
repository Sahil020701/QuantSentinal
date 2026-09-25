import React from 'react';
import MiniChart from './MiniChart';

export default function DashboardTab({ portfolio }) {
  const { cash, holdings, valuationHistory } = portfolio;

  // Latest valuation details
  const latestValuation = valuationHistory[valuationHistory.length - 1] || {
    totalValue: 50000.0,
    profitPercent: 0.0,
    totalDeposited: 50000.0,
    holdingsValue: 0.0
  };

  const totalValue = latestValuation.totalValue;
  const holdingsValue = latestValuation.holdingsValue || 0;
  const profitPercent = latestValuation.profitPercent || 0;
  const totalDeposited = latestValuation.totalDeposited || 50000.0;
  const netProfit = totalValue - totalDeposited;

  // Active positions statistics
  const activeCount = holdings.length;

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
          <div className="kpi-label">Net Return</div>
          <div className="kpi-value" style={{ color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {netProfit >= 0 ? '+' : ''}₹{netProfit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`kpi-sub ${profitPercent >= 0 ? 'positive' : 'negative'}`}>
            {profitPercent >= 0 ? '▲' : '▼'} {profitPercent.toFixed(2)}% Cumulative Return
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
          <div className="panel-header">
            <h2>Portfolio Net Worth</h2>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Deposited Capital: ₹{totalDeposited.toLocaleString('en-IN')}
            </div>
          </div>
          <div style={{ height: '300px' }}>
            <MiniChart 
              data={valuationHistory} 
              valueKey="totalValue" 
              dateKey="date"
              fillGradId="netWorthGrad"
            />
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
                  <th>Returns (P&L)</th>
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
