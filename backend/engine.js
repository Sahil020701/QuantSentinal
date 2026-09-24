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
  checkBreakouts,
  calculateADX
} = require('./utils/indicators');
const StateModel = require('./models/State');

const STATE_FILE = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, 'state_test.json')
  : path.join(__dirname, 'state.json');
const CACHE_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(__dirname, 'data', 'historical_cache.json');
const FALLBACK_WATCHLIST_FILE = path.join(__dirname, 'data', 'watchlist_fallback.json');

const DEFAULT_WATCHLIST = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries', sector: 'Energy & Conglomerate' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', sector: 'IT Services' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd', sector: 'Banking & Financials' },
  { symbol: 'INFY.NS', name: 'Infosys Ltd', sector: 'IT Services' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', sector: 'Banking & Financials' }
];

const WATCHLIST = [];

function loadWatchlist() {
  // 1. Try loading from cache file
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (cache.watchlist && Array.isArray(cache.watchlist) && cache.watchlist.length > 0) {
        WATCHLIST.length = 0;
        WATCHLIST.push(...cache.watchlist);
        console.log(`Loaded ${WATCHLIST.length} assets from dynamic Nifty 200 watchlist cache.`);
        return;
      }
    } catch (e) {
      console.warn("Failed to load watchlist from cache, checking fallback:", e.message);
    }
  }

  // 2. Try loading from fallback watchlist file
  if (fs.existsSync(FALLBACK_WATCHLIST_FILE)) {
    try {
      const list = JSON.parse(fs.readFileSync(FALLBACK_WATCHLIST_FILE, 'utf8'));
      if (Array.isArray(list) && list.length > 0) {
        WATCHLIST.length = 0;
        WATCHLIST.push(...list);
        console.log(`Loaded ${WATCHLIST.length} assets from fallback watchlist file.`);
        return;
      }
    } catch (e) {
      console.warn("Failed to load fallback watchlist file:", e.message);
    }
  }

  // 3. Fall back to minimal hardcoded default
  WATCHLIST.length = 0;
  WATCHLIST.push(...DEFAULT_WATCHLIST);
  console.log(`Using default boot watchlist with ${WATCHLIST.length} assets.`);
}

// Initialize watchlist on boot
loadWatchlist();

