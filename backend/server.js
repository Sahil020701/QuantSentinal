require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { 
  loadState, 
  saveState, 
  resetSimulation, 
  runSimulation, 
  getWatchlistQuotes 
} = require('./engine');

const app = express();
const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/quant_sentinal';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected successfully.'))
  .catch(err => console.error('MongoDB Connection Error:', err));

app.use(cors());
app.use(express.json());

// Helper to get today's date formatted in UTC (matching Yahoo's trading calendar)
function getTodayUTCDateString() {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

// POST Trigger Catch-up Run Manually
app.post('/api/trigger-run', async (req, res) => {
  try {
    const todayStr = getTodayUTCDateString();
    console.log(`Manual trigger run requested up to ${todayStr}...`);
    const state = await runSimulation(todayStr);
    res.json({ message: "Simulation catch-up completed.", state });
  } catch (error) {
    console.error("Error in manual run:", error);
    res.status(500).json({ error: "Failed to run simulation", details: error.message });
  }
});

// POST Reset Simulation
app.post('/api/reset', async (req, res) => {
  try {
    console.log("Resetting simulation back to August 8, 2026...");
    const state = await resetSimulation();
    res.json({ message: "Simulation reset successful.", state });
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
    
    if (rotationEnabled !== undefined) state.config.rotationEnabled = Boolean(rotationEnabled);
    if (rotationMinCandidateScore !== undefined) state.config.rotationMinCandidateScore = Number(rotationMinCandidateScore);
    if (rotationMaxUnderperformerProfit !== undefined) state.config.rotationMaxUnderperformerProfit = Number(rotationMaxUnderperformerProfit);

    await saveState(state);
    console.log("Configurations updated:", state.config);
    res.json({ message: "Configurations updated successfully.", config: state.config });
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
    const currentDeposits = lastVal ? lastVal.totalDeposited : 20000.0;
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
    res.json({ message: "Deposit completed successfully.", state });
  } catch (error) {
    console.error("Error making manual deposit:", error);
    res.status(500).json({ error: "Failed to process manual deposit" });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Quant Sentinal Trading Backend listening on port ${PORT}`);
  // Initialize state on boot
  try {
    const state = loadState();
    console.log(`Database loaded. Simulation current date: ${state.lastSimulationDate}`);
  } catch (err) {
    console.error("Failed to load initial state on boot:", err);
  }
});
