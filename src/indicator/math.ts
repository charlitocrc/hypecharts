import type { IndicatorDrawCallback, KLineData } from 'klinecharts'

export type Value = number | undefined

export const DAY = 86_400_000

export const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const positiveNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const rollingSum = (values: number[], period: number): number[] => {
  const result = new Array<number>(values.length).fill(0)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    result[i] = sum
  }
  return result
}

export const simpleMovingAverage = (values: Value[], period: number): Value[] => {
  const result: Value[] = new Array(values.length).fill(undefined)
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (value === undefined) {
      sum = 0
      count = 0
      continue
    }
    sum += value
    count++
    if (count > period) {
      const outgoing = values[i - period]
      if (outgoing === undefined) {
        sum = value
        count = 1
        continue
      }
      sum -= outgoing
      count--
    }
    if (count === period) result[i] = sum / period
  }
  return result
}

export const wilderAverage = (values: number[], period: number): Value[] => {
  const result: Value[] = new Array(values.length).fill(undefined)
  if (values.length < period) return result
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  let average = sum / period
  result[period - 1] = average
  for (let i = period; i < values.length; i++) {
    average = (average * (period - 1) + values[i]) / period
    result[i] = average
  }
  return result
}

export const trueRange = (dataList: KLineData[]): number[] => dataList.map((bar, index) => {
  if (index === 0) return bar.high - bar.low
  const previousClose = dataList[index - 1].close
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previousClose),
    Math.abs(bar.low - previousClose)
  )
})

export const atrSeries = (dataList: KLineData[], period: number): Value[] =>
  wilderAverage(trueRange(dataList), period)

export const optionalEma =(values: Value[], period: number): Value[] => {
  const result: Value[] = new Array(values.length).fill(undefined)
  const alpha = 2 / (period + 1)
  let seed = 0
  let count = 0
  let ema: Value
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (value === undefined) {
      seed = 0
      count = 0
      ema = undefined
      continue
    }
    if (ema === undefined) {
      seed += value
      count++
      if (count === period) {
        ema = seed / period
        result[i] = ema
      }
      continue
    }
    ema += alpha * (value - ema)
    result[i] = ema
  }
  return result
}

/** Sliding-window population standard deviation (Welford-style, mirrors BBW). */
export const rollingStdDev = (values: number[], period: number): Value[] => {
  const result: Value[] = new Array(values.length).fill(undefined)
  let mean = 0
  let squaredDeviation = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (i < period) {
      const delta = value - mean
      mean += delta / (i + 1)
      squaredDeviation += delta * (value - mean)
    } else {
      const outgoing = values[i - period]
      const nextMean = mean + (value - outgoing) / period
      squaredDeviation += (value - outgoing) * (value - nextMean + outgoing - mean)
      mean = nextMean
    }
    if (i >= period - 1) result[i] = Math.sqrt(Math.max(0, squaredDeviation / period))
  }
  return result
}

export const rollingExtrema = (values: number[], period: number, mode: 'min' | 'max', asIndex = false): Value[] => {
  const result: Value[] = new Array(values.length).fill(undefined)
  const deque: number[] = []
  let head = 0
  for (let i = 0; i < values.length; i++) {
    while (deque.length > head && deque[head] <= i - period) head++
    while (deque.length > head) {
      const last = deque[deque.length - 1]
      const remove = mode === 'max' ? values[last] <= values[i] : values[last] >= values[i]
      if (!remove) break
      deque.pop()
    }
    deque.push(i)
    if (i >= period - 1) result[i] = asIndex ? deque[head] : values[deque[head]]
  }
  return result
}

/** Percentage rate of change over `period` bars. */
export const rateOfChange = (values: Value[], period: number): Value[] => values.map((value, index) => {
  const previous = values[index - period]
  return value === undefined || previous === undefined || previous === 0
    ? undefined
    : (value - previous) / previous * 100
})

/** O(n) linearly weighted moving average. */
export const weightedMovingAverage = (values: Value[], period: number): Value[] => {
  const result: Value[] = new Array(values.length).fill(undefined)
  const denominator = period * (period + 1) / 2
  let simpleSum = 0
  let weightedSum = 0
  let validCount = 0

  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (value === undefined) {
      simpleSum = 0
      weightedSum = 0
      validCount = 0
      continue
    }

    if (validCount < period) {
      validCount++
      simpleSum += value
      weightedSum += validCount * value
      if (validCount === period) result[i] = weightedSum / denominator
      continue
    }

    const outgoing = values[i - period]
    if (outgoing === undefined) {
      simpleSum = value
      weightedSum = value
      validCount = 1
      continue
    }
    weightedSum = weightedSum - simpleSum + period * value
    simpleSum += value - outgoing
    result[i] = weightedSum / denominator
  }
  return result
}

export interface RegressionFit { value?: number, slope?: number }

