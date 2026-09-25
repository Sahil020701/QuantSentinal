const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
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
  getTop25AlgoRankings
} = require('./engine');

const app = express();
const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/quant_sentinal';

app.use(cors());
app.use(express.json());

// Helper to get the latest *completed* trading session date in IST.
// NSE market hours: 09:15–15:30 IST (UTC+5:30).
// - If it's a weekday AND past 15:30 IST  → use today's IST date (session is closed).
// - Otherwise (pre-market, weekend, holiday) → step back to the previous calendar day
//   so that yfinance always finds a fully closed bar and the simulation can run.
function getLatestTradingDateIST() {
  // Current time in IST
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30
  const istNow = new Date(now.getTime() + istOffset);

  const dayOfWeek = istNow.getUTCDay(); // 0=Sun, 6=Sat in IST
  const istHHMM   = istNow.getUTCHours() * 100 + istNow.getUTCMinutes();

  const pad = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  // Market is "done for today" only on Mon-Fri after 15:30 IST
  const marketSessionComplete = (dayOfWeek >= 1 && dayOfWeek <= 5 && istHHMM >= 1530);

  if (marketSessionComplete) {
    return toDateStr(istNow); // today's IST date — session has closed
  }

  // Step back one calendar day to find the last completed session date
  const yesterday = new Date(istNow.getTime() - 24 * 60 * 60 * 1000);
  return toDateStr(yesterday);
}

// Backwards-compatible alias used throughout server routes
const getTodayUTCDateString = getLatestTradingDateIST;

