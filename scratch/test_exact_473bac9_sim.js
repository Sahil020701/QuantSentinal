const fs = require('fs');
const path = require('path');
const {
  calculateEMA, calculateSMA, calculateRSI, calculateATR, calculateADX, calculateSlope
} = require('../backend/utils/indicators');

const rawData = fs.readFileSync(path.join(__dirname, '../backend/data/market_data_5y.json'), 'utf8');
const cachedData = JSON.parse(rawData);
const watchlist = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/data/watchlist_fallback.json'), 'utf8'));

function checkBreakouts(closes, highs, lows, lookback = 20) {
  const len = closes.length;
  if (len < lookback + 1) return { isBullishBreakout: false, highestHigh20: 0 };
  const currentClose = closes[len - 1];
  const priorHighs = highs.slice(Math.max(0, len - 1 - lookback), len - 1);
  const highestPriorHigh = Math.max(...priorHighs);
  return { isBullishBreakout: currentClose > highestPriorHigh, highestHigh20: highestPriorHigh };
}

// EXACT 473bac9 evaluateMarketRegime
function evaluateMarketRegime(simDate, cachedData) {
  const benchmarkData = cachedData['^NSEI'] || cachedData['NIFTYBEES.NS'] || cachedData['RELIANCE.NS'];
  if (!benchmarkData || benchmarkData.length === 0) {
    return { regime: 'NEUTRAL', benchmarkRsi: 50, trend: 'FLAT', return5d: 0 };
  }

  const dayIdx = benchmarkData.findIndex(row => row.date === simDate);
  if (dayIdx === -1 || dayIdx < 20) {
    return { regime: 'NEUTRAL', benchmarkRsi: 50, trend: 'FLAT', return5d: 0 };
  }

  const subHistory = benchmarkData.slice(0, dayIdx + 1);
  const closes = subHistory.map(r => r.close);
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const rsiArr = calculateRSI(closes, 14);

  const currClose = closes[closes.length - 1];
  const close5dAgo = closes[Math.max(0, closes.length - 6)];
  const return5d = (currClose - close5dAgo) / close5dAgo;

  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];
  const rsi = rsiArr[rsiArr.length - 1] || 50;

  // 1. Confirmed RISK_OFF: Benchmark is below 20 EMA, or benchmark 5d return is negative, or RSI < 48
  if ((ema20 && currClose < ema20) || return5d < -0.008 || (rsi < 48)) {
    return { regime: 'RISK_OFF', benchmarkRsi: rsi, trend: 'DOWN', return5d };
  }

  // 2. Confirmed Bullish: Above 20 EMA with positive 5d return & healthy RSI
  if (ema20 && currClose >= ema20 * 1.001 && return5d >= 0 && rsi >= 50) {
    return { regime: 'BULLISH', benchmarkRsi: rsi, trend: 'UP', return5d };
  }

  // 3. Counter-trend rally / choppy consolidation: Above 20 EMA but flat or consolidating
  return { regime: 'NEUTRAL', benchmarkRsi: rsi, trend: 'CONSOLIDATING', return5d };
}

