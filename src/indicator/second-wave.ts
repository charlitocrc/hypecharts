import {
  IndicatorSeries,
  type IndicatorTemplate,
  type KLineData
} from 'klinecharts'

import {
  type Value, guideLines, optionalEma, positiveInt, positiveNumber,
  rollingExtrema, rollingSum, simpleMovingAverage, wilderAverage
} from './math'

interface SingleResult { value?: number }
interface TwoLineResult { first?: number, second?: number }
interface ThreeLineResult { upper?: number, middle?: number, lower?: number }
interface AlligatorResult { jaw?: number, teeth?: number, lips?: number }
interface PivotResult {
  p?: number
  r1?: number
  s1?: number
  r2?: number
  s2?: number
  r3?: number
  s3?: number
}

const DAY = 86_400_000

const nonNegativeInt = (value: unknown, fallback: number): number => {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export const moneyFlowIndex: IndicatorTemplate<SingleResult> = {
  name: 'MFI',
  shortName: 'MFI',
  calcParams: [14],
  precision: 2,
  minValue: 0,
  maxValue: 100,
  figures: [{ key: 'value', title: 'MFI: ', type: 'line' }],
  draw: guideLines([20, 80]),
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 14)
    const typical = dataList.map(bar => (bar.high + bar.low + bar.close) / 3)
    const positive = dataList.map(() => 0)
    const negative = dataList.map(() => 0)
    for (let i = 1; i < dataList.length; i++) {
      const flow = typical[i] * (dataList[i].volume ?? 0)
      if (typical[i] > typical[i - 1]) positive[i] = flow
      else if (typical[i] < typical[i - 1]) negative[i] = flow
    }
    const positiveSum = rollingSum(positive, period)
    const negativeSum = rollingSum(negative, period)
    return dataList.map((_, index) => {
      if (index < period) return {}
      if (negativeSum[index] === 0) return { value: positiveSum[index] === 0 ? 50 : 100 }
      const ratio = positiveSum[index] / negativeSum[index]
      return { value: 100 - 100 / (1 + ratio) }
    })
  }
}

export const chaikinMoneyFlow: IndicatorTemplate<SingleResult> = {
  name: 'CMF',
  shortName: 'CMF',
  calcParams: [20],
  precision: 4,
  minValue: -1,
  maxValue: 1,
  figures: [{ key: 'value', title: 'CMF: ', type: 'line' }],
  draw: guideLines([0]),
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 20)
    const volume = dataList.map(bar => bar.volume ?? 0)
    const moneyFlowVolume = dataList.map((bar, index) => {
      const range = bar.high - bar.low
      const multiplier = range === 0 ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / range
      return multiplier * volume[index]
    })
    const flowSum = rollingSum(moneyFlowVolume, period)
    const volumeSum = rollingSum(volume, period)
    return dataList.map((_, index) => index < period - 1 || volumeSum[index] === 0
      ? {}
      : { value: flowSum[index] / volumeSum[index] })
  }
}

export const stochastic: IndicatorTemplate<TwoLineResult> = {
  name: 'STOCH',
  shortName: 'Stochastic',
  calcParams: [14, 1, 3],
  precision: 2,
  minValue: 0,
  maxValue: 100,
  figures: [
    { key: 'first', title: '%K: ', type: 'line' },
    { key: 'second', title: '%D: ', type: 'line' }
  ],
  draw: guideLines([20, 80]),
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 14)
    const smoothK = positiveInt(indicator.calcParams[1], 1)
    const smoothD = positiveInt(indicator.calcParams[2], 3)
    const highest = rollingExtrema(dataList.map(bar => bar.high), period, 'max')
    const lowest = rollingExtrema(dataList.map(bar => bar.low), period, 'min')
    const raw = dataList.map((bar, index) => {
      if (highest[index] === undefined || lowest[index] === undefined) return undefined
      const range = highest[index]! - lowest[index]!
      return range === 0 ? 0 : (bar.close - lowest[index]!) / range * 100
    })
    const k = simpleMovingAverage(raw, smoothK)
    const d = simpleMovingAverage(k, smoothD)
    return dataList.map((_, index) => ({ first: k[index], second: d[index] }))
  }
}

export const aroon: IndicatorTemplate<TwoLineResult> = {
  name: 'AROON',
  shortName: 'Aroon',
  calcParams: [14],
  precision: 2,
  minValue: 0,
  maxValue: 100,
  figures: [
    { key: 'first', title: 'Up: ', type: 'line' },
    { key: 'second', title: 'Down: ', type: 'line' }
  ],
  draw: guideLines([50]),
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 14)
    const window = period + 1
    const highs = rollingExtrema(dataList.map(bar => bar.high), window, 'max', true)
    const lows = rollingExtrema(dataList.map(bar => bar.low), window, 'min', true)
    return dataList.map((_, index) => highs[index] === undefined || lows[index] === undefined
      ? {}
      : {
          first: (period - (index - highs[index]!)) / period * 100,
          second: (period - (index - lows[index]!)) / period * 100
        })
  }
}

