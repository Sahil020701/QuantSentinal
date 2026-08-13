/**
 * Calculate Simple Moving Average (SMA)
 * @param {number[]} prices - Array of historical close prices
 * @param {number} period - SMA period (e.g., 20 or 50)
 * @returns {(number|null)[]} Array of SMA values matching input length
 */
function calculateSMA(prices, period) {
  if (!prices || prices.length === 0) return [];
  const smaValues = Array(prices.length).fill(null);
  
  if (prices.length < period) return smaValues;
  
  let sum = 0;
  // First sum
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  smaValues[period - 1] = sum / period;
  
  for (let i = period; i < prices.length; i++) {
    sum = sum - prices[i - period] + prices[i];
    smaValues[i] = sum / period;
  }
  
  return smaValues;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param {number[]} prices - Array of historical close prices
 * @param {number} period - EMA period
 * @returns {(number|null)[]} Array of EMA values matching input length
 */
function calculateEMA(prices, period) {
  if (!prices || prices.length === 0) return [];
  const emaValues = Array(prices.length).fill(null);
  
  if (prices.length < period) return emaValues;
  
  // Start with SMA for the first value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let currentEma = sum / period;
  emaValues[period - 1] = currentEma;
  
  const multiplier = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) {
    currentEma = (prices[i] - currentEma) * multiplier + currentEma;
    emaValues[i] = currentEma;
  }
  
  return emaValues;
}

/**
 * Calculate Relative Strength Index (RSI) using Wilder's smoothing
 * @param {number[]} prices - Array of close prices
 * @param {number} period - RSI period (default: 14)
 * @returns {(number|null)[]} Array of RSI values matching input length
 */
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length === 0) return [];
  const rsiValues = Array(prices.length).fill(null);
  
  if (prices.length <= period) return rsiValues;
  
  const gains = [];
  const losses = [];
  
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  rsiValues[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  
  for (let i = period + 1; i < prices.length; i++) {
    const currentGain = gains[i - 1];
    const currentLoss = losses[i - 1];
    
    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    
    if (avgLoss === 0) {
      rsiValues[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsiValues[i] = 100 - (100 / (1 + rs));
    }
  }
  
  return rsiValues;
}

/**
 * Calculate Moving Average Convergence Divergence (MACD)
 * @param {number[]} prices - Array of close prices
 * @param {number} fastPeriod - Fast EMA period (default: 12)
 * @param {number} slowPeriod - Slow EMA period (default: 26)
 * @param {number} signalPeriod - Signal line EMA period (default: 9)
 * @returns {{macdLine: (number|null)[], signalLine: (number|null)[], histogram: (number|null)[]}}
 */
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const defaultResult = {
    macdLine: Array(prices.length).fill(null),
    signalLine: Array(prices.length).fill(null),
    histogram: Array(prices.length).fill(null)
  };

  if (!prices || prices.length < slowPeriod) {
    return defaultResult;
  }

  const fastEma = calculateEMA(prices, fastPeriod);
  const slowEma = calculateEMA(prices, slowPeriod);
  
  const macdLine = [];
  for (let i = 0; i < prices.length; i++) {
    if (fastEma[i] === null || slowEma[i] === null) {
      macdLine.push(null);
    } else {
      macdLine.push(fastEma[i] - slowEma[i]);
    }
  }
  
  // Find first index where MACD line has value
  const firstNonNullIndex = macdLine.findIndex(val => val !== null);
  if (firstNonNullIndex === -1 || macdLine.length - firstNonNullIndex < signalPeriod) {
    return defaultResult;
  }
  
  // Compute Signal line (EMA(9) of MACD Line)
  const macdSubArray = macdLine.slice(firstNonNullIndex);
  const signalSubEma = calculateEMA(macdSubArray, signalPeriod);
  
  const signalLine = Array(prices.length).fill(null);
  const histogram = Array(prices.length).fill(null);
  
  for (let i = 0; i < macdSubArray.length; i++) {
    const targetIdx = firstNonNullIndex + i;
    signalLine[targetIdx] = signalSubEma[i];
    if (macdLine[targetIdx] !== null && signalLine[targetIdx] !== null) {
      histogram[targetIdx] = macdLine[targetIdx] - signalLine[targetIdx];
    }
  }
  
  return { macdLine, signalLine, histogram };
}

/**
 * Check for breakouts over a given period
 * @param {number[]} prices - Close prices
 * @param {number[]} highs - High prices
 * @param {number[]} lows - Low prices
 * @param {number} lookbackPeriod - Lookback period (default: 10)
 * @returns {{isBullishBreakout: boolean, isBearishBreakout: boolean}}
 */
function checkBreakouts(prices, highs, lows, lookbackPeriod = 10) {
  if (!prices || prices.length <= lookbackPeriod) {
    return { isBullishBreakout: false, isBearishBreakout: false };
  }
  
  const len = prices.length;
  const currentPrice = prices[len - 1];
  
  // Extract previous high/lows (excluding current day)
  const prevHighs = highs.slice(len - 1 - lookbackPeriod, len - 1);
  const prevLows = lows.slice(len - 1 - lookbackPeriod, len - 1);
  
  const support = Math.min(...prevLows);
  const resistance = Math.max(...prevHighs);
  
  return {
    isBullishBreakout: currentPrice > resistance,
    isBearishBreakout: currentPrice < support
  };
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  checkBreakouts
};
