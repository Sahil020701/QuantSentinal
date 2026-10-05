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

function evaluateMarketRegime(simDate, cachedData, isConservative = false) {
  const benchmarkData = cachedData['^NSEI'] || cachedData['NIFTYBEES.NS'] || cachedData['RELIANCE.NS'];
  if (!benchmarkData || benchmarkData.length < 50) return { regime: 'BULLISH', benchmarkRsi: 55, trend: 'UP', return5d: 0.01 };

  const bIdx = benchmarkData.findIndex(row => row.date === simDate);
  if (bIdx === -1 || bIdx < 20) return { regime: 'BULLISH', benchmarkRsi: 55, trend: 'UP', return5d: 0.01 };

  const closes = benchmarkData.slice(0, bIdx + 1).map(r => r.close);
  const ema20Arr = calculateEMA(closes, 20);
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50Arr = calculateEMA(closes, 50);
  const ema50 = ema50Arr.length > 0 ? ema50Arr[ema50Arr.length - 1] : null;

  const rsiArr = calculateRSI(closes, 14);
  const rsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : 50;

  const currClose = closes[closes.length - 1];
  const return5d = bIdx >= 5 ? (currClose - benchmarkData[bIdx - 5].close) / benchmarkData[bIdx - 5].close : 0;

  if (isConservative) {
    if ((ema20 && currClose < ema20) || return5d < -0.008 || (rsi < 48)) {
      return { regime: 'RISK_OFF', benchmarkRsi: rsi, trend: 'DOWN', return5d };
    }
  } else {
    if (currClose < ema20 * 0.985 && (rsi < 42 || return5d < -0.02) && (ema50 ? currClose < ema50 : true)) {
      return { regime: 'RISK_OFF', benchmarkRsi: rsi, trend: 'DOWN', return5d };
    }
  }

  if (ema20 && currClose >= ema20 * 1.001 && return5d >= 0 && rsi >= 50) {
    return { regime: 'BULLISH', benchmarkRsi: rsi, trend: 'UP', return5d };
  }
  return { regime: 'NEUTRAL', benchmarkRsi: rsi, trend: 'CONSOLIDATING', return5d };
}

