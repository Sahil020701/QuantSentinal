const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const mongoose = require('mongoose');
const { 
  calculateSMA, 
  calculateEMA, 
  calculateRSI, 
  calculateMACD, 
  calculateATR, 
  calculateRVOL, 
  calculateSlope, 
  checkBreakouts 
} = require('./utils/indicators');
const StateModel = require('./models/State');

const DEFAULT_WATCHLIST = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries', sector: 'Energy & Conglomerate' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', sector: 'IT Services' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd', sector: 'Banking & Financials' },
  { symbol: 'INFY.NS', name: 'Infosys Ltd', sector: 'IT Services' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', sector: 'Banking & Financials' }
];

const WATCHLIST = [];

function loadWatchlist() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (cache.watchlist && cache.watchlist.length > 0) {
        WATCHLIST.length = 0;
        WATCHLIST.push(...cache.watchlist);
        console.log(`Loaded ${WATCHLIST.length} assets from dynamic Nifty 200 watchlist cache.`);
        return;
      }
    } catch (e) {
      console.warn("Failed to load watchlist from cache, using default:", e.message);
    }
  }
  WATCHLIST.length = 0;
  WATCHLIST.push(...DEFAULT_WATCHLIST);
  console.log(`Using default boot watchlist with ${WATCHLIST.length} assets.`);
}

const STATE_FILE = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, 'state_test.json')
  : path.join(__dirname, 'state.json');
const CACHE_FILE = path.join(__dirname, 'data', 'historical_cache.json');
const CACHE_DIR = path.join(__dirname, 'data');

// Initialize watchlist on boot (runs after constants are defined)
loadWatchlist();

// Default initial state starting today: August 8, 2026
const INITIAL_STATE = {
  lastSimulationDate: '2026-08-08',
  cash: 20000.0,
  holdings: [],
  history: [],
  valuationHistory: [
    {
      date: '2026-08-08',
      cash: 20000.0,
      holdingsValue: 0.0,
      totalValue: 20000.0,
      profitPercent: 0.0,
      totalDeposited: 20000.0
    }
  ],
  logs: [
    {
      date: '2026-08-08',
      sentiment: 'NEUTRAL',
      text: "Quant Sentinal Aggressive Trading System online. Initial capital of ₹20,000 deposited. Objective: Target 15%-20% annualized returns using momentum breakouts and oversold rebounds. Current state is cash-only; waiting for market open on Monday to execute technical scanners."
    }
  ],
  config: {
    targetProfitPercent: 0.15, // +15% default (overridden by saved state/config UI)
    stopLossPercent: 0.06,      // -6% stop loss
    maxPositions: 50,          // Invest cash across up to 50 stocks
    aggressiveness: 'aggressive', // conservative, moderate, aggressive, hyper
    rotationEnabled: true,      // Rotate portfolio when cash is low/slots full
    rotationMinCandidateScore: 85, // Minimum score needed for a candidate to trigger rotation
    rotationMaxUnderperformerProfit: -2.0 // Only rotate out holding if it's down at least this %
  }
};

// Ensure directories exist
function ensureDirectories() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// Load current state
async function loadState() {
  if (mongoose.connection.readyState === 1) {
    try {
      let doc = await StateModel.findOne({ key: 'simulation_state' });
      if (doc) {
        const mongoState = doc.toObject();
        // Keep local file in sync with MongoDB
        try {
          fs.writeFileSync(STATE_FILE, JSON.stringify(mongoState, null, 2));
        } catch (_) {}
        return mongoState;
      }
    } catch (e) {
      console.warn("MongoDB read failed, falling back to local file state:", e.message);
    }
  }
  
  if (fs.existsSync(STATE_FILE)) {
    try {
      const fileState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      // If MongoDB is connected but empty, initialize MongoDB with fileState
      if (mongoose.connection.readyState === 1) {
        await saveState(fileState);
      }
      return fileState;
    } catch (e) {
      console.warn("Local state file corrupted:", e.message);
    }
  }

  return await resetSimulation();
}

// Save state
async function saveState(state) {
  // Always persist state to disk state.json
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("Error saving state file:", e.message);
  }

  // Persist to MongoDB if connected
  if (mongoose.connection.readyState === 1) {
    try {
      const stateData = { ...state };
      delete stateData._id;
      delete stateData.key;
      
      await StateModel.findOneAndUpdate(
        { key: 'simulation_state' },
        stateData,
        { upsert: true, returnDocument: 'after' }
      );
    } catch (e) {
      console.error("Error saving state to MongoDB:", e.message);
    }
  }
}

// Reset state
async function resetSimulation() {
  const state = JSON.parse(JSON.stringify(INITIAL_STATE));
  await saveState(state);
  return state;
}