// EXACT 473bac9 scanMarketCandidates
function scanMarketCandidates(simDate, cachedData, currentHoldings = [], config = {}) {
  const marketRegime = evaluateMarketRegime(simDate, cachedData);
  const candidates = [];

  const benchmarkData = cachedData['^NSEI'] || cachedData['NIFTYBEES.NS'] || cachedData['RELIANCE.NS'];
  let benchmarkReturn20d = 0;
  if (benchmarkData && benchmarkData.length > 0) {
    const bIdx = benchmarkData.findIndex(row => row.date === simDate);
    if (bIdx >= 20) {
      const bClose = benchmarkData[bIdx].close;
      const bPast = benchmarkData[bIdx - 20].close;
      if (bPast > 0) benchmarkReturn20d = (bClose - bPast) / bPast;
    }
  }

  const sectorCounts = {};
  for (const h of currentHoldings) {
    const sec = h.sector || 'Other';
    sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
  }

  for (const stock of watchlist) {
    if (stock.sector === 'ETFs') continue;

    const existingHolding = currentHoldings.find(h => h.symbol === stock.symbol);
    let isAccumulationCandidate = false;

    if (existingHolding) {
      const daysHeld = existingHolding.buyDate
        ? Math.max(1, Math.round((new Date(simDate) - new Date(existingHolding.buyDate)) / (1000 * 60 * 60 * 24)))
        : 5;

      if (existingHolding.isAccumulated || (existingHolding.profitPercent || 0) < 6.0 || daysHeld < 3) {
        continue;
      }
      isAccumulationCandidate = true;
    }

    const maxPerSector = 2;
    if (!isAccumulationCandidate && stock.sector !== 'ETFs' && (sectorCounts[stock.sector] || 0) >= maxPerSector) {
      continue;
    }

    const stockHistory = cachedData[stock.symbol];
    if (!stockHistory || stockHistory.length === 0) continue;

    const dayIdx = stockHistory.findIndex(row => row.date === simDate);
    if (dayIdx === -1 || dayIdx < 14) continue;

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

    const ema20Array = calculateEMA(closes, 20);
    const ema50Array = calculateEMA(closes, 50);
    const sma20Array = calculateSMA(closes, 20);
    const sma50Array = calculateSMA(closes, 50);
    const rsiArray = calculateRSI(closes, 14);
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
    const currentAtr = atrArray[len - 1] || (currentClose * 0.025);
    const currentRvol = rvolArray[len - 1] || 1.0;
    const currentAdx = adxArray[len - 1] || 22;

    if (ema20 === null || rsiVal === null) continue;

    if (currentClose < 50) continue;
    if (ema50 && (ema20 < ema50 || ema50Slope < -0.005)) continue;
    if (currentClose < ema20 * 0.985) continue;

    const lookbackBars = Math.min(20, len - 1);
    const pastClose = closes[len - 1 - lookbackBars];
    const stockReturn20d = pastClose > 0 ? ((currentClose - pastClose) / pastClose) : 0;
    if (len >= 20 && (stockReturn20d < 0.02 || stockReturn20d < benchmarkReturn20d + 0.015)) continue;

    const lookback10d = Math.min(10, len - 1);
    const close10dAgoStock = closes[len - 1 - lookback10d];
    const stockReturn10d = close10dAgoStock > 0 ? ((currentClose - close10dAgoStock) / close10dAgoStock) : 0;
    if (len >= 10 && stockReturn10d > 0.22) continue;
    if (currentClose > ema20 * 1.13) continue;

    const candleRange = currentHigh - currentLow;
    const clv = candleRange > 0 ? (currentClose - currentLow) / candleRange : 0.5;
    const breakout20 = checkBreakouts(closes, highs, lows, 20);

    let buySignal = false;
    let baseScore = 0;
    let reason = '';
    let strategyName = '';

    const dayMove = prevClose > 0 ? (currentClose - prevClose) / prevClose : 0;
    const isMetalETF = stock.sector === 'Precious Metals';
    const minDayMove = isMetalETF ? 0.003 : 0.018;
    const minRvol = isMetalETF ? 1.10 : 1.90;
    const minRsExcess = isMetalETF ? -0.05 : 0.04;
    const minRsi = isMetalETF ? 46 : 52;

    if (
      breakout20.isBullishBreakout &&
      currentClose > ema20 &&
      (ema50 ? (ema20 >= ema50 * 1.01 && ema20Slope > 0) : true) &&
      (stockReturn20d - benchmarkReturn20d) >= minRsExcess &&
      currentRvol >= minRvol &&
      rsiVal >= minRsi && rsiVal <= 72.5 &&
      (isMetalETF || currentAdx >= 20) &&
      currentClose >= currentOpen &&
      (isMetalETF || clv >= 0.68) &&
      dayMove >= minDayMove &&
      currentClose <= ema20 * 1.08 &&
      stockReturn10d <= 0.18
    ) {
      buySignal = true;
      strategyName = isMetalETF ? 'COMMODITY_MOMENTUM' : 'MOMENTUM_BREAKOUT';
      baseScore = isMetalETF ? 90 : 88;
      reason = isMetalETF
        ? `Precious Metals 20-day breakout in confirmed uptrend (${currentRvol.toFixed(1)}x RVOL, RSI: ${rsiVal.toFixed(1)}).`
        : `Fresh 20-day breakout with institutional volume surge (${currentRvol.toFixed(1)}x RVOL, RSI: ${rsiVal.toFixed(1)}) in confirmed uptrend.`;
    }

    if (buySignal) {
      let score = baseScore;
      const rsExcess = stockReturn20d - benchmarkReturn20d;
      if (rsExcess >= 0.08) score += 10;
      else if (rsExcess >= 0.04) score += 7;
      if (currentRvol >= 3.0) score += 10;
      else if (currentRvol >= 2.0) score += 7;
      if (clv >= 0.70) score += 4;
      if (currentAdx >= 25) score += 4;
      if (marketRegime.regime === 'BULLISH') score += 3;
      else if (marketRegime.regime === 'RISK_OFF') score -= 6;
      score = Math.max(50, Math.min(100, Math.round(score)));

      if (isAccumulationCandidate && (score < 85 || currentRvol < 1.0)) {
        continue;
      }

      const minScoreThreshold = isAccumulationCandidate
        ? 84
        : (marketRegime.regime === 'RISK_OFF' ? 92 : (marketRegime.regime === 'NEUTRAL' ? 88 : 84));

      if (score >= minScoreThreshold) {
        candidates.push({
          symbol: stock.symbol,
          name: stock.name,
          sector: stock.sector,
          price: currentClose,
          score: score,
          rsGain: rsExcess,
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
            atr: currentAtr
          }
        });
      }
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const diff = (b.rsGain || 0) - (a.rsGain || 0);
    if (Math.abs(diff) > 0.005) return diff;
    return (b.technicalStats?.rvol || 1) - (a.technicalStats?.rvol || 1);
  });
  return { candidates, marketRegime };
}

