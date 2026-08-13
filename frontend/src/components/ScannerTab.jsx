import React, { useState, useEffect } from 'react';
import MiniChart from './MiniChart';

const SECTOR_SPECULATIONS = {
  'IT Services': "Speculating structural growth in AI integrations and cloud services. Technical setup suggests consolidation breakout above the 20-day SMA. Quant Sentinal ranks this sector as high-beta swing candidate.",
  'Banking & Financials': "Speculating banking sector margin improvements ahead of monetary policy shifts. Credit off-take remains robust at 15% YoY. Chart patterns show solid base formation with a double-bottom confirmation.",
  'Energy & Conglomerate': "Speculating massive clean energy cap-ex announcements. Volatility in crude prices is hedged by refining margins. Volume profiling indicates heavy institutional accumulation near structural supports.",
  'Automotive': "Speculating commercial EV subsidy expansion and robust festive order logs. Input steel prices are softening. Bullish chart flag pattern breaking out on above-average volume.",
  'Consumer Goods': "Speculating strong volume recovery in rural demand post-monsoon. High pricing power provides defense against inflation. Technically acting as low-beta defensive portfolio anchors.",
  'Infrastructure': "Speculating massive government budget capex allocations. Infrastructure order book ratios are at multi-year highs. Price trades strongly above the 50-day SMA, indicating robust support.",
  'Metals & Mining': "Speculating global inventory shortages and rising industrial demand. Technical scanners suggest a strong momentum shift, with RSI expanding from oversold territories.",
  'Power': "Speculating high peak power demand spikes. Cap-ex expansion in solar and grid networks is generating strong positive cash flows. Price structure shows a bullish ascending triangle pattern.",
  'Pharma': "Speculating fast-tracked approvals for major generic molecules. Domestic portfolio growth is steady. Acting as a defensive sector play, finding support on the 20-day moving average.",
  'ETFs': "Reflecting broad market liquidity and structural growth of the Indian economy. Provides diversified momentum exposure without single-stock corporate governance risks."
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export default function ScannerTab() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);
  const [selectedSector, setSelectedSector] = useState('ALL');

  useEffect(() => {
    fetchQuotes();
  }, []);

  const fetchQuotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/scanner`);
      if (!res.ok) throw new Error("Failed to fetch scanner quotes");
      const data = await res.json();
      setQuotes(data);
    } catch (err) {
      console.error(err);
      setError("Could not load market quotes. Make sure the backend server is running.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="spinner-container">
        <div className="spinner" />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Scanning Indian Stock Market...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--red)' }}>
        <p style={{ fontWeight: '500' }}>⚠️ {error}</p>
        <button onClick={fetchQuotes} className="btn btn-secondary" style={{ marginTop: '1rem' }}>
          Retry Scan
        </button>
      </div>
    );
  }

  const sectors = ['ALL', ...new Set(quotes.map(q => q.sector).filter(Boolean))];
  const filteredQuotes = selectedSector === 'ALL' 
    ? quotes 
    : quotes.filter(q => q.sector === selectedSector);

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="glass-panel">
        <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: '0.5rem' }}>
          <div>
            <h2>🔍 Market Watch & Scanner</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Real-time quotes, technical indicator analysis, and Quant Sentinal recommendation signals ({filteredQuotes.length} assets listed)
            </p>
          </div>
          <button onClick={fetchQuotes} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>
            🔄 Refresh Market Data
          </button>
        </div>

        {/* Sector Tabs Filter */}
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', padding: '0.5rem 1.25rem 1rem 1.25rem', margin: '0 -1.25rem', borderBottom: '1px solid var(--border-color)', scrollbarWidth: 'thin' }}>
          {sectors.map(sec => (
            <button
              key={sec}
              className={`btn ${selectedSector === sec ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', whiteSpace: 'nowrap' }}
              onClick={() => setSelectedSector(sec)}
            >
              {sec}
            </button>
          ))}
        </div>

        {/* Watchlist Grid */}
        <div className="scanner-grid" style={{ marginTop: '1.5rem' }}>
          {filteredQuotes.map((stock) => {
            const isPositive = stock.changePercent >= 0;
            const recClass = stock.recommendation.includes('BUY') ? 'buy' : stock.recommendation.includes('REDUCE') ? 'sell' : 'hold';
            
            return (
              <div 
                className="scanner-card" 
                key={stock.symbol}
                onClick={() => setSelectedStock(stock)}
              >
                <div className="scanner-header">
                  <div>
                    <span className="stock-badge">{stock.symbol.replace('.NS', '')}</span>
                    <span className="company-name">{stock.name}</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600' }}>
                    {stock.sector}
                  </span>
                </div>

                <div className="scanner-prices">
                  <span className="scanner-price">₹{stock.price.toFixed(2)}</span>
                  <span className={`scanner-change ${isPositive ? 'positive' : 'negative'}`}>
                    {isPositive ? '▲' : '▼'} {Math.abs(stock.changePercent).toFixed(2)}%
                  </span>
                </div>

                {/* Mini sparkline chart inside card */}
                {stock.history && stock.history.length > 0 && (
                  <div style={{ height: '50px', marginBottom: '0.75rem', pointerEvents: 'none' }}>
                    <MiniChart 
                      data={stock.history}
                      valueKey="close"
                      dateKey="date"
                      showPoints={false}
                      showTooltip={false}
                      strokeColor={isPositive ? 'var(--green)' : 'var(--red)'}
                      fillGradId={`sparkGrad-${stock.symbol.replace('.', '-')}`}
                    />
                  </div>
                )}

                <div className="scanner-metrics">
                  <div className="scanner-metric">
                    <span className="scanner-metric-lbl">RSI (14)</span>
                    <span className="scanner-metric-val" style={{ color: stock.rsi > 70 ? 'var(--red)' : stock.rsi < 35 ? 'var(--green)' : 'inherit' }}>
                      {stock.rsi.toFixed(1)}
                    </span>
                  </div>
                  <div className="scanner-metric">
                    <span className="scanner-metric-lbl">Trend</span>
                    <span className="scanner-metric-val">
                      {stock.price > stock.sma20 ? 'Bullish' : 'Bearish'}
                    </span>
                  </div>
                </div>

                <div className={`scanner-rec ${recClass}`}>
                  <span>⚙️</span> {stock.recommendation}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stock Detail Modal */}
      {selectedStock && (
        <div className="modal-overlay" onClick={() => setSelectedStock(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="stock-badge" style={{ fontSize: '1.25rem' }}>{selectedStock.symbol.replace('.NS', '')}</span>
                  <span style={{ fontSize: '1.1rem', fontWeight: '500' }}>{selectedStock.name}</span>
                </h2>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{selectedStock.sector} Sector</span>
              </div>
              <button className="modal-close" onClick={() => setSelectedStock(null)}>×</button>
            </div>

            <div className="scanner-prices" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <div>
                <span style={{ fontSize: '2rem', fontWeight: '700' }}>₹{selectedStock.price.toFixed(2)}</span>
                <span 
                  className={`scanner-change ${selectedStock.changePercent >= 0 ? 'positive' : 'negative'}`}
                  style={{ fontSize: '1.1rem', marginLeft: '1rem' }}
                >
                  {selectedStock.changePercent >= 0 ? '▲' : '▼'} {Math.abs(selectedStock.changePercent).toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Historical chart */}
            <div style={{ height: '200px', margin: '0.5rem 0' }}>
              <MiniChart 
                data={selectedStock.history}
                valueKey="close"
                dateKey="date"
                strokeColor="var(--accent)"
                fillGradId="modalChartGrad"
              />
            </div>

            {/* Technical analysis details */}
            <div className="modal-grid">
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block' }}>Relative Strength Index (RSI 14)</span>
                <span style={{ fontSize: '1.1rem', fontWeight: '700' }}>{selectedStock.rsi.toFixed(2)}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block' }}>
                  {selectedStock.rsi > 70 ? 'Overbought (Extended)' : selectedStock.rsi < 35 ? 'Oversold (Value Area)' : 'Neutral Momentum'}
                </span>
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block' }}>Moving Averages (20 / 50 SMA)</span>
                <span style={{ fontSize: '1.1rem', fontWeight: '700' }}>₹{selectedStock.sma20.toFixed(0)} / ₹{selectedStock.sma50.toFixed(0)}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block' }}>
                  Price is {selectedStock.price > selectedStock.sma20 ? 'Above 20 SMA (Short-term Bullish)' : 'Below 20 SMA (Short-term Bearish)'}
                </span>
              </div>
            </div>

            {/* Speclative Thesis */}
            <div style={{ background: 'var(--accent-glow)', border: '1px solid var(--accent-border)', padding: '1rem', borderRadius: '10px' }}>
              <h3 style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: '600', marginBottom: '0.35rem' }}>🧠 Quant Sentinal Speculative Thesis</h3>
              <p style={{ fontSize: '0.82rem', lineHeight: '1.5', color: 'var(--text-primary)' }}>
                {SECTOR_SPECULATIONS[selectedStock.sector] || "Scanning fundamental drivers and index liquidity pools for setups."}
              </p>
              <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Signal: <strong style={{ color: selectedStock.recommendation.includes('BUY') ? 'var(--green)' : selectedStock.recommendation.includes('REDUCE') ? 'var(--red)' : 'inherit' }}>{selectedStock.recommendation}</strong></span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>*Reason: {selectedStock.recReason}</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedStock(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
