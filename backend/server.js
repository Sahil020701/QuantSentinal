const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
dns.setDefaultResultOrder('ipv4first');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const {
  loadState,
  saveState,
  resetSimulation,
  runSimulation,
  reEvaluateHoldings,
  deployIdleCash,
  getWatchlistQuotes,
  getTop25AlgoRankings,
  getLatestCompletedMarketDate,
  initLivePortfolio,
  executeLiveTrade,
  closeLiveTrade
} = require('./engine');

const app = express();
const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/quant_sentinal';

app.use(cors());
app.use(express.json());

// Official NSE trading holidays (YYYY-MM-DD) for 2024, 2025, 2026
const NSE_HOLIDAYS = new Set([
  // 2026 NSE Holidays
  '2026-01-26', // Republic Day
  '2026-02-17', // Mahashivratri
  '2026-03-04', // Holi
  '2026-03-20', // Id-Ul-Fitr (Ramzan Id)
  '2026-03-27', // Shri Ram Navami
  '2026-03-31', // Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-27', // Bakri Id / Eid-ul-Adha
  '2026-06-26', // Muharram
  '2026-08-15', // Independence Day
  '2026-08-26', // Milad-un-Nabi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-08', // Diwali Laxmi Pujan
  '2026-11-10', // Diwali Balipratipada
  '2026-11-24', // Gurunanak Jayanti
  '2026-12-25', // Christmas
  // 2025 NSE Holidays
  '2025-01-26', '2025-02-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14',
  '2025-04-18', '2025-05-01', '2025-08-15', '2025-08-27', '2025-10-02', '2025-10-21',
  '2025-11-01', '2025-11-05', '2025-12-25',
  // 2024 NSE Holidays
  '2024-01-22', '2024-01-26', '2024-03-08', '2024-03-25', '2024-03-29', '2024-04-11',
  '2024-04-17', '2024-05-01', '2024-05-20', '2024-06-17', '2024-07-17', '2024-08-15',
  '2024-10-02', '2024-11-01', '2024-11-15', '2024-12-25'
]);

// Helper to get the latest *completed* trading session date in IST.
// NSE market hours: 09:15–15:30 IST (UTC+5:30).
// - If it's a weekday AND past 15:30 IST AND not an exchange holiday → use today's IST date (session is closed).
// - Otherwise (pre-market, weekend, exchange holiday) → automatically step back to the true latest completed market session.
function getLatestTradingDateIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30
  const istNow = new Date(now.getTime() + istOffset);

  const dayOfWeek = istNow.getUTCDay(); // 0=Sun, 6=Sat in IST
  const istHHMM = istNow.getUTCHours() * 100 + istNow.getUTCMinutes();

  const pad = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  // If today is a weekday, market has closed (after 15:30 IST), and today is not a holiday, candidate is today
  // Otherwise, start from yesterday
  let d;
  if (dayOfWeek >= 1 && dayOfWeek <= 5 && istHHMM >= 1530 && !NSE_HOLIDAYS.has(toDateStr(istNow))) {
    d = new Date(istNow.getTime());
  } else {
    d = new Date(istNow.getTime() - 24 * 60 * 60 * 1000);
  }

  // Step backwards past weekends (Saturday=6, Sunday=0) and known NSE exchange holidays
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || NSE_HOLIDAYS.has(toDateStr(d))) {
    d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  }

  let computedDate = toDateStr(d);
  return computedDate;
}

// Backwards-compatible alias used throughout server routes
const getTodayUTCDateString = getLatestTradingDateIST;

// GET Portfolio (Instant response for requested mode: live or backtest)
app.get('/api/portfolio', async (req, res) => {
  try {
    const mode = (req.query.mode === 'live') ? 'live' : 'backtest';
    const state = await loadState(mode);
    res.json(state);
  } catch (error) {
    console.error("Error in GET /api/portfolio:", error);
    res.status(500).json({ error: "Failed to load state", details: error.message });
  }
});

// GET Watchlist Quotes for Market Scanner
app.get('/api/scanner', async (req, res) => {
  try {
    const todayStr = getTodayUTCDateString();
    const quotes = await getWatchlistQuotes(todayStr);
    res.json(quotes);
  } catch (error) {
    console.error("Error fetching scanner quotes:", error);
    res.status(500).json({ error: "Failed to load scanner quotes" });
  }
});

// GET Top Algo Rankings with Indicator Pass/Fail Breakdown
app.get('/api/algo-top25', async (req, res) => {
  try {
    const { date, limit, refresh } = req.query;
    const todayStr = getTodayUTCDateString();
    const targetDate = date || todayStr;
    const forceRefresh = refresh === 'true' || refresh === '1';
    const data = await getTop25AlgoRankings(targetDate, forceRefresh);
    if (limit && limit !== 'all' && limit !== 'ALL') {
      const numLimit = parseInt(limit, 10);
      if (!isNaN(numLimit) && numLimit > 0) {
        data.rankings = (data.rankings || data.top25).slice(0, numLimit);
      }
    }
    res.json(data);
  } catch (error) {
    console.error("Error fetching algo rankings:", error);
    res.status(500).json({ error: "Failed to load algorithm rankings", details: error.message });
  }
});