export const ultimateOscillator: IndicatorTemplate<SingleResult> = {
  name: 'UO',
  shortName: 'Ultimate Oscillator',
  calcParams: [7, 14, 28],
  precision: 2,
  minValue: 0,
  maxValue: 100,
  figures: [{ key: 'value', title: 'UO: ', type: 'line' }],
  draw: guideLines([30, 70]),
  calc: (dataList, indicator) => {
    const first = positiveInt(indicator.calcParams[0], 7)
    const second = positiveInt(indicator.calcParams[1], 14)
    const third = positiveInt(indicator.calcParams[2], 28)
    const periods = [first, second, third]
    const pressure: number[] = []
    const range: number[] = []
    dataList.forEach((bar, index) => {
      const previousClose = index > 0 ? dataList[index - 1].close : bar.close
      const trueLow = Math.min(bar.low, previousClose)
      const trueHigh = Math.max(bar.high, previousClose)
      pressure.push(bar.close - trueLow)
      range.push(trueHigh - trueLow)
    })
    const pressureSums = periods.map(period => rollingSum(pressure, period))
    const rangeSums = periods.map(period => rollingSum(range, period))
    const warmup = Math.max(...periods) - 1
    return dataList.map((_, index) => {
      if (index < warmup) return {}
      const average = (p: number): number => rangeSums[p][index] === 0 ? 0 : pressureSums[p][index] / rangeSums[p][index]
      return { value: 100 * (4 * average(0) + 2 * average(1) + average(2)) / 7 }
    })
  }
}

export const trueStrengthIndex: IndicatorTemplate<TwoLineResult> = {
  name: 'TSI',
  shortName: 'True Strength Index',
  calcParams: [25, 13, 13],
  precision: 2,
  minValue: -100,
  maxValue: 100,
  figures: [
    { key: 'first', title: 'TSI: ', type: 'line' },
    { key: 'second', title: 'Signal: ', type: 'line' }
  ],
  draw: guideLines([0]),
  calc: (dataList, indicator) => {
    const longPeriod = positiveInt(indicator.calcParams[0], 25)
    const shortPeriod = positiveInt(indicator.calcParams[1], 13)
    const signalPeriod = positiveInt(indicator.calcParams[2], 13)
    const changes: Value[] = dataList.map((bar, index) => index === 0 ? undefined : bar.close - dataList[index - 1].close)
    const absoluteChanges = changes.map(value => value === undefined ? undefined : Math.abs(value))
    const smoothedChange = optionalEma(optionalEma(changes, longPeriod), shortPeriod)
    const smoothedAbsolute = optionalEma(optionalEma(absoluteChanges, longPeriod), shortPeriod)
    const tsi = dataList.map((_, index) => {
      const denominator = smoothedAbsolute[index]
      if (smoothedChange[index] === undefined || denominator === undefined) return undefined
      return denominator === 0 ? 0 : 100 * smoothedChange[index]! / denominator
    })
    const signal = optionalEma(tsi, signalPeriod)
    return dataList.map((_, index) => ({ first: tsi[index], second: signal[index] }))
  }
}

const multiEmaTemplate = (name: 'DEMA' | 'TEMA', depth: 2 | 3): IndicatorTemplate<SingleResult> => ({
  name,
  shortName: name,
  series: IndicatorSeries.Price,
  calcParams: [9],
  precision: 4,
  shouldOhlc: true,
  figures: [{ key: 'value', title: `${name}: `, type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 9)
    const first = optionalEma(dataList.map(bar => bar.close), period)
    const second = optionalEma(first, period)
    const third = depth === 3 ? optionalEma(second, period) : []
    return dataList.map((_, index) => {
      if (first[index] === undefined || second[index] === undefined) return {}
      if (depth === 2) return { value: 2 * first[index]! - second[index]! }
      if (third[index] === undefined) return {}
      return { value: 3 * first[index]! - 3 * second[index]! + third[index]! }
    })
  }
})

export const dema = multiEmaTemplate('DEMA', 2)
export const tema = multiEmaTemplate('TEMA', 3)

export const envelopes: IndicatorTemplate<ThreeLineResult> = {
  name: 'ENV',
  shortName: 'Envelopes',
  series: IndicatorSeries.Price,
  calcParams: [20, 10],
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'middle', title: 'Basis: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 20)
    const percentage = positiveNumber(indicator.calcParams[1], 10) / 100
    const basis = simpleMovingAverage(dataList.map(bar => bar.close), period)
    return dataList.map((_, index) => basis[index] === undefined
      ? {}
      : {
          upper: basis[index]! * (1 + percentage),
          middle: basis[index],
          lower: basis[index]! * (1 - percentage)
        })
  }
}