// Helper to format date as YYYY-MM-DD in UTC timezone (matching Yahoo's trading calendar)
function formatUTCDate(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let activeUpdatePromise = null;

// Fetch and Cache Yahoo Finance Data via Python yfinance helper script (real-time batch data)
async function updateCache(endDateStr, forceRefresh = false) {
  ensureDirectories();
  
  const todayStr = formatUTCDate(new Date());
  const CACHE_MIN_TTL_MS = 15 * 60 * 1000; // 15 minutes minimum threshold between network fetches
  
  // Check if cache file exists and is fresh for today (unless forceRefresh is requested & cache is >15 mins old)
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const stats = fs.statSync(CACHE_FILE);
      const ageMs = Date.now() - stats.mtimeMs;
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      
      if (cache.lastUpdated === todayStr && Object.keys(cache.data).length > 0) {
        if (!forceRefresh || ageMs < CACHE_MIN_TTL_MS) {
          console.log(`Using cached market data (Cache age: ${Math.round(ageMs / 1000 / 60)} mins).`);
          return cache.data;
        }
      }
    } catch (e) {
      console.warn("Corrupted cache file, rebuilding...", e);
    }
  }

  // If there is already an active fetch happening, wait for its completion to prevent race conditions
  if (activeUpdatePromise) {
    console.log("Waiting for concurrent cache update to finish...");
    return activeUpdatePromise;
  }

  // Create update promise and store it globally
  activeUpdatePromise = (async () => {
    console.log("Cache outdated or missing. Fetching live market data using Python yfinance script...");
    
    // Dynamically calculate start date (120 days lookback to ensure 50+ trading bars for technical indicators)
    const endD = new Date(endDateStr);
    const startD = new Date(endD.getTime() - (120 * 24 * 60 * 60 * 1000));
    const startDateStr = formatUTCDate(startD);
    // Determine Python executable (prefer isolated backend venv if available)
    const venvUnix = path.join(__dirname, 'venv', 'bin', 'python3');
    const venvWin = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
    let pythonBin = 'python3';

    if (fs.existsSync(venvUnix)) {
      pythonBin = `"${venvUnix}"`;
    } else if (fs.existsSync(venvWin)) {
      pythonBin = `"${venvWin}"`;
    }

    const pythonScript = path.join(__dirname, 'fetch_data.py');
    
    // Execute Python yfinance batch script in a promise
    await new Promise((resolve, reject) => {
      exec(`${pythonBin} "${pythonScript}" "${startDateStr}" "${endDateStr}" "${CACHE_FILE}"`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Python script error: ${error.message}`);
          console.error(`Stderr: ${stderr}`);
          reject(error);
        } else {
          console.log(`Python script output: ${stdout || 'SUCCESS'}`);
          resolve();
        }
      });
    });

    // Reload the watchlist dynamically from the freshly generated cache file
    loadWatchlist();

    // Re-read and return the newly generated cache data
    if (fs.existsSync(CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      return cache.data;
    } else {
      throw new Error("Python script finished but cache file was not created.");
    }
  })();

  try {
    const result = await activeUpdatePromise;
    return result;
  } finally {
    activeUpdatePromise = null;
  }
}


// Generate aggressive narrative logs for Quant Sentinal
function generateNarrativeLog(date, sentiment, cash, holdings, totalValue, transactions) {
  const activeHoldingsSymbols = holdings.map(h => h.symbol.replace('.NS', '')).join(', ');
  
  const marketSummaries = {
    BULLISH: [
      `Market action is highly constructive. Nifty is maintaining its upward trajectory. Bulls are in complete control.`,
      `Bullish momentum is sweeping through the index. Aggressive trading pays off in conditions like these.`,
      `We see clean breakouts across multiple sectors. Capital is chasing growth, and we are riding the wave.`
    ],
    BEARISH: [
      `Bearish sentiment is dominating today's session. Sellers are dragging down core sectors. We are managing risk closely.`,
      `Market structure is turning defensive. The index faced strong overhead rejection. Cash conservation is key here.`,
      `Selling pressure accelerated today. Weak global cues and IT/Banking drag. We are playing tight and protecting capital.`
    ],
    VOLATILE: [
      `Extreme chop in today's session. High intraday swings but no clear trend direction. Wild action.`,
      `Volatile session with massive swings. Traders are fighting over key support levels. Tight stop losses are saving our positions.`,
      `Sector rotation is happening at breakneck speed. Volatility index (VIX) spikes. We stay nimble.`
    ],
    NEUTRAL: [
      `Market closed flat. Consolidation phase continues as institutions wait for fresh triggers.`,
      `Sideways rangebound trading today. Quiet session with low volume. Excellent environment for selective stock pickings.`,
      `No major movements today. Index is resting on the 20-day SMA. Consolidation before the next big expansion.`
    ]
  };

  const genericRemarks = [
    `Annual target of 15%-20% returns requires aggressive risk management. We do not marry positions—we rent momentum.`,
    `Rule #1: Let winners run, cut losers immediately. 6% stop loss is non-negotiable.`,
    `Aggressive trading is about probability. Win rate matters, but average win size vs average loss size matters more.`,
    `Deploying capital strictly where edge exists. We hold cash when market setups are sub-optimal.`
  ];

  const summaryArr = marketSummaries[sentiment] || marketSummaries.NEUTRAL;
  const mainSummary = summaryArr[Math.floor((date.charCodeAt(date.length - 1) || 0) % summaryArr.length)];
  const remark = genericRemarks[Math.floor((date.charCodeAt(date.length - 2) || 0) % genericRemarks.length)];

  let logsText = `${mainSummary}\n\n`;

  if (transactions.length > 0) {
    logsText += `**Transactions Executed:**\n`;
    transactions.forEach(t => {
      if (t.type === 'BUY') {
        logsText += `- **BOUGHT** ${t.quantity} shares of ${t.symbol.replace('.NS', '')} at ₹${t.price.toFixed(2)}. Target set at ₹${t.targetPrice.toFixed(2)}, Stop Loss at ₹${t.stopLoss.toFixed(2)}. *Reason:* ${t.reason}\n`;
      } else if (t.type === 'SELL') {
        const profitLossText = t.profit >= 0 ? `PROFIT of +₹${t.profit.toFixed(2)} (+${t.profitPercent.toFixed(1)}%)` : `LOSS of -₹${Math.abs(t.profit).toFixed(2)} (${t.profitPercent.toFixed(1)}%)`;
        logsText += `- **SOLD** ${t.quantity} shares of ${t.symbol.replace('.NS', '')} at ₹${t.price.toFixed(2)}: Triggered ${t.reason}. Realized ${profitLossText}.\n`;
      } else if (t.type === 'DEPOSIT') {
        logsText += `- **MONTHLY DEPOSIT**: Added ₹20,000.00 cash to the portfolio. Total cash available: ₹${cash.toFixed(2)}.\n`;
      }
    });
    logsText += `\n`;
  } else {
    logsText += `No trade executions today. Current portfolio allocation is stable. `;
    if (holdings.length > 0) {
      logsText += `Active holdings: ${activeHoldingsSymbols}. `;
    } else {
      logsText += `Currently holding 100% cash, scanning for high-probability setups. `;
    }
    logsText += `\n\n`;
  }

  logsText += `**Desk Metrics:**\n`;
  logsText += `- Total Portfolio Net Worth: ₹${totalValue.toFixed(2)}\n`;
  logsText += `- Cash Balance: ₹${cash.toFixed(2)} | Holdings Value: ₹${(totalValue - cash).toFixed(2)}\n`;
  logsText += `- Status: ${remark}`;

  return logsText;
}

/**
 * Evaluate broad market regime based on benchmark ETF / index (e.g. NIFTYBEES.NS or RELIANCE.NS)
 */
function evaluateMarketRegime(simDate, cachedData) {
  const benchmarkData = cachedData['NIFTYBEES.NS'] || cachedData['RELIANCE.NS'];
  if (!benchmarkData || benchmarkData.length === 0) {
    return { regime: 'NEUTRAL', benchmarkRsi: 50, trend: 'FLAT' };
  }

  const dayIdx = benchmarkData.findIndex(row => row.date === simDate);
  if (dayIdx === -1 || dayIdx < 20) {
    return { regime: 'NEUTRAL', benchmarkRsi: 50, trend: 'FLAT' };
  }

  const subHistory = benchmarkData.slice(0, dayIdx + 1);
  const closes = subHistory.map(r => r.close);
  const sma20Arr = calculateSMA(closes, 20);
  const sma50Arr = calculateSMA(closes, 50);
  const rsiArr = calculateRSI(closes, 14);

  const currClose = closes[closes.length - 1];
  const sma20 = sma20Arr[sma20Arr.length - 1];
  const sma50 = sma50Arr[sma50Arr.length - 1];
  const rsi = rsiArr[rsiArr.length - 1] || 50;

  if (sma20 && currClose > sma20 && rsi >= 48) {
    return { regime: 'BULLISH', benchmarkRsi: rsi, trend: 'UP' };
  } else if (sma20 && currClose < sma20 && rsi < 42) {
    return { regime: 'RISK_OFF', benchmarkRsi: rsi, trend: 'DOWN' };
  }
  return { regime: 'NEUTRAL', benchmarkRsi: rsi, trend: 'CONSOLIDATING' };
}

/**
 * Intelligent Multi-Strategy Scanner with Volume Confirmation & Multi-Factor Scoring
 * Scans universe for high-win-rate, institutional-grade swing setups.
 */
function scanMarketCandidates(simDate, cachedData, currentHoldings = [], config = {}) {
  const marketRegime = evaluateMarketRegime(simDate, cachedData);
  const candidates = [];

  // Count sector distribution in current holdings to enforce sector diversification
  const sectorCounts = {};
  for (const h of currentHoldings) {
    const sec = h.sector || 'Other';
    sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
  }

  for (const stock of WATCHLIST) {
    // Avoid buying what we already hold
    if (currentHoldings.some(h => h.symbol === stock.symbol)) continue;

    // Sector limit: max 2 positions per sector (except ETFs) to prevent concentration risk
    if (stock.sector !== 'ETFs' && (sectorCounts[stock.sector] || 0) >= 2) {
      continue;
    }

    const stockHistory = cachedData[stock.symbol];
    if (!stockHistory || stockHistory.length === 0) continue;

    // Get index for current simulation date
    const dayIdx = stockHistory.findIndex(row => row.date === simDate);
    if (dayIdx === -1 || dayIdx < 50) continue; // Need at least 50 bars of history

    const subHistory = stockHistory.slice(0, dayIdx + 1);
    const closes = subHistory.map(row => row.close);
    const highs = subHistory.map(row => row.high);
    const lows = subHistory.map(row => row.low);
    const opens = subHistory.map(row => row.open !== undefined ? row.open : row.close);
    const volumes = subHistory.map(row => row.volume || 0);

    const len = closes.length;
    const currentClose = closes[len - 1];
    const currentOpen = opens[len - 1];
    const prevClose = closes[len - 2];

    // Compute technical indicators
    const sma20Array = calculateSMA(closes, 20);
    const sma50Array = calculateSMA(closes, 50);
    const rsiArray = calculateRSI(closes, 14);
    const macdResult = calculateMACD(closes);
    const atrArray = calculateATR(highs, lows, closes, 14);
    const rvolArray = calculateRVOL(volumes, 20);
    const sma20Slope = calculateSlope(sma20Array, 5);
    const sma50Slope = calculateSlope(sma50Array, 10);

    const sma20 = sma20Array[len - 1];
    const sma50 = sma50Array[len - 1];
    const rsiVal = rsiArray[len - 1];
    const prevRsiVal = rsiArray[len - 2];
    const macdLine = macdResult.macdLine[len - 1];
    const signalLine = macdResult.signalLine[len - 1];
    const histogram = macdResult.histogram[len - 1];
    const prevMacdLine = macdResult.macdLine[len - 2];
    const prevSignalLine = macdResult.signalLine[len - 2];
    const prevHistogram = macdResult.histogram[len - 2];
    const currentAtr = atrArray[len - 1] || (currentClose * 0.02);
    const currentRvol = rvolArray[len - 1] || 1.0;

    if (sma20 === null || sma50 === null || rsiVal === null) continue;

    const breakout20 = checkBreakouts(closes, highs, lows, 20);
    const breakout10 = checkBreakouts(closes, highs, lows, 10);

    let buySignal = false;
    let baseScore = 0;
    let reason = '';
    let strategyName = '';

    // --- High-Probability Strategy 1: Volume-Confirmed Momentum Breakout (20-Day High) ---
    // 20-day high breakout + price > 20 SMA > 50 SMA + upward slope + volume expansion + not overextended
    if (
      breakout20.isBullishBreakout &&
      currentClose > sma20 &&
      sma20 > sma50 &&
      sma20Slope >= 0 &&
      currentRvol >= 1.1 &&
      rsiVal >= 52 &&
      rsiVal <= 70 &&
      currentClose >= currentOpen &&
      currentClose <= sma20 * 1.08 // Avoid chasing extended moves
    ) {
      buySignal = true;
      strategyName = 'MOMENTUM_BREAKOUT';
      baseScore = 86;
      reason = `20-day high breakout confirmed with volume surge (${currentRvol.toFixed(1)}x RVOL, RSI: ${rsiVal.toFixed(1)}).`;
    }

    // --- High-Probability Strategy 2: Value Pullback on Rising Support (Uptrend Dip Bounce) ---
    // Primary trend is strictly UP (50 SMA slope >= 0 & price >= 50 SMA), bounced off 20/50 SMA support with a green reversal candle
    else if (
      sma50Slope >= -0.1 &&
      currentClose >= sma50 * 0.99 &&
      (Math.abs(currentClose - sma20) / sma20 <= 0.025 || Math.abs(currentClose - sma50) / sma50 <= 0.03) &&
      currentClose > currentOpen &&
      currentClose > prevClose &&
      rsiVal >= 36 &&
      rsiVal <= 52 &&
      rsiVal > prevRsiVal &&
      (histogram === null || prevHistogram === null || histogram > prevHistogram)
    ) {
      buySignal = true;
      strategyName = 'SUPPORT_PULLBACK';
      baseScore = 82;
      const supLevel = Math.abs(currentClose - sma20) < Math.abs(currentClose - sma50) ? '20-day SMA' : '50-day SMA';
      reason = `Bullish rebound off rising ${supLevel} support with positive momentum recovery (RSI: ${rsiVal.toFixed(1)}).`;
    }

    // --- High-Probability Strategy 3: High-Quality MACD Golden Cross with Trend Alignment ---
    // Fresh MACD cross above 20 SMA and 50 SMA in a healthy momentum zone
    else if (
      macdLine !== null &&
      signalLine !== null &&
      macdLine > signalLine &&
      prevMacdLine !== null &&
      prevSignalLine !== null &&
      prevMacdLine <= prevSignalLine &&
      currentClose > sma20 &&
      currentClose > sma50 &&
      sma20 >= sma50 * 0.98 &&
      rsiVal >= 48 &&
      rsiVal <= 65 &&
      currentRvol >= 0.85
    ) {
      buySignal = true;
      strategyName = 'MACD_CROSSOVER';
      baseScore = 78;
      reason = `Bullish MACD crossover confirmed above 20 & 50-day moving averages (RSI: ${rsiVal.toFixed(1)}).`;
    }

    // --- High-Probability Strategy 4: Volatility Squeeze Expansion ---
    // 10-day breakout with heavy institutional accumulation (RVOL >= 1.4)
    else if (
      breakout10.isBullishBreakout &&
      currentClose > sma20 &&
      sma20 > sma50 &&
      currentRvol >= 1.4 &&
      rsiVal >= 50 &&
      rsiVal <= 68 &&
      currentClose > currentOpen
    ) {
      buySignal = true;
      strategyName = 'VOLATILITY_EXPANSION';
      baseScore = 80;
      reason = `Consolidation breakout fueled by heavy institutional volume (${currentRvol.toFixed(1)}x RVOL).`;
    }

    if (buySignal) {
      // --- Multi-Factor Confluence Scoring Adjustments (0-100 scale) ---
      let score = baseScore;

      // 1. Volume Factor
      if (currentRvol >= 2.0) score += 8;
      else if (currentRvol >= 1.4) score += 5;
      else if (currentRvol < 0.9) score -= 6;

      // 2. Trend & Moving Average Strength
      if (currentClose > sma20 && sma20 > sma50 && sma20Slope > 0.8) score += 5;
      if (sma50Slope > 0.5) score += 3;

      // 3. MACD Momentum
      if (macdLine > 0 && histogram > 0) score += 4;

      // 4. Proximity to Support (Tight Risk/Reward)
      const distFromSma20 = (currentClose - sma20) / sma20;
      if (distFromSma20 >= 0.005 && distFromSma20 <= 0.035) {
        score += 4; // Perfect sweet spot near support
      } else if (distFromSma20 > 0.06) {
        score -= 5; // Penalty for being stretched
      }

      // 5. Market Regime Filter
      if (marketRegime.regime === 'BULLISH') {
        score += 4;
      } else if (marketRegime.regime === 'RISK_OFF') {
        score -= stock.sector === 'ETFs' ? 2 : 10;
      }

      // Clamp score between 50 and 100
      score = Math.max(50, Math.min(100, Math.round(score)));

      // Enforce Minimum Quality Bar
      const minScoreThreshold = marketRegime.regime === 'RISK_OFF' ? 82 : 72;
      if (score >= minScoreThreshold) {
        candidates.push({
          symbol: stock.symbol,
          name: stock.name,
          sector: stock.sector,
          price: currentClose,
          score: score,
          reason: reason,
          strategy: strategyName,
          technicalStats: {
            rsi: rsiVal,
            sma20,
            sma50,
            rvol: currentRvol,
            atr: currentAtr,
            macdHist: histogram || 0
          }
        });
      }
    }
  }

  // Sort descending by multi-factor score
  candidates.sort((a, b) => b.score - a.score);
  return { candidates, marketRegime };
}

// Core Simulation Function
async function runSimulation(targetEndDateStr, forceRefresh = false) {
  const state = await loadState();
  const cachedData = await updateCache(targetEndDateStr, forceRefresh);

  const lastRunDateStr = state.lastSimulationDate;
  if (!forceRefresh && lastRunDateStr >= targetEndDateStr) {
    console.log(`Simulation is already up to date (${lastRunDateStr}).`);
    return state;
  }

  // Find all unique trading dates from a highly liquid stock (RELIANCE.NS) to get the market calendar
  const relianceData = cachedData['RELIANCE.NS'];
  if (!relianceData || relianceData.length === 0) {
    throw new Error("Failed to load historical data for calendar baseline (RELIANCE.NS).");
  }

  // Extract dates that are greater than lastRunDateStr and <= targetEndDateStr
  const tradingDates = relianceData
    .map(row => row.date)
    .filter(date => date > lastRunDateStr && date <= targetEndDateStr)
    .sort();

  if (tradingDates.length === 0) {
    console.log("No new trading days found to simulate.");
    return state;
  }

  console.log(`Simulating ${tradingDates.length} trading days: from ${tradingDates[0]} to ${tradingDates[tradingDates.length - 1]}`);

  // We loop day-by-day through the new trading dates
  for (const simDate of tradingDates) {
    const todayTransactions = [];

    // --- 1. Monthly Deposit Check (Deposit on the 8th of each month) ---
    const simDay = new Date(simDate);
    const lastRunDay = new Date(state.lastSimulationDate);
    
    // Deposit ₹20k if a new month has arrived on the 8th day (or if we skipped past the 8th of a new month)
    const isNewMonth = simDay.getMonth() !== lastRunDay.getMonth() || simDay.getFullYear() !== lastRunDay.getFullYear();
    const isPastDepositDay = simDay.getDate() >= 8;
    const lastRunBeforeDepositDay = lastRunDay.getDate() < 8;
    
    if ((isNewMonth && isPastDepositDay) || (isNewMonth && lastRunBeforeDepositDay)) {
      state.cash += 20000.0;
      // Record deposit in valuation totals
      const lastVal = state.valuationHistory[state.valuationHistory.length - 1];
      const newTotalDeposited = (lastVal ? lastVal.totalDeposited : 0) + 20000.0;
      
      todayTransactions.push({
        type: 'DEPOSIT',
        amount: 20000.0,
        reason: 'Monthly Contribution'
      });
      console.log(`[${simDate}] Deposited monthly ₹20,000. Cash: ₹${state.cash}`);
    }

    // --- 2. Portfolio Sell Checks (Evaluate active holdings) ---
    const remainingHoldings = [];
    
    for (const position of state.holdings) {
      const stockData = cachedData[position.symbol];
      const dayBar = stockData ? stockData.find(row => row.date === simDate) : null;

      if (!dayBar) {
        // No data for this stock today, keep position
        remainingHoldings.push(position);
        continue;
      }

      const { high, low, close } = dayBar;
      let triggerSell = false;
      let sellPrice = close;
      let sellReason = '';

      // Check stop loss first (risk-averse prioritization)
      if (low <= position.stopLoss) {
        triggerSell = true;
        sellPrice = position.stopLoss; // Executed at stop loss
        sellReason = 'Stop Loss Triggered';
      } 
      // Check target profit
      else if (high >= position.targetPrice) {
        triggerSell = true;
        sellPrice = position.targetPrice; // Executed at target price
        sellReason = 'Target Profit Hit';
      }

      if (triggerSell) {
        const revenue = position.quantity * sellPrice;
        const cost = position.quantity * position.buyPrice;
        const profit = revenue - cost;
        const profitPercent = (profit / cost) * 100;

        state.cash += revenue;
        
        const completedTrade = {
          symbol: position.symbol,
          name: position.name,
          sector: position.sector,
          quantity: position.quantity,
          buyPrice: position.buyPrice,
          sellPrice: sellPrice,
          buyDate: position.buyDate,
          sellDate: simDate,
          profit: profit,
          profitPercent: profitPercent,
          reason: sellReason
        };

        state.history.push(completedTrade);
        todayTransactions.push({
          type: 'SELL',
          symbol: position.symbol,
          quantity: position.quantity,
          price: sellPrice,
          profit: profit,
          profitPercent: profitPercent,
          reason: sellReason
        });
        
        console.log(`[${simDate}] SOLD ${position.symbol} @ ₹${sellPrice} (${sellReason}). P&L: ₹${profit.toFixed(2)}`);
      } else {
        // Position remains open, update its current price
        position.currentPrice = close;
        position.value = position.quantity * close;
        position.profit = position.value - (position.quantity * position.buyPrice);
        position.profitPercent = (position.profit / (position.quantity * position.buyPrice)) * 100;
        remainingHoldings.push(position);
      }
    }
    state.holdings = remainingHoldings;

    // --- 3. Technical Scanner & Buys ---
    const { candidates, marketRegime } = scanMarketCandidates(simDate, cachedData, state.holdings, state.config);

    // Deploy cash to top candidates
    for (const targetStock of candidates) {
      // Sector diversification: prevent more than 2 open positions in same sector (except ETFs)
      const currentSectorCount = state.holdings.filter(h => h.sector === targetStock.sector).length;
      if (targetStock.sector !== 'ETFs' && currentSectorCount >= 2) {
        continue;
      }

      let availableSlots = state.config.maxPositions - state.holdings.length;
      let canBuy = (availableSlots > 0 && state.cash >= 1000);

      const rotationEnabled = state.config.rotationEnabled !== false;
      const minCandScore = state.config.rotationMinCandidateScore || 85;
      const maxUnderperformerProfit = state.config.rotationMaxUnderperformerProfit || -2.0;

      // If rotation is enabled and we cannot buy normally, check for underperformer swap
      if (rotationEnabled && (!canBuy || state.cash < targetStock.price) && targetStock.score >= minCandScore && state.holdings.length > 0) {
        let worstHoldingIndex = -1;
        let worstHoldingProfit = Infinity;

        for (let j = 0; j < state.holdings.length; j++) {
          const h = state.holdings[j];
          // Prevent same-day rotation churn
          if (h.buyDate !== simDate && h.profitPercent < worstHoldingProfit) {
            worstHoldingProfit = h.profitPercent;
            worstHoldingIndex = j;
          }
        }

        if (worstHoldingIndex !== -1 && worstHoldingProfit <= maxUnderperformerProfit) {
          const position = state.holdings[worstHoldingIndex];
          const stockData = cachedData[position.symbol];
          const dayBar = stockData ? stockData.find(row => row.date === simDate) : null;
          const sellPrice = dayBar ? dayBar.close : position.currentPrice;
          const revenue = position.quantity * sellPrice;

          // Only proceed if the swap generates enough cash to actually buy at least 1 share of the candidate
          if (state.cash + revenue >= targetStock.price) {
            const cost = position.quantity * position.buyPrice;
            const profit = revenue - cost;
            const profitPercent = (profit / cost) * 100;

            state.cash += revenue;

            const completedTrade = {
              symbol: position.symbol,
              name: position.name,
              sector: position.sector,
              quantity: position.quantity,
              buyPrice: position.buyPrice,
              sellPrice: sellPrice,
              buyDate: position.buyDate,
              sellDate: simDate,
              profit: profit,
              profitPercent: profitPercent,
              reason: `Replaced by ${targetStock.symbol} (Score: ${targetStock.score.toFixed(1)})`
            };

            state.history.push(completedTrade);
            todayTransactions.push({
              type: 'SELL',
              symbol: position.symbol,
              quantity: position.quantity,
              price: sellPrice,
              profit: profit,
              profitPercent: profitPercent,
              reason: `Replaced by ${targetStock.symbol} (Score: ${targetStock.score.toFixed(1)})`
            });

            console.log(`[${simDate}] ROTATION SELL: Replaced underperformer ${position.symbol} @ ₹${sellPrice} (P&L: ${profitPercent.toFixed(2)}%) with ${targetStock.symbol}`);
            
            // Remove from holdings
            state.holdings.splice(worstHoldingIndex, 1);
            
            // Recalculate indicators for the buying logic
            availableSlots = state.config.maxPositions - state.holdings.length;
            canBuy = true;
          }
        }
      }

      if (canBuy && state.cash >= 1000) {
        const activeSlots = state.config.maxPositions - state.holdings.length;
        const capitalAllocation = Math.min(state.cash, Math.max(state.cash / (activeSlots || 1), 3000));
        const qty = Math.floor(capitalAllocation / targetStock.price);

        if (qty > 0) {
          const cost = qty * targetStock.price;
          state.cash -= cost;

          const targetPrice = targetStock.price * (1 + state.config.targetProfitPercent);
          const stopLoss = targetStock.price * (1 - state.config.stopLossPercent);

          const newHolding = {
            symbol: targetStock.symbol,
            name: targetStock.name,
            sector: targetStock.sector,
            quantity: qty,
            buyPrice: targetStock.price,
            currentPrice: targetStock.price,
            buyDate: simDate,
            targetPrice: targetPrice,
            stopLoss: stopLoss,
            value: cost,
            profit: 0.0,
            profitPercent: 0.0,
            buyReason: targetStock.reason,
            technicalStats: targetStock.technicalStats
          };

          state.holdings.push(newHolding);
          todayTransactions.push({
            type: 'BUY',
            symbol: targetStock.symbol,
            quantity: qty,
            price: targetStock.price,
            targetPrice,
            stopLoss,
            reason: targetStock.reason
          });
          
          console.log(`[${simDate}] BOUGHT ${qty} shares of ${targetStock.symbol} @ ₹${targetStock.price}. Target: ₹${targetPrice.toFixed(2)}, SL: ₹${stopLoss.toFixed(2)}`);
        }
      }
    }

    // --- 4. End-of-Day Valuation and Logging ---
    let holdingsValue = 0;
    for (const h of state.holdings) {
      // Re-fetch close price to ensure accurate valuation
      const stockData = cachedData[h.symbol];
      const dayBar = stockData ? stockData.find(row => row.date === simDate) : null;
      if (dayBar) {
        h.currentPrice = dayBar.close;
        h.value = h.quantity * dayBar.close;
        h.profit = h.value - (h.quantity * h.buyPrice);
        h.profitPercent = (h.profit / (h.quantity * h.buyPrice)) * 100;
      }
      holdingsValue += h.value;
    }

    const totalValue = state.cash + holdingsValue;
    const lastVal = state.valuationHistory[state.valuationHistory.length - 1];
    const totalDeposited = lastVal ? lastVal.totalDeposited : 20000.0;
    const profitPercent = ((totalValue - totalDeposited) / totalDeposited) * 100;

    // Append to valuation history
    state.valuationHistory.push({
      date: simDate,
      cash: state.cash,
      holdingsValue: holdingsValue,
      totalValue: totalValue,
      profitPercent: profitPercent,
      totalDeposited: totalDeposited
    });

    // Determine Day Sentiment based on transactions or random fluctuation
    let sentiment = 'NEUTRAL';
    const sellsCount = todayTransactions.filter(t => t.type === 'SELL').length;
    const buysCount = todayTransactions.filter(t => t.type === 'BUY').length;
    
    if (sellsCount > 0) {
      const profitableSells = todayTransactions.filter(t => t.type === 'SELL' && t.profit > 0).length;
      sentiment = profitableSells > sellsCount / 2 ? 'BULLISH' : 'BEARISH';
    } else if (buysCount > 0) {
      sentiment = 'BULLISH';
    } else {
      // Random mock fluctuation based on date hash
      const hash = simDate.charCodeAt(simDate.length - 1) + simDate.charCodeAt(simDate.length - 2);
      if (hash % 3 === 0) sentiment = 'BULLISH';
      else if (hash % 3 === 1) sentiment = 'BEARISH';
      else sentiment = 'VOLATILE';
    }

    // Generate Narrative log
    const logText = generateNarrativeLog(simDate, sentiment, state.cash, state.holdings, totalValue, todayTransactions);
    state.logs.unshift({
      date: simDate,
      sentiment: sentiment,
      text: logText
    });

    state.lastSimulationDate = simDate;
  }

  await saveState(state);
  return state;
}

// Get basic quote details for a symbol (for scanner screen)
async function getWatchlistQuotes(endDateStr) {
  const cachedData = await updateCache(endDateStr);
  const result = [];

  for (const stock of WATCHLIST) {
    const history = cachedData[stock.symbol];
    if (history && history.length >= 2) {
      const todayBar = history[history.length - 1];
      const yesterdayBar = history[history.length - 2];
      
      const change = todayBar.close - yesterdayBar.close;
      const changePercent = (change / yesterdayBar.close) * 100;

      // Extract closes, highs, lows, volumes for technical indicators
      const closes = history.map(r => r.close);
      const highs = history.map(r => r.high);
      const lows = history.map(r => r.low);
      const volumes = history.map(r => r.volume || 0);

      const rsiArray = calculateRSI(closes, 14);
      const sma20Array = calculateSMA(closes, 20);
      const sma50Array = calculateSMA(closes, 50);
      const rvolArray = calculateRVOL(volumes, 20);
      const breakout20 = checkBreakouts(closes, highs, lows, 20);

      const rsi = rsiArray[rsiArray.length - 1];
      const sma20 = sma20Array[sma20Array.length - 1];
      const sma50 = sma50Array[sma50Array.length - 1];
      const rvol = rvolArray[rvolArray.length - 1] || 1.0;

      // Intelligent Action recommendations based on technical setup & volume
      let recommendation = 'HOLD / WAIT';
      let recReason = 'Trend is consolidating, waiting for directional expansion.';

      if (todayBar.close > sma20 && sma20 > sma50 && breakout20.isBullishBreakout && rvol >= 1.1 && rsi >= 52 && rsi <= 70) {
        recommendation = 'STRONG BUY';
        recReason = `Volume-backed 20-day high breakout (${rvol.toFixed(1)}x RVOL, RSI: ${rsi.toFixed(1)}).`;
      } else if (todayBar.close >= sma50 * 0.99 && (Math.abs(todayBar.close - sma20) / sma20 <= 0.025 || Math.abs(todayBar.close - sma50) / sma50 <= 0.03) && todayBar.close > yesterdayBar.close && rsi >= 38 && rsi <= 54) {
        recommendation = 'ACCUMULATE';
        recReason = `Bouncing off key moving average support with momentum recovery (RSI: ${rsi.toFixed(1)}).`;
      } else if (rsi > 72 || (sma20 && todayBar.close > sma20 * 1.08)) {
        recommendation = 'HOLD / REDUCE';
        recReason = 'Short-term overbought/extended, watch for trailing stop-loss trigger.';
      } else if (sma20 && sma50 && todayBar.close < sma20 && sma20 < sma50) {
        recommendation = 'AVOID';
        recReason = 'Asset in confirmed downtrend below 20 and 50-day moving averages.';
      }

      result.push({
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector,
        price: todayBar.close,
        change,
        changePercent,
        rsi: rsi || 50,
        sma20: sma20 || todayBar.close,
        sma50: sma50 || todayBar.close,
        rvol: rvol,
        recommendation,
        recReason,
        history: history.slice(-30) // Last 30 trading days for mini charts
      });
    } else {
      result.push({
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector,
        price: 0,
        change: 0,
        changePercent: 0,
        rsi: 50,
        sma20: 0,
        sma50: 0,
        rvol: 1.0,
        recommendation: 'WAIT',
        recReason: 'Loading market data...',
        history: []
      });
    }
  }

  return result;
}

// Re-evaluate all open holdings against current config targets using the last known price.
// Called immediately after a config change so new profit/stop targets take effect without
// needing to wait for the next trading day simulation.
async function reEvaluateHoldings() {
  const state = await loadState();
  if (!state.holdings || state.holdings.length === 0) {
    console.log('[reEvaluate] No open holdings to re-evaluate.');
    return state;
  }

  const simDate = state.lastSimulationDate;
  const cachedData = await updateCache(simDate);

  const remainingHoldings = [];
  const closedTrades = [];

  for (const position of state.holdings) {
    const stockData = cachedData[position.symbol];
    // Use the last available bar for this position (most recent trading day)
    const dayBar = stockData ? [...stockData].reverse().find(row => row.date <= simDate) : null;

    if (!dayBar) {
      remainingHoldings.push(position);
      continue;
    }

    const high = dayBar.high;
    const low = dayBar.low;
    const close = dayBar.close;

    let triggerSell = false;
    let sellPrice = close;
    let sellReason = '';

    // Re-check using the baked-in targetPrice (which was already updated retroactively when config changed)
    if (low <= position.stopLoss) {
      triggerSell = true;
      sellPrice = position.stopLoss;
      sellReason = 'Stop Loss Triggered';
    } else if (high >= position.targetPrice) {
      triggerSell = true;
      sellPrice = position.targetPrice;
      sellReason = 'Target Profit Hit';
    }

    if (triggerSell) {
      const revenue = position.quantity * sellPrice;
      const cost = position.quantity * position.buyPrice;
      const profit = revenue - cost;
      const profitPercent = (profit / cost) * 100;

      state.cash += revenue;

      const completedTrade = {
        symbol: position.symbol,
        name: position.name,
        sector: position.sector,
        quantity: position.quantity,
        buyPrice: position.buyPrice,
        sellPrice: sellPrice,
        buyDate: position.buyDate,
        sellDate: simDate,
        profit: profit,
        profitPercent: profitPercent,
        reason: `${sellReason} (Config Re-evaluation)`
      };

      state.history.push(completedTrade);
      closedTrades.push(completedTrade);
      console.log(`[reEvaluate] SOLD ${position.symbol} @ ₹${sellPrice.toFixed(2)} — ${sellReason}. P&L: ₹${profit.toFixed(2)} (${profitPercent.toFixed(2)}%)`);
    } else {
      // Update current price but keep position
      position.currentPrice = close;
      position.value = position.quantity * close;
      position.profit = position.value - (position.quantity * position.buyPrice);
      position.profitPercent = (position.profit / (position.quantity * position.buyPrice)) * 100;
      remainingHoldings.push(position);
    }
  }

  state.holdings = remainingHoldings;
  await saveState(state);

  console.log(`[reEvaluate] Done. Closed ${closedTrades.length} position(s), ${remainingHoldings.length} still open.`);
  return { state, closedTrades };
}

// Deploy available cash into candidate setups immediately on current simulation date
async function deployIdleCash(simDate) {
  const state = await loadState();
  const targetDate = simDate || state.lastSimulationDate;
  const cachedData = await updateCache(targetDate);
  
  let availableSlots = state.config.maxPositions - state.holdings.length;
  if (availableSlots <= 0 || state.cash < 1000) {
    return state;
  }

  const { candidates } = scanMarketCandidates(targetDate, cachedData, state.holdings, state.config);

  let newBuysCount = 0;
  for (const targetStock of candidates) {
    // Sector diversification check: maximum 2 positions per sector (except ETFs)
    const currentSectorCount = state.holdings.filter(h => h.sector === targetStock.sector).length;
    if (targetStock.sector !== 'ETFs' && currentSectorCount >= 2) {
      continue;
    }

    availableSlots = state.config.maxPositions - state.holdings.length;
    if (availableSlots <= 0 || state.cash < 1000) break;

    const capitalAllocation = Math.min(state.cash, Math.max(state.cash / (availableSlots || 1), 3000));
    const qty = Math.floor(capitalAllocation / targetStock.price);

    if (qty > 0) {
      const cost = qty * targetStock.price;
      state.cash -= cost;
      const targetPrice = targetStock.price * (1 + state.config.targetProfitPercent);
      const stopLoss = targetStock.price * (1 - state.config.stopLossPercent);

      const newHolding = {
        symbol: targetStock.symbol,
        name: targetStock.name,
        sector: targetStock.sector,
        quantity: qty,
        buyPrice: targetStock.price,
        currentPrice: targetStock.price,
        buyDate: targetDate,
        targetPrice,
        stopLoss,
        value: cost,
        profit: 0.0,
        profitPercent: 0.0,
        buyReason: targetStock.reason,
        technicalStats: targetStock.technicalStats
      };

      state.holdings.push(newHolding);
      newBuysCount++;
      console.log(`[deployIdleCash] BOUGHT ${qty} shares of ${targetStock.symbol} @ ₹${targetStock.price}. Target: ₹${targetPrice.toFixed(2)}, SL: ₹${stopLoss.toFixed(2)}`);
    }
  }

  if (newBuysCount > 0) {
    let holdingsValue = 0;
    for (const h of state.holdings) {
      holdingsValue += h.value;
    }
    const totalValue = state.cash + holdingsValue;
    const lastVal = state.valuationHistory[state.valuationHistory.length - 1];
    if (lastVal) {
      lastVal.cash = state.cash;
      lastVal.holdingsValue = holdingsValue;
      lastVal.totalValue = totalValue;
      lastVal.profitPercent = ((totalValue - lastVal.totalDeposited) / lastVal.totalDeposited) * 100;
    }
    await saveState(state);
  }

  return state;
}

module.exports = {
  WATCHLIST,
  loadState,
  saveState,
  resetSimulation,
  runSimulation,
  reEvaluateHoldings,
  deployIdleCash,
  getWatchlistQuotes,
  evaluateMarketRegime,
  scanMarketCandidates
};
