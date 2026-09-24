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
const os = require('os');

const FALLBACK_WATCHLIST_FILE = path.join(__dirname, 'data', 'watchlist_fallback.json');

const DEFAULT_WATCHLIST = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries', sector: 'Energy & Conglomerate' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', sector: 'IT Services' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd', sector: 'Banking & Financials' },
  { symbol: 'INFY.NS', name: 'Infosys Ltd', sector: 'IT Services' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', sector: 'Banking & Financials' }
];

const WATCHLIST = [];
let inMemoryState = null;
let inMemoryMarketData = null; // In-memory runtime cache: { lastUpdated: String, watchlist: Array, data: Object }

function loadWatchlist() {
  // 1. Try from in-memory cache
  if (inMemoryMarketData?.watchlist?.length > 0) {
    WATCHLIST.length = 0;
    WATCHLIST.push(...inMemoryMarketData.watchlist);
    console.log(`Loaded ${WATCHLIST.length} assets from in-memory watchlist.`);
    return;
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
    targetProfitPercent: 0.25, // +25.0% baseline with dynamic uncapped trailing runner
    stopLossPercent: 0.075,    // -7.5% closing-basis wiggle room (eliminates intraday noise stopouts)
    maxPositions: 12,          // 12 positions to deploy capital more aggressively (~8% each)
    aggressiveness: 'aggressive', // conservative, moderate, aggressive, hyper
    rotationEnabled: false,     // Disabled to eliminate whipsaw churn on normal pullbacks
    rotationMinCandidateScore: 90, // High bar if rotation is manually turned on
    rotationMaxUnderperformerProfit: -4.5 // Only rotate if trade is broken beyond -4.5%
  }
};

// Load current state (directly from MongoDB with in-memory fallback)
async function loadState() {
  if (mongoose.connection.readyState === 1) {
    try {
      let doc = await StateModel.findOne({ key: 'simulation_state' });
      if (doc) {
        inMemoryState = doc.toObject();
        return inMemoryState;
      }
    } catch (e) {
      console.warn("MongoDB read failed:", e.message);
    }
  }
  
  if (inMemoryState) {
    return inMemoryState;
  }

  return await resetSimulation();
}

