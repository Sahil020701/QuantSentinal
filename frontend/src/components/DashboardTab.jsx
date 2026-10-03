import React, { useState, useMemo } from 'react';
import MiniChart from './MiniChart';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

// Algorithmic Trailing Stop Ladder & Risk Cushion Calculator
export function computeHoldingTrailingInfo(position) {
  const pGain = position.profitPercent || 0;
  const buy = position.buyPrice || 0;
  const curr = position.currentPrice || 0;
  const currentSl = position.stopLoss || (buy * 0.952);
  const target = position.targetPrice || (buy * 1.25);

  const rupeeBuffer = Math.max(0, curr - currentSl);
  const pctBuffer = curr > 0 ? (rupeeBuffer / curr) * 100 : 0;

  const rupeeUpside = Math.max(0, target - curr);
  const pctUpside = curr > 0 ? (rupeeUpside / curr) * 100 : 0;

  // Trailing Ladder Definitions
  const step1Sl = buy * 0.952;
  const step2Trigger = buy * 1.10;
  const step2Sl = buy;
  const step3Trigger = buy * 1.12;
  const step3Sl = buy * 1.055;
  const step4Trigger = buy * 1.15;
  const step4Sl = buy * 1.08;
  const step5Trigger = buy * 1.18;
  const step5Sl = buy * 1.115;
  const step6Target = buy * 1.25;

  let activeStep = 1;
  let statusBadge = { label: 'HARD_STOP (-4.8%)', type: 'badge-hard-stop', step: 1 };

  if (pGain >= 25.0 || curr >= step6Target) {
    activeStep = 6;
    statusBadge = { label: 'TARGET (+25%)', type: 'badge-target', step: 6 };
  } else if (pGain >= 18.0 || currentSl >= step5Sl * 0.999) {
    activeStep = 5;
    statusBadge = { label: 'LOCKED +11.5%', type: 'badge-locked-super', step: 5 };
  } else if (pGain >= 15.0 || currentSl >= step4Sl * 0.999) {
    activeStep = 4;
    statusBadge = { label: 'LOCKED +8.0%', type: 'badge-locked-high', step: 4 };
  } else if (pGain >= 12.0 || currentSl >= step3Sl * 0.999) {
    activeStep = 3;
    statusBadge = { label: 'LOCKED +5.5%', type: 'badge-locked-mid', step: 3 };
  } else if (pGain >= 10.0 || currentSl >= step2Sl * 0.999) {
    activeStep = 2;
    statusBadge = { label: 'BREAKEVEN PROTECTED', type: 'badge-breakeven', step: 2 };
  }

  const steps = [
    {
      num: 1,
      title: 'Initial Hard Stop Loss (-4.8%)',
      trigger: 'Immediate upon trade entry',
      slPrice: step1Sl,
      slText: `-4.80% (₹${step1Sl.toFixed(2)})`,
      desc: 'Strict risk boundary. Auto-exits to cap maximum portfolio downside risk at 4.8%.',
      isActive: activeStep === 1,
      isCompleted: activeStep > 1
    },
    {
      num: 2,
      title: 'Breakeven Trailing Defense (0.0% Risk)',
      trigger: `Price crosses +10.0% gain (₹${step2Trigger.toFixed(2)})`,
      slPrice: step2Sl,
      slText: `Breakeven Entry (₹${step2Sl.toFixed(2)})`,
      desc: 'Capital protection trigger. Stop loss raised to entry price. Trade is 100% risk-free.',
      isActive: activeStep === 2,
      isCompleted: activeStep > 2
    },
    {
      num: 3,
      title: 'Profit Lock Tier 1 (+5.5% Secured)',
      trigger: `Price crosses +12.0% gain (₹${step3Trigger.toFixed(2)})`,
      slPrice: step3Sl,
      slText: `+5.50% Secured (₹${step3Sl.toFixed(2)})`,
      desc: 'Locking green profit. Even on a sudden gap-down reversal, +5.5% return is guaranteed.',
      isActive: activeStep === 3,
      isCompleted: activeStep > 3
    },
    {
      num: 4,
      title: 'Super Runner Lock (+8.0% Secured)',
      trigger: `Price crosses +15.0% gain (₹${step4Trigger.toFixed(2)})`,
      slPrice: step4Sl,
      slText: `+8.00% Secured (₹${step4Sl.toFixed(2)})`,
      desc: 'Momentum defense. Locks +8.0% minimum return while giving the asset room to reach target.',
      isActive: activeStep === 4,
      isCompleted: activeStep > 4
    },
    {
      num: 5,
      title: 'Compounding Lock (+11.5% Secured)',
      trigger: `Price crosses +18.0% gain (₹${step5Trigger.toFixed(2)})`,
      slPrice: step5Sl,
      slText: `+11.50% Secured (₹${step5Sl.toFixed(2)})`,
      desc: 'Elite breakout runner. Guarantees 11.5% return as price approaches full take-profit ceiling.',
      isActive: activeStep === 5,
      isCompleted: activeStep > 5
    },
    {
      num: 6,
      title: 'Target Profit Harvest (+25.0%)',
      trigger: `Price hits target ceiling (₹${step6Target.toFixed(2)})`,
      slPrice: step6Target,
      slText: `Full Target (+25.0%)`,
      desc: 'Target objective met (+25.0%). Book 100% gains or initiate parabolic trailing runner.',
      isActive: activeStep === 6,
      isCompleted: false
    }
  ];

  return {
    buy,
    curr,
    currentSl,
    target,
    rupeeBuffer,
    pctBuffer,
    rupeeUpside,
    pctUpside,
    activeStep,
    statusBadge,
    steps
  };
}

