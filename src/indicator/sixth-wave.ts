/**
 * Sixth wave: the trader staples from the parity matrix — DPO, Coppock Curve,
 * Klinger Oscillator, Know Sure Thing, McGinley Dynamic, ALMA, LSMA/Linear
 * Regression Slope, Zig Zag, Williams Fractal and 52 Week High/Low. Formulas
 * follow published reference definitions where they exist (see
 * docs/indicator-parity-matrix.md caveats for what is and isn't documented).
 */
import {
  IndicatorSeries,
  type IndicatorDrawCallback,
  type IndicatorFigure,
  type IndicatorTemplate,
  type KLineData
} from 'klinecharts'

import {
  DAY, fillTriangle, guideLines, optionalEma, positiveInt, positiveNumber,
  rateOfChange, rollingLeastSquares, rollingTimeExtrema,
  simpleMovingAverage, weightedMovingAverage, type Value
} from './math'

interface SingleResult { value?: number }
interface KvoResult { kvo?: number, signal?: number }
interface KstResult { kst?: number, signal?: number }
interface FractalResult { up?: number, down?: number }
interface Week52Result { high?: number, low?: number }
interface ZigZagResult { value?: number }

export const detrendedPriceOscillator: IndicatorTemplate<SingleResult> = {
  name: 'DPO',
  shortName: 'DPO',
  calcParams: [21],
  precision: 4,
  figures: [{ key: 'value', title: 'DPO: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 21)
    const shift = Math.floor(period / 2) + 1
    const closes = dataList.map(bar => bar.close)
    const basis = simpleMovingAverage(closes, period)
    return dataList.map((bar, index) => {
      const reference = basis[index - shift]
      return reference === undefined ? {} : { value: bar.close - reference }
    })
  },
  draw: guideLines([0])
}

export const coppockCurve: IndicatorTemplate<SingleResult> = {
  name: 'COPPOCK',
  shortName: 'Coppock Curve',
  calcParams: [14, 11, 10],
  precision: 2,
  figures: [{ key: 'value', title: 'Coppock: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const longPeriod = positiveInt(indicator.calcParams[0], 14)
    const shortPeriod = positiveInt(indicator.calcParams[1], 11)
    const smoothing = positiveInt(indicator.calcParams[2], 10)
    const closes = dataList.map(bar => bar.close)
    const longRoc = rateOfChange(closes, longPeriod)
    const shortRoc = rateOfChange(closes, shortPeriod)
    const sum = longRoc.map((value, index) => {
      const other = shortRoc[index]
      return value === undefined || other === undefined ? undefined : value + other
    })
    return weightedMovingAverage(sum, smoothing).map(value => value === undefined ? {} : { value })
  },
  draw: guideLines([0])
}

export const klingerOscillator: IndicatorTemplate<KvoResult> = {
  name: 'KVO',
  shortName: 'Klinger Oscillator',
  calcParams: [34, 55, 13],
  precision: 2,
  figures: [
    { key: 'kvo', title: 'KVO: ', type: 'line' },
    { key: 'signal', title: 'Signal: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const fast = positiveInt(indicator.calcParams[0], 34)
    const slow = positiveInt(indicator.calcParams[1], 55)
    const signalPeriod = positiveInt(indicator.calcParams[2], 13)
    // Documented volume force: VF = volume × 2 × (dm/cm − 1) ×
    // trend × 100, where the trend is +1 on an HLC-sum rise and −1 otherwise
    // (ties included), and cm accumulates dm while the trend holds.
    const force: Value[] = []
    let trend = 1
    let previousTrend = 1
    let cumulativeMeasure = 0
    let previousRange = 0
    for (let i = 0; i < dataList.length; i++) {
      const range = dataList[i].high - dataList[i].low
      const sum = dataList[i].high + dataList[i].low + dataList[i].close
      if (i > 0) {
        const previousSum = dataList[i - 1].high + dataList[i - 1].low + dataList[i - 1].close
        trend = sum > previousSum ? 1 : -1
        cumulativeMeasure = trend === previousTrend ? cumulativeMeasure + range : previousRange + range
      } else {
        cumulativeMeasure = range
      }
      const ratioTerm = cumulativeMeasure > 0 ? 2 * (range / cumulativeMeasure - 1) : 0
      force.push((dataList[i].volume ?? 0) * ratioTerm * trend * 100)
      previousTrend = trend
      previousRange = range
    }
    const fastEma = optionalEma(force, fast)
    const slowEma = optionalEma(force, slow)
    const kvo = fastEma.map((value, index) => {
      const baseline = slowEma[index]
      return value === undefined || baseline === undefined ? undefined : value - baseline
    })
    const signal = optionalEma(kvo, signalPeriod)
    return dataList.map((_, index) => ({
      kvo: kvo[index],
      signal: signal[index]
    }))
  },
  draw: guideLines([0])
}

export const knowSureThing: IndicatorTemplate<KstResult> = {
  name: 'KST',
  shortName: 'KST',
  calcParams: [10, 15, 20, 30, 10, 10, 10, 15, 9],
  precision: 2,
  figures: [
    { key: 'kst', title: 'KST: ', type: 'line' },
    { key: 'signal', title: 'Signal: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const rocPeriods = [0, 1, 2, 3].map(slot => positiveInt(indicator.calcParams[slot], 10))
    const smoothings = [4, 5, 6, 7].map(slot => positiveInt(indicator.calcParams[slot], 10))
    const signalPeriod = positiveInt(indicator.calcParams[8], 9)
    const closes = dataList.map(bar => bar.close)
    const weighted = rocPeriods.map((period, slot) =>
      simpleMovingAverage(rateOfChange(closes, period), smoothings[slot]))
    const kst = closes.map((_, index) => {
      let sum = 0
      for (let slot = 0; slot < 4; slot++) {
        const value = weighted[slot][index]
        if (value === undefined) return undefined
        sum += value * (slot + 1)
      }
      return sum
    })
    const signal = simpleMovingAverage(kst, signalPeriod)
    return dataList.map((_, index) => ({
      kst: kst[index],
      signal: signal[index]
    }))
  },
  draw: guideLines([0])
}

export const mcginleyDynamic: IndicatorTemplate<SingleResult> = {
  name: 'MCGINLEY',
  shortName: 'McGinley Dynamic',
  series: IndicatorSeries.Price,
  calcParams: [14],
  precision: 4,
  shouldOhlc: true,
  figures: [{ key: 'value', title: 'MD: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 14)
    let dynamic: number | undefined
    return dataList.map(bar => {
      if (dynamic === undefined) {
        dynamic = bar.close
        return { value: dynamic }
      }
      const ratio = dynamic > 0 && bar.close > 0 ? bar.close / dynamic : 1
      dynamic += (bar.close - dynamic) / (period * ratio ** 4)
      return { value: dynamic }
    })
  }
}

export const arnaudLegouxMovingAverage: IndicatorTemplate<SingleResult> = {
  name: 'ALMA',
  shortName: 'ALMA',
  series: IndicatorSeries.Price,
  calcParams: [9, 0.85, 6],
  precision: 4,
  shouldOhlc: true,
  figures: [{ key: 'value', title: 'ALMA: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 9)
    // offset legitimately spans [0, 1] — unlike the other params it must not
    // be rejected when zero, so it is clamped instead of defaulted
    const rawOffset = Number(indicator.calcParams[1])
    const offset = Math.min(1, Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0.85))
    const sigma = positiveNumber(indicator.calcParams[2], 6)
    const spread = period / sigma
    const center = offset * (period - 1)
    const weights: number[] = []
    let weightSum = 0
    for (let k = 0; k < period; k++) {
      const weight = Math.exp(-((k - center) ** 2) / (2 * spread ** 2))
      weights.push(weight)
      weightSum += weight
    }
    const closes = dataList.map(bar => bar.close)
    return dataList.map((_, index) => {
      if (index < period - 1) return {}
      let weightedSum = 0
      for (let k = 0; k < period; k++) weightedSum += weights[k] * closes[index - period + 1 + k]
      return { value: weightedSum / weightSum }
    })
  }
}

export const leastSquaresMovingAverage: IndicatorTemplate<SingleResult> = {
  name: 'LSMA',
  shortName: 'LSMA',
  series: IndicatorSeries.Price,
  calcParams: [25],
  precision: 4,
  shouldOhlc: true,
  figures: [{ key: 'value', title: 'LSMA: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 25)
    return rollingLeastSquares(dataList.map(bar => bar.close), period)
      .map(fit => fit.value === undefined ? {} : { value: fit.value })
  }
}

export const linearRegressionSlope: IndicatorTemplate<SingleResult> = {
  name: 'LRSLOPE',
  shortName: 'Lin Reg Slope',
  calcParams: [25],
  precision: 4,
  figures: [{ key: 'value', title: 'Slope: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 25)
    return rollingLeastSquares(dataList.map(bar => bar.close), period)
      .map(fit => fit.slope === undefined ? {} : { value: fit.slope })
  },
  draw: guideLines([0])
}

const zigzagFigures: IndicatorFigure<ZigZagResult>[] = [
  { key: 'value', title: 'Zig Zag: ', type: 'line' }
]

const drawZigzag: IndicatorDrawCallback = ({ ctx, indicator, visibleRange, xAxis, yAxis, defaultStyles }) => {
  const rows = indicator.result as ZigZagResult[]
  const pivots: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value !== undefined) pivots.push(i)
  }
  if (pivots.length === 0) return false
  const style = defaultStyles.lines?.[0]
  ctx.strokeStyle = style?.color ?? '#76808f'
  ctx.lineWidth = style?.size ?? 2
  const from = visibleRange.from
  const to = visibleRange.to
  let start = pivots.findIndex(index => index >= from - 1)
  // every pivot sits left of the viewport — nothing to draw
  if (start === -1) return false
  // anchor on the last pivot before the viewport so a leg crossing the whole
  // screen still renders
  if (start > 0) start--
  let end = start
  while (end + 1 < pivots.length && pivots[end + 1] <= to) end++
  // include one pivot past the right edge so the exiting leg renders too
  if (end + 1 < pivots.length) end++
  ctx.beginPath()
  let drawing = false
  for (let p = start; p <= end; p++) {
    const x = xAxis.convertToPixel(pivots[p])
    const y = yAxis.convertToPixel(rows[pivots[p]].value!)
    if (!drawing) {
      ctx.moveTo(x, y)
      drawing = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  if (drawing) ctx.stroke()
  return false
}

export const zigzag: IndicatorTemplate<ZigZagResult> = {
  name: 'ZIGZAG',
  shortName: 'Zig Zag',
  series: IndicatorSeries.Price,
  shouldOhlc: true,
  calcParams: [12, 5],
  precision: 4,
  figures: zigzagFigures,
  calc: (dataList, indicator) => {
    const legs = positiveInt(indicator.calcParams[0], 12)
    const deviation = positiveNumber(indicator.calcParams[1], 5) / 100
    const result: ZigZagResult[] = dataList.map(() => ({}))
    if (dataList.length === 0) return result
    let direction: 1 | -1 = 1
    let extremeIndex = 0
    let extremePrice = dataList[0].high
    const pivots: Array<{ index: number, price: number }> = []
    for (let i = 1; i < dataList.length; i++) {
      const bar = dataList[i]
      if (direction === 1) {
        if (bar.high >= extremePrice) {
          extremePrice = bar.high
          extremeIndex = i
        } else if (bar.low <= extremePrice * (1 - deviation) && i - extremeIndex >= legs) {
          pivots.push({ index: extremeIndex, price: extremePrice })
          direction = -1
          extremePrice = bar.low
          extremeIndex = i
        }
      } else {
        if (bar.low <= extremePrice) {
          extremePrice = bar.low
          extremeIndex = i
        } else if (bar.high >= extremePrice * (1 + deviation) && i - extremeIndex >= legs) {
          pivots.push({ index: extremeIndex, price: extremePrice })
          direction = 1
          extremePrice = bar.high
          extremeIndex = i
        }
      }
    }
    // the live leg: current extreme renders so the last segment follows price
    if (pivots.length === 0 || pivots[pivots.length - 1].index !== extremeIndex) {
      pivots.push({ index: extremeIndex, price: extremePrice })
    }
    pivots.forEach(pivot => { result[pivot.index].value = pivot.price })
    return result
  },
  draw: drawZigzag
}

const drawFractals: IndicatorDrawCallback = ({ ctx, indicator, visibleRange, xAxis, yAxis }) => {
  const rows = indicator.result as FractalResult[]
  const from = Math.max(0, visibleRange.from)
  const to = Math.min(rows.length, visibleRange.to)
  for (let i = from; i < to; i++) {
    const row = rows[i]
    const x = xAxis.convertToPixel(i)
    if (row.up !== undefined) {
      // fractal high: bearish marker above the high
      ctx.fillStyle = '#ef5350'
      fillTriangle(ctx, x, yAxis.convertToPixel(row.up) - 8, -1)
    }
    if (row.down !== undefined) {
      // fractal low: bullish marker below the low
      ctx.fillStyle = '#26a69a'
      fillTriangle(ctx, x, yAxis.convertToPixel(row.down) + 8, 1)
    }
  }
  return false
}

export const williamsFractal: IndicatorTemplate<FractalResult> = {
  name: 'FRACTAL',
  shortName: 'Williams Fractal',
  series: IndicatorSeries.Price,
  shouldOhlc: true,
  calcParams: [2],
  precision: 4,
  figures: [
    { key: 'up', title: 'Up Fractal: ', type: 'line' },
    { key: 'down', title: 'Down Fractal: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const bars = positiveInt(indicator.calcParams[0], 2)
    return dataList.map((bar, index) => {
      if (index < bars || index + bars >= dataList.length) return {}
      let isHigh = true
      let isLow = true
      for (let k = 1; k <= bars; k++) {
        if (!(bar.high > dataList[index - k].high && bar.high > dataList[index + k].high)) isHigh = false
        if (!(bar.low < dataList[index - k].low && bar.low < dataList[index + k].low)) isLow = false
      }
      return {
        up: isHigh ? bar.high : undefined,
        down: isLow ? bar.low : undefined
      }
    })
  },
  draw: drawFractals
}

const WEEKS_PER_YEAR = 52

export const week52HighLow: IndicatorTemplate<Week52Result> = {
  name: 'W52',
  shortName: '52 Week High/Low',
  series: IndicatorSeries.Price,
  calcParams: [WEEKS_PER_YEAR],
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'high', title: '52w High: ', type: 'line', styles: () => ({ color: '#26a69a' }) },
    { key: 'low', title: '52w Low: ', type: 'line', styles: () => ({ color: '#ef5350' }) }
  ],
  calc: (dataList, indicator) => {
    const weeks = positiveInt(indicator.calcParams[0], WEEKS_PER_YEAR)
    const window = weeks * 7 * DAY
    const highs = rollingTimeExtrema(dataList, window, 'high')
    const lows = rollingTimeExtrema(dataList, window, 'low')
    return dataList.map((_, index) => ({
      high: highs[index],
      low: lows[index]
    }))
  }
}

const indicators: IndicatorTemplate[] = [
  detrendedPriceOscillator,
  coppockCurve,
  klingerOscillator,
  knowSureThing,
  mcginleyDynamic,
  arnaudLegouxMovingAverage,
  leastSquaresMovingAverage,
  linearRegressionSlope,
  zigzag,
  williamsFractal,
  week52HighLow
]

export default indicators