// Save state (directly to MongoDB with in-memory tracking)
async function saveState(state) {
  inMemoryState = { ...state };

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

// Fetch and Store Yahoo Finance Data via Python yfinance helper script into in-memory runtime cache
async function updateCache(endDateStr, forceRefresh = false) {
  const todayStr = formatUTCDate(new Date());

  // 1. Check in-memory market data first
  if (inMemoryMarketData && inMemoryMarketData.lastUpdated === todayStr && inMemoryMarketData.data && Object.keys(inMemoryMarketData.data).length > 0) {
    if (!forceRefresh) {
      return inMemoryMarketData.data;
    }
  }

  // If there is already an active fetch happening, wait for its completion to prevent race conditions
  if (activeUpdatePromise) {
    console.log("Waiting for concurrent market data update to finish...");
    return activeUpdatePromise;
  }

  // Create update promise and store it globally
  activeUpdatePromise = (async () => {
    console.log("Market data outdated or missing. Fetching live market data using Python yfinance script...");
    
    // Dynamically calculate start date (365 days lookback to ensure 50+ trading bars for technical indicators)
    const endD = new Date(endDateStr);
    const startD = new Date(endD.getTime() - (365 * 24 * 60 * 60 * 1000));
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
    const tempOutputFile = path.join(os.tmpdir(), `market_data_${Date.now()}.json`);

    try {
      // Execute Python yfinance batch script writing to OS temp file
      await new Promise((resolve, reject) => {
        exec(`${pythonBin} "${pythonScript}" "${startDateStr}" "${endDateStr}" "${tempOutputFile}"`, (error, stdout, stderr) => {
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

      if (!fs.existsSync(tempOutputFile)) {
        throw new Error("Python script finished but output was not generated.");
      }

      const rawPayload = fs.readFileSync(tempOutputFile, 'utf8');
      const payload = JSON.parse(rawPayload);

      // Clean up temp file immediately - no persistent disk dependency
      try {
        fs.unlinkSync(tempOutputFile);
      } catch (_) {}

      // Update in-memory storage
      inMemoryMarketData = payload;
      if (payload.watchlist && Array.isArray(payload.watchlist) && payload.watchlist.length > 0) {
        WATCHLIST.length = 0;
        WATCHLIST.push(...payload.watchlist);
      }
      console.log(`Loaded live market data for ${Object.keys(payload.data).length} symbols into server memory.`);

      return payload.data;
    } catch (err) {
      try {
        if (fs.existsSync(tempOutputFile)) fs.unlinkSync(tempOutputFile);
      } catch (_) {}
      throw err;
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
  const prevClose1 = closes[closes.length - 2] || currClose;
  const prevClose2 = closes[closes.length - 3] || prevClose1;
  const close5dAgo = closes[Math.max(0, closes.length - 6)];
  const close10dAgo = closes[Math.max(0, closes.length - 11)];
  const return5d = (currClose - close5dAgo) / close5dAgo;
  const return10d = (currClose - close10dAgo) / close10dAgo;

  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];
  const rsi = rsiArr[rsiArr.length - 1] || 50;

  // 1. Confirmed RISK_OFF: Only block new buys when market is in a genuine multi-week breakdown
  if ((ema20 && currClose < ema20 * 0.975) || return5d < -0.030 || return10d < -0.045 || (rsi < 36 && currClose < ema50)) {
    return { regime: 'RISK_OFF', benchmarkRsi: rsi, trend: 'DOWN', return5d };
  }

  // 2. Confirmed Bullish: Above 20 EMA with positive 5d return and healthy RSI
  if (ema20 && currClose > ema20 * 1.002 && return5d >= 0 && rsi >= 52) {
    return { regime: 'BULLISH', benchmarkRsi: rsi, trend: 'UP', return5d };
  }

  return { regime: 'NEUTRAL', benchmarkRsi: rsi, trend: 'CONSOLIDATING', return5d };
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
    // Exclude index ETFs: they are macro benchmarks for regime analysis, not individual swing stocks
    if (stock.sector === 'ETFs') continue;

    const existingHolding = currentHoldings.find(h => h.symbol === stock.symbol);
    let isAccumulationCandidate = false;

    if (existingHolding) {
      // --- Safe Pyramiding / Accumulation Guardrails ---
      // 1. Max 1 accumulation tranche per holding
      // 2. Minimum cushion: unrealized profit >= +8.0%
      // 3. Held for at least 4 trading days (prevents premature re-entry)
      const daysHeld = existingHolding.buyDate 
        ? Math.max(1, Math.round((new Date(simDate) - new Date(existingHolding.buyDate)) / (1000 * 60 * 60 * 24)))
        : 5;

      if (existingHolding.isAccumulated || (existingHolding.profitPercent || 0) < 8.0 || daysHeld < 4) {
        continue; // Cannot add to this holding
      }
      isAccumulationCandidate = true;
    }

    // Sector limit: max 3 positions per sector for new entries (except ETFs)
    if (!isAccumulationCandidate && stock.sector !== 'ETFs' && (sectorCounts[stock.sector] || 0) >= 3) {
      continue;
    }

    const stockHistory = cachedData[stock.symbol];
    if (!stockHistory || stockHistory.length === 0) continue;

    // Get index for current simulation date
    const dayIdx = stockHistory.findIndex(row => row.date === simDate);
    if (dayIdx === -1 || dayIdx < 14) continue; // Need at least 14 bars (RSI period)

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
    const currentAtr = atrArray[len - 1] || (currentClose * 0.025);
    const currentRvol = rvolArray[len - 1] || 1.0;
    const currentAdx = adxArray[len - 1] || 22; // Default to neutral trend strength if history is developing

    if (ema20 === null || rsiVal === null) continue;

    // Filter 1: Eliminate penny stocks (price must be at least ₹50)
    if (currentClose < 50) continue;

    // Filter 2: Reject Stage 4 Downtrends (20 EMA below 50 EMA with 50 EMA sloping down)
    if (ema50 && ema20 < ema50 && ema50Slope < 0) continue;

    // Filter 3: Relative Strength (RS) — reject negative momentum laggards
    const lookbackBars = Math.min(20, len - 1);
    const pastClose = closes[len - 1 - lookbackBars];
    const stockReturn20d = pastClose > 0 ? ((currentClose - pastClose) / pastClose) : 0;
    if (len >= 20 && stockReturn20d < -0.02) continue;

    // Filter 4: Reject already-extended stocks (chasing after big move)
    // If a stock has already run >12% in the last 10 days, the risk/reward is poor
    const lookback10d = Math.min(10, len - 1);
    const close10dAgoStock = closes[len - 1 - lookback10d];
    const stockReturn10d = close10dAgoStock > 0 ? ((currentClose - close10dAgoStock) / close10dAgoStock) : 0;
    if (len >= 10 && stockReturn10d > 0.12) continue; // Skip — already extended, high whipsaw risk

    // Candlestick Buying Pressure: Close Location Value (CLV)
    const candleRange = currentHigh - currentLow;
    const clv = candleRange > 0 ? (currentClose - currentLow) / candleRange : 0.5;

    const breakout20 = checkBreakouts(closes, highs, lows, 20);

    let buySignal = false;
    let baseScore = 0;
    let reason = '';
    let strategyName = '';

    // ----------------------------------------------------------------
    // STRATEGY 0: Pre-Breakout Base (VCP / Tight Consolidation)
    // Catches the stock BEFORE the 20-day breakout fires.
    // Criteria: Near 20d highs, contracting volatility, trend aligned.
    // This is the earliest, lowest-risk entry point.
    // ----------------------------------------------------------------
    const high20d = Math.max(...highs.slice(Math.max(0, len - 21), len - 1));
    const atrPrev5 = len >= 6 ? calculateATR(highs.slice(len-6, len), lows.slice(len-6, len), closes.slice(len-6, len), 5) : atrArray;
    const atrCurrent5 = (atrPrev5[atrPrev5.length - 1] || currentAtr);
    // ATR contraction: current 5-day ATR is shrinking vs 14-day ATR (low volatility base)
    const atrContraction = atrCurrent5 < currentAtr * 0.85;
    // Volume drying up during consolidation (confirming accumulation)
    const volumeDryUp = currentRvol < 1.0;
    // Price within 5% of 20d high (building a base near highs, not breaking out yet)
    const nearHighBase = currentClose >= high20d * 0.95 && currentClose < high20d * 1.002;

    if (
      !buySignal &&
      nearHighBase &&
      atrContraction &&
      volumeDryUp &&
      ema50 && ema20 > ema50 &&       // Uptrend confirmed: EMA stack aligned
      ema20Slope > 0 &&               // EMA20 still rising (not topping)
      rsiVal >= 50 && rsiVal <= 68 && // Momentum building but not overbought
      currentClose > ema20 * 1.00 &&  // Above EMA20 (uptrend)
      currentClose <= ema20 * 1.06 && // But not extended
      stockReturn10d <= 0.08 &&       // Did not run hard recently (not chasing)
      currentClose >= currentOpen     // Green day (no distribution)
    ) {
      buySignal = true;
      strategyName = 'PRE_BREAKOUT_BASE';
      baseScore = 88;
      reason = `Tight base forming near 20d highs with contracting volatility (ATR compression, RSI: ${rsiVal.toFixed(1)}). Early entry before breakout.`;
    }

    // ----------------------------------------------------------------
    // STRATEGY 1: Volume-Confirmed Breakout (TIGHTENED)
    // Only buy breakouts within 4% of EMA20 — prevents buying extended.
    // Reject if stock has already run >8% in 10 days (chasing).
    // ----------------------------------------------------------------
    else if (
      breakout20.isBullishBreakout &&
      currentClose > ema20 &&
      (ema20 > ema50 || currentRvol >= 1.5) && // Require stronger volume if EMA not stacked
      currentRvol >= 1.20 &&           // Raised from 1.10 — must have real volume surge
      rsiVal >= 50 && rsiVal <= 72 &&  // Tightened upper RSI: 72 (was 75) — avoid overbought breakouts
      currentClose >= currentOpen &&
      clv >= 0.55 &&                   // Raised from 0.50 — require stronger close within candle
      currentClose <= ema20 * 1.04 &&  // TIGHTENED: was 1.08 — now only buy within 4% of EMA20
      stockReturn10d <= 0.08           // Reject if already up 8%+ in 10 days (late entry)
    ) {
      buySignal = true;
      strategyName = 'MOMENTUM_BREAKOUT';
      baseScore = 90;
      reason = `Fresh 20-day breakout with volume surge (${currentRvol.toFixed(1)}x RVOL, RSI: ${rsiVal.toFixed(1)}) in confirmed uptrend.`;
    }

    // ----------------------------------------------------------------
    // STRATEGY 2: Support Pullback / 20 EMA Bounce (TIGHTENED)
    // Require: Stock was above EMA20 for 3+ of last 5 days (confirms it's
    // a genuine pullback to support, not a failed breakout)
    // ----------------------------------------------------------------
    else if (
      currentClose >= ema20 * 0.982 && // Tightened: was 0.980
      currentClose <= ema20 * 1.035 && // Tightened: was 1.040
      currentClose > currentOpen &&
      currentClose > prevClose &&
      currentRvol >= 0.90 &&           // Raised from 0.85 — require at least avg volume
      clv >= 0.55 &&                   // Raised from 0.50
      rsiVal >= 45 && rsiVal <= 68 &&  // Tightened: was 44-72
      (ema50 ? ema20 >= ema50 * 0.98 : true) &&
      // KEY: Confirm this is a pullback, not a breakdown
      // At least 3 of the last 5 closes must have been above EMA20 (confirmed uptrend)
      (() => {
        const ema20Prev = ema20Array.slice(len - 6, len - 1);
        const closesPrev5 = closes.slice(len - 6, len - 1);
        const daysAboveEma = ema20Prev.filter((e, i) => e !== null && closesPrev5[i] > e).length;
        return daysAboveEma >= 3;
      })()
    ) {
      buySignal = true;
      strategyName = 'SUPPORT_PULLBACK';
      baseScore = 86;
      reason = `Bullish support bounce off 20 EMA in strong primary uptrend (RSI: ${rsiVal.toFixed(1)}, Green Reversal).`;
    }

    // ----------------------------------------------------------------
    // STRATEGY 3: EMA20 Crossover Inception (Early Trend Turn)
    // Price crosses above EMA20 TODAY with volume — earliest trend signal.
    // This is already a good early-entry signal, tighten CLV slightly.
    // ----------------------------------------------------------------
    else if (
      currentClose > ema20 &&
      prevClose <= ema20 &&            // Crossover happened today
      currentClose > currentOpen &&
      currentRvol >= 1.25 &&           // Raised slightly: was 1.2
      rsiVal >= 48 && rsiVal <= 66 &&  // Tightened: was 50-68
      clv >= 0.58                      // Raised: was 0.55 — must close strongly in upper candle
    ) {
      buySignal = true;
      strategyName = 'TREND_INCEPTION';
      baseScore = 85;
      reason = `Price cross above 20 EMA with volume expansion (${currentRvol.toFixed(1)}x RVOL, RSI: ${rsiVal.toFixed(1)}).`;
    }

    // ----------------------------------------------------------------
    // STRATEGY 4: MACD Momentum Expansion (keep tightest filter)
    // Only valid when close is within 3% of EMA20 (no chasing)
    // ----------------------------------------------------------------
    else if (
      currentClose > ema20 &&
      (ema50 ? ema20 >= ema50 * 0.98 : true) &&
      macdLine !== null && signalLine !== null &&
      macdLine > signalLine &&
      (prevMacdLine <= prevSignalLine || (histogram > 0 && prevHistogram !== null && histogram > prevHistogram)) &&
      rsiVal >= 50 && rsiVal <= 66 &&
      currentRvol >= 1.1 &&
      currentClose >= currentOpen &&
      clv >= 0.55 &&
      currentClose <= ema20 * 1.03 &&  // Very tight: only within 3% of EMA20
      stockReturn10d <= 0.06           // Reject if already moved 6%+ in 10d
    ) {
      buySignal = true;
      strategyName = 'MACD_EXPANSION';
      baseScore = 82;
      reason = `MACD bullish momentum expansion aligned with 20 EMA trend (RSI: ${rsiVal.toFixed(1)}).`;
    }

    if (buySignal) {
      // --- Multi-Factor Confluence Scoring (0-100 scale) ---
      let score = baseScore;

      // 0. Relative Strength: Reward steady performers, penalize extended runners
      // We want stocks in early/mid rally, NOT stocks already extended
      if (stockReturn20d >= 0.06 && stockReturn20d <= 0.18) score += 5;  // Sweet spot: 6-18% 20d move
      else if (stockReturn20d >= 0.02 && stockReturn20d < 0.06) score += 3; // Just getting going
      else if (stockReturn20d > 0.18) score -= 4;  // Already ran hard — late entry penalty
      else if (stockReturn20d < -0.03) score -= 5; // Laggard

      // 0b. Short-term extension penalty: penalize stocks up >6% in last 10 days
      if (stockReturn10d > 0.06) score -= 4;
      if (stockReturn10d > 0.09) score -= 3; // Extra penalty if very extended

      // 1. Institutional Volume Confirmation
      if (currentRvol >= 2.0) score += 6;
      else if (currentRvol >= 1.5) score += 4;
      else if (currentRvol >= 1.2) score += 2;
      else if (currentRvol < 0.9) score -= 4;

      // 2. Trend Stacking Strength (price > EMA20 > EMA50, EMA20 rising)
      if (currentClose > ema20 && ema50 && ema20 > ema50 && ema20Slope > 0.3) score += 4;

      // 3. Candle Strength (close location value)
      if (clv >= 0.75) score += 4;
      else if (clv < 0.55) score -= 3;

      // 4. Proximity to EMA20 — reward entries close to support
      const distFromEma20 = (currentClose - ema20) / ema20;
      if (distFromEma20 >= 0.001 && distFromEma20 <= 0.03) {
        score += 6; // Excellent low-risk entry near EMA20
      } else if (distFromEma20 > 0.03 && distFromEma20 <= 0.05) {
        score -= 2; // Slightly extended
      } else if (distFromEma20 > 0.05) {
        score -= 8; // Too far from support — high whipsaw risk
      }

      // 5. ADX Trend Strength
      if (currentAdx >= 28) score += 4;
      else if (currentAdx < 16) score -= 4;

      // 6. Market Regime Confluence
      if (marketRegime.regime === 'BULLISH') {
        score += 3;
      } else if (marketRegime.regime === 'RISK_OFF') {
        score -= stock.sector === 'ETFs' ? 1 : 6;
      }

      score = Math.max(50, Math.min(100, Math.round(score)));

      // Accumulation candidates require elite confirmation (score >= 85 and RVOL >= 1.0)
      if (isAccumulationCandidate && (score < 85 || currentRvol < 1.0)) {
        continue;
      }

      const minScoreThreshold = isAccumulationCandidate 
        ? 83 
        : (marketRegime.regime === 'RISK_OFF' ? 88 : (marketRegime.regime === 'NEUTRAL' ? 80 : 72));

      if (score >= minScoreThreshold) {
        candidates.push({
          symbol: stock.symbol,
          name: stock.name,
          sector: stock.sector,
          price: currentClose,
          score: score,
          rsGain: stockReturn20d,
          reason: isAccumulationCandidate ? `[ACCUMULATE] Trend continuation in winning holding: ${reason}` : reason,
          strategy: strategyName,
          isAccumulation: isAccumulationCandidate,
          parentHolding: isAccumulationCandidate ? existingHolding : null,
          technicalStats: {
            rsi: rsiVal,
            sma20: sma20 || ema20,
            sma50: sma50 || ema50,
            ema20,
            ema50: ema50 || ema20,
            rvol: currentRvol,
            atr: currentAtr,
            macdHist: histogram || 0
          }
        });
      }
    }
  }

  // Sort descending by multi-factor score; break ties using Relative Strength (RS) momentum
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.rsGain || 0) - (a.rsGain || 0);
  });
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

      // --- Institutional Trend-Following Exit Engine ---
      const dayIdx = stockData.findIndex(row => row.date === simDate);
      const buyIdx = stockData.findIndex(row => row.date === position.buyDate);
      const tradingDaysHeld = (buyIdx !== -1 && dayIdx !== -1) ? (dayIdx - buyIdx) : Math.round((new Date(simDate) - new Date(position.buyDate)) / (1000 * 60 * 60 * 24));
      const currentGainPct = ((close - position.buyPrice) / position.buyPrice) * 100;
      const maxProfitGainPercent = ((high - position.buyPrice) / position.buyPrice) * 100;

      // Calculate stock 20-day EMA and RSI for trailing runner support
      let dayEma20 = null;
      let stockRsi = 50;
      if (dayIdx >= 10) {
        const closesSoFar = stockData.slice(0, dayIdx + 1).map(r => r.close);
        const ema20Arr = calculateEMA(closesSoFar, 20);
        dayEma20 = ema20Arr[ema20Arr.length - 1];
        const rsiArr = calculateRSI(closesSoFar, 14);
        stockRsi = rsiArr[rsiArr.length - 1] || 50;
      }

      // Dynamic Profit Protection (Uncapped Upside — let winners RUN like Coforge +20%):
      // Step 1: At +10% peak gain, move stop loss to Breakeven (+0.5% buffer)
      if (maxProfitGainPercent >= 10.0) {
        const beLevel = position.buyPrice * 1.005;
        if (beLevel > position.stopLoss) position.stopLoss = beLevel;
      }

      // Step 2: At +15% gain, lock in +8% minimum profit
      if (maxProfitGainPercent >= 15.0) {
        const lockProfit = position.buyPrice * 1.080;
        if (lockProfit > position.stopLoss) position.stopLoss = lockProfit;
      }

      // Step 3: At +20% gain, lock in +13% minimum profit
      if (maxProfitGainPercent >= 20.0) {
        const lockProfit2 = position.buyPrice * 1.130;
        if (lockProfit2 > position.stopLoss) position.stopLoss = lockProfit2;
      }

      // Step 4: At +25% gain, lock in +18% minimum profit
      if (maxProfitGainPercent >= 25.0) {
        const lockProfit3 = position.buyPrice * 1.180;
        if (lockProfit3 > position.stopLoss) position.stopLoss = lockProfit3;
      }

      // Step 5: At +30% gain, activate RUNNER MODE (trail 20 EMA closely or lock +23%)
      if (maxProfitGainPercent >= 30.0 && dayEma20) {
        const runnerTrail = Math.max(position.buyPrice * 1.230, dayEma20 * 0.985);
        if (runnerTrail > position.stopLoss) position.stopLoss = runnerTrail;
      }

      // 1. Check Stop-Loss / Trailing Stop Trigger
      const isTrailingStop = position.stopLoss > position.buyPrice;
      const initialStopBreach = close <= position.stopLoss || low <= position.stopLoss * 0.94;
      const trailingStopBreach = close <= position.stopLoss || low <= position.stopLoss * 0.98;

      if (isTrailingStop ? trailingStopBreach : initialStopBreach) {
        triggerSell = true;
        // In realistic execution, trailing stop triggers at the stop loss level, not penalizing to day's close
        sellPrice = isTrailingStop 
          ? (dayBar.open && dayBar.open < position.stopLoss ? dayBar.open : position.stopLoss)
          : Math.min(close, position.stopLoss);
        sellReason = isTrailingStop ? 'Trailing Profit Locked' : 'Stop Loss Triggered';
      }
      // 2. Stagnation / Time Stop:
      // Give healthy consolidation bases room to develop: Require at least 22 trading days (~1 month)
      // and must be down at least -3.5% AND below 20 EMA by > 1.5%
      else if (tradingDaysHeld >= 22 && currentGainPct < -3.5 && dayEma20 && close < dayEma20 * 0.985) {
        triggerSell = true;
        sellPrice = close;
        sellReason = `Stagnation Time-Stop (${tradingDaysHeld}d held, ${currentGainPct.toFixed(1)}%)`;
      }
      // 3. Parabolic Climax Blow-Off Exit
      else if (currentGainPct >= 20.0 && stockRsi >= 82 && dayEma20 && close > dayEma20 * 1.12) {
        triggerSell = true;
        sellPrice = close;
        sellReason = `Parabolic Climax Blow-Off (${stockRsi.toFixed(1)} RSI, +${currentGainPct.toFixed(1)}%) Profit Taken`;
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
          reason: sellReason,
          accumulated: position.isAccumulated || false
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

    // Helper: execute a buy or accumulation and record transaction
    const executeBuy = (targetStock) => {
      let currentHoldingsValue = 0;
      for (const h of state.holdings) currentHoldingsValue += h.value;
      const totalPortfolioValue = state.cash + currentHoldingsValue;
      const minCashReserve = totalPortfolioValue * 0.05;
      if (state.cash <= minCashReserve) return false;

      // --- BRANCH A: SAFE POSITION ACCUMULATION / PYRAMIDING ---
      if (targetStock.isAccumulation) {
        const parent = state.holdings.find(h => h.symbol === targetStock.symbol);
        if (!parent || parent.isAccumulated) return false;

        // Guardrail 1: Inverted Triangle Sizing (max 50% of parent quantity, max 6% of portfolio)
        const maxAddQtyByParent = Math.max(1, Math.floor(parent.quantity * 0.5));
        const maxCapitalForAdd = Math.min(totalPortfolioValue * 0.06, state.cash - minCashReserve);
        const maxAddQtyByCap = Math.floor(maxCapitalForAdd / targetStock.price);

        let qty = Math.min(maxAddQtyByParent, maxAddQtyByCap);
        if (qty <= 0 && parent.quantity === 1 && state.cash >= targetStock.price + minCashReserve) {
          if ((parent.value + targetStock.price) <= totalPortfolioValue * 0.20) {
            qty = 1;
          }
        }
        if (qty <= 0) return false;

        const addCost = qty * targetStock.price;
        if ((parent.value + addCost) > totalPortfolioValue * 0.20) return false;

        const totalNewQty = parent.quantity + qty;
        const oldCostBasis = parent.quantity * parent.buyPrice;
        const totalCostBasis = oldCostBasis + addCost;
        const blendedBuyPrice = totalCostBasis / totalNewQty;

        // Guardrail 2: Combined Zero-Loss Guarantee
        // Combined stop loss MUST ensure that if hit, total trade exits at or above breakeven (+0.5% profit cushion)
        const guaranteedBreakevenStop = blendedBuyPrice * 1.005;
        const existingStopCapped = parent.stopLoss ? Math.min(parent.stopLoss, targetStock.price * 0.94) : 0;
        const newStopLoss = Math.max(guaranteedBreakevenStop, existingStopCapped);

        state.cash -= addCost;
        parent.quantity = totalNewQty;
        parent.buyPrice = blendedBuyPrice;
        parent.currentPrice = targetStock.price;
        parent.value = totalNewQty * targetStock.price;
        parent.profit = parent.value - totalCostBasis;
        parent.profitPercent = (parent.profit / totalCostBasis) * 100;
        parent.stopLoss = newStopLoss;
        parent.isAccumulated = true;
        parent.accumulatedDate = simDate;
        parent.accumulatedQty = qty;
        parent.accumulatedPrice = targetStock.price;

        todayTransactions.push({
          type: 'ACCUMULATE',
          symbol: targetStock.symbol,
          quantity: qty,
          price: targetStock.price,
          blendedBuyPrice,
          stopLoss: newStopLoss,
          reason: targetStock.reason
        });

        console.log(`[${simDate}] [ACCUMULATED] +${qty}x ${targetStock.symbol} @ ₹${targetStock.price.toFixed(2)}. Total: ${totalNewQty} shares, Blended Entry: ₹${blendedBuyPrice.toFixed(2)}, Guaranteed SL: ₹${newStopLoss.toFixed(2)} (Net Zero-Loss Protected)`);
        return true;
      }

      // --- BRANCH B: NEW POSITION PURCHASE ---
      const availableSlots = Math.max(1, state.config.maxPositions - state.holdings.length);
      // Smart dynamic position sizing: allocate capital proportionally across remaining slots
      // Target ~8% to 12% of portfolio per position, ensuring all 12 slots can be filled
      const targetPositionSize = Math.max(5000, Math.min(totalPortfolioValue * 0.125, (state.cash - minCashReserve) / availableSlots));
      const minAllocationFloor = Math.min(4500, totalPortfolioValue * 0.04);
      if (state.cash < minAllocationFloor + minCashReserve) return false;

      const capitalAllocation = Math.min(targetPositionSize, state.cash - minCashReserve);
      let qty = Math.floor(capitalAllocation / targetStock.price);

      // High-priced momentum compounders (e.g. Bosch Ltd., Bajaj Auto):
      // Allow buying 1 share if cash is sufficient (preserving min reserve) and price <= 35% of portfolio
      if (qty <= 0 && state.cash >= targetStock.price + minCashReserve && targetStock.price <= totalPortfolioValue * 0.35) {
        qty = 1;
      }
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
    let currentHoldingsValue = 0;
    for (const h of state.holdings) currentHoldingsValue += h.value;
    const totalPortVal = state.cash + currentHoldingsValue;
    const cashRatio = totalPortVal > 0 ? (state.cash / totalPortVal) : 1;
    // When cash is excessively liquid (>25% of portfolio), allow up to 3-4 buys per day to deploy capital
    const maxBuysToday = cashRatio > 0.35 ? 4 : (cashRatio > 0.20 ? 3 : 2);
    let todayBuysCount = 0;

    for (const targetStock of candidates) {
      if (todayBuysCount >= maxBuysToday) break;

      const isAccumulation = targetStock.isAccumulation;

      // Sector diversification: max 3 positions per sector (skip check if accumulating)
      if (!isAccumulation) {
        const currentSectorCount = state.holdings.filter(h => h.sector === targetStock.sector).length;
        if (targetStock.sector !== 'ETFs' && currentSectorCount >= 3) continue;
      }

      // Broad Market Regime Gate:
      // In RISK_OFF: Only buy elite relative-strength leaders (score 90+ with confirmed 20d momentum or pre-breakout base)
      if (marketRegime.regime === 'RISK_OFF') {
        const isElite = targetStock.score >= 90 && ((targetStock.rsGain || 0) >= 0.04 || targetStock.strategy === 'PRE_BREAKOUT_BASE');
        if (!isElite) continue;
      }
      // In NEUTRAL: Allow good setups (score >= 76)
      if (!isAccumulation && marketRegime.regime === 'NEUTRAL' && targetStock.score < 76 && (targetStock.rsGain || 0) < 0.02) {
        continue;
      }

      const availableSlots = state.config.maxPositions - state.holdings.length;
      let canBuy = isAccumulation ? (state.cash >= 1000) : (availableSlots > 0 && state.cash >= 1000);

      const rotationEnabled = state.config.rotationEnabled !== false;
      const minCandScore = state.config.rotationMinCandidateScore || 85;
      const maxUnderperformerProfit = state.config.rotationMaxUnderperformerProfit || -2.0;

      // If rotation is enabled and we cannot buy normally, check for underperformer swap (only for new positions)
      if (!isAccumulation && rotationEnabled && (!canBuy || state.cash < targetStock.price) && targetStock.score >= minCandScore && state.holdings.length > 0) {
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
        if (executeBuy(targetStock)) {
          todayBuysCount++;
        }
        if (todayBuysCount >= maxBuysToday) break;
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

    // --- Institutional Trend-Following Exit Engine (Synced with Simulation) ---
    const buyIdx = stockData.findIndex(row => row.date === position.buyDate);
    const currIdx = stockData.findIndex(row => row.date === simDate);
    const tradingDaysHeld = (buyIdx !== -1 && currIdx !== -1) ? (currIdx - buyIdx) : Math.round((new Date(simDate) - new Date(position.buyDate)) / (1000 * 60 * 60 * 24));
    const currentGainPct = ((close - position.buyPrice) / position.buyPrice) * 100;
    const maxProfitGainPercent = ((high - position.buyPrice) / position.buyPrice) * 100;

    let dayEma20 = null;
    let stockRsi = 50;
    if (currIdx >= 10) {
      const closesSoFar = stockData.slice(0, currIdx + 1).map(r => r.close);
      const ema20Arr = calculateEMA(closesSoFar, 20);
      dayEma20 = ema20Arr[ema20Arr.length - 1];
      const rsiArr = calculateRSI(closesSoFar, 14);
      stockRsi = rsiArr[rsiArr.length - 1] || 50;
    }

    // Dynamic Profit Protection (Uncapped Upside):
    // Step 1: At +5.0% peak gain, move stop loss to Breakeven (+0.5% buffer)
    if (maxProfitGainPercent >= 5.0) {
      const beLevel = position.buyPrice * 1.005;
      if (beLevel > position.stopLoss) position.stopLoss = beLevel;
    }

    // Step 2: At +8.0% gain, lock in +5.0% minimum profit
    if (maxProfitGainPercent >= 8.0) {
      const lockProfit = position.buyPrice * 1.050;
      if (lockProfit > position.stopLoss) position.stopLoss = lockProfit;
    }

    // Step 3: At +10.5% gain, lock in +8.0% minimum profit
    if (maxProfitGainPercent >= 10.5) {
      const lockProfit2 = position.buyPrice * 1.080;
      if (lockProfit2 > position.stopLoss) position.stopLoss = lockProfit2;
    }

    // Step 4: At +13.0% gain, lock in +10.5% minimum profit
    if (maxProfitGainPercent >= 13.0) {
      const lockProfit3 = position.buyPrice * 1.105;
      if (lockProfit3 > position.stopLoss) position.stopLoss = lockProfit3;
    }

    // Step 5: At +15.0% gain, activate RUNNER MODE (trail 20 EMA or lock +12.5%)
    if (maxProfitGainPercent >= 15.0 && dayEma20) {
      const runnerTrail = Math.max(position.buyPrice * 1.125, dayEma20 * 0.985);
      if (runnerTrail > position.stopLoss) position.stopLoss = runnerTrail;
    }

    // Check Stop-Loss / Trailing Stop Trigger
    const isTrailingStop = position.stopLoss > position.buyPrice;
    const initialStopBreach = close <= position.stopLoss || low <= position.stopLoss * 0.94;
    const trailingStopBreach = close <= position.stopLoss || low <= position.stopLoss * 0.98;

    if (isTrailingStop ? trailingStopBreach : initialStopBreach) {
      triggerSell = true;
      sellPrice = isTrailingStop 
        ? (dayBar.open && dayBar.open < position.stopLoss ? dayBar.open : position.stopLoss)
        : Math.min(close, position.stopLoss);
      sellReason = isTrailingStop ? 'Trailing Profit Locked' : 'Stop Loss Triggered';
    }
    // Stagnation / Time Stop
    else if (tradingDaysHeld >= 22 && currentGainPct < -3.5 && dayEma20 && close < dayEma20 * 0.985) {
      triggerSell = true;
      sellPrice = close;
      sellReason = `Stagnation Time-Stop (${tradingDaysHeld}d held, ${currentGainPct.toFixed(1)}%)`;
    }
    // Parabolic Climax Blow-Off Exit
    else if (currentGainPct >= 20.0 && stockRsi >= 82 && dayEma20 && close > dayEma20 * 1.12) {
      triggerSell = true;
      sellPrice = close;
      sellReason = `Parabolic Climax Blow-Off (${stockRsi.toFixed(1)} RSI, +${currentGainPct.toFixed(1)}%) Profit Taken`;
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
        reason: `${sellReason} (Config Re-evaluation)`,
        accumulated: position.isAccumulated || false
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
  
  const hasAccumulationCandidate = state.holdings.some(h => !h.isAccumulated && (h.profitPercent || 0) >= 8.0);
  let availableSlots = state.config.maxPositions - state.holdings.length;
  if ((availableSlots <= 0 && !hasAccumulationCandidate) || state.cash < 1000) {
    return state;
  }

  const { candidates, marketRegime } = scanMarketCandidates(targetDate, cachedData, state.holdings, state.config);

  const maxDeployBuys = 4;
  let newBuysCount = 0;
  for (const targetStock of candidates) {
    if (newBuysCount >= maxDeployBuys) break;
    if (targetStock.sector === 'ETFs') continue;

    const isAccumulation = targetStock.isAccumulation;

    if (marketRegime && marketRegime.regime === 'RISK_OFF') {
      const isElite = targetStock.score >= 90 && ((targetStock.rsGain || 0) >= 0.04 || targetStock.strategy === 'PRE_BREAKOUT_BASE');
      if (!isElite) continue;
    } else if (!isAccumulation && marketRegime && marketRegime.regime === 'NEUTRAL' && targetStock.score < 76 && (targetStock.rsGain || 0) < 0.02) {
      continue;
    }

    // Sector diversification check: maximum 3 positions per sector (except ETFs)
    if (!isAccumulation) {
      const currentSectorCount = state.holdings.filter(h => h.sector === targetStock.sector).length;
      if (currentSectorCount >= 3) {
        continue;
      }
    }

    availableSlots = state.config.maxPositions - state.holdings.length;
    if (!isAccumulation && (availableSlots <= 0 || state.cash < 1000)) continue;

    let currentHoldingsValue = 0;
    for (const h of state.holdings) currentHoldingsValue += h.value;
    const totalPortfolioValue = state.cash + currentHoldingsValue;
    const minCashReserve = totalPortfolioValue * 0.05;
    if (state.cash <= minCashReserve) break;

    // --- ACCUMULATION BRANCH ---
    if (isAccumulation) {
      const parent = state.holdings.find(h => h.symbol === targetStock.symbol);
      if (!parent || parent.isAccumulated) continue;

      const maxAddQtyByParent = Math.max(1, Math.floor(parent.quantity * 0.5));
      const maxCapitalForAdd = Math.min(totalPortfolioValue * 0.06, state.cash - minCashReserve);
      const maxAddQtyByCap = Math.floor(maxCapitalForAdd / targetStock.price);

      let qty = Math.min(maxAddQtyByParent, maxAddQtyByCap);
      if (qty <= 0 && parent.quantity === 1 && state.cash >= targetStock.price + minCashReserve) {
        if ((parent.value + targetStock.price) <= totalPortfolioValue * 0.20) {
          qty = 1;
        }
      }
      if (qty <= 0) continue;

      const addCost = qty * targetStock.price;
      if ((parent.value + addCost) > totalPortfolioValue * 0.20) continue;

      const totalNewQty = parent.quantity + qty;
      const oldCostBasis = parent.quantity * parent.buyPrice;
      const totalCostBasis = oldCostBasis + addCost;
      const blendedBuyPrice = totalCostBasis / totalNewQty;

      const guaranteedBreakevenStop = blendedBuyPrice * 1.005;
      const existingStopCapped = parent.stopLoss ? Math.min(parent.stopLoss, targetStock.price * 0.94) : 0;
      const newStopLoss = Math.max(guaranteedBreakevenStop, existingStopCapped);

      state.cash -= addCost;
      parent.quantity = totalNewQty;
      parent.buyPrice = blendedBuyPrice;
      parent.currentPrice = targetStock.price;
      parent.value = totalNewQty * targetStock.price;
      parent.profit = parent.value - totalCostBasis;
      parent.profitPercent = (parent.profit / totalCostBasis) * 100;
      parent.stopLoss = newStopLoss;
      parent.isAccumulated = true;
      parent.accumulatedDate = targetDate;
      parent.accumulatedQty = qty;
      parent.accumulatedPrice = targetStock.price;

      newBuysCount++;
      console.log(`[deployIdleCash] [ACCUMULATED] +${qty} shares of ${targetStock.symbol} @ ₹${targetStock.price}. Blended Entry: ₹${blendedBuyPrice.toFixed(2)}, Guaranteed SL: ₹${newStopLoss.toFixed(2)}`);
      continue;
    }

    // --- NEW POSITION BRANCH ---
    const targetPositionSize = Math.max(5000, Math.min(totalPortfolioValue * 0.125, (state.cash - minCashReserve) / availableSlots));
    const capitalAllocation = Math.min(targetPositionSize, state.cash - minCashReserve);
    let qty = Math.floor(capitalAllocation / targetStock.price);

    // High-priced momentum compounders:
    if (qty <= 0 && state.cash >= targetStock.price + minCashReserve && targetStock.price <= totalPortfolioValue * 0.35) {
      qty = 1;
    }

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
      if (newBuysCount >= maxDeployBuys) break;
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
