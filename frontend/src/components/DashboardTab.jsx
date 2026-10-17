import React, { useState, useMemo, useEffect } from 'react';
import MiniChart from './MiniChart';

const API_URL = import.meta.env.VITE_API_URL || 'https://130.210.13.143.sslip.io';

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

  // Trailing ladder mirrors the engine exit rules in backend/engine.js (runSimulation)
  const peak = Math.max(pGain, position.peakProfitPercent || 0);
  const step1Sl = buy * 0.952;
  const step2Sl = buy * 1.012;
  const step3Sl = buy * 1.055;
  const step4Sl = buy * 1.115;
  const ema20Runner = peak >= 25.0;

  let activeStep = 1;
  let statusBadge = { label: 'HARD STOP (-4.8%)', type: 'badge-hard-stop', step: 1 };
  if (peak >= 35.0) {
    activeStep = 6;
    statusBadge = { label: 'TIGHT EMA20 RUNNER', type: 'badge-target', step: 6 };
  } else if (peak >= 25.0) {
    activeStep = 5;
    statusBadge = { label: 'EMA20 RUNNER', type: 'badge-target', step: 5 };
  } else if (peak >= 18.0) {
    activeStep = 4;
    statusBadge = { label: 'LOCKED +11.5%', type: 'badge-locked-super', step: 4 };
  } else if (peak >= 11.0) {
    activeStep = 3;
    statusBadge = { label: 'LOCKED +5.5%', type: 'badge-locked-mid', step: 3 };
  } else if (peak >= 3.0) {
    activeStep = 2;
    statusBadge = { label: 'BREAKEVEN +1.2%', type: 'badge-breakeven', step: 2 };
  }

  const mk = (num, title, trigger, slText, desc) => ({
    num, title, trigger, slText, desc,
    isActive: activeStep === num,
    isCompleted: activeStep > num
  });

  const steps = [
    mk(1, 'Initial Hard Stop Loss', 'On entry', `-4.80% (Rs ${step1Sl.toFixed(2)})`,
      'Strict risk boundary that caps the loss on a failed trade at 4.8%.'),
    mk(2, 'Breakeven Protection', `Peak gain reaches +3.0% (Rs ${(buy * 1.03).toFixed(2)})`, `+1.20% (Rs ${step2Sl.toFixed(2)})`,
      'Stop moves above entry to a +1.2% cushion, so the trade can no longer lose money.'),
    mk(3, 'Profit Lock Tier 1', `Peak gain reaches +11.0% (Rs ${(buy * 1.11).toFixed(2)})`, `+5.50% (Rs ${step3Sl.toFixed(2)})`,
      'Locks a minimum +5.5% profit.'),
    mk(4, 'Profit Lock Tier 2', `Peak gain reaches +18.0% (Rs ${(buy * 1.18).toFixed(2)})`, `+11.50% (Rs ${step4Sl.toFixed(2)})`,
      'Locks a minimum +11.5% profit.'),
    mk(5, 'Uncapped EMA20 Runner', `Peak gain reaches +25.0% (Rs ${(buy * 1.25).toFixed(2)})`, 'Trails 1.0% below 20 EMA',
      'No fixed exit. The stop follows the 20 EMA so multi-bagger runs are not cut short.'),
    mk(6, 'Tight EMA20 Runner', `Peak gain reaches +35.0% (Rs ${(buy * 1.35).toFixed(2)})`, 'Trails 0.5% below 20 EMA',
      'Trail tightens to capture the apex of a big run.')
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

// Currency formatter: sign first, then symbol (e.g. -₹398.00 / +₹205.80)
const inr = (n, signed = false) => {
  const v = Number.isFinite(n) ? n : 0;
  const sign = v < 0 ? '-' : signed ? '+' : '';
  return `${sign}₹${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

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

  // Anchor cutoff from the latest data point in history rather than browser wall-clock time
  const lastDateStr = history[history.length - 1]?.date;
  const baseDate = lastDateStr ? new Date(lastDateStr) : new Date();
  let cutoff;

  if (range.ytd) {
    cutoff = new Date(baseDate.getFullYear(), 0, 1); // Jan 1 of simulation year
  } else {
    cutoff = new Date(baseDate);
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
    if (portfolioMode === 'backtest' || (portfolio?.valuationHistory && portfolio.valuationHistory.length > 260)) {
      return 'ALL';
    }
    return '1Y';
  });

  // Automatically adapt range to ALL when multi-year backtest data is loaded or mode switches to backtest
  useEffect(() => {
    if (portfolioMode === 'backtest') {
      setActiveRange('ALL');
    }
  }, [portfolioMode, valuationHistory?.length]);
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

  // ── Previous Day (1-Day) P&L Metrics ─────────────────────────────────────
  const prevDayMetrics = useMemo(() => {
    if (!valuationHistory || valuationHistory.length < 2) {
      return {
        hasPrev: false,
        amount: 0,
        percent: 0,
        prevDate: null
      };
    }
    const curr = valuationHistory[valuationHistory.length - 1];
    const prev = valuationHistory[valuationHistory.length - 2];

    const currDep = curr.totalDeposited || totalDeposited;
    const prevDep = prev.totalDeposited || currDep;
    const currTradingPL = (curr.totalValue || 0) - currDep;
    const prevTradingPL = (prev.totalValue || 0) - prevDep;

    // Pure trading P&L change between the two sessions (deposit-adjusted)
    const amount = currTradingPL - prevTradingPL;
    const prevVal = prev.totalValue || 1;
    const percent = prevVal > 0 ? (amount / prevVal) * 100 : 0;

    return {
      hasPrev: true,
      amount,
      percent,
      prevDate: prev.date,
      currDate: curr.date
    };
  }, [valuationHistory, totalDeposited]);

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

  // ── Derived statistics (client-side only, read-only) ─────────────────────
  const tradeStats = useMemo(() => {
    const h = portfolio.history || [];
    const wins = h.filter(t => (t.profit || 0) > 0);
    const losses = h.filter(t => (t.profit || 0) < 0);
    const grossWin = wins.reduce((s, t) => s + t.profit, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
    return {
      count: h.length,
      wins: wins.length,
      losses: losses.length,
      winRate: h.length > 0 ? (wins.length / h.length) * 100 : 0,
      realized: h.reduce((s, t) => s + (t.profit || 0), 0),
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? -grossLoss / losses.length : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    };
  }, [portfolio.history]);

  // Deposit-adjusted drawdown: track equity as value / capital deployed
  const drawdown = useMemo(() => {
    let peak = 0;
    let max = 0;
    let current = 0;
    for (const v of valuationHistory) {
      const dep = v.totalDeposited || 0;
      if (dep <= 0) continue;
      const eq = (v.totalValue || 0) / dep;
      if (eq > peak) peak = eq;
      current = peak > 0 ? (eq / peak - 1) * 100 : 0;
      if (current < max) max = current;
    }
    return { max, current };
  }, [valuationHistory]);

  const openPnl = holdings.reduce((s, p) => s + (p.profit || 0), 0);
  const exposurePct = totalValue > 0 ? Math.max(0, Math.min(100, (holdingsValue / totalValue) * 100)) : 0;

  return (
    <div className="tab-content">
      {/* KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi-card accent">
          <div className="kpi-label">Portfolio Value</div>
          <div className="kpi-value">₹{totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="kpi-sub neutral">Total Assets Under Management</div>
        </div>

        <div className={`kpi-card ${netProfit >= 0 ? 'green' : 'red'}`}>
          <div className="kpi-label">Total Trading P&amp;L</div>
          <div className="kpi-value" style={{ color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {inr(netProfit, true)}
          </div>
          <div className={`kpi-sub ${profitPercent >= 0 ? 'positive' : 'negative'}`}>
            {profitPercent >= 0 ? '▲ +' : '▼ '}{profitPercent.toFixed(2)}% All-Time Return
          </div>
        </div>

        <div className={`kpi-card ${prevDayMetrics.amount >= 0 ? 'green' : 'red'}`}>
          <div className="kpi-label">Previous Day P&amp;L</div>
          <div className="kpi-value" style={{ color: prevDayMetrics.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {inr(prevDayMetrics.amount, true)}
          </div>
          <div className={`kpi-sub ${prevDayMetrics.percent >= 0 ? 'positive' : 'negative'}`}>
            {prevDayMetrics.hasPrev
              ? `${prevDayMetrics.percent >= 0 ? '▲ +' : '▼ '}${prevDayMetrics.percent.toFixed(2)}% vs ${prevDayMetrics.prevDate}`
              : 'Initial Session Baseline'
            }
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
          <div className="panel-header" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <h2>{chartTitle}</h2>
              <div className={`panel-sub ${periodIsUp ? 'pos' : 'neg'}`} style={{ fontWeight: 600 }}>
                {periodChangeAmt >= 0 ? '+' : '-'}₹{Math.abs(periodChangeAmt).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                {' '}({periodChangePct >= 0 ? '+' : ''}{periodChangePct.toFixed(2)}%) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>over {activeRange}</span>
              </div>
            </div>

            <div className="chart-controls">
              <div className="seg" role="group" aria-label="Chart series">
                {[
                  { key: 'total', label: 'Total' },
                  { key: 'invested', label: 'Invested' },
                  { key: 'pl', label: 'P&L' }
                ].map(m => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setChartMode(m.key)}
                    className={`seg-btn ${chartMode === m.key ? 'active' : ''}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label="Time range">
                {RANGES.map(r => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => setActiveRange(r.label)}
                    className={`seg-btn ${activeRange === r.label ? 'active' : ''}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="chart-frame">
            <MiniChart
              data={chartData}
              valueKey={chartValueKey}
              dateKey="date"
              fillGradId="netWorthGrad"
              responsive
              baselineValue={isPlMode ? 0 : isInvestedMode ? null : totalDeposited}
              baselineLabel={isPlMode ? 'Break-even (₹0)' : 'Invested Capital'}
            />
          </div>

          {/* Bottom meta row */}
          <div className="chart-meta">
            {isPlMode ? (
              <span>Net profit <strong className={netProfit >= 0 ? 'pos' : 'neg'}>
                {inr(netProfit, true)} ({profitPercent >= 0 ? '+' : ''}{profitPercent.toFixed(2)}%)
              </strong></span>
            ) : isInvestedMode ? (
              <span>Invested value <strong style={{ color: 'var(--text-primary)' }}>₹{holdingsValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
            ) : (
              <span>Capital deployed <strong style={{ color: 'var(--text-primary)' }}>₹{totalDeposited.toLocaleString('en-IN')}</strong></span>
            )}
            <span>{chartData.length} data points</span>
            <span>Updated <strong style={{ color: 'var(--text-primary)' }}>{portfolio.lastSimulationDate}</strong></span>
          </div>
        </div>

        {/* Performance & Risk Statistics */}
        <div className="glass-panel">
          <div className="panel-header" style={{ marginBottom: '0.5rem' }}>
            <h2>Performance &amp; Risk</h2>
          </div>
          <div className="stat-list">
            <div className="stat-group-title">Returns</div>
            <div className="stat-row">
              <span className="stat-k">Total return</span>
              <span className={`stat-v ${profitPercent >= 0 ? 'pos' : 'neg'}`}>{profitPercent >= 0 ? '+' : ''}{profitPercent.toFixed(2)}%</span>
            </div>
            <div className="stat-row">
              <span className="stat-k">{cagrMetrics.isAbsolute ? 'Return (under 30d)' : 'Annualized (CAGR)'}</span>
              <span className={`stat-v ${cagrMetrics.cagr >= 0 ? 'pos' : 'neg'}`}>{cagrMetrics.cagr >= 0 ? '+' : ''}{cagrMetrics.cagr.toFixed(2)}%</span>
            </div>
            <div className="stat-row">
              <span className="stat-k">Max drawdown</span>
              <span className="stat-v neg">{drawdown.max.toFixed(2)}%</span>
            </div>
            <div className="stat-row">
              <span className="stat-k">Current drawdown</span>
              <span className={`stat-v ${drawdown.current < -0.005 ? 'neg' : ''}`}>{drawdown.current.toFixed(2)}%</span>
            </div>

            <div className="stat-group-title">Closed trades</div>
            <div className="stat-row">
              <span className="stat-k">Win rate</span>
              <span className="stat-v">
                {tradeStats.count > 0 ? `${tradeStats.winRate.toFixed(1)}% (${tradeStats.wins}W / ${tradeStats.losses}L)` : '—'}
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-k">Profit factor</span>
              <span className="stat-v">{tradeStats.profitFactor === null ? '—' : tradeStats.profitFactor.toFixed(2)}</span>
            </div>
            <div className="stat-row">
              <span className="stat-k">Avg win / Avg loss</span>
              <span className="stat-v">
                <span className="pos">₹{tradeStats.avgWin.toFixed(0)}</span> / <span className="neg">₹{Math.abs(tradeStats.avgLoss).toFixed(0)}</span>
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-k">Realized P&amp;L</span>
              <span className={`stat-v ${tradeStats.realized >= 0 ? 'pos' : 'neg'}`}>
                {tradeStats.realized >= 0 ? '+' : '-'}₹{Math.abs(tradeStats.realized).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="stat-group-title">Exposure</div>
            <div className="stat-row">
              <span className="stat-k">Open P&amp;L</span>
              <span className={`stat-v ${openPnl >= 0 ? 'pos' : 'neg'}`}>
                {openPnl >= 0 ? '+' : '-'}₹{Math.abs(openPnl).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div style={{ padding: '0.4rem 0 0.2rem' }}>
              <div className="alloc-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, exposurePct)}%`, background: 'var(--accent)' }} />
              </div>
              <div className="alloc-legend">
                <span>Invested {exposurePct.toFixed(0)}%</span>
                <span>Cash {(100 - exposurePct).toFixed(0)}%</span>
              </div>
            </div>

            <div className="stat-group-title">Strategy</div>
            <div className="stat-row">
              <span className="stat-k">Risk setting</span>
              <span className="stat-v" style={{ textTransform: 'capitalize' }}>{portfolio.config.aggressiveness}</span>
            </div>
            <div className="stat-row">
              <span className="stat-k">Target / Stop loss</span>
              <span className="stat-v">
                <span className="pos">+{+(portfolio.config.targetProfitPercent * 100).toFixed(1)}%</span> / <span className="neg">-{+(portfolio.config.stopLossPercent * 100).toFixed(1)}%</span>
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-k">Last updated</span>
              <span className="stat-v">{portfolio.lastSimulationDate}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Holdings Section */}
      <div className="glass-panel">
        <div className="panel-header" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h2>Active Holdings</h2>
            <span className={`status-badge ${portfolioMode === 'live' ? 'live' : 'closed'}`}>
              <span className="status-dot" />
              <span>{portfolioMode === 'live' ? 'Live Portfolio' : 'Backtest Simulation'}</span>
            </span>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {holdings.length} open position{holdings.length === 1 ? '' : 's'}
          </span>
        </div>

        {holdings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            <p style={{ margin: '0 0 0.5rem', fontWeight: '600', color: 'var(--text-primary)' }}>
              {portfolioMode === 'live'
                ? 'Your Live Portfolio is ready with ₹50,000 liquid capital.'
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
            <table className="custom-table resp-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Position</th>
                  <th>Buy Price</th>
                  <th>Current Price</th>
                  <th>P&amp;L</th>
                  <th>Stop Loss</th>
                  <th>Target</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((position, idx) => {
                  const trailing = computeHoldingTrailingInfo(position);
                  const isProfit = position.profit >= 0;
                  const weightPct = totalValue > 0 ? ((position.value / totalValue) * 100).toFixed(1) : '0.0';

                  return (
                    <tr key={idx}>
                      <td data-label="Asset">
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span className="stock-badge">{position.symbol.replace('.NS', '')}</span>
                            {position.isAccumulated && (
                              <span className="trailing-chip badge-breakeven">Pyramid</span>
                            )}
                          </div>
                          <span className="company-name">{position.name}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{position.sector || 'NSE Equity'}</span>
                        </div>
                      </td>
                      <td data-label="Position">
                        <div style={{ fontWeight: '600' }}>{position.quantity} shares</div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          ₹{position.value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {weightPct}%
                        </div>
                      </td>
                      <td data-label="Buy Price">₹{position.buyPrice.toFixed(2)}</td>
                      <td data-label="Current Price">
                        <span style={{ fontWeight: '600' }}>₹{position.currentPrice.toFixed(2)}</span>
                      </td>
                      <td data-label="P&L" className={isProfit ? 'positive-cell' : 'negative-cell'}>
                        <div>
                          {inr(position.profit, true)}
                        </div>
                        <div style={{ fontSize: '0.74rem' }}>
                          {isProfit ? '+' : ''}{position.profitPercent.toFixed(2)}%
                        </div>
                      </td>
                      <td data-label="Stop Loss">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: '600', color: 'var(--red)' }}>
                              ₹{position.stopLoss.toFixed(2)}
                            </span>
                            <span className={`trailing-chip ${trailing.statusBadge.type}`}>
                              {trailing.statusBadge.label}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Buffer ₹{trailing.rupeeBuffer.toFixed(2)} ({trailing.pctBuffer.toFixed(1)}%)
                          </span>
                        </div>
                      </td>
                      <td data-label="Target">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontWeight: '600', color: 'var(--green)' }}>
                            ₹{position.targetPrice.toFixed(2)} (+25%)
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Upside +₹{trailing.rupeeUpside.toFixed(2)} ({trailing.pctUpside.toFixed(1)}%)
                          </span>
                        </div>
                      </td>
                      <td data-label="Actions">
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => setInspectHolding(position)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                          >
                            Trade Plan
                          </button>
                          {portfolioMode === 'live' && (
                            <button
                              type="button"
                              onClick={() => handleCloseHolding(position)}
                              disabled={closingHolding}
                              className="btn btn-danger"
                              style={{ padding: '4px 10px', fontSize: '0.74rem' }}
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
            <div className="modal-card" style={{ maxWidth: '680px' }} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              
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
              <div className="metric-tiles" style={{ margin: '0.25rem 0' }}>
                <div className="metric-tile">
                  <div className="t-label">Entry</div>
                  <div className="t-val">₹{inspectHolding.buyPrice.toFixed(2)}</div>
                </div>
                <div className="metric-tile">
                  <div className="t-label">Current</div>
                  <div className={`t-val ${isProfit ? 'pos' : 'neg'}`}>₹{inspectHolding.currentPrice.toFixed(2)}</div>
                  <div className={`t-sub ${isProfit ? 'pos' : 'neg'}`}>{isProfit ? '+' : ''}{inspectHolding.profitPercent.toFixed(2)}%</div>
                </div>
                <div className="metric-tile is-red">
                  <div className="t-label">Stop Loss</div>
                  <div className="t-val">₹{inspectHolding.stopLoss.toFixed(2)}</div>
                  <div className="t-sub">₹{trailing.rupeeBuffer.toFixed(2)} buffer</div>
                </div>
                <div className="metric-tile is-green">
                  <div className="t-label">Target (+25%)</div>
                  <div className="t-val">₹{inspectHolding.targetPrice.toFixed(2)}</div>
                  <div className="t-sub">+₹{trailing.rupeeUpside.toFixed(2)} upside</div>
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