/**
 * Least-squares regression over a sliding window with x = 0 at the oldest
 * bar; `value` is the fit at the newest bar (LSMA) and `slope` its slope.
 * O(1) per bar: when the window slides, every retained x drops by one, so
 * the sliding Σxy is T − (Σy − y_oldest) + (period−1)·y_new.
 */
export const rollingLeastSquares = (values: number[], period: number): RegressionFit[] => {
  const result: RegressionFit[] = values.map(() => ({}))
  if (period === 1) return values.map(value => ({ value, slope: 0 }))
  const countX = period * (period - 1) / 2
  const countX2 = (period - 1) * period * (2 * period - 1) / 6
  const denominator = period * countX2 - countX * countX
  if (denominator === 0) return result
  let sumY = 0
  let sumXY = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (i < period) {
      sumY += value
      sumXY += i * value
    } else {
      const outgoing = values[i - period]
      sumXY = sumXY - (sumY - outgoing) + (period - 1) * value
      sumY = sumY - outgoing + value
    }
    if (i >= period - 1) {
      const slope = (period * sumXY - countX * sumY) / denominator
      const intercept = (sumY - slope * countX) / period
      result[i] = { value: intercept + slope * (period - 1), slope }
    }
  }
  return result
}

/** Wilder-smoothed relative strength index over `period` bars (gap-free input). */
export const rsiSeries = (values: number[], period: number): Value[] => {
  const result: Value[] = new Array(values.length).fill(undefined)
  if (values.length <= period) return result
  let averageGain = 0
  let averageLoss = 0
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1]
    averageGain += Math.max(change, 0)
    averageLoss += Math.max(-change, 0)
  }
  averageGain /= period
  averageLoss /= period
  const compute = (): number => averageLoss === 0
    ? (averageGain === 0 ? 50 : 100)
    : 100 - 100 / (1 + averageGain / averageLoss)
  result[period] = compute()
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1]
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period
    result[i] = compute()
  }
  return result
}

/** Root mean square over a sliding window (no de-meaning). */
export const rollingRms = (values: Value[], period: number): Value[] => {
  const result: Value[] = new Array(values.length).fill(undefined)
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (value === undefined) {
      sum = 0
      count = 0
      continue
    }
    const square = value * value
    sum += square
    count++
    if (count > period) {
      const outgoing = values[i - period]
      if (outgoing === undefined) {
        sum = square
        count = 1
        continue
      }
      sum -= outgoing * outgoing
      count--
    }
    if (count === period) result[i] = Math.sqrt(sum / period)
  }
  return result
}

/** Percentage of the trailing `period` window at or below the current value;
 * undefined until the full lookback holds data. */
export const percentRank = (values: Value[], period: number): Value[] => {
  const result: Value[] = new Array(values.length).fill(undefined)
  let first = -1
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== undefined) {
      first = i
      break
    }
  }
  if (first === -1) return result
  for (let i = first + period; i < values.length; i++) {
    const value = values[i]!
    let count = 0
    for (let k = i - period; k < i; k++) {
      if (values[k]! <= value) count++
    }
    result[i] = count / period * 100
  }
  return result
}

/** Rolling high or low over a trailing time window; timestamps must ascend. */
export const rollingTimeExtrema = (dataList: KLineData[], windowMs: number, mode: 'high' | 'low'): Value[] => {
  const result: Value[] = new Array(dataList.length).fill(undefined)
  const deque: number[] = []
  let head = 0
  for (let i = 0; i < dataList.length; i++) {
    const cutoff = dataList[i].timestamp - windowMs
    while (deque.length > head && dataList[deque[head]].timestamp <= cutoff) head++
    while (deque.length > head) {
      const last = deque[deque.length - 1]
      const remove = mode === 'high' ? dataList[last].high <= dataList[i].high : dataList[last].low >= dataList[i].low
      if (!remove) break
      deque.pop()
    }
    deque.push(i)
    result[i] = mode === 'high' ? dataList[deque[head]].high : dataList[deque[head]].low
  }
  return result
}

/** Filled screen-space triangle; direction 1 points up, -1 points down. */
export const fillTriangle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: 1 | -1,
  size = 5
): void => {
  ctx.beginPath()
  ctx.moveTo(x, y - direction * size)
  ctx.lineTo(x - size, y + direction * size)
  ctx.lineTo(x + size, y + direction * size)
  ctx.closePath()
  ctx.fill()
}

export const guideLines = (levels: number[]): IndicatorDrawCallback =>
  ({ ctx, bounding, defaultStyles, yAxis }) => {
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 1
    ctx.strokeStyle = defaultStyles.lines[0]?.color ?? '#76808f'
    ctx.setLineDash([4, 4])
    for (const level of levels) {
      const y = Math.round(yAxis.convertToPixel(level)) + 0.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(bounding.width, y)
      ctx.stroke()
    }
    return false
  }