// GET Portfolio (Includes automated catch-up simulation)
app.get('/api/portfolio', async (req, res) => {
  try {
    const todayStr = getTodayUTCDateString();
    console.log(`GET /api/portfolio requested. Attempting catch-up simulation to ${todayStr}...`);
    
    // Automatically catch up to today
    const state = await runSimulation(todayStr);
    res.json(state);
  } catch (error) {
    console.error("Error in GET /api/portfolio:", error);
    // Return current state even if catch-up failed, to prevent UI crash
    try {
      const state = await loadState();
      res.json(state);
    } catch (e) {
      res.status(500).json({ error: "Failed to load state", details: error.message });
    }
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

// GET Top 25 Algo Rankings with Indicator Pass/Fail Breakdown
app.get('/api/algo-top25', async (req, res) => {
  try {
    const { date } = req.query;
    const todayStr = getTodayUTCDateString();
    const targetDate = date || todayStr;
    const data = await getTop25AlgoRankings(targetDate);
    res.json(data);
  } catch (error) {
    console.error("Error fetching top 25 algo rankings:", error);
    res.status(500).json({ error: "Failed to load algorithm rankings", details: error.message });
  }
});

// POST Trigger Catch-up Run Manually
app.post('/api/trigger-run', async (req, res) => {
  try {
    const todayStr = getTodayUTCDateString();
    console.log(`Manual trigger run requested up to ${todayStr}...`);
    let state = await runSimulation(todayStr, true);
    state = await deployIdleCash(todayStr);
    res.json({ message: "Simulation catch-up and cash deployment completed.", state });
  } catch (error) {
    console.error("Error in manual run:", error);
    res.status(500).json({ error: "Failed to run simulation", details: error.message });
  }
});

// POST Reset Simulation
app.post('/api/reset', async (req, res) => {
  try {
    const { startDate, replay = true } = req.body || {};
    const todayStr = getTodayUTCDateString();
    const targetStartDate = (startDate === 'today' || startDate === todayStr) ? todayStr : (startDate || '2026-07-01');
    
    console.log(`Resetting simulation baseline to ${targetStartDate} (replay=${replay})...`);
    let state = await resetSimulation(targetStartDate);

    if (replay && targetStartDate < todayStr) {
      console.log(`Auto-replaying simulation from ${targetStartDate} to ${todayStr}...`);
      state = await runSimulation(todayStr, false);
      state = await deployIdleCash(todayStr);
    }

    res.json({ message: `Simulation reset successful with start date ${targetStartDate}.`, state });
  } catch (error) {
    console.error("Error resetting simulation:", error);
    res.status(500).json({ error: "Failed to reset simulation" });
  }
});

// POST Update Configurations
app.post('/api/config', async (req, res) => {
  try {
    const { 
      targetProfitPercent, 
      stopLossPercent, 
      maxPositions, 
      aggressiveness,
      rotationEnabled,
      rotationMinCandidateScore,
      rotationMaxUnderperformerProfit
    } = req.body;
    const state = await loadState();

    if (targetProfitPercent !== undefined) state.config.targetProfitPercent = Number(targetProfitPercent);
    if (stopLossPercent !== undefined) state.config.stopLossPercent = Number(stopLossPercent);
    if (maxPositions !== undefined) state.config.maxPositions = Number(maxPositions);
    if (aggressiveness !== undefined) state.config.aggressiveness = aggressiveness;

    // Retroactively update targetPrice and stopLoss on all open holdings
    // so that config changes take effect immediately, not just on future buys.
    if (targetProfitPercent !== undefined || stopLossPercent !== undefined) {
      if (state.holdings && state.holdings.length > 0) {
        state.holdings = state.holdings.map(h => ({
          ...h,
          targetPrice: h.buyPrice * (1 + state.config.targetProfitPercent),
          stopLoss: h.buyPrice * (1 - state.config.stopLossPercent),
        }));
        console.log(`Retroactively updated targetPrice/stopLoss for ${state.holdings.length} open holdings.`);
      }
    }
    
    if (rotationEnabled !== undefined) state.config.rotationEnabled = Boolean(rotationEnabled);
    if (rotationMinCandidateScore !== undefined) state.config.rotationMinCandidateScore = Number(rotationMinCandidateScore);
    if (rotationMaxUnderperformerProfit !== undefined) state.config.rotationMaxUnderperformerProfit = Number(rotationMaxUnderperformerProfit);

    await saveState(state);
    console.log("Configurations updated:", state.config);

    // Immediately re-evaluate open positions against the new target/stop values.
    // This handles the case where the simulation is already up to date (no new trading
    // days) but a position has already crossed the new threshold on the last simulated day.
    let reEvalResult = null;
    if (targetProfitPercent !== undefined || stopLossPercent !== undefined) {
      reEvalResult = await reEvaluateHoldings();
      console.log(`Re-evaluation complete: ${reEvalResult.closedTrades.length} position(s) booked.`);
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
    const { amount } = req.body;
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid deposit amount" });
    }

    const state = await loadState();
    state.cash += Number(amount);
    
    // Update the last history element to adjust totalDeposited
    const lastVal = state.valuationHistory[state.valuationHistory.length - 1];
    const currentDeposits = lastVal ? lastVal.totalDeposited : 50000.0;
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
      text: `MANUAL CAPITAL INJECTION: Deposited an additional ₹${amount.toLocaleString('en-IN')}.00 cash. Total cash capital available for trades: ₹${state.cash.toFixed(2)}.`
    });

    await saveState(state);
    console.log(`Manual deposit of ₹${amount} completed. Cash: ₹${state.cash}`);

    // Immediately deploy newly injected cash into candidates on current simulation date
    const updatedState = await deployIdleCash(getTodayUTCDateString());

    res.json({ message: "Deposit completed and cash deployed into active market setups.", state: updatedState });
  } catch (error) {
    console.error("Error making manual deposit:", error);
    res.status(500).json({ error: "Failed to process manual deposit" });
  }
});

// Automated Background Scheduler for Market Open & Trigger Execution
async function runAutomatedEngineCycle(forceRefresh = false) {
  try {
    const todayStr = getTodayUTCDateString();
    console.log(`[AUTOMATED SCHEDULER] Running engine cycle for date ${todayStr}...`);
    let state = await runSimulation(todayStr, forceRefresh);
    state = await deployIdleCash(todayStr);
    console.log(`[AUTOMATED SCHEDULER] Cycle complete. Last simulation date: ${state.lastSimulationDate}`);
  } catch (error) {
    console.error("[AUTOMATED SCHEDULER] Error during engine cycle execution:", error.message);
  }
}

function startTradingScheduler() {
  console.log("Starting Quant Sentinal Automated Trading Scheduler...");
  
  // 1. Execute immediately on startup catchup
  runAutomatedEngineCycle(true);

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
      const state = await loadState();
      console.log(`Database loaded. Simulation current date: ${state.lastSimulationDate}`);
      startTradingScheduler();
    } catch (err) {
      console.error("Failed to load initial state on boot:", err);
    }
  });
}

startServer();