type PivotBucket = 'day' | 'week' | 'month'

export const inferPivotBucket = (dataList: KLineData[]): PivotBucket => {
  const deltas: number[] = []
  for (let i = 1; i < Math.min(dataList.length, 50); i++) {
    const delta = dataList[i].timestamp - dataList[i - 1].timestamp
    if (delta > 0) deltas.push(delta)
  }
  if (deltas.length === 0) return 'day'
  deltas.sort((a, b) => a - b)
  // Use the lower median so one sparse-data gap cannot promote an intraday
  // chart to weekly/monthly pivot anchoring.
  const interval = deltas[Math.floor((deltas.length - 1) / 2)]
  if (interval <= 15 * 60_000) return 'day'
  if (interval < DAY) return 'week'
  return 'month'
}

export const pivotBucketKey = (timestamp: number, bucket: PivotBucket): number => {
  if (bucket === 'day') return Math.floor(timestamp / DAY)
  if (bucket === 'week') return Math.floor((timestamp + 3 * DAY) / (7 * DAY))
  const date = new Date(timestamp)
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}

const traditionalPivots = (high: number, low: number, close: number): PivotResult => {
  const p = (high + low + close) / 3
  const range = high - low
  return {
    p,
    r1: 2 * p - low,
    s1: 2 * p - high,
    r2: p + range,
    s2: p - range,
    r3: 2 * p + (high - 2 * low),
    s3: 2 * p - (2 * high - low)
  }
}

export const pivotPoints: IndicatorTemplate<PivotResult> = {
  name: 'PIVOT',
  shortName: 'Pivot Points',
  series: IndicatorSeries.Price,
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'p', title: 'P: ', type: 'line' },
    { key: 'r1', title: 'R1: ', type: 'line' },
    { key: 's1', title: 'S1: ', type: 'line' },
    { key: 'r2', title: 'R2: ', type: 'line' },
    { key: 's2', title: 'S2: ', type: 'line' },
    { key: 'r3', title: 'R3: ', type: 'line' },
    { key: 's3', title: 'S3: ', type: 'line' }
  ],
  calc: dataList => {
    if (dataList.length === 0) return []
    const bucket = inferPivotBucket(dataList)
    const result: PivotResult[] = []
    let currentKey = pivotBucketKey(dataList[0].timestamp, bucket)
    let high = dataList[0].high
    let low = dataList[0].low
    let close = dataList[0].close
    let active: PivotResult = {}

    dataList.forEach((bar, index) => {
      const key = pivotBucketKey(bar.timestamp, bucket)
      if (index > 0 && key !== currentKey) {
        active = traditionalPivots(high, low, close)
        currentKey = key
        high = bar.high
        low = bar.low
      } else {
        high = Math.max(high, bar.high)
        low = Math.min(low, bar.low)
      }
      close = bar.close
      result.push({ ...active })
    })
    return result
  },
  draw: ({ ctx, indicator, visibleRange, defaultStyles, xAxis, yAxis }) => {
    const from = Math.max(0, visibleRange.from - 1)
    const to = Math.min(indicator.result.length, visibleRange.to)
    const plots = (indicator.styles as any)?.plots ?? {}
    indicator.figures.forEach((figure, figureIndex) => {
      const plot = plots[figure.key] ?? {}
      if (plot.visible === false) return
      let previous: number | undefined
      let started = false
      ctx.beginPath()
      for (let index = from; index < to; index++) {
        const value = indicator.result[index][figure.key as keyof PivotResult]
        if (value === undefined) {
          started = false
          previous = undefined
          continue
        }
        const x = xAxis.convertToPixel(index)
        const y = yAxis.convertToPixel(value)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else if (value !== previous) {
          ctx.lineTo(x, yAxis.convertToPixel(previous!))
          ctx.lineTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
        previous = value
      }
      ctx.globalAlpha = figureIndex === 0 ? 0.9 : 0.65
      ctx.lineWidth = plot.size ?? (figureIndex === 0 ? 1.5 : 1)
      ctx.strokeStyle = plot.color ?? defaultStyles.lines[figureIndex % defaultStyles.lines.length]?.color ?? '#76808f'
      ctx.setLineDash(plot.style === 'dashed' ? [4, 4] : [])
      ctx.stroke()
    })
    return true
  }
}

