/**
 * Calculate Simple Moving Average (SMA)
 * @param {number[]} prices - Array of historical close prices
 * @param {number} period - SMA period (e.g., 20 or 50)
 * @returns {(number|null)[]} Array of SMA values matching input length
 */
function calculateSMA(prices, period) {
  if (!prices || prices.length === 0) return [];
  const smaValues = Array(prices.length).fill(null);
  
  if (prices.length < period) {
    if (prices.length < 10) return smaValues;
    // Adaptive seed for early simulation dates (e.g. July 1)
    let sum = 0;
    for (let i = 0; i < prices.length; i++) {
      sum += prices[i];
      smaValues[i] = sum / (i + 1);
    }
    return smaValues;
  }
  
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
  
  if (prices.length < period) {
    if (prices.length < 10) return emaValues;
    // Adaptive seed: calculates EMA using available history so EMA50 is not null in early simulation months
    let sum = 0;
    for (let i = 0; i < Math.min(10, prices.length); i++) sum += prices[i];
    let currentEma = sum / Math.min(10, prices.length);
    const multiplier = 2 / (period + 1);
    for (let i = 0; i < prices.length; i++) {
      currentEma = (prices[i] - currentEma) * multiplier + currentEma;
      emaValues[i] = currentEma;
    }
    return emaValues;
  }
  
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
 * Calculate Average True Range (ATR)
 * @param {number[]} highs - High prices
 * @param {number[]} lows - Low prices
 * @param {number[]} closes - Close prices
 * @param {number} period - ATR period (default: 14)
 * @returns {(number|null)[]} Array of ATR values
 */
function calculateATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length === 0 || !lows || !closes) return [];
  const len = highs.length;
  const atrValues = Array(len).fill(null);
  if (len <= period) return atrValues;

  const trValues = [highs[0] - lows[0]];
  for (let i = 1; i < len; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trValues.push(Math.max(hl, hc, lc));
  }

  // Initial ATR as simple mean of first 'period' TR values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += trValues[i];
  }
  let currentAtr = sum / period;
  atrValues[period - 1] = currentAtr;

  // Wilder smoothing for subsequent bars
  for (let i = period; i < len; i++) {
    currentAtr = (currentAtr * (period - 1) + trValues[i]) / period;
    atrValues[i] = currentAtr;
  }

  return atrValues;
}

/**
 * Calculate Relative Volume (RVOL)
 * Ratio of current bar volume to 20-bar average volume
 * @param {number[]} volumes - Array of volume bars
 * @param {number} period - Average volume lookback period (default: 20)
 * @returns {(number|null)[]} Array of RVOL values
 */
function calculateRVOL(volumes, period = 20) {
  if (!volumes || volumes.length === 0) return [];
  const rvolValues = Array(volumes.length).fill(null);
  if (volumes.length < period) return rvolValues;

  const volSMA = calculateSMA(volumes, period);
  for (let i = period - 1; i < volumes.length; i++) {
    const avg = volSMA[i];
    if (avg && avg > 0) {
      rvolValues[i] = volumes[i] / avg;
    } else {
      rvolValues[i] = 1.0;
    }
  }

  return rvolValues;
}

/**
 * Calculate Trend Slope (% change over lookback)
 * @param {(number|null)[]} series - Data series (e.g. SMA values)
 * @param {number} lookback - Lookback bars (default: 5)
 * @returns {number} Slope percentage or 0
 */
function calculateSlope(series, lookback = 5) {
  if (!series || series.length <= lookback) return 0;
  const current = series[series.length - 1];
  const prev = series[series.length - 1 - lookback];
  if (current === null || prev === null || prev === 0) return 0;
  return ((current - prev) / prev) * 100;
}

/**
 * Check for breakouts over a given period (default 20-day high/low)
 * @param {number[]} prices - Close prices
 * @param {number[]} highs - High prices
 * @param {number[]} lows - Low prices
 * @param {number} lookbackPeriod - Lookback period (default: 20)
 * @returns {{isBullishBreakout: boolean, isBearishBreakout: boolean, resistance: number, support: number}}
 */