function calculateRVOL(volumes, period = 20) {
  if (!volumes || volumes.length === 0) return [];
  const rvol = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < period) {
      rvol.push(1.0);
    } else {
      const slice = volumes.slice(i - period, i);
      const avg = slice.reduce((a, b) => a + b, 0) / period;
      rvol.push(avg > 0 ? (volumes[i] / avg) : 1.0);
    }
  }
  return rvol;
}

// Now test simulation with 473bac9 buying loop
function runSim() {
  const benchmarkData = cachedData['^NSEI'] || cachedData['NIFTYBEES.NS'];
  const tradingDates = benchmarkData
    .map(r => r.date)
    .filter(d => d >= '2025-10-01' && d <= '2026-10-01')
    .sort();

  const state = {
    cash: 100000.0,
    holdings: [],
    history: [],
    config: {
      targetProfitPercent: 0.25,
      stopLossPercent: 0.048,
      maxPositions: 10,
      rotationEnabled: true,
      rotationMinCandidateScore: 90,
      rotationMaxUnderperformerProfit: -1.0
    }
  };

  for (const simDate of tradingDates) {
    const remainingHoldings = [];

    for (const position of state.holdings) {
      const stockData = cachedData[position.symbol];
      const dayBar = stockData ? stockData.find(row => row.date === simDate) : null;
      if (!dayBar) { remainingHoldings.push(position); continue; }

      const { high, low, close } = dayBar;
      let triggerSell = false;
      let sellPrice = close;
      let sellReason = '';

      const dayIdx = stockData.findIndex(row => row.date === simDate);
      const buyIdx = stockData.findIndex(row => row.date === position.buyDate);
      const tradingDaysHeld = (buyIdx !== -1 && dayIdx !== -1) ? (dayIdx - buyIdx) : 5;
      const currentGainPct = ((close - position.buyPrice) / position.buyPrice) * 100;
      const todayPeakGainPercent = ((high - position.buyPrice) / position.buyPrice) * 100;

      if (!position.peakProfitPercent || todayPeakGainPercent > position.peakProfitPercent) {
        position.peakProfitPercent = todayPeakGainPercent;
      }
      const peakProfitGainPercent = position.peakProfitPercent;

      let dayEma20 = null;
      let stockRsi = 50;
      if (dayIdx >= 10) {
        const closesSoFar = stockData.slice(0, dayIdx + 1).map(r => r.close);
        const ema20Arr = calculateEMA(closesSoFar, 20);
        dayEma20 = ema20Arr[ema20Arr.length - 1];
        const rsiArr = calculateRSI(closesSoFar, 14);
        stockRsi = rsiArr[rsiArr.length - 1] || 50;
      }

      if (peakProfitGainPercent >= 3.0) {
        const beLevel = position.buyPrice * 1.012;
        if (beLevel > position.stopLoss) position.stopLoss = beLevel;
      }
      if (peakProfitGainPercent >= 11.0) {
        const lockProfit1 = position.buyPrice * 1.055;
        if (lockProfit1 > position.stopLoss) position.stopLoss = lockProfit1;
      }
      if (peakProfitGainPercent >= 18.0) {
        const lockProfit2 = position.buyPrice * 1.115;
        if (lockProfit2 > position.stopLoss) position.stopLoss = lockProfit2;
      }
      if (peakProfitGainPercent >= 25.0) {
        const runnerTrail = dayEma20 ? dayEma20 * 0.99 : position.buyPrice * 1.18;
        if (runnerTrail > position.stopLoss) position.stopLoss = runnerTrail;
      }
      if (peakProfitGainPercent >= 35.0 && dayEma20) {
        const runnerTrail = dayEma20 * 0.995;
        if (runnerTrail > position.stopLoss) position.stopLoss = runnerTrail;
      }

      const isTrailingStop = position.stopLoss > position.buyPrice;
      const trailingBreach = close <= position.stopLoss;
      const initialBreach = close <= position.stopLoss || low <= position.stopLoss;

      let partialSellQty = 0;
      let partialSellReason = '';

      if (isTrailingStop ? trailingBreach : initialBreach) {
        triggerSell = true;
        sellPrice = (dayBar.open && dayBar.open < position.stopLoss) ? dayBar.open : position.stopLoss;
        sellReason = isTrailingStop ? 'Trailing Profit Locked' : 'Stop Loss Triggered';
      }
      else if (tradingDaysHeld >= 3 && tradingDaysHeld <= 4 && currentGainPct <= -2.4 && stockRsi < 50 && dayEma20 && close < dayEma20) {
        triggerSell = true;
        sellPrice = close;
        sellReason = 'Early Failed Breakout Exit';
      }
      else if (tradingDaysHeld >= 6 && currentGainPct < -1.0 && dayEma20 && close < dayEma20) {
        triggerSell = true;
        sellPrice = close;
        sellReason = 'Stagnation Time-Stop';
      }
      else if (tradingDaysHeld >= 10 && currentGainPct <= 0.0 && dayEma20 && close < dayEma20) {
        triggerSell = true;
        sellPrice = close;
        sellReason = 'Stagnation Dead-Money Exit';
      }
      else if (peakProfitGainPercent >= 4.0 && peakProfitGainPercent < 10.0 && dayEma20 && close < dayEma20) {
        triggerSell = true;
        sellPrice = close;
        sellReason = 'Failed Follow-Through';
      }
      else if (!position.isClimaxScaled && currentGainPct >= 20.0 && stockRsi >= 82 && dayEma20 && close > dayEma20 * 1.12) {
        if (position.quantity >= 2) {
          partialSellQty = Math.floor(position.quantity * 0.5);
          partialSellReason = 'Parabolic Climax 50% Profit Taken';
        } else {
          triggerSell = true;
          sellPrice = close;
          sellReason = 'Parabolic Climax Blow-Off';
        }
      }

      if (partialSellQty > 0) {
        const pSellPrice = close;
        const pRevenue = partialSellQty * pSellPrice;
        const pCost = partialSellQty * position.buyPrice;
        state.cash += pRevenue;
        position.quantity -= partialSellQty;
        position.isClimaxScaled = true;
        position.stopLoss = Math.max(position.stopLoss, dayEma20 ? dayEma20 * 0.99 : position.buyPrice * 1.15);
        state.history.push({
          symbol: position.symbol,
          profit: pRevenue - pCost,
          profitPercent: ((pRevenue - pCost) / pCost) * 100,
          reason: partialSellReason
        });
        position.currentPrice = close;
        position.value = position.quantity * close;
        position.profit = position.value - (position.quantity * position.buyPrice);
        position.profitPercent = (position.profit / (position.quantity * position.buyPrice)) * 100;
        remainingHoldings.push(position);
      } else if (triggerSell) {
        const rev = position.quantity * sellPrice;
        const cost = position.quantity * position.buyPrice;
        state.cash += rev;
        state.history.push({
          symbol: position.symbol,
          sellDate: simDate,
          profit: rev - cost,
          profitPercent: ((rev - cost) / cost) * 100,
          reason: sellReason
        });
      } else {
        position.currentPrice = close;
        position.value = position.quantity * close;
        position.profit = position.value - (position.quantity * position.buyPrice);
        position.profitPercent = (position.profit / (position.quantity * position.buyPrice)) * 100;
        remainingHoldings.push(position);
      }
    }
    state.holdings = remainingHoldings;

    const { candidates, marketRegime } = scanMarketCandidates(simDate, cachedData, state.holdings, state.config);

    const executeBuy = (targetStock) => {
      let currentHoldingsValue = 0;
      for (const h of state.holdings) currentHoldingsValue += h.value;
      const totalPortfolioValue = state.cash + currentHoldingsValue;
      const minCashReserve = Math.min(2000, totalPortfolioValue * 0.02);
      if (state.cash <= minCashReserve) return false;

      if (targetStock.isAccumulation) {
        const parent = state.holdings.find(h => h.symbol === targetStock.symbol);
        if (!parent || parent.isAccumulated) return false;
        const maxAddQtyByParent = Math.max(1, Math.floor(parent.quantity * 0.5));
        const maxCapitalForAdd = Math.min(totalPortfolioValue * 0.06, state.cash - minCashReserve);
        const maxAddQtyByCap = Math.floor(maxCapitalForAdd / targetStock.price);
        let qty = Math.min(maxAddQtyByParent, maxAddQtyByCap);
        if (qty <= 0 && parent.quantity === 1 && state.cash >= targetStock.price + minCashReserve) {
          if ((parent.value + targetStock.price) <= totalPortfolioValue * 0.20) qty = 1;
        }
        if (qty <= 0) return false;

        const addCost = qty * targetStock.price;
        if ((parent.value + addCost) > totalPortfolioValue * 0.20) return false;

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
        return true;
      }

      const availableSlots = Math.max(1, state.config.maxPositions - state.holdings.length);
      const isHighConviction = (targetStock.score || 0) >= 93;
      const allocPct = isHighConviction ? 0.15 : 0.125;
      const targetPositionSize = totalPortfolioValue * allocPct;
      const minAllocationFloor = Math.min(4000, totalPortfolioValue * 0.04);
      if (state.cash < minAllocationFloor + minCashReserve) return false;

      const capitalAllocation = Math.min(targetPositionSize, state.cash - minCashReserve);
      let qty = Math.floor(capitalAllocation / targetStock.price);
      if (qty <= 0 && state.cash >= targetStock.price + minCashReserve && targetStock.price <= totalPortfolioValue * 0.35) {
        qty = 1;
      }
      if (qty <= 0) return false;

      const cost = qty * targetStock.price;
      state.cash -= cost;

      state.holdings.push({
        symbol: targetStock.symbol,
        name: targetStock.name,
        sector: targetStock.sector,
        quantity: qty,
        buyPrice: targetStock.price,
        currentPrice: targetStock.price,
        buyDate: simDate,
        targetPrice: targetStock.price * (1 + state.config.targetProfitPercent),
        stopLoss: targetStock.price * (1 - state.config.stopLossPercent),
        value: cost,
        profit: 0.0,
        profitPercent: 0.0,
        score: targetStock.score
      });
      return true;
    };

    let currentHoldingsValue = 0;
    for (const h of state.holdings) currentHoldingsValue += h.value;
    const totalPortVal = state.cash + currentHoldingsValue;
    const cashRatio = totalPortVal > 0 ? (state.cash / totalPortVal) : 1;
    const maxBuysToday = (marketRegime.regime === 'BULLISH' && cashRatio > 0.20) ? 4 : (marketRegime.regime === 'BULLISH') ? 2 : 1;
    let todayBuysCount = 0;

    for (const targetStock of candidates) {
      if (todayBuysCount >= maxBuysToday) break;
      const isAccumulation = targetStock.isAccumulation;

      if (!isAccumulation && marketRegime.regime === 'RISK_OFF') continue;
      if (!isAccumulation && marketRegime.regime === 'NEUTRAL') {
        if (marketRegime.return5d < 0) continue;
        if (targetStock.score < 92 || (targetStock.rsGain || 0) < 0.06 || (targetStock.technicalStats?.rvol || 1) < 2.0) continue;
      }

      if (!isAccumulation) {
        const simIdx = tradingDates.indexOf(simDate);
        const recentLoss = state.history.some(t => {
          if (t.symbol !== targetStock.symbol || t.profit > 0) return false;
          const sellIdx = tradingDates.indexOf(t.sellDate);
          if (sellIdx === -1) return false;
          const daysSinceLoss = simIdx - sellIdx;
          if (daysSinceLoss <= 8) {
            if ((targetStock.technicalStats?.rvol || 1) >= 2.0) return false;
            return true;
          }
          return false;
        });
        if (recentLoss) continue;
      }

      const availableSlots = state.config.maxPositions - state.holdings.length;
      let canBuy = isAccumulation ? (state.cash >= 1000) : (availableSlots > 0 && state.cash >= 1000);

      let sectorLimitReached = false;
      if (!isAccumulation && targetStock.sector !== 'ETFs') {
        const sectorHoldings = state.holdings.filter(h => h.sector === targetStock.sector);
        if (sectorHoldings.length >= 2) {
          sectorLimitReached = true;
        } else if (sectorHoldings.length === 1) {
          if (sectorHoldings[0].stopLoss < sectorHoldings[0].buyPrice) {
            sectorLimitReached = true;
          }
        }
      }

      const rotationEnabled = state.config.rotationEnabled !== false;
      const minCandScore = state.config.rotationMinCandidateScore || 90;
      const maxUnderperformerProfit = state.config.rotationMaxUnderperformerProfit || -1.0;

      if (!isAccumulation && rotationEnabled && (!canBuy || sectorLimitReached || state.cash < targetStock.price) && targetStock.score >= minCandScore && state.holdings.length > 0) {
        let worstHoldingIndex = -1;
        let worstHoldingProfit = Infinity;

        for (let j = 0; j < state.holdings.length; j++) {
          const h = state.holdings[j];
          if (h.buyDate === simDate) continue;
          if (sectorLimitReached && h.sector !== targetStock.sector) continue;
          if (h.profitPercent < worstHoldingProfit) {
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
            state.cash += revenue;
            state.history.push({
              symbol: position.symbol,
              sellDate: simDate,
              profit,
              profitPercent: (profit / cost) * 100,
              reason: `Replaced by ${targetStock.symbol}`
            });
            state.holdings.splice(worstHoldingIndex, 1);
            canBuy = true;
            sectorLimitReached = false;
          }
        }
      }

      if (sectorLimitReached) continue;

      if (canBuy && state.cash >= 1000) {
        if (executeBuy(targetStock)) {
          todayBuysCount++;
        }
        if (todayBuysCount >= maxBuysToday) break;
      }
    }
  }

  let finalHVal = 0;
  for (const h of state.holdings) finalHVal += h.value;
  const finalTotal = state.cash + finalHVal;
  const pnlPct = ((finalTotal - 100000) / 100000) * 100;
  const wins = state.history.filter(t => t.profit > 0);

  console.log('Result for 473bac9 simulation:');
  console.log('Total Trades:', state.history.length);
  console.log('Open Holdings:', state.holdings.length);
  console.log('Final Net Worth: ₹' + finalTotal.toFixed(0));
  console.log('PnL %: ' + pnlPct.toFixed(2) + '%');
  console.log('Win Rate: ' + ((wins.length / state.history.length) * 100).toFixed(1) + '%');
}

runSim();