export const chaikinOscillator: IndicatorTemplate<SingleResult> = {
  name: 'CHAIKIN',
  shortName: 'Chaikin Oscillator',
  calcParams: [3, 10],
  precision: 4,
  figures: [{ key: 'value', title: 'Chaikin: ', type: 'line' }],
  draw: guideLines([0]),
  calc: (dataList, indicator) => {
    const fastPeriod = positiveInt(indicator.calcParams[0], 3)
    const slowPeriod = positiveInt(indicator.calcParams[1], 10)
    let cumulative = 0
    const adl = dataList.map(bar => {
      const range = bar.high - bar.low
      const multiplier = range === 0 ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / range
      cumulative += multiplier * (bar.volume ?? 0)
      return cumulative
    })
    const fast = optionalEma(adl, fastPeriod)
    const slow = optionalEma(adl, slowPeriod)
    return dataList.map((_, index) => fast[index] === undefined || slow[index] === undefined
      ? {}
      : { value: fast[index]! - slow[index]! })
  }
}

const medianInterval = (dataList: KLineData[]): number => {
  const deltas: number[] = []
  for (let i = 1; i < Math.min(dataList.length, 100); i++) {
    const delta = dataList[i].timestamp - dataList[i - 1].timestamp
    if (delta > 0) deltas.push(delta)
  }
  if (deltas.length === 0) return DAY
  deltas.sort((a, b) => a - b)
  return deltas[Math.floor((deltas.length - 1) / 2)]
}

export const historicalVolatility: IndicatorTemplate<SingleResult> = {
  name: 'HV',
  shortName: 'Historical Volatility',
  calcParams: [20],
  precision: 2,
  minValue: 0,
  figures: [{ key: 'value', title: 'HV: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 20)
    const returns = dataList.map((bar, index) => index === 0 || bar.close <= 0 || dataList[index - 1].close <= 0
      ? undefined
      : Math.log(bar.close / dataList[index - 1].close))
    const periodsPerYear = 365.25 * DAY / medianInterval(dataList)
    const result: SingleResult[] = dataList.map(() => ({}))
    let sum = 0
    let squareSum = 0
    let count = 0
    for (let i = 0; i < returns.length; i++) {
      const value = returns[i]
      if (value !== undefined) {
        sum += value
        squareSum += value * value
        count++
      }
      if (i > period) {
        const outgoing = returns[i - period]
        if (outgoing !== undefined) {
          sum -= outgoing
          squareSum -= outgoing * outgoing
          count--
        }
      }
      if (i >= period && count === period) {
        const mean = sum / period
        const variance = Math.max(0, squareSum / period - mean * mean)
        result[i].value = Math.sqrt(variance * periodsPerYear) * 100
      }
    }
    return result
  }
}

export const williamsAlligator: IndicatorTemplate<AlligatorResult> = {
  name: 'ALLIGATOR',
  shortName: 'Williams Alligator',
  series: IndicatorSeries.Price,
  calcParams: [13, 8, 8, 5, 5, 3],
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'jaw', title: 'Jaw: ', type: 'line', styles: () => ({ color: '#2962ff' }) },
    { key: 'teeth', title: 'Teeth: ', type: 'line', styles: () => ({ color: '#ef5350' }) },
    { key: 'lips', title: 'Lips: ', type: 'line', styles: () => ({ color: '#26a69a' }) }
  ],
  calc: (dataList, indicator) => {
    const jawPeriod = positiveInt(indicator.calcParams[0], 13)
    const jawShift = nonNegativeInt(indicator.calcParams[1], 8)
    const teethPeriod = positiveInt(indicator.calcParams[2], 8)
    const teethShift = nonNegativeInt(indicator.calcParams[3], 5)
    const lipsPeriod = positiveInt(indicator.calcParams[4], 5)
    const lipsShift = nonNegativeInt(indicator.calcParams[5], 3)
    const medianPrice = dataList.map(bar => (bar.high + bar.low) / 2)
    const jaw = wilderAverage(medianPrice, jawPeriod)
    const teeth = wilderAverage(medianPrice, teethPeriod)
    const lips = wilderAverage(medianPrice, lipsPeriod)
    const result: AlligatorResult[] = dataList.map(() => ({}))
    for (let source = 0; source < dataList.length; source++) {
      if (jaw[source] !== undefined && source + jawShift < result.length) result[source + jawShift].jaw = jaw[source]
      if (teeth[source] !== undefined && source + teethShift < result.length) result[source + teethShift].teeth = teeth[source]
      if (lips[source] !== undefined && source + lipsShift < result.length) result[source + lipsShift].lips = lips[source]
    }
    return result
  }
}

const secondWaveIndicators: IndicatorTemplate[] = [
  moneyFlowIndex,
  chaikinMoneyFlow,
  stochastic,
  aroon,
  ultimateOscillator,
  trueStrengthIndex,
  dema,
  tema,
  envelopes,
  pivotPoints,
  chaikinOscillator,
  historicalVolatility,
  williamsAlligator
]

export default secondWaveIndicators