// Default initial state starting July 1, 2026
const INITIAL_STATE = {
  lastSimulationDate: '2026-07-01',
  cash: 50000.0,
  holdings: [],
  history: [],
  valuationHistory: [
    {
      date: '2026-07-01',
      cash: 50000.0,
      holdingsValue: 0.0,
      totalValue: 50000.0,
      profitPercent: 0.0,
      totalDeposited: 50000.0
    }
  ],
  logs: [
    {
      date: '2026-07-01',
      sentiment: 'NEUTRAL',
      text: "Quant Sentinal Aggressive Trading System online. Initial capital of ₹50,000 deposited. Objective: Target 15%-20% annualized returns using momentum breakouts and oversold rebounds. Current simulation baseline set to 2026-07-01. Ready for market scanning and execution."
    }
  ],
  config: {
    targetProfitPercent: 0.10, // +10.0% realistic swing target
    stopLossPercent: 0.04,      // -4.0% tight risk control (2.5:1 reward-to-risk ratio)
    maxPositions: 20,          // Disciplined focus on top 20 setups
    aggressiveness: 'aggressive', // conservative, moderate, aggressive, hyper
    rotationEnabled: false,     // Disabled to eliminate whipsaw churn on normal -2% pullbacks
    rotationMinCandidateScore: 92, // High bar if rotation is manually turned on
    rotationMaxUnderperformerProfit: -4.5 // Only rotate if trade is broken beyond -4.5%
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
async function resetSimulation(customStartDate) {
  const startDate = customStartDate || '2026-07-01';
  const state = {
    ...JSON.parse(JSON.stringify(INITIAL_STATE)),
    lastSimulationDate: startDate,
    cash: 50000.0,
    holdings: [],
    history: [],
    valuationHistory: [
      {
        date: startDate,
        cash: 50000.0,
        holdingsValue: 0.0,
        totalValue: 50000.0,
        profitPercent: 0.0,
        totalDeposited: 50000.0
      }
    ],
    logs: [
      {
        date: startDate,
        sentiment: 'NEUTRAL',
        text: `Quant Sentinal Trading System online. Initial capital of ₹50,000 deposited. Objective: Target 15%-20% annualized returns using momentum breakouts and smart support rebounds. Current simulation baseline set to ${startDate}. Ready for market scanning and execution.`
      }
    ]
  };
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
        logsText += `- **MONTHLY DEPOSIT**: Added ₹50,000.00 cash to the portfolio. Total cash available: ₹${cash.toFixed(2)}.\n`;
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
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const rsiArr = calculateRSI(closes, 14);

  const currClose = closes[closes.length - 1];
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];
  const rsi = rsiArr[rsiArr.length - 1] || 50;

  if (ema20 && currClose > ema20 && (ema50 ? ema20 >= ema50 : true) && rsi >= 50) {
    return { regime: 'BULLISH', benchmarkRsi: rsi, trend: 'UP' };
  } else if (ema20 && (currClose < ema20 || rsi < 44)) {
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

    // Sector limit: max 3 positions per sector (except ETFs) to prevent concentration risk
    if (stock.sector !== 'ETFs' && (sectorCounts[stock.sector] || 0) >= 3) {
      continue;
    }

    const stockHistory = cachedData[stock.symbol];
    if (!stockHistory || stockHistory.length === 0) continue;

    // Get index for current simulation date
    const dayIdx = stockHistory.findIndex(row => row.date === simDate);
    if (dayIdx === -1 || dayIdx < 30) continue; // Need at least 30 bars of history

    const subHistory = stockHistory.slice(0, dayIdx + 1);
    const closes = subHistory.map(row => row.close);
    const highs = subHistory.map(row => row.high);
    const lows = subHistory.map(row => row.low);
    const opens = subHistory.map(row => row.open !== undefined ? row.open : row.close);
    const volumes = subHistory.map(row => row.volume || 0);

    const len = closes.length;
    const currentClose = closes[len - 1];
    const currentOpen = opens[len - 1];
    const currentHigh = highs[len - 1];
    const currentLow = lows[len - 1];
    const prevClose = closes[len - 2];

    // Compute technical indicators (EMA + SMA + RSI + MACD + ATR + RVOL + ADX)
    const ema20Array = calculateEMA(closes, 20);
    const ema50Array = calculateEMA(closes, 50);
    const sma20Array = calculateSMA(closes, 20);
    const sma50Array = calculateSMA(closes, 50);
    const rsiArray = calculateRSI(closes, 14);
    const macdResult = calculateMACD(closes);
    const atrArray = calculateATR(highs, lows, closes, 14);
    const rvolArray = calculateRVOL(volumes, 20);
    const adxArray = calculateADX(highs, lows, closes, 14);
    const ema20Slope = calculateSlope(ema20Array, 5);
    const ema50Slope = calculateSlope(ema50Array, 10);

    const ema20 = ema20Array[len - 1];
    const ema50 = ema50Array[len - 1];
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
    const currentAdx = adxArray[len - 1] || 0;  // ADX: trend strength (>20 = trending, >25 = strong)

    if (ema20 === null || ema50 === null || rsiVal === null) continue;

    // Candlestick Buying Pressure: Close Location Value (CLV)
    const candleRange = currentHigh - currentLow;
    const clv = candleRange > 0 ? (currentClose - currentLow) / candleRange : 0.5;

    const breakout20 = checkBreakouts(closes, highs, lows, 20);

    let buySignal = false;
    let baseScore = 0;
    let reason = '';
    let strategyName = '';

    // --- Institutional Strategy 1: Volume-Confirmed Controlled Breakout ---
    // Strict uptrend (Price > 20 EMA > 50 EMA), not overextended (within 4.5% of 20 EMA), strong close & volume.
    // ADX >= 20 confirms this is a trending market, not a choppy range bounce.
    if (
      breakout20.isBullishBreakout &&
      currentClose > ema20 &&
      ema20 > ema50 &&
      ema20Slope > 0.2 &&
      ema50Slope >= 0 &&
      currentRvol >= 1.5 &&           // Raised: need meaningful institutional volume
      rsiVal >= 55 &&                  // Raised: must already have momentum
      rsiVal <= 68 &&
      currentClose >= currentOpen &&
      clv >= 0.60 &&                   // Raised: strong close in upper part of range
      currentClose <= ema20 * 1.045 &&
      currentAdx >= 18                 // ADX trend confirmation (18+ = trend forming)
    ) {
      buySignal = true;
      strategyName = 'MOMENTUM_BREAKOUT';
      baseScore = 90;
      reason = `Fresh 20-day breakout with volume surge (${currentRvol.toFixed(1)}x RVOL, RSI: ${rsiVal.toFixed(1)}) in confirmed uptrend.`;
    }

    // --- Institutional Strategy 2: High-Quality Uptrend Support Pullback Bounce ---
    // Primary trend is strictly BULLISH (EMA20 > EMA50 and EMA50 sloping UP).
    // Price bounced off 20 EMA support with a strong green reversal candle and momentum recovery.
    // ADX >= 20 confirms we're in a trending environment, not a choppy range.
    else if (
      ema20 > ema50 &&
      ema50Slope >= 0 &&
      ema20Slope >= 0 &&
      currentClose >= ema20 * 0.988 && // Tighter: must be very close to EMA20 support
      currentClose <= ema20 * 1.025 && // Tighter: not more than 2.5% above EMA20
      currentClose > currentOpen &&
      currentClose > prevClose &&
      clv >= 0.60 &&                   // Raised: strong buying pressure
      rsiVal >= 45 &&                  // Raised: no oversold buys in downtrends
      rsiVal <= 58 &&
      rsiVal > prevRsiVal &&           // RSI must be recovering (not still falling)
      (histogram === null || prevHistogram === null || histogram > prevHistogram) &&
      currentAdx >= 18                 // Trending environment only
    ) {
      buySignal = true;
      strategyName = 'SUPPORT_PULLBACK';
      baseScore = 87;
      reason = `Bullish support bounce off 20 EMA in strong primary uptrend (RSI: ${rsiVal.toFixed(1)}, Green Reversal).`;
    }

    // --- Institutional Strategy 3: MACD Momentum Expansion in Aligned Trend ---
    // Bullish MACD crossover or expanding histogram above 20 & 50 EMA with constructive volume.
    else if (
      currentClose > ema20 &&
      ema20 > ema50 &&
      ema50Slope >= 0 &&
      macdLine !== null &&
      signalLine !== null &&
      macdLine > signalLine &&
      (prevMacdLine <= prevSignalLine || (histogram > 0 && prevHistogram !== null && histogram > prevHistogram)) &&
      rsiVal >= 52 &&                  // Raised: must show genuine momentum
      rsiVal <= 65 &&
      currentRvol >= 1.1 &&            // Raised: volume confirmation required
      currentClose >= currentOpen &&
      clv >= 0.55 &&
      currentClose <= ema20 * 1.04 &&
      currentAdx >= 18
    ) {
      buySignal = true;
      strategyName = 'MACD_EXPANSION';
      baseScore = 84;
      reason = `MACD bullish momentum expansion aligned with 20 & 50 EMA trend (RSI: ${rsiVal.toFixed(1)}).`;
    }

    // --- Strategy 4: EMA Trend Continuation (Steady Uptrend Rider) ---
    // Stock is in a confirmed uptrend (EMA20 > EMA50), holding above EMA20, RSI rising and healthy.
    // Now requires ADX >= 20 to ensure we are riding a real trend, not a dead-cat bounce.
    else if (
      ema20 > ema50 &&
      ema20Slope > 0.15 &&             // Raised: EMA must be meaningfully rising
      ema50Slope >= 0 &&
      currentClose > ema20 &&
      currentClose <= ema20 * 1.05 &&  // Tighter: max 5% above EMA20
      rsiVal >= 50 &&                  // Raised: must be in bullish momentum territory
      rsiVal <= 68 &&
      rsiVal > prevRsiVal &&
      currentClose >= currentOpen &&
      currentRvol >= 1.0 &&            // Raised: at least average volume
      currentAdx >= 20                 // Strong trend confirmation required
    ) {
      buySignal = true;
      strategyName = 'TREND_CONTINUATION';
      baseScore = 81;
      reason = `Steady uptrend continuation above 20 EMA (RSI: ${rsiVal.toFixed(1)}, RVOL: ${currentRvol.toFixed(1)}x).`;
    }

    // --- Strategy 5: Short-Term Momentum (Restricted to trending stocks only) ---
    // Requires EMA20 > EMA50 (no more buying in downtrends) AND ADX >= 20 (no sideways chop).
    // This prevents force-fill buys in sideways/declining markets that were causing most stop-losses.
    else if (
      ema20 > ema50 &&                            // MUST be in uptrend structure
      ema20Slope > 0.1 &&                         // EMA20 must be clearly rising
      currentClose > ema20 &&                     // Price above short-term average
      currentClose <= ema20 * 1.06 &&             // Not extended beyond 6% above EMA20
      rsiVal >= 50 && rsiVal <= 68 &&             // RSI in healthy bullish zone (raised floor)
      currentClose >= currentOpen &&              // Green candle
      currentRvol >= 0.85 &&                      // Reasonable volume
      currentAdx >= 18                            // Avoid sideways/choppy markets
    ) {
      buySignal = true;
      strategyName = 'SHORT_TERM_MOMENTUM';
      baseScore = 77;
      reason = `Short-term momentum: price above rising EMA20 (RSI: ${rsiVal.toFixed(1)}, RVOL: ${currentRvol.toFixed(1)}x).`;
    }

    if (buySignal) {

      // --- Multi-Factor Confluence Scoring Adjustments (0-100 scale) ---
      let score = baseScore;

      // 1. Institutional Volume Confirmation
      if (currentRvol >= 2.0) score += 6;
      else if (currentRvol >= 1.5) score += 4;
      else if (currentRvol >= 1.2) score += 2;
      else if (currentRvol < 0.9) score -= 6;  // More penalty for thin volume

      // 2. Trend Stacking Strength
      if (currentClose > ema20 && ema20 > ema50 && ema20Slope > 0.6) score += 4;
      if (ema50Slope > 0.4) score += 3;

      // 3. Candle Strength (Close location value)
      if (clv >= 0.75) score += 4;
      else if (clv < 0.50) score -= 4;  // Weak close = less conviction

      // 4. Proximity to 20 EMA Support (Reward-to-Risk Optimization)
      const distFromEma20 = (currentClose - ema20) / ema20;
      if (distFromEma20 >= 0.002 && distFromEma20 <= 0.020) {
        score += 6; // Ideal low-risk sweet spot — very close to EMA20 support
      } else if (distFromEma20 > 0.035 && distFromEma20 <= 0.05) {
        score -= 4; // Penalty for approaching overextended levels
      } else if (distFromEma20 > 0.05) {
        score -= 8; // Strong penalty — too far from support, poor R:R
      }

      // 5. ADX Trend Strength Bonus
      if (currentAdx >= 30) score += 5;      // Very strong trend
      else if (currentAdx >= 25) score += 3; // Strong trend
      else if (currentAdx < 18) score -= 6;  // Choppy market penalty

      // 6. Market Regime Confluence
      if (marketRegime.regime === 'BULLISH') {
        score += 3;
      } else if (marketRegime.regime === 'RISK_OFF') {
        score -= stock.sector === 'ETFs' ? 2 : 8; // Strong penalty in risk-off — only ETFs survive
      }

      // Clamp score between 50 and 100
      score = Math.max(50, Math.min(100, Math.round(score)));

      // Quality Threshold: 76 in normal markets (raised from 72 to prevent marginal trades),
      // 83 in RISK_OFF (only high-conviction institutional setups survive).
      const minScoreThreshold = marketRegime.regime === 'RISK_OFF' ? 83 : 76;
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
            sma20: sma20 || ema20,
            sma50: sma50 || ema50,
            ema20,
            ema50,
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

  // Track total deposited capital and monthly injection transitions
  let currentTotalDeposited = (state.valuationHistory && state.valuationHistory.length > 0)
    ? (state.valuationHistory[state.valuationHistory.length - 1].totalDeposited || 50000.0)
    : 50000.0;

  // Track month key (YYYY-MM) of last deposit to prevent duplicate deposits in the same month
  let lastDepositMonthKey = state.lastSimulationDate ? state.lastSimulationDate.slice(0, 7) : '2026-07';

  // We loop day-by-day through the new trading dates
  for (const simDate of tradingDates) {
    const todayTransactions = [];

    // --- 1. Monthly Deposit Check (Deposit automatically on 1st trading day of each new month) ---
    const currentMonthKey = simDate.slice(0, 7); // e.g. '2026-09'
    
    if (currentMonthKey !== lastDepositMonthKey) {
      const depositAmount = 50000.0;
      state.cash += depositAmount;
      currentTotalDeposited += depositAmount;
      lastDepositMonthKey = currentMonthKey;
      
      todayTransactions.push({
        type: 'DEPOSIT',
        amount: depositAmount,
        reason: 'Monthly Contribution (1st of Month)'
      });
      console.log(`[${simDate}] Deposited monthly ₹${depositAmount.toLocaleString('en-IN')}. Cash: ₹${state.cash.toFixed(2)}, Total Deposited: ₹${currentTotalDeposited.toFixed(2)}`);
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

      // --- Dynamic Trailing Stop-Loss Protection (Gentler Steps) ---
      // Let trades breathe fully to 6% before locking any profit.
      // Step 1 at 6%: lock only breakeven (0%) — keeps us from turning a winner into a loser.
      // Step 2 at 10%: lock +4% — reward is clearly materialising.
      // Step 3 at 15%: lock +9% — let the big runners run.
      const maxProfitGainPercent = ((high - position.buyPrice) / position.buyPrice) * 100;
      if (maxProfitGainPercent >= 6.0) {
        const trailingLevel = position.buyPrice * 1.000; // Lock in breakeven
        if (trailingLevel > position.stopLoss) {
          position.stopLoss = trailingLevel;
        }
      }
      if (maxProfitGainPercent >= 10.0) {
        const trailingLevel = position.buyPrice * 1.040; // Lock in +4%
        if (trailingLevel > position.stopLoss) {
          position.stopLoss = trailingLevel;
        }
      }
      if (maxProfitGainPercent >= 15.0) {
        const trailingLevel = position.buyPrice * 1.090; // Lock in +9%
        if (trailingLevel > position.stopLoss) {
          position.stopLoss = trailingLevel;
        }
      }

      // 1. Check Stop-Loss / Trailing Stop Trigger (Risk-First)
      if (low <= position.stopLoss) {
        triggerSell = true;
        sellPrice = position.stopLoss; // Executed at stop loss
        sellReason = position.stopLoss > position.buyPrice ? 'Trailing Stop Profit Locked' : 'Stop Loss Triggered';
      } 
      // 2. Check Target Profit Hit
      else if (high >= position.targetPrice) {
        triggerSell = true;
        sellPrice = position.targetPrice; // Executed at target price
        sellReason = 'Target Profit Hit';
      }
      // 3. Technical Indicator Take-Profit (Overbought Exhaustion)
      else {
        const dayIdx = stockData.findIndex(row => row.date === simDate);
        const buyIdx = stockData.findIndex(row => row.date === position.buyDate);
        const tradingDaysHeld = (buyIdx !== -1 && dayIdx !== -1) ? (dayIdx - buyIdx) : Math.round((new Date(simDate) - new Date(position.buyDate)) / (1000 * 60 * 60 * 24));
        const currentGainPct = ((close - position.buyPrice) / position.buyPrice) * 100;

        if (dayIdx >= 14) {
          const closesSoFar = stockData.slice(0, dayIdx + 1).map(r => r.close);
          const rsiArr = calculateRSI(closesSoFar, 14);
          const stockRsi = rsiArr[rsiArr.length - 1] || 50;

          if (currentGainPct >= 6.0 && stockRsi >= 78) {
            triggerSell = true;
            sellPrice = close;
            sellReason = `RSI Overbought Exhaustion (${stockRsi.toFixed(1)}) Profit Taken`;
          }
        }

        // 4. Stale Trade Exit (Time Stop): Release stagnant capital after 20+ trading days if underperforming.
        // Extended from 15 to 20 days — gives trades more time to develop momentum.
        // Threshold lowered from 3% to 2% — only exit if truly flat (not just slow).
        if (!triggerSell && tradingDaysHeld >= 20 && currentGainPct < 2.0) {
          triggerSell = true;
          sellPrice = close;
          sellReason = `Stale Trade Time Exit (${tradingDaysHeld} Days Flat)`;
        }
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
        
        console.log(`[${simDate}] SOLD ${position.symbol} @ ₹${sellPrice.toFixed(2)} (${sellReason}). P&L: ₹${profit.toFixed(2)} (${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`);
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

    // Helper: execute a buy and record transaction
    const executeBuy = (targetStock) => {
      let currentHoldingsValue = 0;
      for (const h of state.holdings) currentHoldingsValue += h.value;
      const totalPortfolioValue = state.cash + currentHoldingsValue;
      const minCashReserve = totalPortfolioValue * 0.05;
      if (state.cash <= minCashReserve) return false;

      const targetPositionSize = Math.max(5000, totalPortfolioValue * 0.08);
      const capitalAllocation = Math.min(targetPositionSize, state.cash * 0.60, state.cash - minCashReserve);
      const qty = Math.floor(capitalAllocation / targetStock.price);
      if (qty <= 0) return false;

      const cost = qty * targetStock.price;
      state.cash -= cost;
      const targetPrice = targetStock.price * (1 + state.config.targetProfitPercent);
      const stopLoss = targetStock.price * (1 - state.config.stopLossPercent);

      state.holdings.push({
        symbol: targetStock.symbol,
        name: targetStock.name,
        sector: targetStock.sector,
        quantity: qty,
        buyPrice: targetStock.price,
        currentPrice: targetStock.price,
        buyDate: simDate,
        targetPrice,
        stopLoss,
        value: cost,
        profit: 0.0,
        profitPercent: 0.0,
        buyReason: targetStock.reason,
        technicalStats: targetStock.technicalStats
      });

      todayTransactions.push({ type: 'BUY', symbol: targetStock.symbol, quantity: qty, price: targetStock.price, targetPrice, stopLoss, reason: targetStock.reason });
      console.log(`[${simDate}] BOUGHT ${qty}x ${targetStock.symbol} @ ₹${targetStock.price.toFixed(2)} (₹${cost.toFixed(0)} / Portfolio ₹${totalPortfolioValue.toFixed(0)}). SL: ₹${stopLoss.toFixed(2)}`);
      return true;
    };

    // --- Pass 1: Deploy cash to qualified scanner candidates ---
    for (const targetStock of candidates) {
      // Sector diversification: prevent more than 3 open positions in same sector (except ETFs)
      const currentSectorCount = state.holdings.filter(h => h.sector === targetStock.sector).length;
      if (targetStock.sector !== 'ETFs' && currentSectorCount >= 3) continue;

      const availableSlots = state.config.maxPositions - state.holdings.length;
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

          if (state.cash + revenue >= targetStock.price) {
            const cost = position.quantity * position.buyPrice;
            const profit = revenue - cost;
            const profitPercent = (profit / cost) * 100;
            state.cash += revenue;

            state.history.push({ symbol: position.symbol, name: position.name, sector: position.sector, quantity: position.quantity, buyPrice: position.buyPrice, sellPrice, buyDate: position.buyDate, sellDate: simDate, profit, profitPercent, reason: `Replaced by ${targetStock.symbol} (Score: ${targetStock.score.toFixed(1)})` });
            todayTransactions.push({ type: 'SELL', symbol: position.symbol, quantity: position.quantity, price: sellPrice, profit, profitPercent, reason: `Replaced by ${targetStock.symbol}` });
            console.log(`[${simDate}] ROTATION SELL: ${position.symbol} @ ₹${sellPrice} → ${targetStock.symbol}`);
            state.holdings.splice(worstHoldingIndex, 1);
            canBuy = true;
          }
        }
      }

      if (canBuy && state.cash >= 1000) {
        executeBuy(targetStock);
        if (state.holdings.length >= state.config.maxPositions) break;
      }
    }

    // --- Pass 2: Smart Cash Deployment — fires only when >40% cash is idle AND market is healthy ---
    // Raised threshold from 20% → 40% to avoid premature deployment into mediocre setups.
    // Added NIFTY trend gate: if NIFTYBEES.NS is below its own EMA20, the broad market is weak
    // and we should conserve cash rather than force-buying individual stocks.
    // Candidate quality bar is now 76 (same as organic strategy minimum), not 65.
    {
      let hv2 = 0; for (const h of state.holdings) hv2 += h.value;
      const portfolioVal2 = state.cash + hv2;
      const cashRatio = portfolioVal2 > 0 ? state.cash / portfolioVal2 : 0;

      // --- NIFTY Trend Gate ---
      let niftyAboveEma20 = true; // default allow if data unavailable
      const niftyData = cachedData['NIFTYBEES.NS'];
      if (niftyData && niftyData.length > 0) {
        const niftyDayIdx = niftyData.findIndex(row => row.date === simDate);
        if (niftyDayIdx >= 20) {
          const niftySub = niftyData.slice(0, niftyDayIdx + 1);
          const niftyClose = niftySub.map(r => r.close);
          const niftyEma20 = calculateEMA(niftyClose, 20);
          niftyAboveEma20 = niftyClose[niftyClose.length - 1] > niftyEma20[niftyEma20.length - 1];
        }
      }

      if (cashRatio > 0.40 && state.holdings.length < state.config.maxPositions && niftyAboveEma20) {
        // Build a force-deploy candidate list from ALL watchlist stocks not already held
        const heldSymbols = new Set(state.holdings.map(h => h.symbol));
        const forceCandidates = [];

        for (const stock of WATCHLIST) {
          if (heldSymbols.has(stock.symbol)) continue;
          // Sector cap still enforced at 3
          const secCount = state.holdings.filter(h => h.sector === stock.sector).length;
          if (stock.sector !== 'ETFs' && secCount >= 3) continue;

          const stockHistory = cachedData[stock.symbol];
          if (!stockHistory || stockHistory.length === 0) continue;
          const dayIdx = stockHistory.findIndex(row => row.date === simDate);
          if (dayIdx === -1 || dayIdx < 30) continue; // Need 30 bars for ADX

          const sub = stockHistory.slice(0, dayIdx + 1);
          const cls = sub.map(r => r.close);
          const hhs = sub.map(r => r.high);
          const lls = sub.map(r => r.low);
          const ops = sub.map(r => r.open !== undefined ? r.open : r.close);
          const vls = sub.map(r => r.volume || 0);

          const len2 = cls.length;
          const ema20Arr2 = calculateEMA(cls, 20);
          const ema50Arr2 = calculateEMA(cls, 50);
          const rsiArr2 = calculateRSI(cls, 14);
          const adxArr2 = calculateADX(hhs, lls, cls, 14);
          const ema20_2 = ema20Arr2[len2 - 1];
          const ema50_2 = ema50Arr2[len2 - 1];
          const rsi2 = rsiArr2[len2 - 1];
          const adx2 = adxArr2[len2 - 1] || 0;
          const close2 = cls[len2 - 1];
          const open2 = ops[len2 - 1];
          const rvols2 = calculateRVOL(vls, 20);
          const rvol2 = rvols2[len2 - 1] || 1.0;

          if (!ema20_2 || !rsi2) continue;

          // Force-deploy quality gate — now same bar as organic entries:
          // EMA20 > EMA50 uptrend, RSI 52-70, green candle, ADX >= 18 trending, not overextended.
          // Previously score floor was 65 (below the 76 organic threshold) — this was buying
          // stocks that the organic scanner had ALREADY REJECTED. Fixed.
          if (
            close2 > ema20_2 &&
            ema50_2 && ema20_2 > ema50_2 &&        // EMA20 > EMA50 = uptrend structure
            close2 <= ema20_2 * 1.06 &&             // Not overextended (>6% above EMA20 = bad R:R)
            rsi2 >= 52 && rsi2 <= 70 &&             // Raised floor to 52 — more selective
            close2 >= open2 &&                      // Green candle — momentum day
            rvol2 >= 0.9 &&                         // Decent volume participation
            adx2 >= 20                              // Meaningful trend strength
          ) {
            // Score 76–86: same floor as organic, bonus for proximity to EMA20
            const distScore = Math.max(0, 10 - ((close2 - ema20_2) / ema20_2) * 100);
            const forceScore = 76 + distScore;
            forceCandidates.push({
              ...stock,
              price: close2,
              score: forceScore,
              reason: `Force-deploy: above EMA20 (RSI ${rsi2.toFixed(1)})`,
              technicalStats: { rsi: rsi2, ema20: ema20_2, ema50: ema50_2 || ema20_2, rvol: rvol2, atr: 0, macdHist: 0 }
            });
          }
        }

        if (forceCandidates.length > 0) {
          // Sort by score (proximity to EMA20 preferred) and deploy
          forceCandidates.sort((a, b) => b.score - a.score);
          for (const fc of forceCandidates) {
            if (state.holdings.length >= state.config.maxPositions) break;
            let hv3 = 0; for (const h of state.holdings) hv3 += h.value;
            if (state.cash / (state.cash + hv3) <= 0.10) break; // keep 10% cash buffer
            if (!state.holdings.some(h => h.symbol === fc.symbol)) {
              executeBuy(fc);
            }
          }
          const hv4 = state.holdings.reduce((s, h) => s + h.value, 0);
          console.log(`[${simDate}] FORCE-DEPLOY: Cash ratio was ${(cashRatio * 100).toFixed(0)}% → now ${(state.cash / (state.cash + hv4) * 100).toFixed(0)}% (${state.holdings.length} positions)`);
        } else {
          console.log(`[${simDate}] FORCE-DEPLOY SKIPPED: Cash ${(cashRatio * 100).toFixed(0)}% idle but no quality candidates found — conserving cash.`);
        }
      } else if (cashRatio > 0.40 && !niftyAboveEma20) {
        console.log(`[${simDate}] FORCE-DEPLOY BLOCKED: Cash ${(cashRatio * 100).toFixed(0)}% idle but NIFTY is below EMA20 — market is weak, holding cash.`);
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
    const profitPercent = currentTotalDeposited > 0 ? ((totalValue - currentTotalDeposited) / currentTotalDeposited) * 100 : 0.0;

    // Append to valuation history
    state.valuationHistory.push({
      date: simDate,
      cash: state.cash,
      holdingsValue: holdingsValue,
      totalValue: totalValue,
      profitPercent: profitPercent,
      totalDeposited: currentTotalDeposited
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
      text: logText,
      details: {
        cash: state.cash,
        holdingsValue: holdingsValue,
        totalValue: totalValue,
        activePositions: state.holdings.length,
        transactions: todayTransactions.map(t => ({
          type: t.type,
          symbol: t.symbol ? t.symbol.replace('.NS', '') : null,
          quantity: t.quantity,
          price: t.price,
          targetPrice: t.targetPrice,
          stopLoss: t.stopLoss,
          profit: t.profit,
          profitPercent: t.profitPercent,
          reason: t.reason,
          amount: t.amount
        })),
        holdings: state.holdings.map(h => ({
          symbol: h.symbol.replace('.NS', ''),
          quantity: h.quantity,
          buyPrice: h.buyPrice,
          currentPrice: h.currentPrice,
          profitPercent: h.profitPercent,
          value: h.value
        }))
      }
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
      const ema20Array = calculateEMA(closes, 20);
      const ema50Array = calculateEMA(closes, 50);
      const sma20Array = calculateSMA(closes, 20);
      const sma50Array = calculateSMA(closes, 50);
      const rvolArray = calculateRVOL(volumes, 20);
      const breakout20 = checkBreakouts(closes, highs, lows, 20);

      const rsi = rsiArray[rsiArray.length - 1];
      const ema20 = ema20Array[ema20Array.length - 1];
      const ema50 = ema50Array[ema50Array.length - 1];
      const sma20 = sma20Array[sma20Array.length - 1];
      const sma50 = sma50Array[sma50Array.length - 1];
      const rvol = rvolArray[rvolArray.length - 1] || 1.0;

      // Intelligent Action recommendations based on technical setup & volume
      let recommendation = 'HOLD / WAIT';
      let recReason = 'Trend is consolidating, waiting for directional expansion.';

      if (todayBar.close > ema20 && ema20 > ema50 && breakout20.isBullishBreakout && rvol >= 1.2 && rsi >= 53 && rsi <= 68 && todayBar.close <= ema20 * 1.045) {
        recommendation = 'STRONG BUY';
        recReason = `Volume-backed 20-day high breakout (${rvol.toFixed(1)}x RVOL, RSI: ${rsi.toFixed(1)}) in confirmed uptrend.`;
      } else if (ema20 > ema50 && todayBar.close >= ema20 * 0.985 && todayBar.close <= ema20 * 1.03 && todayBar.close > yesterdayBar.close && rsi >= 43 && rsi <= 58) {
        recommendation = 'ACCUMULATE';
        recReason = `Bouncing off 20 EMA support in primary uptrend (RSI: ${rsi.toFixed(1)}).`;
      } else if (rsi > 72 || (ema20 && todayBar.close > ema20 * 1.08)) {
        recommendation = 'HOLD / REDUCE';
        recReason = 'Short-term overbought/extended, watch for trailing stop-loss trigger.';
      } else if (ema20 && ema50 && todayBar.close < ema20 && ema20 < ema50) {
        recommendation = 'AVOID';
        recReason = 'Asset in confirmed downtrend below 20 and 50 EMAs.';
      }

      result.push({
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector,
        price: todayBar.close,
        change,
        changePercent,
        rsi: rsi || 50,
        sma20: sma20 || ema20 || todayBar.close,
        sma50: sma50 || ema50 || todayBar.close,
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
    return { closedTrades: [], remainingHoldings: [] };
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

    // --- Trailing Stop-Loss Protection (synced with main engine steps) ---
    const maxProfitGainPercent = ((high - position.buyPrice) / position.buyPrice) * 100;
    if (maxProfitGainPercent >= 6.0) {
      const trailingLevel = position.buyPrice * 1.000; // Lock in breakeven
      if (trailingLevel > position.stopLoss) {
        position.stopLoss = trailingLevel;
      }
    }
    if (maxProfitGainPercent >= 10.0) {
      const trailingLevel = position.buyPrice * 1.040; // Lock in +4%
      if (trailingLevel > position.stopLoss) {
        position.stopLoss = trailingLevel;
      }
    }
    if (maxProfitGainPercent >= 15.0) {
      const trailingLevel = position.buyPrice * 1.090; // Lock in +9%
      if (trailingLevel > position.stopLoss) {
        position.stopLoss = trailingLevel;
      }
    }

    // Re-check using the stopLoss and targetPrice
    if (low <= position.stopLoss) {
      triggerSell = true;
      sellPrice = position.stopLoss;
      sellReason = position.stopLoss > position.buyPrice ? 'Trailing Stop Profit Locked' : 'Stop Loss Triggered';
    } else if (high >= position.targetPrice) {
      triggerSell = true;
      sellPrice = position.targetPrice;
      sellReason = 'Target Profit Hit';
    } else {
      const buyIdx = stockData.findIndex(row => row.date === position.buyDate);
      const currIdx = stockData.findIndex(row => row.date === simDate);
      const tradingDaysHeld = (buyIdx !== -1 && currIdx !== -1) ? (currIdx - buyIdx) : Math.round((new Date(simDate) - new Date(position.buyDate)) / (1000 * 60 * 60 * 24));
      const currentGainPct = ((close - position.buyPrice) / position.buyPrice) * 100;

      if (tradingDaysHeld >= 15 && currentGainPct < 3.0) {
        triggerSell = true;
        sellPrice = close;
        sellReason = `Stale Trade Time Exit (${tradingDaysHeld} Days Flat)`;
      }
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
      console.log(`[reEvaluate] SOLD ${position.symbol} @ ₹${sellPrice.toFixed(2)} — ${sellReason}. P&L: ₹${profit.toFixed(2)} (${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`);
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
    // Sector diversification check: maximum 3 positions per sector (except ETFs)
    const currentSectorCount = state.holdings.filter(h => h.sector === targetStock.sector).length;
    if (targetStock.sector !== 'ETFs' && currentSectorCount >= 3) {
      continue;
    }

    availableSlots = state.config.maxPositions - state.holdings.length;
    if (availableSlots <= 0 || state.cash < 1000) break;

    // Target 8% of total portfolio per position — 12 positions × 8% = 96% deployed.
    let currentHoldingsValue = 0;
    for (const h of state.holdings) currentHoldingsValue += h.value;
    const totalPortfolioValue = state.cash + currentHoldingsValue;
    const minCashReserve = totalPortfolioValue * 0.05;
    if (state.cash <= minCashReserve) break;
    const targetPositionSize = Math.max(5000, totalPortfolioValue * 0.08);
    const capitalAllocation = Math.min(targetPositionSize, state.cash * 0.60, state.cash - minCashReserve);
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