// ── Time-range definitions ──────────────────────────────────────────────────
const RANGES = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: 'YTD', days: null, ytd: true },
  { label: '1Y', days: 365 },
  { label: '2Y', days: 730 },
  { label: '3Y', days: 1095 },
  { label: '5Y', days: 1826 },
  { label: 'ALL', days: null },
];

function filterByRange(history, range) {
  if (!history || history.length === 0) return history;
  if (!range || (range.days === null && !range.ytd)) return history; // ALL / Since Inception

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

export default function DashboardTab({ portfolio, portfolioMode = 'live', onPortfolioRefresh }) {
  const { cash, holdings, valuationHistory } = portfolio;
  const [activeRange, setActiveRange] = useState(() => {
    if (portfolio?.valuationHistory && portfolio.valuationHistory.length > 300) {
      return 'ALL';
    }
    return '1Y';
  });
  const [chartMode, setChartMode] = useState('total'); // 'total' | 'invested'
  const [inspectHolding, setInspectHolding] = useState(null);
  const [closingHolding, setClosingHolding] = useState(false);
  const [copiedGtt, setCopiedGtt] = useState(false);

  const handleCloseHolding = async (holding) => {
    if (!holding) return;
    const confirmClose = window.confirm(`Confirm sell of ${holding.quantity} shares of ${holding.symbol.replace('.NS', '')} at current market price ₹${holding.currentPrice.toFixed(2)}?`);
    if (!confirmClose) return;

    setClosingHolding(true);
    try {
      const res = await fetch(`${API_URL}/api/live/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: holding.symbol,
          price: holding.currentPrice,
          reason: 'Manual Exit from Dashboard Holdings'
        })
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to close position");
      }
      setInspectHolding(null);
      if (typeof onPortfolioRefresh === 'function') {
        onPortfolioRefresh();
      }
    } catch (err) {
      console.error(err);
      alert(`Error closing holding: ${err.message}`);
    } finally {
      setClosingHolding(false);
    }
  };

  const handleCopyGTT = (position, trailingInfo) => {
    const sym = position.symbol.replace('.NS', '');
    const text = `QUANTSENTINEL GTT ORDER TICKET
Asset: ${sym} (${position.name || 'NSE Equity'})
Action: GTT OCO (One Cancels Other)
Current CMP: ₹${position.currentPrice.toFixed(2)}
Active Stop Loss Trigger: ₹${position.stopLoss.toFixed(2)} (${trailingInfo.statusBadge.label})
Downside Risk Cushion: ₹${trailingInfo.rupeeBuffer.toFixed(2)} (${trailingInfo.pctBuffer.toFixed(1)}%)
Target Trigger: ₹${position.targetPrice.toFixed(2)} (+25.0%)
Upside Potential: ₹${trailingInfo.rupeeUpside.toFixed(2)} (${trailingInfo.pctUpside.toFixed(1)}%)
Position Size: ${position.quantity} shares (Value: ₹${position.value.toFixed(2)})
GTT Execution: Place OCO Sell on Zerodha Kite / Groww with Stop Loss trigger and Target trigger.`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedGtt(true);
      setTimeout(() => setCopiedGtt(false), 2500);
    }
  };

  // Latest valuation details
  const latestValuation = valuationHistory[valuationHistory.length - 1] || {
    totalValue: 100000.0,
    profitPercent: 0.0,
    totalDeposited: 100000.0,
    holdingsValue: 0.0,
  };

  const totalValue = latestValuation.totalValue;
  const holdingsValue = latestValuation.holdingsValue || 0;
  const profitPercent = latestValuation.profitPercent || 0;
  const totalDeposited = latestValuation.totalDeposited || 100000.0;
  const netProfit = totalValue - totalDeposited;
  const activeCount = holdings.length;

  // ── Mutual Fund Style Annualized Return (CAGR) ───────────────────────────
  // CAGR = (End Value / Start Capital) ^ (365 / daysElapsed) - 1
  const firstValuation = valuationHistory[0] || latestValuation;
  const cagrMetrics = useMemo(() => {
    if (!firstValuation.date || !latestValuation.date) return { cagr: profitPercent, days: 0, years: 0 };
    const dStart = new Date(firstValuation.date);
    const dEnd = new Date(latestValuation.date);
    const diffDays = Math.max(1, Math.round((dEnd - dStart) / (1000 * 60 * 60 * 24)));
    const years = diffDays / 365.25;

    if (years < (30 / 365.25) || totalDeposited <= 0) {
      // Under 1 month: annualized figures produce distorted extrapolations, show absolute ROI
      return { cagr: profitPercent, isAbsolute: true, days: diffDays, years };
    }

    // Compound Annual Growth Rate on initial capital
    const endVal = Math.max(0, totalValue);
    const cagr = (Math.pow(endVal / totalDeposited, 1 / years) - 1) * 100;
    return { cagr, isAbsolute: false, days: diffDays, years };
  }, [firstValuation, latestValuation, totalValue, totalDeposited, profitPercent]);

  // ── Filtered chart data ─────────────────────────────────────────────────
  const selectedRange = RANGES.find(r => r.label === activeRange) || RANGES[RANGES.length - 1];
  const filteredHistory = useMemo(
    () => filterByRange(valuationHistory, selectedRange),
    [valuationHistory, selectedRange]
  );

  // Chart mode derivations: 'total' | 'invested' | 'pl'
  const isInvestedMode = chartMode === 'invested';
  const isPlMode = chartMode === 'pl';

  const chartTitle = isPlMode
    ? 'Pure Trading P&L'
    : isInvestedMode
      ? 'Invested Holdings Value'
      : 'Portfolio Net Worth';

  // Ensure each history item has plAmt (totalValue - totalDeposited) and plPct (profitPercent)
  const chartData = useMemo(() => {
    return filteredHistory.map(item => {
      const dep = item.totalDeposited || 100000;
      const tv = item.totalValue || 0;
      return {
        ...item,
        plAmt: tv - dep,
        plPct: item.profitPercent ?? 0,
      };
    });
  }, [filteredHistory]);

  const chartValueKey = isPlMode ? 'plAmt' : isInvestedMode ? 'holdingsValue' : 'totalValue';

  // Period-level performance
  const periodStartROI = filteredHistory[0]?.profitPercent ?? 0;
  const periodEndROI = filteredHistory[filteredHistory.length - 1]?.profitPercent ?? 0;

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
            {profitPercent >= 0 ? '▲' : '▼'} {Math.abs(profitPercent).toFixed(2)}% Absolute Return
          </div>
        </div>

        <div className="kpi-card green">
          <div className="kpi-label">Annualized Return (CAGR)</div>
          <div className="kpi-value" style={{ color: cagrMetrics.cagr >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {cagrMetrics.cagr >= 0 ? '+' : ''}{cagrMetrics.cagr.toFixed(2)}%
          </div>
          <div className="kpi-sub neutral">
            {cagrMetrics.isAbsolute
              ? `${cagrMetrics.days} days active`
              : `Annualized (${cagrMetrics.years.toFixed(1)}Y compound)`}
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
            Invested: ₹{holdingsValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                {[
                  { key: 'total', label: 'Total' },
                  { key: 'invested', label: 'Invested Only' },
                  { key: 'pl', label: 'Pure P/L' }
                ].map((m, idx, arr) => (
                  <button
                    key={m.key}
                    onClick={() => setChartMode(m.key)}
                    style={{
                      padding: '5px 12px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      border: 'none',
                      borderRight: idx < arr.length - 1 ? '1px solid var(--border-color)' : 'none',
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
              data={chartData}
              valueKey={chartValueKey}
              dateKey="date"
              fillGradId="netWorthGrad"
              baselineValue={isPlMode ? 0 : isInvestedMode ? null : totalDeposited}
              baselineLabel={isPlMode ? 'Break-even (₹0)' : 'Invested Capital'}
            />
          </div>

          {/* Bottom meta row */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: '0.75rem', paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.75rem', color: 'var(--text-secondary)'
          }}>
            {isPlMode ? (
              <span>Net Profit: <strong style={{ color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {netProfit >= 0 ? '+' : ''}₹{netProfit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({profitPercent >= 0 ? '+' : ''}{profitPercent.toFixed(2)}%)
              </strong></span>
            ) : isInvestedMode ? (
              <span>Invested Value: <strong style={{ color: 'var(--text-primary)' }}>₹{holdingsValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
            ) : (
              <span>Invested Capital: <strong style={{ color: 'var(--text-primary)' }}>₹{totalDeposited.toLocaleString('en-IN')}</strong></span>
            )}
            <span>Data Points: <strong style={{ color: 'var(--text-primary)' }}>{chartData.length}</strong></span>
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
              <span style={{ color: 'var(--text-secondary)' }}>Annualized Return:</span>
              <span style={{ fontWeight: '600', color: cagrMetrics.cagr >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {cagrMetrics.cagr >= 0 ? '+' : ''}{cagrMetrics.cagr.toFixed(2)}% p.a.
              </span>
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
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2>Active Holdings</h2>
            <span className={`status-badge ${portfolioMode === 'live' ? 'live' : 'closed'}`} style={{ padding: '0.2rem 0.6rem', fontSize: '0.72rem' }}>
              <span className="status-dot" />
              <span>{portfolioMode === 'live' ? 'Live Trading Portfolio (₹1,00,000)' : 'Backtest Simulation'}</span>
            </span>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Showing {holdings.length} open position{holdings.length === 1 ? '' : 's'}
          </span>
        </div>

        {holdings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            <p style={{ margin: '0 0 0.5rem', fontWeight: '600', color: 'var(--text-primary)' }}>
              {portfolioMode === 'live'
                ? 'Your Live Portfolio is ready with ₹1,00,000 liquid capital.'
                : 'No active stock holdings in this backtest period.'}
            </p>
            <p style={{ margin: '0', fontSize: '0.85rem' }}>
              {portfolioMode === 'live'
                ? 'Head over to Algo Top 25 to view institutional candidates and execute your first live position with one click.'
                : 'Current portfolio is 100% cash. Running scans on market open.'}
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Position</th>
                  <th>Buy Price</th>
                  <th>Current Price</th>
                  <th>P&amp;L Returns</th>
                  <th>Dynamic Stop Loss</th>
                  <th>Target Upside</th>
                  <th style={{ textAlign: 'center' }}>Trade Plan &amp; Steps</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((position, idx) => {
                  const trailing = computeHoldingTrailingInfo(position);
                  const isProfit = position.profit >= 0;
                  const weightPct = totalValue > 0 ? ((position.value / totalValue) * 100).toFixed(1) : '0.0';

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
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{position.sector || 'NSE Equity'}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: '700' }}>{position.quantity} shares</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          ₹{position.value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({weightPct}%)
                        </div>
                      </td>
                      <td>₹{position.buyPrice.toFixed(2)}</td>
                      <td>
                        <span style={{ fontWeight: '700' }}>₹{position.currentPrice.toFixed(2)}</span>
                      </td>
                      <td className={isProfit ? 'positive-cell' : 'negative-cell'}>
                        <div style={{ fontWeight: '700' }}>
                          {isProfit ? '+' : ''}₹{position.profit.toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.75rem' }}>
                          {isProfit ? '+' : ''}{position.profitPercent.toFixed(2)}%
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: '700', color: 'var(--red)' }}>
                              ₹{position.stopLoss.toFixed(2)}
                            </span>
                            <span className={`trailing-chip ${trailing.statusBadge.type}`}>
                              {trailing.statusBadge.label}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Buffer: ₹{trailing.rupeeBuffer.toFixed(2)} ({trailing.pctBuffer.toFixed(1)}% cushion)
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontWeight: '700', color: 'var(--green)' }}>
                            ₹{position.targetPrice.toFixed(2)} (+25%)
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Upside: +₹{trailing.rupeeUpside.toFixed(2)} (+{trailing.pctUpside.toFixed(1)}%)
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => setInspectHolding(position)}
                            className="btn btn-secondary"
                            style={{ padding: '5px 12px', fontSize: '0.75rem', fontWeight: '700' }}
                          >
                            Trade Plan &amp; Steps
                          </button>
                          {portfolioMode === 'live' && (
                            <button
                              type="button"
                              onClick={() => handleCloseHolding(position)}
                              disabled={closingHolding}
                              className="btn btn-danger"
                              style={{ padding: '5px 10px', fontSize: '0.72rem', fontWeight: '700' }}
                              title="Close Position (Sell shares on Live Portfolio)"
                            >
                              Sell
                            </button>
                          )}
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

      {/* Trade Plan & Algorithmic Steps Modal */}
      {inspectHolding && (() => {
        const trailing = computeHoldingTrailingInfo(inspectHolding);
        const sym = inspectHolding.symbol.replace('.NS', '');
        const isProfit = inspectHolding.profit >= 0;

        return (
          <div className="modal-backdrop" onClick={() => setInspectHolding(null)}>
            <div className="modal-card" style={{ maxWidth: '680px' }} onClick={e => e.stopPropagation()}>
              
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                    <span className="stock-badge" style={{ fontSize: '1rem', padding: '3px 8px' }}>{sym}</span>
                    <span className={`trailing-chip ${trailing.statusBadge.type}`}>
                      {trailing.statusBadge.label}
                    </span>
                    {inspectHolding.isAccumulated && (
                      <span style={{ fontSize: '0.65rem', fontWeight: '800', padding: '2px 6px', borderRadius: '4px', background: 'rgba(56,189,248,0.2)', color: '#0284c7' }}>
                        PYRAMID POSITION
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {inspectHolding.name} &bull; {inspectHolding.sector || 'NSE Equity'} &bull; {inspectHolding.quantity} shares
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectHolding(null)}
                  style={{ background: 'none', border: 'none', fontSize: '1.25rem', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                >
                  ✕
                </button>
              </div>

              {/* Price Metrics Bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem', margin: '1rem 0' }}>
                <div style={{ background: 'var(--bg-card-hover)', borderRadius: '8px', padding: '0.6rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>Entry Price</div>
                  <div style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--text-primary)' }}>₹{inspectHolding.buyPrice.toFixed(2)}</div>
                </div>
                <div style={{ background: 'var(--bg-card-hover)', borderRadius: '8px', padding: '0.6rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>Current Price</div>
                  <div style={{ fontSize: '1rem', fontWeight: '800', color: isProfit ? 'var(--green)' : 'var(--red)' }}>
                    ₹{inspectHolding.currentPrice.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: isProfit ? 'var(--green)' : 'var(--red)', fontWeight: '700' }}>
                    {isProfit ? '+' : ''}{inspectHolding.profitPercent.toFixed(2)}%
                  </div>
                </div>
                <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: '8px', padding: '0.6rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--red)', fontWeight: '700', textTransform: 'uppercase' }}>Active Stop Loss</div>
                  <div style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--red)' }}>₹{inspectHolding.stopLoss.toFixed(2)}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>₹{trailing.rupeeBuffer.toFixed(2)} buffer</div>
                </div>
                <div style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: '8px', padding: '0.6rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--green)', fontWeight: '700', textTransform: 'uppercase' }}>Target Exit (+25%)</div>
                  <div style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--green)' }}>₹{inspectHolding.targetPrice.toFixed(2)}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>+₹{trailing.rupeeUpside.toFixed(2)} upside</div>
                </div>
              </div>

              {/* Trailing Stop Ladder */}
              <div style={{ margin: '1rem 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                    Algorithmic Trailing Stop-Loss Ladder
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Current Active: <strong>Step {trailing.activeStep}</strong>
                  </div>
                </div>

                <div className="steps-ladder">
                  {trailing.steps.map(step => (
                    <div
                      key={step.num}
                      className={`step-card ${step.isActive ? 'active-step' : ''} ${step.isCompleted ? 'completed-step' : ''}`}
                    >
                      <div className="step-num-badge">
                        {step.isCompleted ? '✓' : step.num}
                      </div>
                      <div className="step-content">
                        <div className="step-header-row">
                          <div>
                            <span className="step-title">{step.title}</span>
                            {step.isActive && (
                              <span className="step-active-tag">Active Current Step</span>
                            )}
                          </div>
                          <span className="step-target-badge">{step.slText}</span>
                        </div>
                        <div className="step-desc">
                          <strong>Trigger:</strong> {step.trigger}. {step.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Broker GTT Ticket & Setup Guide */}
              <div style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.8rem', margin: '1rem 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--accent)' }}>
                    Broker GTT Setup (Zerodha Kite / Groww / AngelOne)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyGTT(inspectHolding, trailing)}
                    className="btn btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                  >
                    {copiedGtt ? 'Copied to Clipboard!' : 'Copy GTT Parameters'}
                  </button>
                </div>
                <div className="ticket-copy-box" style={{ fontSize: '0.72rem', padding: '0.5rem' }}>
{`Asset: ${sym} (${inspectHolding.name})
Type: GTT OCO (One Cancels Other)  |  Quantity: ${inspectHolding.quantity}
Stop Loss Trigger: ₹${inspectHolding.stopLoss.toFixed(2)}  (Limit: ₹${(inspectHolding.stopLoss * 0.995).toFixed(2)})
Target Trigger: ₹${inspectHolding.targetPrice.toFixed(2)}  (Limit: ₹${inspectHolding.targetPrice.toFixed(2)})
Trailing Status: Step ${trailing.activeStep} (${trailing.statusBadge.label})`}
                </div>
              </div>

              {/* Modal Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                {portfolioMode === 'live' && (
                  <button
                    type="button"
                    onClick={() => handleCloseHolding(inspectHolding)}
                    disabled={closingHolding}
                    className="btn btn-danger"
                    style={{ fontSize: '0.82rem' }}
                  >
                    {closingHolding ? 'Closing...' : `Close Position (${inspectHolding.quantity} shares)`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInspectHolding(null)}
                  className="btn btn-primary"
                  style={{ fontSize: '0.82rem' }}
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