function checkBreakouts(prices, highs, lows, lookbackPeriod = 20) {
  if (!prices || prices.length <= lookbackPeriod) {
    return { isBullishBreakout: false, isBearishBreakout: false, resistance: 0, support: 0 };
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
    isBearishBreakout: currentPrice < support,
    resistance,
    support
  };
}

/**
 * Calculate Average Directional Index (ADX) — Trend Strength Indicator
 * ADX < 20: sideways/choppy (avoid entries)
 * ADX 20-25: weak trend forming
 * ADX > 25: strong confirmed trend (ideal for momentum entries)
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} period - default 14
 * @returns {(number|null)[]} Array of ADX values
 */
function calculateADX(highs, lows, closes, period = 14) {
  const len = highs.length;
  const adxValues = Array(len).fill(null);
  if (!highs || len < 7) return adxValues;

  // Use adaptive period for shorter histories so valid setups aren't blocked
  const effPeriod = len < period * 2 + 1 ? Math.max(5, Math.floor((len - 1) / 2)) : period;
  if (len < effPeriod * 2 + 1) return adxValues;

  const trArr = [];
  const dmPlusArr = [];
  const dmMinusArr = [];

  // Calculate True Range, +DM, -DM
  trArr.push(highs[0] - lows[0]);
  dmPlusArr.push(0);
  dmMinusArr.push(0);

  for (let i = 1; i < len; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trArr.push(Math.max(hl, hc, lc));

    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    dmPlusArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinusArr.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder smoothing for TR, +DM, -DM
  let smoothTR = trArr.slice(0, effPeriod).reduce((a, b) => a + b, 0);
  let smoothDMPlus = dmPlusArr.slice(0, effPeriod).reduce((a, b) => a + b, 0);
  let smoothDMMinus = dmMinusArr.slice(0, effPeriod).reduce((a, b) => a + b, 0);

  const diPlusArr = [];
  const diMinusArr = [];

  // First DI values
  diPlusArr.push(smoothTR > 0 ? (smoothDMPlus / smoothTR) * 100 : 0);
  diMinusArr.push(smoothTR > 0 ? (smoothDMMinus / smoothTR) * 100 : 0);

  for (let i = effPeriod; i < len; i++) {
    smoothTR = smoothTR - smoothTR / effPeriod + trArr[i];
    smoothDMPlus = smoothDMPlus - smoothDMPlus / effPeriod + dmPlusArr[i];
    smoothDMMinus = smoothDMMinus - smoothDMMinus / effPeriod + dmMinusArr[i];
    diPlusArr.push(smoothTR > 0 ? (smoothDMPlus / smoothTR) * 100 : 0);
    diMinusArr.push(smoothTR > 0 ? (smoothDMMinus / smoothTR) * 100 : 0);
  }

  // DX values from DI arrays
  const dxArr = [];
  for (let i = 0; i < diPlusArr.length; i++) {
    const diSum = diPlusArr[i] + diMinusArr[i];
    dxArr.push(diSum > 0 ? (Math.abs(diPlusArr[i] - diMinusArr[i]) / diSum) * 100 : 0);
  }

  // First ADX = average of first 'effPeriod' DX values
  if (dxArr.length < effPeriod) return adxValues;
  let adx = dxArr.slice(0, effPeriod).reduce((a, b) => a + b, 0) / effPeriod;
  const startIdx = effPeriod * 2 - 1; // offset into original array
  adxValues[startIdx] = adx;

  for (let i = effPeriod; i < dxArr.length; i++) {
    adx = (adx * (effPeriod - 1) + dxArr[i]) / effPeriod;
    adxValues[startIdx + (i - effPeriod) + 1] = adx;
  }

  return adxValues;
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateRVOL,
  calculateSlope,
  checkBreakouts,
  calculateADX
};