// POST Trigger Catch-up Run Manually
app.post('/api/trigger-run', async (req, res) => {
  try {
    const mode = (req.body?.mode === 'live' || req.query.mode === 'live') ? 'live' : 'backtest';
    const todayStr = getTodayUTCDateString();
    console.log(`Manual trigger run requested up to ${todayStr} for ${mode}...`);
    let state = await runSimulation(todayStr, true, mode);
    state = await deployIdleCash(todayStr, mode);
    res.json({ message: `Simulation catch-up completed for ${mode} portfolio.`, state });
  } catch (error) {
    console.error("Error in manual run:", error);
    res.status(500).json({ error: "Failed to run simulation", details: error.message });
  }
});

// POST Reset Simulation
app.post('/api/reset', async (req, res) => {
  try {
    const { startDate, replay = true, mode = 'backtest' } = req.body || {};
    const todayStr = getTodayUTCDateString();

    if (mode === 'live') {
      console.log("Resetting Live Portfolio to fresh ₹1,00,000 baseline today...");
      const state = await initLivePortfolio();
      return res.json({ message: "Live Portfolio reset successfully with clean ₹1,00,000 slate.", state });
    }

    const minHistoryDateStr = '2019-01-01';
    let rawStartDate = (startDate === 'today' || startDate === todayStr) ? todayStr : (startDate || '2023-10-01');
    const targetStartDate = rawStartDate < minHistoryDateStr ? minHistoryDateStr : rawStartDate;

    console.log(`Resetting backtest baseline to ${targetStartDate} (replay=${replay})...`);
    // If replaying forward to today, initialize baseline in memory without prematurely wiping MongoDB
    const shouldSaveImmediately = !replay || targetStartDate >= todayStr;
    let state = await resetSimulation(targetStartDate, 'backtest', shouldSaveImmediately);

    if (replay && targetStartDate < todayStr) {
      console.log(`Auto-replaying backtest from ${targetStartDate} to ${todayStr}...`);
      state = await runSimulation(todayStr, false, 'backtest');
      state = await deployIdleCash(todayStr, 'backtest', state);
      await saveState(state, 'backtest');
    }

    res.json({ message: `Backtest simulation reset successful with start date ${targetStartDate}.`, state });
  } catch (error) {
    console.error("Error resetting simulation:", error);
    res.status(500).json({ error: "Failed to reset simulation" });
  }
});

// POST Update Configurations
app.post('/api/config', async (req, res) => {
  try {
    const mode = (req.body?.mode === 'live' || req.query.mode === 'live') ? 'live' : 'backtest';
    const {
      targetProfitPercent,
      stopLossPercent,
      maxPositions,
      aggressiveness,
      rotationEnabled,
      rotationMinCandidateScore,
      rotationMaxUnderperformerProfit
    } = req.body;
    const state = await loadState(mode);

    if (targetProfitPercent !== undefined) state.config.targetProfitPercent = Number(targetProfitPercent);
    if (stopLossPercent !== undefined) state.config.stopLossPercent = Number(stopLossPercent);
    if (maxPositions !== undefined) state.config.maxPositions = Number(maxPositions);
    if (aggressiveness !== undefined) state.config.aggressiveness = aggressiveness;

    if (targetProfitPercent !== undefined || stopLossPercent !== undefined) {
      if (state.holdings && state.holdings.length > 0) {
        state.holdings = state.holdings.map(h => ({
          ...h,
          targetPrice: h.buyPrice * (1 + state.config.targetProfitPercent),
          stopLoss: h.buyPrice * (1 - state.config.stopLossPercent),
        }));
      }
    }

    if (rotationEnabled !== undefined) state.config.rotationEnabled = Boolean(rotationEnabled);
    if (rotationMinCandidateScore !== undefined) state.config.rotationMinCandidateScore = Number(rotationMinCandidateScore);
    if (rotationMaxUnderperformerProfit !== undefined) state.config.rotationMaxUnderperformerProfit = Number(rotationMaxUnderperformerProfit);

    await saveState(state, mode);
    console.log(`Configurations updated for ${mode}:`, state.config);

    let reEvalResult = null;
    if (targetProfitPercent !== undefined || stopLossPercent !== undefined) {
      reEvalResult = await reEvaluateHoldings(mode);
    }

    res.json({
      message: "Configurations updated successfully.",
      config: state.config,
      reEvaluated: reEvalResult ? reEvalResult.closedTrades.length : 0,
      closedTrades: reEvalResult ? reEvalResult.closedTrades : []
    });
  } catch (error) {
    console.error("Error updating config:", error);
    res.status(500).json({ error: "Failed to update configuration" });
  }
});

