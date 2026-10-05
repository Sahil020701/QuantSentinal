import React, { useState, useEffect } from 'react';
import MiniChart from './MiniChart';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export default function AlgoTop25Tab({ portfolioMode = 'live', onTradeExecuted }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState('ALL');
  const [selectedCap, setSelectedCap] = useState('ALL');
  const [minPassed, setMinPassed] = useState('ALL');
  const [displayLimit, setDisplayLimit] = useState(25);
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'cards'
  const [inspectStock, setInspectStock] = useState(null);
  const [simulateStock, setSimulateStock] = useState(null);
  const [userCapital, setUserCapital] = useState(50000);
  const [copiedOrderId, setCopiedOrderId] = useState(false);
  const [onlyReadyToBuy, setOnlyReadyToBuy] = useState(false);
  const [executingLive, setExecutingLive] = useState(false);
  const [executionFeedback, setExecutionFeedback] = useState(null);

  const handleExecuteLiveBuy = async (stock, qty, price, sl, tp) => {
    setExecutingLive(true);
    setExecutionFeedback(null);
    try {
      const res = await fetch(`${API_URL}/api/live/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: stock.symbol,
          name: stock.name,
          sector: stock.sector,
          quantity: qty,
          price: price,
          stopLoss: sl,
          targetPrice: tp,
          reason: `Algo Top 25 (${stock.strategy || 'Momentum Breakout'})`
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Order execution failed");
      }
      setExecutionFeedback({
        type: 'success',
        text: `Order Executed: Added ${qty}x ${stock.symbol.replace('.NS', '')} @ ₹${price.toFixed(2)} to Live Portfolio.`
      });
      if (typeof onTradeExecuted === 'function') {
        onTradeExecuted();
      }
      fetchTop25();
    } catch (err) {
      console.error(err);
      setExecutionFeedback({
        type: 'error',
        text: err.message
      });
    } finally {
      setExecutingLive(false);
    }
  };

  const copyOrderParameters = (stock, qty, requiredCap, sl, tp, riskRs, gainRs, allocPct, grade) => {
    const sym = stock.symbol.replace('.NS', '');
    const text = `QUANTSENTINEL NEXT-DAY ORDER TICKET
Asset: ${sym} (${stock.name})
Sector: ${stock.sector} | Cap: ${stock.cap || 'Equity'}
Action: BUY (CNC / Delivery)
Order Type: LIMIT ORDER
Limit Entry Price: ₹${stock.price.toFixed(2)}
Stop Loss: ₹${sl.toFixed(2)} (-4.8%)
Take-Profit Target: ₹${tp.toFixed(2)} (+25.0%)
Recommended Sizing: ${qty} shares (₹${requiredCap.toLocaleString('en-IN')})
Account Allocation: ${allocPct}% (${grade})
Risk / Reward: 1 : 5.2 (Downside Risk: ₹${riskRs.toLocaleString('en-IN')} | Upside Target: ₹${gainRs.toLocaleString('en-IN')})
GTT Setup: Place OCO GTT on Zerodha/Groww before 09:15 AM IST`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedOrderId(true);
      setTimeout(() => setCopiedOrderId(false), 2500);
    }
  };

  useEffect(() => {
    fetchTop25();
  }, [portfolioMode]);

  const fetchTop25 = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/algo-top25?limit=all&mode=${portfolioMode}`);
      if (!res.ok) throw new Error("Failed to load algorithm rankings");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
      setError("Could not load algorithm candidates. Ensure backend is running.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="spinner-container">
        <div className="spinner" />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: '500' }}>
          Scanning 500+ NSE Assets (Large, Mid & Small Cap) & Computing Multi-Factor Indicator Models...
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

  const { date, marketRegime, strategyApproach, strategyTitle, totalScanned = 0, top25 = [], rankings } = data;
  const allCandidates = (rankings && rankings.length > 0) ? rankings : top25;

  // Generate dynamic step-up options: 25, 50, 75, ... up to total available assets, then 'ALL'
  const limitOptions = [];
  const maxPool = allCandidates.length || totalScanned || 25;
  for (let step = 25; step < maxPool; step += 25) {
    limitOptions.push(step);
  }
  limitOptions.push('ALL');

  const displayedPool = displayLimit === 'ALL'
    ? allCandidates
    : allCandidates.slice(0, Number(displayLimit) || 25);

  // Unique sectors for filtering (derived from all candidates)
  const sectors = ['ALL', ...new Set(allCandidates.map(s => s.sector).filter(Boolean))];
  const caps = ['ALL', 'Large Cap', 'Mid Cap', 'Small Cap'];

  // Count qualified buys ready for next-day execution
  const qualifiedBuysCount = allCandidates.filter(s => s.executionStatus?.status === 'QUALIFIED_BUY').length;

  // Filtering
  const filteredStocks = displayedPool.filter(stock => {
    const matchesSearch =
      stock.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      stock.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSector = selectedSector === 'ALL' || stock.sector === selectedSector;
    const matchesCap = selectedCap === 'ALL' || (stock.cap && stock.cap === selectedCap);
    const matchesPassed =
      minPassed === 'ALL' ||
      (minPassed === '8' && stock.passedCount === 8) ||
      (minPassed === '7+' && stock.passedCount >= 7) ||
      (minPassed === '6+' && stock.passedCount >= 6);
    const matchesQualified = !onlyReadyToBuy || stock.executionStatus?.status === 'QUALIFIED_BUY';
    return matchesSearch && matchesSector && matchesCap && matchesPassed && matchesQualified;
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
              <h2>{displayLimit === 'ALL' ? `All Algo Candidates (${allCandidates.length})` : `Top ${displayLimit} Algo Candidates`}</h2>
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
              {strategyApproach && (
                <span style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '6px',
                  background: strategyApproach === 'conservative' ? 'rgba(59, 130, 246, 0.12)' : 'var(--accent-glow)',
                  color: strategyApproach === 'conservative' ? 'var(--blue, #3b82f6)' : 'var(--accent)',
                  border: `1px solid ${strategyApproach === 'conservative' ? 'rgba(59, 130, 246, 0.3)' : 'var(--accent-border)'}`,
                  fontWeight: '700'
                }}>
                  STRATEGY: {strategyApproach === 'conservative' ? 'CONSERVATIVE (~40 TRADES/YR)' : 'AGGRESSIVE (~172 TRADES/YR)'}
                </span>
              )}
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
          <span title="Price >= 20 EMA, 20 EMA > 50 EMA & expanding"><strong>Trend:</strong> 20 &gt; 50 EMA</span>
          <span title="Alpha >= +4.0% outperformance vs Nifty 50"><strong>RS Alpha:</strong> &gt;= +4.0% vs Nifty</span>
          <span title="Institutional volume >= 1.90x 20-day avg"><strong>RVOL:</strong> &gt;= 1.9x Vol</span>
          <span title="RSI within sweet spot (52.0 - 72.5)"><strong>RSI:</strong> 52 - 72.5 Sweet Spot</span>
          <span title="New 20-day high or within 1.5% of resistance"><strong>Breakout:</strong> 20D High Setup</span>
          <span title="Close Location Value >= 68%"><strong>CLV:</strong> &gt;= 68% Close</span>
          <span title="ADX >= 20.0 directional trend strength"><strong>ADX:</strong> &gt;= 20 Trend Strength</span>
          <span title="<= 8.0% above 20 EMA to avoid extended trap"><strong>Safety:</strong> &lt;= 8.0% from 20 EMA</span>
        </div>

        {/* Next-Day Actionable Setups Banner */}
        {qualifiedBuysCount > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 1rem',
            borderRadius: '10px',
            background: 'var(--green-glow)',
            border: '1px solid var(--green-border)',
            marginTop: '0.75rem',
            flexWrap: 'wrap',
            gap: '0.6rem'
          }}>
            <div>
              <span style={{ fontSize: '0.88rem', fontWeight: '800', color: 'var(--green)' }}>
                {qualifiedBuysCount} Next-Day Trade Setup{qualifiedBuysCount > 1 ? 's' : ''} Ready for Market Open!
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                QuantSentinel algorithm passed all institutional criteria. Click Order Ticket to copy Limit &amp; Stop Loss prices.
              </span>
            </div>
            <button
              onClick={() => setOnlyReadyToBuy(!onlyReadyToBuy)}
              className={`btn ${onlyReadyToBuy ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem', fontWeight: '700' }}
            >
              {onlyReadyToBuy ? 'Show All Ranked Assets' : `View Only Next-Day Buys (${qualifiedBuysCount})`}
            </button>
          </div>
        )}

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

          {/* Market Cap filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Cap:</span>
            <select
              value={selectedCap}
              onChange={(e) => setSelectedCap(e.target.value)}
              className="config-select"
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
            >
              {caps.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Configurable Limit Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Show:</span>
            <select
              value={displayLimit}
              onChange={(e) => setDisplayLimit(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
              className="config-select"
              style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem', fontWeight: '600', color: 'var(--accent)' }}
            >
              {limitOptions.map(opt => (
                <option key={opt} value={opt}>
                  {opt === 'ALL' ? `All (${allCandidates.length})` : `Top ${opt}`}
                </option>
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
              <option value="ALL">All {displayLimit === 'ALL' ? 'Assets' : `(Top ${displayLimit})`}</option>
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
                  <th style={{ textAlign: 'center', minWidth: '180px' }}>Simulate &amp; Inspect</th>
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
                        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {stock.sector}
                          </span>
                          {stock.cap && (
                            <span style={{
                              fontSize: '0.62rem',
                              padding: '0.05rem 0.35rem',
                              borderRadius: '4px',
                              background: stock.cap === 'Large Cap' ? 'rgba(59, 130, 246, 0.1)' : stock.cap === 'Mid Cap' ? 'rgba(168, 85, 247, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                              color: stock.cap === 'Large Cap' ? '#60a5fa' : stock.cap === 'Mid Cap' ? '#c084fc' : '#facc15',
                              border: `1px solid ${stock.cap === 'Large Cap' ? 'rgba(59, 130, 246, 0.2)' : stock.cap === 'Mid Cap' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(234, 179, 8, 0.2)'}`,
                              fontWeight: '600'
                            }}>
                              {stock.cap}
                            </span>
                          )}
                        </div>
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

                      {/* Action: Simulate & Inspect */}
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center' }}>
                          <button
                            className={`btn-ticket ${stock.executionStatus?.status === 'QUALIFIED_BUY' ? 'btn-ticket-glow' : ''}`}
                            onClick={() => setSimulateStock(stock)}
                            title="Simulate Next-Day Order (Limit Price, Stop Loss, Quantity)"
                          >
                            Order Ticket
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                            onClick={() => setInspectStock(stock)}
                            title="Inspect indicator checklist and historical chart"
                          >
                            Inspect
                          </button>
                        </div>
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
                      {stock.name} • {stock.sector}{stock.cap ? ` • ${stock.cap}` : ''}
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

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }} onClick={(e) => e.stopPropagation()}>
                <button
                  className={`btn-ticket ${stock.executionStatus?.status === 'QUALIFIED_BUY' ? 'btn-ticket-glow' : 'btn-ticket-primary'}`}
                  style={{ flex: '1.2', fontSize: '0.8rem', padding: '0.45rem', justifyContent: 'center' }}
                  onClick={() => setSimulateStock(stock)}
                >
                  Simulate Trade &amp; SL
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ flex: '0.8', fontSize: '0.8rem', padding: '0.45rem', justifyContent: 'center' }}
                  onClick={() => setInspectStock(stock)}
                >
                  Inspect Setup →
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
                    {inspectStock.name} • {inspectStock.sector}{inspectStock.cap ? ` • ${inspectStock.cap}` : ''}
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

            {/* Button to Switch to Order Ticket */}
            <button
              onClick={() => {
                const stock = inspectStock;
                setInspectStock(null);
                setSimulateStock(stock);
              }}
              className="btn btn-ticket-primary"
              style={{ width: '100%', marginTop: '0.75rem', padding: '0.65rem', fontSize: '0.88rem' }}
            >
              Open Next-Day Order Ticket &amp; Broker Simulator &rarr;
            </button>

            {/* Close Button */}
            <button
              onClick={() => setInspectStock(null)}
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: '0.4rem' }}
            >
              Close Inspection
            </button>

          </div>
        </div>
      )}

      {/* ================= Next-Day Order Ticket & Trade Simulation Modal ================= */}
      {simulateStock && (() => {
        const price = simulateStock.price || 0;
        const isGradeAPlus = (simulateStock.algoScore || 0) >= 93;
        const allocPct = isGradeAPlus ? 15.0 : 12.5;
        const convictionGrade = isGradeAPlus ? 'Grade A+ (High Conviction)' : (simulateStock.algoScore >= 80 ? 'Grade A (Standard)' : 'Grade B (Watchlist)');
        
        const stopLossPrice = Number((price * 0.952).toFixed(2));
        const targetPrice = Number((price * 1.25).toFixed(2));
        const limitPriceBuffered = Number((price * 1.002).toFixed(2));

        const targetAllocRupees = userCapital * (allocPct / 100);
        let suggestedQty = price > 0 ? Math.floor(targetAllocRupees / price) : 0;
        if (suggestedQty <= 0 && userCapital >= price) suggestedQty = 1;

        const totalInvestment = suggestedQty * price;
        const maxDownsideRisk = Number((suggestedQty * (price - stopLossPrice)).toFixed(2));
        const maxUpsideGain = Number((suggestedQty * (targetPrice - price)).toFixed(2));
        const riskPctOfAccount = userCapital > 0 ? ((maxDownsideRisk / userCapital) * 100).toFixed(2) : '0.00';
        const gainPctOfAccount = userCapital > 0 ? ((maxUpsideGain / userCapital) * 100).toFixed(2) : '0.00';

        const isQualified = simulateStock.executionStatus?.status === 'QUALIFIED_BUY';

        return (
          <div className="modal-overlay" onClick={() => setSimulateStock(null)}>
            <div
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '720px', maxHeight: '92vh', overflowY: 'auto' }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className={`rank-badge ${getRankClass(simulateStock.rank)}`} style={{ width: '38px', height: '38px', fontSize: '1.05rem' }}>
                    #{simulateStock.rank}
                  </span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <h2 style={{ margin: '0', fontSize: '1.35rem' }}>{simulateStock.symbol.replace('.NS', '')}</h2>
                      <span className={`score-chip ${getScoreChipClass(simulateStock.algoScore)}`}>
                        {simulateStock.algoScore}/100 Algo Score
                      </span>
                      <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'rgba(37, 99, 235, 0.1)', color: 'var(--accent)', fontWeight: '700' }}>
                        {convictionGrade}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                      {simulateStock.name} • {simulateStock.sector}{simulateStock.cap ? ` • ${simulateStock.cap}` : ''}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSimulateStock(null)}
                  style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  ✕
                </button>
              </div>

              {/* Execution Status Alert Banner */}
              <div style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: isQualified ? 'var(--green-glow)' : 'rgba(15, 23, 42, 0.03)',
                border: `1px solid ${isQualified ? 'var(--green-border)' : 'var(--border-color)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem'
              }}>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: isQualified ? 'var(--green)' : 'var(--text-primary)' }}>
                    {isQualified ? 'QUANT SENTINEL ACTIVE BUY SETUP (NEXT SESSION)' : `Setup Status: ${simulateStock.executionStatus?.label || 'Watchlist'}`}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {isQualified
                      ? 'This stock meets all breakout momentum and institutional criteria. Engine plans to execute at market open.'
                      : (simulateStock.executionStatus?.reason || 'Candidate is tracked on algorithm watchlist.')}
                  </div>
                </div>

                <span style={{
                  fontSize: '0.72rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '5px',
                  ...getExecutionBadgeStyle(simulateStock.executionStatus?.status)
                }}>
                  {simulateStock.executionStatus?.label}
                </span>
              </div>

              {/* 4 Core Parameter Cards (Broker Execution Specs) */}
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Next-Day Order Execution Parameters
                </div>
                <div className="ticket-metric-grid">
                  {/* Card 1: Limit Order Entry */}
                  <div className="ticket-metric-card" style={{ borderLeft: '4px solid var(--accent)' }}>
                    <span className="ticket-metric-label">1. Limit Order Price</span>
                    <span className="ticket-metric-val" style={{ color: 'var(--accent)' }}>
                      ₹{price.toFixed(2)}
                    </span>
                    <span className="ticket-metric-sub" style={{ color: 'var(--text-secondary)' }}>
                      Trigger Buffer: ₹{limitPriceBuffered.toFixed(2)} (+0.2%)
                    </span>
                  </div>

                  {/* Card 2: Stop-Loss (-4.8%) */}
                  <div className="ticket-metric-card" style={{ borderLeft: '4px solid var(--red)' }}>
                    <span className="ticket-metric-label">2. Stop-Loss (Hard Exit)</span>
                    <span className="ticket-metric-val" style={{ color: 'var(--red)' }}>
                      ₹{stopLossPrice.toFixed(2)}
                    </span>
                    <span className="ticket-metric-sub" style={{ color: 'var(--red)' }}>
                      -4.8% (-₹{(price * 0.048).toFixed(2)}/sh)
                    </span>
                  </div>

                  {/* Card 3: Target (+25.0%) */}
                  <div className="ticket-metric-card" style={{ borderLeft: '4px solid var(--green)' }}>
                    <span className="ticket-metric-label">3. Target Profit</span>
                    <span className="ticket-metric-val" style={{ color: 'var(--green)' }}>
                      ₹{targetPrice.toFixed(2)}
                    </span>
                    <span className="ticket-metric-sub" style={{ color: 'var(--green)' }}>
                      +25.0% (+₹{(price * 0.25).toFixed(2)}/sh)
                    </span>
                  </div>

                  {/* Card 4: Risk / Reward */}
                  <div className="ticket-metric-card" style={{ borderLeft: '4px solid #8b5cf6' }}>
                    <span className="ticket-metric-label">4. Risk / Reward</span>
                    <span className="ticket-metric-val" style={{ color: '#8b5cf6' }}>
                      1 : 5.2
                    </span>
                    <span className="ticket-metric-sub" style={{ color: 'var(--text-secondary)' }}>
                      Asymmetric Payoff Edge
                    </span>
                  </div>
                </div>
              </div>

              {/* Interactive Capital Allocation & Position Sizing Calculator */}
              <div style={{ background: 'rgba(15, 23, 42, 0.02)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div>
                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      Interactive Position Sizing Calculator
                    </span>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Calculates exact shares and rupee risk based on your trading account capital.
                    </div>
                  </div>

                  {/* Capital Preset Pills */}
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {[50000, 100000, 200000, 500000].map(amt => (
                      <button
                        key={amt}
                        onClick={() => setUserCapital(amt)}
                        className={`calc-preset-pill ${userCapital === amt ? 'active' : ''}`}
                      >
                        ₹{(amt / 1000).toFixed(0)}K
                      </button>
                    ))}
                  </div>
                </div>

                {/* Capital Input Field */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.85rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    My Account Capital:
                  </span>
                  <div style={{ position: 'relative', width: '180px' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontWeight: '700', color: 'var(--text-muted)' }}>
                      ₹
                    </span>
                    <input
                      type="number"
                      value={userCapital}
                      onChange={(e) => setUserCapital(Math.max(1000, Number(e.target.value) || 0))}
                      className="config-input"
                      style={{ paddingLeft: '1.75rem', width: '100%', fontSize: '0.9rem', fontWeight: '700' }}
                    />
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    (Suggested Size: <strong>{allocPct}%</strong> / ₹{targetAllocRupees.toLocaleString('en-IN')})
                  </span>
                </div>

                {/* Real-Time Calculation Results Matrix */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '0.65rem',
                  padding: '0.85rem',
                  background: 'var(--bg-card)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '600' }}>Recommended Qty</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--accent)' }}>
                      {suggestedQty} <span style={{ fontSize: '0.75rem', fontWeight: '500' }}>shares</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '600' }}>Capital Deployed</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      ₹{totalInvestment.toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '600' }}>Max Loss at SL (-4.8%)</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--red)' }}>
                      -₹{maxDownsideRisk.toLocaleString('en-IN')}
                      <span style={{ fontSize: '0.68rem', fontWeight: '600', marginLeft: '0.25rem' }}>({riskPctOfAccount}%)</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '600' }}>Target Profit (+25%)</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--green)' }}>
                      +₹{maxUpsideGain.toLocaleString('en-IN')}
                      <span style={{ fontSize: '0.68rem', fontWeight: '600', marginLeft: '0.25rem' }}>({gainPctOfAccount}%)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Formatted Order Code Block & One-Click Copy */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                    Broker Order Ticket Summary
                  </span>
                  <button
                    onClick={() => copyOrderParameters(
                      simulateStock,
                      suggestedQty,
                      totalInvestment,
                      stopLossPrice,
                      targetPrice,
                      maxDownsideRisk,
                      maxUpsideGain,
                      allocPct,
                      convictionGrade
                    )}
                    className="btn btn-ticket-primary"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
                  >
                    {copiedOrderId ? 'Copied to Clipboard!' : 'Copy Order Details'}
                  </button>
                </div>

                <div className="ticket-copy-box">
{`Asset: ${simulateStock.symbol.replace('.NS', '')} (${simulateStock.name})
Action: BUY (CNC / Delivery)  |  Order Type: LIMIT
Limit Price: ₹${price.toFixed(2)}  (Trigger Buffer: ₹${limitPriceBuffered.toFixed(2)})
Stop Loss: ₹${stopLossPrice.toFixed(2)} (-4.8%)
Take-Profit: ₹${targetPrice.toFixed(2)} (+25.0%)
Qty: ${suggestedQty} shares  (Value: ₹${totalInvestment.toLocaleString('en-IN')})
Risk / Reward: 1 : 5.2 (Risk ₹${maxDownsideRisk.toLocaleString('en-IN')} to gain ₹${maxUpsideGain.toLocaleString('en-IN')})`}
                </div>
              </div>

              {/* Broker Execution Guide (Zerodha / Groww / AngelOne) */}
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', background: 'rgba(37, 99, 235, 0.03)', border: '1px solid var(--accent-border)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
                <div style={{ fontWeight: '700', color: 'var(--accent)', marginBottom: '0.3rem' }}>
                  How to Simulate / Place this on your Broker (Zerodha Kite, Groww, AngelOne):
                </div>
                <ol style={{ paddingLeft: '1.2rem', margin: '0', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <li>Open your Broker App in the evening &rarr; Search <strong>{simulateStock.symbol.replace('.NS', '')}</strong>.</li>
                  <li>Click <strong>Create GTT</strong> (or place an <strong>After Market Limit Order / AMO</strong>).</li>
                  <li>Set <strong>Trigger Price</strong> at <strong>₹{price.toFixed(2)}</strong> and <strong>Limit Price</strong> at <strong>₹{limitPriceBuffered.toFixed(2)}</strong>.</li>
                  <li>Set Stop-Loss trigger at <strong>₹{stopLossPrice.toFixed(2)}</strong> (-4.8%) and Target at <strong>₹{targetPrice.toFixed(2)}</strong> (+25%).</li>
                  <li>Enter Quantity: <strong>{suggestedQty} shares</strong> and click <strong>Place GTT</strong>.</li>
                </ol>
              </div>

              {/* Algorithmic Trailing Rules */}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                <strong>QuantSentinel Trade Management Plan:</strong>
                <span style={{ marginLeft: '0.35rem' }}>
                  1. Exit immediately if price hits ₹{stopLossPrice.toFixed(2)} (-4.8%). &bull; 
                  2. At +3% peak gain, stop moves to +1.2% (₹{(price * 1.012).toFixed(2)}). &bull; 
                  3. At +11% peak, lock +5.5% (₹{(price * 1.055).toFixed(2)}); at +18% peak, lock +11.5% (₹{(price * 1.115).toFixed(2)}). &bull; 
                  4. Past +25% (₹{targetPrice.toFixed(2)}) the stop trails the 20 EMA with no fixed cap.
                </span>
              </div>

              {/* Feedback Banner */}
              {executionFeedback && (
                <div style={{
                  padding: '0.6rem 0.8rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  background: executionFeedback.type === 'success' ? 'var(--green-glow)' : 'var(--red-glow)',
                  border: `1px solid ${executionFeedback.type === 'success' ? 'var(--green-border)' : 'var(--red-border)'}`,
                  color: executionFeedback.type === 'success' ? 'var(--green)' : 'var(--red)'
                }}>
                  {executionFeedback.text}
                </div>
              )}

              {/* Bottom Buttons */}
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    const stock = simulateStock;
                    setSimulateStock(null);
                    setInspectStock(stock);
                  }}
                  className="btn btn-secondary"
                  style={{ flex: '1', minWidth: '160px', fontSize: '0.85rem' }}
                >
                  View Full Indicators &amp; Chart &rarr;
                </button>

                <button
                  type="button"
                  onClick={() => handleExecuteLiveBuy(simulateStock, suggestedQty, price, stopLossPrice, targetPrice)}
                  disabled={executingLive}
                  className="btn btn-primary"
                  style={{
                    flex: '1.2',
                    minWidth: '200px',
                    fontSize: '0.85rem',
                    background: 'var(--green)',
                    borderColor: 'var(--green)'
                  }}
                >
                  {executingLive
                    ? 'Executing Order...'
                    : `Add to Live Portfolio (${suggestedQty} shares)`}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSimulateStock(null);
                    setExecutionFeedback(null);
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                >
                  Done
                </button>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
}
