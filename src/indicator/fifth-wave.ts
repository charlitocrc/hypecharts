/**
 * Fifth wave: common built-in studies that reuse the existing averaging
 * and dispersion primitives — Bollinger %B, Standard Deviation, Typical and
 * Median price overlays, Price/Volume oscillators and the MA cross family.
 */
import {
  IndicatorSeries,
  type IndicatorDrawCallback,
  type IndicatorTemplate,
  type KLineData
} from 'klinecharts'

import {
  fillTriangle, guideLines, optionalEma, positiveInt, positiveNumber, rollingStdDev,
  simpleMovingAverage, type Value
} from './math'

interface SingleResult { value?: number }
interface PercentBResult { percent?: number }
interface OscillatorResult { ppo?: number, absolute?: number }
interface CrossResult { fast?: number, slow?: number }

type MaKind = 'sma' | 'ema'
export type MaCrossKind = 'golden' | 'death'

export const bollingerPercentB: IndicatorTemplate<PercentBResult> = {
  name: 'BBB',
  shortName: '%B',
  calcParams: [20, 2],
  precision: 2,
  figures: [{ key: 'percent', title: '%B: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 20)
    const multiplier = positiveNumber(indicator.calcParams[1], 2)
    const closes = dataList.map(bar => bar.close)
    const mid = simpleMovingAverage(closes, period)
    const deviation = rollingStdDev(closes, period)
    return dataList.map((bar, index) => {
      if (mid[index] === undefined || deviation[index] === undefined) return {}
      const upper = mid[index]! + multiplier * deviation[index]!
      const lower = mid[index]! - multiplier * deviation[index]!
      const range = upper - lower
      // %B runs 0 (lower band) to 1 (upper band).
      return range === 0 ? {} : { percent: (bar.close - lower) / range }
    })
  },
  draw: guideLines([0, 1])
}

export const standardDeviation: IndicatorTemplate<SingleResult> = {
  name: 'STDDEV',
  shortName: 'Std Dev',
  calcParams: [20],
  precision: 4,
  minValue: 0,
  figures: [{ key: 'value', title: 'Std Dev: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 20)
    return rollingStdDev(dataList.map(bar => bar.close), period)
      .map(value => value === undefined ? {} : { value })
  }
}

const priceOverlayTemplate = (
  name: 'TYP' | 'MED',
  shortName: string,
  calculate: (bar: KLineData) => number
): IndicatorTemplate<SingleResult> => ({
  name,
  shortName,
  series: IndicatorSeries.Price,
  precision: 4,
  shouldOhlc: true,
  figures: [{ key: 'value', title: `${shortName}: `, type: 'line' }],
  calc: dataList => dataList.map(bar => ({ value: calculate(bar) }))
})

export const typicalPrice = priceOverlayTemplate('TYP', 'Typical Price', bar => (bar.high + bar.low + bar.close) / 3)

export const medianPrice = priceOverlayTemplate('MED', 'Median Price', bar => (bar.high + bar.low) / 2)

export const priceOscillator: IndicatorTemplate<OscillatorResult> = {
  name: 'PPO',
  shortName: 'Price Oscillator',
  calcParams: [12, 26],
  precision: 4,
  figures: [
    { key: 'ppo', title: 'PPO: ', type: 'line' },
    { key: 'absolute', title: 'Absolute: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const fastPeriod = positiveInt(indicator.calcParams[0], 12)
    const slowPeriod = positiveInt(indicator.calcParams[1], 26)
    const closes = dataList.map(bar => bar.close)
    const fast = optionalEma(closes, fastPeriod)
    const slow = optionalEma(closes, slowPeriod)
    return dataList.map((_, index) => {
      if (fast[index] === undefined || slow[index] === undefined) return {}
      const difference = fast[index]! - slow[index]!
      return {
        ppo: slow[index] === 0 ? undefined : difference / slow[index]! * 100,
        absolute: difference
      }
    })
  },
  draw: guideLines([0])
}

export const volumeOscillator: IndicatorTemplate<SingleResult> = {
  name: 'VO',
  shortName: 'Volume Oscillator',
  calcParams: [5, 10],
  precision: 2,
  figures: [{ key: 'value', title: 'VO: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const fastPeriod = positiveInt(indicator.calcParams[0], 5)
    const slowPeriod = positiveInt(indicator.calcParams[1], 10)
    const volumes = dataList.map(bar => bar.volume ?? 0)
    const fast = simpleMovingAverage(volumes, fastPeriod)
    const slow = simpleMovingAverage(volumes, slowPeriod)
    return dataList.map((_, index) => fast[index] === undefined || slow[index] === undefined || slow[index] === 0
      ? {}
      : { value: (fast[index]! - slow[index]!) / slow[index]! * 100 })
  },
  draw: guideLines([0])
}

/** First index where the fast series crosses the slow series, per bar. */
export const detectMaCrosses = (fast: Value[], slow: Value[]): Array<MaCrossKind | undefined> => {
  const crosses: Array<MaCrossKind | undefined> = new Array(fast.length).fill(undefined)
  for (let i = 1; i < fast.length; i++) {
    const previousFast = fast[i - 1]
    const previousSlow = slow[i - 1]
    const currentFast = fast[i]
    const currentSlow = slow[i]
    if (
      previousFast === undefined || previousSlow === undefined ||
      currentFast === undefined || currentSlow === undefined
    ) continue
    // Ties count as "was on that side" so the common flat-seed case still
    // marks the divergence bar once; strict inequalities would miss it.
    if (previousFast <= previousSlow && currentFast > currentSlow) crosses[i] = 'golden'
    else if (previousFast >= previousSlow && currentFast < currentSlow) crosses[i] = 'death'
  }
  return crosses
}

const drawCrossMarkers: IndicatorDrawCallback = ({ ctx, indicator, visibleRange, xAxis, yAxis }) => {
  const rows = indicator.result as CrossResult[]
  const crosses = detectMaCrosses(rows.map(row => row.fast), rows.map(row => row.slow))
  const from = Math.max(1, visibleRange.from)
  const to = Math.min(rows.length, visibleRange.to)
  for (let i = from; i < to; i++) {
    const kind = crosses[i]
    const row = rows[i]
    if (kind === undefined || row.fast === undefined || row.slow === undefined) continue
    const x = xAxis.convertToPixel(i)
    const y = (yAxis.convertToPixel(row.fast) + yAxis.convertToPixel(row.slow)) / 2
    // Golden cross draws an up-triangle below the intersection, death cross a
    // down-triangle above it; screen y grows downward.
    ctx.fillStyle = kind === 'golden' ? '#26a69a' : '#ef5350'
    fillTriangle(ctx, x, y + (kind === 'golden' ? 10 : -10), kind === 'golden' ? 1 : -1)
  }
  return false
}

const maCrossTemplate = (
  name: 'MACROSS' | 'MAEMACROSS' | 'EMACROSS',
  shortName: string,
  fastKind: MaKind,
  slowKind: MaKind
): IndicatorTemplate<CrossResult> => ({
  name,
  shortName,
  series: IndicatorSeries.Price,
  calcParams: [9, 21],
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'fast', title: 'Fast: ', type: 'line' },
    { key: 'slow', title: 'Slow: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const fastPeriod = positiveInt(indicator.calcParams[0], 9)
    const slowPeriod = positiveInt(indicator.calcParams[1], 21)
    const closes = dataList.map(bar => bar.close)
    const fast = fastKind === 'ema' ? optionalEma(closes, fastPeriod) : simpleMovingAverage(closes, fastPeriod)
    const slow = slowKind === 'ema' ? optionalEma(closes, slowPeriod) : simpleMovingAverage(closes, slowPeriod)
    return dataList.map((_, index) => fast[index] === undefined || slow[index] === undefined
      ? {}
      : { fast: fast[index], slow: slow[index] })
  },
  draw: drawCrossMarkers
})

export const maCross = maCrossTemplate('MACROSS', 'MA Cross', 'sma', 'sma')

export const maEmaCross = maCrossTemplate('MAEMACROSS', 'MA with EMA Cross', 'sma', 'ema')

export const emaCross = maCrossTemplate('EMACROSS', 'EMA Cross', 'ema', 'ema')

const indicators: IndicatorTemplate[] = [
  bollingerPercentB,
  standardDeviation,
  typicalPrice,
  medianPrice,
  priceOscillator,
  volumeOscillator,
  maCross,
  maEmaCross,
  emaCross
]

export default indicators
