const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { calculateSMA, calculateRSI, calculateMACD, checkBreakouts } = require('./utils/indicators');

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
    targetProfitPercent: 0.15, // +15% target
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
function loadState() {
  ensureDirectories();
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      console.error("Error reading state file, resetting...", e);
      return resetSimulation();
    }
  } else {
    return resetSimulation();
  }
}

// Save state
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// Reset state
function resetSimulation() {
  ensureDirectories();
  const state = JSON.parse(JSON.stringify(INITIAL_STATE));
  saveState(state);
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
async function updateCache(endDateStr) {
  ensureDirectories();
  
  const todayStr = formatUTCDate(new Date());
  
  // Check if cache file exists and was updated today
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (cache.lastUpdated === todayStr && Object.keys(cache.data).length > 0) {
        console.log("Using cached market data.");
        return cache.data;
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
    
    const startDateStr = '2026-05-01';
    const pythonScript = path.join(__dirname, 'fetch_data.py');
    
    // Execute Python yfinance batch script in a promise
    await new Promise((resolve, reject) => {
      exec(`python3 "${pythonScript}" "${startDateStr}" "${endDateStr}" "${CACHE_FILE}"`, (error, stdout, stderr) => {
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

// Core Simulation Function
async function runSimulation(targetEndDateStr) {
  const state = loadState();
  const cachedData = await updateCache(targetEndDateStr);

  const lastRunDateStr = state.lastSimulationDate;
  if (lastRunDateStr >= targetEndDateStr) {
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
    const candidates = [];

    for (const stock of WATCHLIST) {
      // Avoid buying what we already hold
      if (state.holdings.some(h => h.symbol === stock.symbol)) continue;

      const stockHistory = cachedData[stock.symbol];
      if (!stockHistory || stockHistory.length === 0) continue;

      // Get index for current simulation date
      const dayIdx = stockHistory.findIndex(row => row.date === simDate);
      if (dayIdx === -1 || dayIdx < 50) continue; // Need at least 50 bars of history to run indicators

      const subHistory = stockHistory.slice(0, dayIdx + 1);
      const closes = subHistory.map(row => row.close);
      const highs = subHistory.map(row => row.high);
      const lows = subHistory.map(row => row.low);

      const currentClose = closes[closes.length - 1];

      // Compute indicators
      const sma20Array = calculateSMA(closes, 20);
      const sma50Array = calculateSMA(closes, 50);
      const rsiArray = calculateRSI(closes, 14);
      const macdResult = calculateMACD(closes);

      const sma20 = sma20Array[sma20Array.length - 1];
      const sma50 = sma50Array[sma50Array.length - 1];
      const rsiVal = rsiArray[rsiArray.length - 1];
      const macdLine = macdResult.macdLine[macdResult.macdLine.length - 1];
      const signalLine = macdResult.signalLine[macdResult.signalLine.length - 1];
      const histogram = macdResult.histogram[macdResult.histogram.length - 1];
      
      const breakout = checkBreakouts(closes, highs, lows, 10);

      if (sma20 === null || sma50 === null || rsiVal === null) continue;

      let buySignal = false;
      let score = 0;
      let reason = '';

      // Technical Strategies:
      
      // 1. Momentum Breakout
      if (currentClose > sma20 && sma20 > sma50 && rsiVal >= 52 && rsiVal <= 68 && breakout.isBullishBreakout) {
        buySignal = true;
        score = 90 + (rsiVal - 50); // Higher score for strong but not overbought RSI
        reason = `Bullish 10-day price breakout on solid momentum (RSI = ${rsiVal.toFixed(1)}).`;
      }
      // 2. Oversold Rebound
      else if (rsiVal < 38 && currentClose > lows[lows.length - 2] && currentClose >= sma50 * 0.98) {
        // RSI is oversold, price holds above 50 SMA (medium-term support) and shows a green reversal bar
        buySignal = true;
        score = 80 + (40 - rsiVal);
        reason = `Oversold dip recovery (RSI = ${rsiVal.toFixed(1)}) near support.`;
      }
      // 3. MACD Golden Cross
      else if (macdLine > signalLine && macdResult.macdLine[macdResult.macdLine.length - 2] <= macdResult.signalLine[macdResult.signalLine.length - 2] && rsiVal > 48 && currentClose > sma20) {
        buySignal = true;
        score = 75;
        reason = `MACD bullish crossover confirmed above the 20-day SMA.`;
      }

      if (buySignal) {
        candidates.push({
          symbol: stock.symbol,
          name: stock.name,
          sector: stock.sector,
          price: currentClose,
          score: score,
          reason: reason,
          technicalStats: {
            rsi: rsiVal,
            sma20,
            sma50,
            macdHist: histogram || 0
          }
        });
      }
    }

    // Sort candidates by technical setup score
    candidates.sort((a, b) => b.score - a.score);

    // Deploy cash to top candidates
    for (const targetStock of candidates) {
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

  saveState(state);
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

      // Extract closes to calculate indicators for scanner details
      const closes = history.map(r => r.close);
      const rsiArray = calculateRSI(closes, 14);
      const sma20Array = calculateSMA(closes, 20);
      const sma50Array = calculateSMA(closes, 50);

      const rsi = rsiArray[rsiArray.length - 1];
      const sma20 = sma20Array[sma20Array.length - 1];
      const sma50 = sma50Array[sma50Array.length - 1];

      // Action recommendations based on technical setup
      let recommendation = 'HOLD / WAIT';
      let recReason = 'Trend is consolidating, no active trigger.';

      if (todayBar.close > sma20 && sma20 > sma50 && rsi >= 50 && rsi <= 68) {
        recommendation = 'STRONG BUY';
        recReason = 'Bullish momentum breakout with strong SMA support.';
      } else if (rsi < 35) {
        recommendation = 'ACCUMULATE';
        recReason = 'Stock is in oversold region, ideal for swing entry.';
      } else if (rsi > 72) {
        recommendation = 'HOLD / REDUCE';
        recReason = 'Short term overbought, potential trailing stop-loss trigger.';
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
        recommendation: 'WAIT',
        recReason: 'Loading market data...',
        history: []
      });
    }
  }

  return result;
}

module.exports = {
  WATCHLIST,
  loadState,
  saveState,
  resetSimulation,
  runSimulation,
  getWatchlistQuotes
};