// POST Deposit Extra Capital Manually
app.post('/api/deposit', async (req, res) => {
  try {
    const { amount, mode = 'backtest' } = req.body;
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid deposit amount" });
    }

    const pType = (mode === 'live') ? 'live' : 'backtest';
    const state = await loadState(pType);
    state.cash += Number(amount);

    const lastVal = state.valuationHistory[state.valuationHistory.length - 1];
    const currentDeposits = lastVal ? lastVal.totalDeposited : 100000.0;
    const newDeposits = currentDeposits + Number(amount);

    if (lastVal) {
      lastVal.cash = state.cash;
      lastVal.totalValue = state.cash + lastVal.holdingsValue;
      lastVal.totalDeposited = newDeposits;
      lastVal.profitPercent = ((lastVal.totalValue - newDeposits) / newDeposits) * 100;
    }

    state.logs.unshift({
      date: getTodayUTCDateString(),
      sentiment: 'NEUTRAL',
      text: `MANUAL CAPITAL INJECTION (${pType.toUpperCase()}): Deposited an additional ₹${amount.toLocaleString('en-IN')}.00 cash. Total cash capital available: ₹${state.cash.toFixed(2)}.`
    });

    await saveState(state, pType);
    console.log(`Manual deposit of ₹${amount} completed for ${pType}. Cash: ₹${state.cash}`);

    const updatedState = await deployIdleCash(getTodayUTCDateString(), pType);

    res.json({ message: `Deposit completed for ${pType} portfolio.`, state: updatedState });
  } catch (error) {
    console.error("Error making manual deposit:", error);
    res.status(500).json({ error: "Failed to process manual deposit" });
  }
});

// POST Live Order Buy / Entry
app.post('/api/live/buy', async (req, res) => {
  try {
    const { symbol, name, sector, quantity, price, stopLoss, targetPrice, reason } = req.body;
    if (!symbol || !quantity || !price) {
      return res.status(400).json({ error: "Symbol, quantity, and price are required." });
    }
    const state = await executeLiveTrade({ symbol, name, sector, quantity, price, stopLoss, targetPrice, reason });
    res.json({ message: `Successfully executed live buy for ${quantity}x ${symbol}.`, state });
  } catch (error) {
    console.error("Error in live buy:", error.message);
    res.status(400).json({ error: error.message });
  }
});

// POST Live Order Sell / Close
app.post('/api/live/sell', async (req, res) => {
  try {
    const { symbol, price, reason } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required to close position." });
    }
    const state = await closeLiveTrade({ symbol, price, reason });
    res.json({ message: `Successfully closed live holding for ${symbol}.`, state });
  } catch (error) {
    console.error("Error in live sell:", error.message);
    res.status(400).json({ error: error.message });
  }
});

let isSchedulerRunning = false;

// Automated Background Scheduler for Market Open & Trigger Execution
async function runAutomatedEngineCycle(forceRefresh = false) {
  if (isSchedulerRunning) return;
  isSchedulerRunning = true;
  try {
    const todayStr = getTodayUTCDateString();
    let state = await loadState('live');
    // Ensure Live portfolio tracks forward automatically
    if (state.lastSimulationDate < todayStr) {
      console.log(`[AUTOMATED SCHEDULER] Running daily engine catch-up for Live Portfolio for ${todayStr}...`);
      state = await runSimulation(todayStr, forceRefresh, 'live');
      state = await deployIdleCash(todayStr, 'live', state);
      await saveState(state, 'live');
      console.log(`[AUTOMATED SCHEDULER] Live cycle complete. Last simulation date: ${state.lastSimulationDate}`);
    }
  } catch (error) {
    console.error("[AUTOMATED SCHEDULER] Error during engine cycle execution:", error.message);
  } finally {
    isSchedulerRunning = false;
  }
}

function startTradingScheduler() {
  console.log("Starting Quant Sentinal Automated Trading Scheduler...");

  // 1. Execute immediately on startup catchup (fast boot using cache)
  runAutomatedEngineCycle(false);

  // 2. Schedule periodic checks (Every 30 minutes during market hours)
  const SCHEDULER_INTERVAL_MS = 30 * 60 * 1000;
  setInterval(() => {
    const today = new Date();
    const day = today.getDay();
    const hours = today.getHours();
    const minutes = today.getMinutes();
    const time = hours * 100 + minutes;

    // Check if market is open (Mon-Fri, 09:15 to 15:30 IST)
    const isMarketOpen = (day >= 1 && day <= 5 && time >= 915 && time <= 1530);
    console.log(`[SCHEDULER TIMER] Triggered. Market Open Status: ${isMarketOpen}`);

    // Always run cycle (forces live cache refresh during market hours)
    runAutomatedEngineCycle(isMarketOpen);
  }, SCHEDULER_INTERVAL_MS);
}

// Start Server Asynchronously ensuring MongoDB connects first
async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB Connected successfully.');
  } catch (err) {
    console.warn('MongoDB Connection Warning (falling back to in-memory state):', err.message);
  }

  app.listen(PORT, async () => {
    console.log(`Quant Sentinal Trading Backend listening on port ${PORT}`);
    try {
      const liveState = await loadState('live');
      const backtestState = await loadState('backtest');
      console.log(`Database loaded. Live Desk date: ${liveState.lastSimulationDate} | Backtest date: ${backtestState.lastSimulationDate}`);
      startTradingScheduler();
    } catch (err) {
      console.error("Failed to load initial state on boot:", err);
    }
  });
}

startServer();
