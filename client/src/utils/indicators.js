// 技术指标计算工具

// SMA (Simple Moving Average)
export function calcSMA(data, period) {
  const result = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
      continue
    }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += data[j]
    result.push(sum / period)
  }
  return result
}

// EMA (Exponential Moving Average)
export function calcEMA(data, period) {
  const result = []
  const multiplier = 2 / (period + 1)
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[i])
      continue
    }
    if (i < period - 1) {
      result.push(null)
      continue
    }
    if (result[i - 1] === null) {
      // 首次有效：用 SMA 初始化
      let sum = 0
      for (let j = 0; j < period; j++) sum += data[j]
      result[i] = sum / period
    } else {
      result[i] = (data[i] - result[i - 1]) * multiplier + result[i - 1]
    }
  }
  return result
}

// MACD
export function calcMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const emaFast = calcEMA(data, fastPeriod)
  const emaSlow = calcEMA(data, slowPeriod)

  const macdLine = []
  for (let i = 0; i < data.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine.push(emaFast[i] - emaSlow[i])
    } else {
      macdLine.push(null)
    }
  }

  // 计算信号线 (MACD 的 EMA)
  const signalLine = calcEMA(macdLine.filter(v => v !== null), signalPeriod)
  let si = 0
  const fullSignal = macdLine.map(v => {
    if (v !== null) return signalLine[si++]
    return null
  })

  const histogram = []
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] !== null && fullSignal[i] !== null) {
      histogram.push(macdLine[i] - fullSignal[i])
    } else {
      histogram.push(null)
    }
  }

  return {
    macdLine,
    signalLine: fullSignal,
    histogram,
  }
}

// RSI
export function calcRSI(data, period = 14) {
  const result = []
  if (data.length < period + 1) {
    return data.map(() => null)
  }

  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }

  let avgGain = gains / period
  let avgLoss = losses / period

  // 第一个 RSI 值
  result[0] = null
  for (let i = 1; i < period; i++) result[i] = null

  if (avgLoss === 0) {
    result[period] = 100
  } else {
    const rs = avgGain / avgLoss
    result[period] = 100 - 100 / (1 + rs)
  }

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1]
    const gain = diff >= 0 ? diff : 0
    const loss = diff >= 0 ? 0 : -diff

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    if (avgLoss === 0) {
      result[i] = 100
    } else {
      const rs = avgGain / avgLoss
      result[i] = 100 - 100 / (1 + rs)
    }
  }

  return result
}

// Bollinger Bands
export function calcBollinger(data, period = 20, multiplier = 2) {
  const sma = calcSMA(data, period)
  const upper = []
  const lower = []

  for (let i = 0; i < data.length; i++) {
    if (sma[i] === null) {
      upper.push(null)
      lower.push(null)
      continue
    }
    let sumSq = 0
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (data[j] - sma[i]) ** 2
    }
    const std = Math.sqrt(sumSq / period)
    upper.push(sma[i] + multiplier * std)
    lower.push(sma[i] - multiplier * std)
  }

  return { sma, upper, lower }
}
