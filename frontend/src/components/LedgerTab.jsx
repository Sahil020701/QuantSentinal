import React from 'react';

export default function LedgerTab({ history = [] }) {
  // Calculate performance metrics
  const totalTrades = history.length;
  const wins = history.filter(t => t.profit >= 0);
  const losses = history.filter(t => t.profit < 0);
  
  const winCount = wins.length;
  const lossCount = losses.length;
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
  
  const totalRealizedPnl = history.reduce((sum, t) => sum + t.profit, 0);
  const avgReturn = totalTrades > 0 ? history.reduce((sum, t) => sum + t.profitPercent, 0) / totalTrades : 0;

  // Find best trade
  let bestTrade = null;
  if (history.length > 0) {
    bestTrade = [...history].sort((a, b) => b.profit - a.profit)[0];
  }

  return (
    <div className="tab-content">
      {/* Metrics Row */}
      <div className="ledger-summary-row">
        <div className="ledger-summary-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Completed Trades</span>
          <div className="ledger-summary-val">{totalTrades}</div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {winCount} Wins | {lossCount} Losses
          </span>
        </div>

        <div className="ledger-summary-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Win Rate</span>
          <div className="ledger-summary-val" style={{ color: winRate >= 50 ? 'var(--green)' : 'inherit' }}>
            {winRate.toFixed(1)}%
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Target: &gt;55% Win Rate
          </span>
        </div>

        <div className="ledger-summary-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Realized P&L</span>
          <div className={`ledger-summary-val ${totalRealizedPnl >= 0 ? 'positive' : 'negative'}`}>
            {totalRealizedPnl >= 0 ? '+' : ''}₹{totalRealizedPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Realized cash returns
          </span>
        </div>

        <div className="ledger-summary-card">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Avg. Trade Return</span>
          <div className={`ledger-summary-val ${avgReturn >= 0 ? 'positive' : 'negative'}`}>
            {avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(2)}%
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Per-trade expectation
          </span>
        </div>
      </div>

      {/* Main Ledger Table */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Closed Trades Ledger</h2>
          {bestTrade && (
            <span style={{ fontSize: '0.8rem', color: 'var(--green)', background: 'var(--green-glow)', padding: '0.2rem 0.6rem', border: '1px solid var(--green-border)', borderRadius: '4px' }}>
              Best Trade: {bestTrade.symbol.replace('.NS', '')} (+₹{bestTrade.profit.toFixed(0)})
            </span>
          )}
        </div>

        {history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            No completed trades logged yet. Scanning for swing setups on Monday.
          </div>
        ) : (
          <div className="table-container">
            <table className="custom-table" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Qty</th>
                  <th>Buy Details</th>
                  <th>Sell Details</th>
                  <th>Hold Period</th>
                  <th>Realized Return</th>
                  <th>Exit Trigger</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((trade, idx) => {
                  const isProfit = trade.profit >= 0;
                  
                  // Calculate hold duration in calendar days (approx)
                  const buyDate = new Date(trade.buyDate);
                  const sellDate = new Date(trade.sellDate);
                  const diffTime = Math.abs(sellDate - buyDate);
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                  return (
                    <tr key={idx}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="stock-badge">{trade.symbol.replace('.NS', '')}</span>
                          <span className="company-name">{trade.name}</span>
                        </div>
                      </td>
                      <td>{trade.quantity}</td>
                      <td>
                        <div>₹{trade.buyPrice.toFixed(2)}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{trade.buyDate}</div>
                      </td>
                      <td>
                        <div>₹{trade.sellPrice.toFixed(2)}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{trade.sellDate}</div>
                      </td>
                      <td>{diffDays} day{diffDays === 1 ? '' : 's'}</td>
                      <td className={isProfit ? 'positive-cell' : 'negative-cell'}>
                        <div>{isProfit ? '+' : ''}₹{trade.profit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div style={{ fontSize: '0.75rem' }}>{isProfit ? '+' : ''}{trade.profitPercent.toFixed(2)}%</div>
                      </td>
                      <td>
                        <span 
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            padding: '0.15rem 0.4rem',
                            borderRadius: '4px',
                            background: trade.reason.includes('Profit') ? 'var(--green-glow)' : 'var(--red-glow)',
                            color: trade.reason.includes('Profit') ? 'var(--green)' : 'var(--red)',
                            border: trade.reason.includes('Profit') ? '1px solid var(--green-border)' : '1px solid var(--red-border)'
                          }}
                        >
                          {trade.reason}
                        </span>
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