function scanMarketCandidatesWithConfig(simDate, cachedData, currentHoldings = [], config = {}) {
  const isConservative = (config.aggressiveness === 'conservative');
  const marketRegime = evaluateMarketRegime(simDate, cachedData, isConservative);
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

      if (existingHolding.isAccumulated || (existingHolding.profitPercent || 0) < 6.0 || daysHeld < 3) continue;
      isAccumulationCandidate = true;
    }

    const maxPerSector = 2;
    if (!isAccumulationCandidate && stock.sector !== 'ETFs' && (sectorCounts[stock.sector] || 0) >= maxPerSector) {
      continue;
    }

    const stockHistory = cachedData[stock.symbol];
    if (!stockHistory || stockHistory.length === 0) continue;

    const dayIdx = stockHistory.findIndex(row => row.date === simDate);
    if (dayIdx === -1 || dayIdx < 50) continue;

    const currentBar = stockHistory[dayIdx];
    const currentClose = currentBar.close;
    if (currentClose < 20 || currentClose > 75000) continue;

    const closes = stockHistory.slice(0, dayIdx + 1).map(r => r.close);
    const volumes = stockHistory.slice(0, dayIdx + 1).map(r => r.volume);
    const highs = stockHistory.slice(0, dayIdx + 1).map(r => r.high);
    const lows = stockHistory.slice(0, dayIdx + 1).map(r => r.low);
    const len = closes.length;

    const currentHigh = highs[len - 1];
    const currentLow = lows[len - 1];
    const currentOpen = currentBar.open !== undefined ? currentBar.open : currentClose;
    const prevClose = closes[len - 2] || currentClose;

    const ema20Arr = calculateEMA(closes, 20);
    const ema50Arr = calculateEMA(closes, 50);
    const ema20 = ema20Arr[len - 1];
    const ema50 = ema50Arr.length > 0 ? ema50Arr[len - 1] : null;
    const ema20Slope = calculateSlope(ema20Arr, 5);
    const ema50Slope = calculateSlope(ema50Arr, 10);

    const rsiArr = calculateRSI(closes, 14);
    const rsiVal = rsiArr[len - 1] || 50;

    const avgVol20 = volumes.slice(Math.max(0, len - 21), len - 1).reduce((a, b) => a + b, 0) / 20;
    const currentRvol = avgVol20 > 0 ? (currentBar.volume || 0) / avgVol20 : 1;

    const candleRange = currentHigh - currentLow;
    const clv = candleRange > 0 ? (currentClose - currentLow) / candleRange : 0.5;

    const past20Close = closes[Math.max(0, len - 21)];
    const stockReturn20d = past20Close > 0 ? ((currentClose - past20Close) / past20Close) : 0;
    const rsExcess = stockReturn20d - benchmarkReturn20d;

    const past10Close = closes[Math.max(0, len - 11)];
    const stockReturn10d = past10Close > 0 ? ((currentClose - past10Close) / past10Close) : 0;
    if (stockReturn10d > (isConservative ? 0.18 : 0.18)) continue;

    const dayMove = prevClose > 0 ? (currentClose - prevClose) / prevClose : 0;
    const isMetalETF = stock.sector === 'Precious Metals';

    if (isConservative) {
      // Conservative strict screening
      if (currentClose < 50) continue;
      if (ema50 && (ema20 < ema50 || ema50Slope < -0.005)) continue;
      if (currentClose < ema20 * 0.985) continue;
      if (currentClose > ema20 * 1.08) continue;
      if (rsExcess < 0.040) continue;

      const breakout20 = checkBreakouts(closes, highs, lows, 20);
      if (!breakout20.isBullishBreakout) continue;

      const minRvol = isMetalETF ? 1.10 : 1.90;
      if (currentRvol < minRvol) continue;

      const minDayMove = isMetalETF ? 0.003 : 0.018;
      if (dayMove < minDayMove) continue;

      if (currentClose < currentOpen) continue;
      if (clv < 0.68) continue;
      if (rsiVal < 52 || rsiVal > 72.5) continue;

      let score = isMetalETF ? 90 : 88;
      if (rsExcess >= 0.08) score += 10;
      else if (rsExcess >= 0.04) score += 7;
      if (currentRvol >= 3.0) score += 10;
      else if (currentRvol >= 2.0) score += 7;
      if (clv >= 0.70) score += 4;
      if (marketRegime.regime === 'BULLISH') score += 3;
      else if (marketRegime.regime === 'RISK_OFF') score -= 6;
      score = Math.max(50, Math.min(100, Math.round(score)));

      if (isAccumulationCandidate && (score < 85 || currentRvol < 1.0)) continue;
      const minScoreThreshold = isAccumulationCandidate ? 85 : (marketRegime.regime === 'RISK_OFF' ? 95 : (marketRegime.regime === 'NEUTRAL' ? 88 : 84));
      if (score < minScoreThreshold) continue;

      candidates.push({
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector,
        price: currentClose,
        score,
        rsGain: rsExcess,
        rvol: currentRvol,
        strategy: 'MOMENTUM_BREAKOUT',
        reason: `Fresh 20-day breakout with institutional volume surge (${currentRvol.toFixed(1)}x RVOL, RSI: ${rsiVal.toFixed(1)}).`,
        isAccumulation: isAccumulationCandidate,
        parentHolding: isAccumulationCandidate ? existingHolding : null
      });
    } else {
      // Aggressive broad momentum screening
      if (!ema20 || currentClose < ema20) continue;
      if (ema50 && (ema20 < ema50 * 1.005 || currentClose < ema50)) continue;
      if (rsExcess < 0.030) continue;

      const distFromEma20 = (currentClose - ema20) / ema20;
      if (distFromEma20 > 0.080) continue;

      const lookback20Highs = highs.slice(Math.max(0, len - 21), len - 1);
      const highestHigh20 = lookback20Highs.length > 0 ? Math.max(...lookback20Highs) : currentClose;
      const isNew20dHigh = currentHigh >= highestHigh20;
      const distTo20dHigh = highestHigh20 > 0 ? (highestHigh20 - currentClose) / highestHigh20 : 0;
      const isCoilingNearHigh = distTo20dHigh <= 0.015 && distTo20dHigh >= -0.01;
      if (!isNew20dHigh && !isCoilingNearHigh) continue;

      const minRvol = isMetalETF ? 1.10 : 1.75;
      if (currentRvol < minRvol) continue;

      const minDayMove = isMetalETF ? 0.003 : 0.014;
      if (dayMove < minDayMove) continue;

      if (currentClose < currentOpen) continue;
      if (clv < 0.64) continue;
      if (rsiVal > 76.5) continue;

      let score = 76;
      if (isNew20dHigh && clv >= 0.70 && currentRvol >= 2.0 && rsExcess >= 0.05) score = 96;
      else if (isNew20dHigh && currentRvol >= 1.8) score = 91;
      else if (isCoilingNearHigh && currentRvol >= 2.0) score = 86;

      if (isAccumulationCandidate && (score < 80 || currentRvol < 1.0)) continue;

      candidates.push({
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector,
        price: currentClose,
        score,
        rsGain: rsExcess,
        rvol: currentRvol,
        strategy: isNew20dHigh ? 'MOMENTUM_BREAKOUT' : 'COILING_BREAKOUT_EXPANSION',
        reason: isNew20dHigh
          ? `Fresh 20-day breakout with volume surge (${currentRvol.toFixed(1)}x RVOL, RSI: ${rsiVal.toFixed(1)})`
          : `Coiling near 20-day high (${currentRvol.toFixed(1)}x RVOL)`,
        isAccumulation: isAccumulationCandidate,
        parentHolding: isAccumulationCandidate ? existingHolding : null
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.rsGain - a.rsGain);
  return { candidates, marketRegime };
}

function runBacktest(mode = 'aggressive', startDate = '2025-10-01', endDate = '2026-10-01') {
  const isConservative = (mode === 'conservative');
  const benchmarkData = cachedData['^NSEI'] || cachedData['NIFTYBEES.NS'];
  const tradingDates = benchmarkData
    .map(r => r.date)
    .filter(d => d >= startDate && d <= endDate)
    .sort();

  const state = {
    cash: 100000.0,
    holdings: [],
    history: [],
    config: {
      aggressiveness: mode,
      stopLossPercent: 0.048,
      targetProfitPercent: 0.25,
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
        const lock1 = position.buyPrice * 1.055;
        if (lock1 > position.stopLoss) position.stopLoss = lock1;
      }
      if (peakProfitGainPercent >= 18.0) {
        const lock2 = position.buyPrice * 1.115;
        if (lock2 > position.stopLoss) position.stopLoss = lock2;
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
          const pQty = Math.floor(position.quantity * 0.5);
          const pRev = pQty * close;
          const pCost = pQty * position.buyPrice;
          state.cash += pRev;
          position.quantity -= pQty;
          position.isClimaxScaled = true;
          position.stopLoss = Math.max(position.stopLoss, dayEma20 ? dayEma20 * 0.99 : position.buyPrice * 1.15);
          state.history.push({ symbol: position.symbol, profit: pRev - pCost, profitPercent: ((pRev - pCost) / pCost) * 100 });
        } else {
          triggerSell = true;
          sellPrice = close;
          sellReason = 'Parabolic Climax Blow-Off';
        }
      }

      if (triggerSell) {
        const rev = position.quantity * sellPrice;
        const cost = position.quantity * position.buyPrice;
        state.cash += rev;
        state.history.push({ symbol: position.symbol, sellDate: simDate, profit: rev - cost, profitPercent: ((rev - cost) / cost) * 100, reason: sellReason });
      } else {
        position.currentPrice = close;
        position.value = position.quantity * close;
        position.profit = position.value - (position.quantity * position.buyPrice);
        position.profitPercent = (position.profit / (position.quantity * position.buyPrice)) * 100;
        remainingHoldings.push(position);
      }
    }
    state.holdings = remainingHoldings;

    const { candidates, marketRegime } = scanMarketCandidatesWithConfig(simDate, cachedData, state.holdings, state.config);

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

        const cost = qty * targetStock.price;
        state.cash -= cost;
        const totalOldCost = parent.quantity * parent.buyPrice;
        const totalNewQty = parent.quantity + qty;
        const blendedBuyPrice = (totalOldCost + cost) / totalNewQty;
        parent.quantity = totalNewQty;
        parent.buyPrice = blendedBuyPrice;
        parent.currentPrice = targetStock.price;
        parent.stopLoss = Math.max(blendedBuyPrice * 1.002, (cost + (parent.quantity * parent.stopLoss)) / totalNewQty);
        parent.value = totalNewQty * targetStock.price;
        parent.profit = parent.value - (totalNewQty * blendedBuyPrice);
        parent.profitPercent = (parent.profit / (totalNewQty * blendedBuyPrice)) * 100;
        parent.isAccumulated = true;
        return true;
      }

      if (state.holdings.length >= state.config.maxPositions) return false;

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
        stopLoss: targetStock.price * (1 - state.config.stopLossPercent),
        value: cost,
        profit: 0.0,
        profitPercent: 0.0,
        score: targetStock.score
      });
      return true;
    };

    if (isConservative) {
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
          if (targetStock.score < 92 || (targetStock.rsGain || 0) < 0.06 || (targetStock.rvol || 1) < 2.0) continue;
        }

        if (!isAccumulation) {
          const simIdx = tradingDates.indexOf(simDate);
          const recentLoss = state.history.some(t => {
            if (t.symbol !== targetStock.symbol || t.profit > 0) return false;
            const sellIdx = tradingDates.indexOf(t.sellDate);
            if (sellIdx === -1) return false;
            const daysSinceLoss = simIdx - sellIdx;
            if (daysSinceLoss <= 8) {
              if ((targetStock.rvol || 1) >= 2.0) return false;
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
          if (sectorHoldings.length >= 2) sectorLimitReached = true;
          else if (sectorHoldings.length === 1 && sectorHoldings[0].stopLoss < sectorHoldings[0].buyPrice) {
            sectorLimitReached = true;
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
              state.history.push({ symbol: position.symbol, sellDate: simDate, profit, profitPercent: (profit / cost) * 100, reason: `Replaced by ${targetStock.symbol}` });
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
    } else {
      // Aggressive buying loop
      for (const c of candidates.filter(x => x.isAccumulation)) {
        if (state.cash < 4000) break;
        executeBuy(c);
      }

      for (const targetStock of candidates.filter(x => !x.isAccumulation)) {
        if (state.holdings.length >= state.config.maxPositions) break;
        if (state.cash < 4000) break;
        if (marketRegime.regime === 'RISK_OFF' && marketRegime.return5d < -0.02) continue;
        executeBuy(targetStock);
      }
    }
  }

  let finalHVal = 0;
  for (const h of state.holdings) finalHVal += h.value;
  const finalTotal = state.cash + finalHVal;
  const pnlPct = ((finalTotal - 100000) / 100000) * 100;
  const wins = state.history.filter(t => t.profit > 0);
  const winRate = (wins.length / state.history.length) * 100;

  return {
    mode,
    period: `${startDate} to ${endDate}`,
    trades: state.history.length,
    open: state.holdings.length,
    pnl: pnlPct.toFixed(2),
    final: finalTotal.toFixed(0),
    winRate: winRate.toFixed(1)
  };
}

console.log("=== 1 YEAR BACKTEST (2025-10-01 to 2026-10-01) ===");
console.log("Conservative:", runBacktest('conservative', '2025-10-01', '2026-10-01'));
console.log("Aggressive  :", runBacktest('aggressive', '2025-10-01', '2026-10-01'));

console.log("\n=== 2 YEAR BACKTEST (2024-10-01 to 2026-10-01) ===");
console.log("Conservative:", runBacktest('conservative', '2024-10-01', '2026-10-01'));
console.log("Aggressive  :", runBacktest('aggressive', '2024-10-01', '2026-10-01'));

console.log("\n=== 3 YEAR BACKTEST (2023-10-01 to 2026-10-01) ===");
console.log("Conservative:", runBacktest('conservative', '2023-10-01', '2026-10-01'));
console.log("Aggressive  :", runBacktest('aggressive', '2023-10-01', '2026-10-01'));

console.log("\n=== 5 YEAR BACKTEST (2021-10-01 to 2026-10-01) ===");
console.log("Conservative:", runBacktest('conservative', '2021-10-01', '2026-10-01'));
console.log("Aggressive  :", runBacktest('aggressive', '2021-10-01', '2026-10-01'));
