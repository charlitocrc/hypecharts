import {
  IndicatorSeries,
  type Indicator,
  type IndicatorFigure,
  type IndicatorTemplate,
  type KLineData
} from 'klinecharts'

import secondWaveIndicators from './second-wave'
import remainingIndicators from './remaining'
import volumeProfileIndicators from './volume-profile'
import fourthWaveIndicators from './fourth-wave'
import fifthWaveIndicators from './fifth-wave'
import sixthWaveIndicators from './sixth-wave'
import seventhWaveIndicators from './seventh-wave'
import candlePatternIndicators from './candle-patterns'
import chartPatternIndicators from './chart-patterns'
import { kdj, rsi, wr } from './bounded-guides'
import compareIndicator from './compare'
import {
  type Value, atrSeries, guideLines, optionalEma, positiveInt, positiveNumber,
  rollingExtrema, rsiSeries, simpleMovingAverage, weightedMovingAverage
} from './math'

export { weightedMovingAverage } from './math'

export {
  accumulationDistribution,
  elderForceIndex,
  linearRegressionChannel,
  vortex
} from './remaining'

export { sessionVolumeProfile, visibleRangeVolumeProfile } from './volume-profile'

export { kdj, rsi, wr } from './bounded-guides'
export { default as compareIndicator } from './compare'

export {
  bollingerBandWidth,
  chandelierExit,
  choppinessIndex,
  fisherTransform,
  kama
} from './fourth-wave'

export {
  bollingerPercentB,
  detectMaCrosses,
  emaCross,
  maCross,
  maEmaCross,
  medianPrice,
  priceOscillator,
  standardDeviation,
  typicalPrice,
  volumeOscillator
} from './fifth-wave'

export {
  arnaudLegouxMovingAverage,
  coppockCurve,
  detrendedPriceOscillator,
  klingerOscillator,
  knowSureThing,
  leastSquaresMovingAverage,
  linearRegressionSlope,
  mcginleyDynamic,
  week52HighLow,
  williamsFractal,
  zigzag
} from './sixth-wave'

export {
  chaikinVolatility,
  chandeKrollStop,
  chandeMomentumOscillator,
  connorsRsi,
  massIndex,
  relativeVigorIndex,
  relativeVolatilityIndex,
  smiErgodic,
  stochasticMomentumIndex,
  ulcerIndex,
  volatilityCloseToClose,
  volatilityOhlc,
  volatilityStop,
  volatilityZeroTrendCloseToClose
} from './seventh-wave'

export * from './candle-patterns'
export * from './chart-patterns'

export {
  aroon,
  chaikinOscillator,
  chaikinMoneyFlow,
  dema,
  envelopes,
  historicalVolatility,
  moneyFlowIndex,
  pivotPoints,
  stochastic,
  tema,
  trueStrengthIndex,
  ultimateOscillator,
  williamsAlligator
} from './second-wave'

interface AtrResult { atr?: number }
type VwapResult = Partial<Record<string, number>>
interface StochRsiResult { k?: number, d?: number }
interface SupertrendResult { up?: number, down?: number }
interface IchimokuResult { conversion?: number, base?: number, spanA?: number, spanB?: number, lagging?: number }
interface SingleLineResult { value?: number }
interface KeltnerResult { upper?: number, middle?: number, lower?: number }
interface DonchianResult { upper?: number, middle?: number, lower?: number }

const relativeStrengthIndex = (values: number[], period: number): Value[] => rsiSeries(values, period)

const midpointSeries = (highs: number[], lows: number[], period: number): Value[] => {
  const highest = rollingExtrema(highs, period, 'max')
  const lowest = rollingExtrema(lows, period, 'min')
  return highest.map((high, index) => high === undefined || lowest[index] === undefined
    ? undefined
    : (high + lowest[index]!) / 2)
}

export const atr: IndicatorTemplate<AtrResult> = {
  name: 'ATR',
  shortName: 'ATR',
  calcParams: [14],
  precision: 4,
  figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 14)
    return atrSeries(dataList, period).map(value => value === undefined ? {} : { atr: value })
  }
}

const DAY = 86_400_000
const VWAP_BAND_COLORS = ['#4caf50', '#808000', '#00897b']

const VWAP_ANCHORS =['session', 'week', 'month', 'quarter', 'year']

export const vwapAnchorKey = (timestamp: number, anchor: number): number => {
  if (anchor === 0) return Math.floor(timestamp / DAY)
  if (anchor === 1) return Math.floor((timestamp + 3 * DAY) / (7 * DAY))
  const date = new Date(timestamp)
  const year = date.getUTCFullYear()
  if (anchor === 2) return year * 12 + date.getUTCMonth()
  if (anchor === 3) return year * 4 + Math.floor(date.getUTCMonth() / 3)
  return year
}

const vwapBands = (calcParams: unknown[]): number[] =>
  calcParams.slice(1, 4).map(Number).filter(value => Number.isFinite(value) && value > 0)

const vwapFigures = (calcParams: unknown[]): Array<IndicatorFigure<VwapResult>> => [
  { key: 'vwap', title: 'VWAP: ', type: 'line' },
  ...vwapBands(calcParams).flatMap((multiplier, index) => {
    const styles = () => ({ color: VWAP_BAND_COLORS[index] })
    return [
      { key: `upper${index + 1}`, title: `+${multiplier}σ: `, type: 'line', styles },
      { key: `lower${index + 1}`, title: `-${multiplier}σ: `, type: 'line', styles }
    ]
  })
]

export const vwap: IndicatorTemplate<VwapResult> = {
  name: 'VWAP',
  shortName: 'VWAP',
  series: IndicatorSeries.Price,
  calcParams: [0, 1],
  precision: 4,
  shouldOhlc: true,
  figures: vwapFigures([0, 1]),
  regenerateFigures: vwapFigures,
  calc: (dataList, indicator) => {
    const anchor = Math.min(VWAP_ANCHORS.length - 1, Math.max(0, Math.floor(Number(indicator.calcParams[0]) || 0)))
    const bands = vwapBands(indicator.calcParams)
    let session = Number.NaN
    let base = 0
    let cumulativeVolume = 0
    let cumulativePriceVolume = 0
    let cumulativeSquareVolume = 0
    return dataList.map(bar => {
      const price = (bar.high + bar.low + bar.close) / 3
      const currentSession = vwapAnchorKey(bar.timestamp, anchor)
      if (currentSession !== session) {
        session = currentSession
        base = price
        cumulativeVolume = 0
        cumulativePriceVolume = 0
        cumulativeSquareVolume = 0
      }
      const volume = bar.volume ?? 0
      const offset = price - base
      cumulativeVolume += volume
      cumulativePriceVolume += offset * volume
      cumulativeSquareVolume += offset * offset * volume
      if (cumulativeVolume <= 0) return {}
      const mean = cumulativePriceVolume / cumulativeVolume
      const deviation = Math.sqrt(Math.max(0, cumulativeSquareVolume / cumulativeVolume - mean * mean))
      const result: VwapResult = { vwap: base + mean }
      bands.forEach((multiplier, index) => {
        result[`upper${index + 1}`] = base + mean + multiplier * deviation
        result[`lower${index + 1}`] = base + mean - multiplier * deviation
      })
      return result
    })
  }
}

export const stochasticRsi: IndicatorTemplate<StochRsiResult> = {
  name: 'STOCHRSI',
  shortName: 'Stoch RSI',
  calcParams: [14, 14, 3, 3],
  precision: 2,
  minValue: 0,
  maxValue: 100,
  figures: [
    { key: 'k', title: '%K: ', type: 'line' },
    { key: 'd', title: '%D: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const rsiPeriod = positiveInt(indicator.calcParams[0], 14)
    const stochasticPeriod = positiveInt(indicator.calcParams[1], 14)
    const kPeriod = positiveInt(indicator.calcParams[2], 3)
    const dPeriod = positiveInt(indicator.calcParams[3], 3)
    const rsi = relativeStrengthIndex(dataList.map(bar => bar.close), rsiPeriod)
    const availableRsi = rsi.slice(rsiPeriod) as number[]
    const lowestRsi = rollingExtrema(availableRsi, stochasticPeriod, 'min')
    const highestRsi = rollingExtrema(availableRsi, stochasticPeriod, 'max')
    const raw: Value[] = new Array(dataList.length).fill(undefined)
    for (let i = rsiPeriod + stochasticPeriod - 1; i < dataList.length; i++) {
      const rangeIndex = i - rsiPeriod
      const lowest = lowestRsi[rangeIndex]
      const highest = highestRsi[rangeIndex]
      const current = rsi[i]
      if (current !== undefined && lowest !== undefined && highest !== undefined) {
        raw[i] = highest === lowest ? 0 : (current - lowest) / (highest - lowest) * 100
      }
    }
    const k = simpleMovingAverage(raw, kPeriod)
    const d = simpleMovingAverage(k, dPeriod)
    return dataList.map((_, index) => ({ k: k[index], d: d[index] }))
  },
  draw: guideLines([20, 80])
}

export const supertrend: IndicatorTemplate<SupertrendResult> = {
  name: 'SUPERTREND',
  shortName: 'Supertrend',
  series: IndicatorSeries.Price,
  calcParams: [10, 3],
  precision: 4,
  shouldOhlc: true,
  figures: [
    {
      key: 'up',
      title: 'Up: ',
      type: 'line',
      styles: () => ({ color: '#26a69a' })
    },
    {
      key: 'down',
      title: 'Down: ',
      type: 'line',
      styles: () => ({ color: '#ef5350' })
    }
  ],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 10)
    const multiplier = positiveNumber(indicator.calcParams[1], 3)
    const atrValues = atrSeries(dataList, period)
    const result: SupertrendResult[] = dataList.map(() => ({}))
    let previousUpper: number | undefined
    let previousLower: number | undefined
    let previousTrend: number | undefined

    for (let i = 0; i < dataList.length; i++) {
      const currentAtr = atrValues[i]
      if (currentAtr === undefined) continue
      const bar = dataList[i]
      const midpoint = (bar.high + bar.low) / 2
      const basicUpper = midpoint + multiplier * currentAtr
      const basicLower = midpoint - multiplier * currentAtr
      const previousClose = i > 0 ? dataList[i - 1].close : bar.close
      const upper = previousUpper === undefined || basicUpper < previousUpper || previousClose > previousUpper
        ? basicUpper
        : previousUpper
      const lower = previousLower === undefined || basicLower > previousLower || previousClose < previousLower
        ? basicLower
        : previousLower
      let trend: number
      if (previousTrend === undefined) {
        trend = upper
      } else if (previousTrend === previousUpper) {
        trend = bar.close <= upper ? upper : lower
      } else {
        trend = bar.close >= lower ? lower : upper
      }
      if (trend === lower) result[i].up = trend
      else result[i].down = trend
      previousUpper = upper
      previousLower = lower
      previousTrend = trend
    }
    return result
  }
}

export const ichimoku: IndicatorTemplate<IchimokuResult> = {
  name: 'ICHIMOKU',
  shortName: 'Ichimoku',
  series: IndicatorSeries.Price,
  calcParams: [9, 26, 52, 26],
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'conversion', title: 'Conversion: ', type: 'line' },
    { key: 'base', title: 'Base: ', type: 'line' },
    { key: 'spanA', title: 'Span A: ', type: 'line' },
    { key: 'spanB', title: 'Span B: ', type: 'line' },
    { key: 'lagging', title: 'Lagging: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const conversionPeriod = positiveInt(indicator.calcParams[0], 9)
    const basePeriod = positiveInt(indicator.calcParams[1], 26)
    const spanBPeriod = positiveInt(indicator.calcParams[2], 52)
    const displacement = positiveInt(indicator.calcParams[3], 26)
    const highs = dataList.map(bar => bar.high)
    const lows = dataList.map(bar => bar.low)
    const conversion = midpointSeries(highs, lows, conversionPeriod)
    const base = midpointSeries(highs, lows, basePeriod)
    const spanBSource = midpointSeries(highs, lows, spanBPeriod)
    const result: IchimokuResult[] = dataList.map((_, index) => ({
      conversion: conversion[index],
      base: base[index]
    }))
    for (let sourceIndex = 0; sourceIndex < dataList.length; sourceIndex++) {
      const futureIndex = sourceIndex + displacement
      if (futureIndex < dataList.length) {
        if (conversion[sourceIndex] !== undefined && base[sourceIndex] !== undefined) {
          result[futureIndex].spanA = (conversion[sourceIndex]! + base[sourceIndex]!) / 2
        }
        result[futureIndex].spanB = spanBSource[sourceIndex]
      }
      const laggingIndex = sourceIndex - displacement
      if (laggingIndex >= 0) result[laggingIndex].lagging = dataList[sourceIndex].close
    }
    return result
  },
  draw: ({ ctx, indicator, visibleRange, xAxis, yAxis }) => {
    const from = Math.max(1, visibleRange.from)
    const to = Math.min(indicator.result.length, visibleRange.to)
    const bullish = '#26a69a'
    const bearish = '#ef5350'
    ctx.globalAlpha = 0.14
    for (let i = from; i < to; i++) {
      const previous = indicator.result[i - 1]
      const current = indicator.result[i]
      if (
        previous.spanA === undefined || previous.spanB === undefined ||
        current.spanA === undefined || current.spanB === undefined
      ) continue
      const x0 = xAxis.convertToPixel(i - 1)
      const x1 = xAxis.convertToPixel(i)
      ctx.beginPath()
      ctx.moveTo(x0, yAxis.convertToPixel(previous.spanA))
      ctx.lineTo(x1, yAxis.convertToPixel(current.spanA))
      ctx.lineTo(x1, yAxis.convertToPixel(current.spanB))
      ctx.lineTo(x0, yAxis.convertToPixel(previous.spanB))
      ctx.closePath()
      ctx.fillStyle = (current.spanA + previous.spanA) >= (current.spanB + previous.spanB) ? bullish : bearish
      ctx.fill()
    }
    return false
  }
}

const singleLineTemplate = (
  name: 'WMA' | 'HMA' | 'VWMA',
  defaultPeriod: number,
  calculate: (dataList: KLineData[], period: number) => Value[]
): IndicatorTemplate<SingleLineResult> => ({
  name,
  shortName: name,
  series: IndicatorSeries.Price,
  calcParams: [defaultPeriod],
  precision: 4,
  shouldOhlc: true,
  figures: [{ key: 'value', title: `${name}: `, type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], defaultPeriod)
    return calculate(dataList, period).map(value => value === undefined ? {} : { value })
  }
})

export const wma = singleLineTemplate('WMA', 9, (dataList, period) =>
  weightedMovingAverage(dataList.map(bar => bar.close), period))

export const hma = singleLineTemplate('HMA', 9, (dataList, period) => {
  const closes = dataList.map(bar => bar.close)
  const half = weightedMovingAverage(closes, Math.max(1, Math.floor(period / 2)))
  const full = weightedMovingAverage(closes, period)
  const difference = closes.map((_, index) => half[index] === undefined || full[index] === undefined
    ? undefined
    : 2 * half[index]! - full[index]!)
  return weightedMovingAverage(difference, Math.max(1, Math.round(Math.sqrt(period))))
})

export const vwma = singleLineTemplate('VWMA', 20, (dataList, period) => {
  const result: Value[] = new Array(dataList.length).fill(undefined)
  let priceVolume = 0
  let volumeSum = 0
  for (let i = 0; i < dataList.length; i++) {
    const volume = dataList[i].volume ?? 0
    priceVolume += dataList[i].close * volume
    volumeSum += volume
    if (i >= period) {
      const outgoingVolume = dataList[i - period].volume ?? 0
      priceVolume -= dataList[i - period].close * outgoingVolume
      volumeSum -= outgoingVolume
    }
    if (i >= period - 1 && volumeSum > 0) result[i] = priceVolume / volumeSum
  }
  return result
})

export const keltnerChannels: IndicatorTemplate<KeltnerResult> = {
  name: 'KC',
  shortName: 'Keltner Channels',
  series: IndicatorSeries.Price,
  calcParams: [20, 10, 2],
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'middle', title: 'Middle: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const emaPeriod = positiveInt(indicator.calcParams[0], 20)
    const atrPeriod = positiveInt(indicator.calcParams[1], 10)
    const multiplier = positiveNumber(indicator.calcParams[2], 2)
    const middle = optionalEma(dataList.map(bar => bar.close), emaPeriod)
    const range = atrSeries(dataList, atrPeriod)
    return dataList.map((_, index) => {
      if (middle[index] === undefined || range[index] === undefined) return {}
      return {
        upper: middle[index]! + multiplier * range[index]!,
        middle: middle[index],
        lower: middle[index]! - multiplier * range[index]!
      }
    })
  }
}

export const donchianChannels: IndicatorTemplate<DonchianResult> = {
  name: 'DC',
  shortName: 'Donchian Channels',
  series: IndicatorSeries.Price,
  calcParams: [20],
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'middle', title: 'Middle: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 20)
    const upper = rollingExtrema(dataList.map(bar => bar.high), period, 'max')
    const lower = rollingExtrema(dataList.map(bar => bar.low), period, 'min')
    return dataList.map((_, index) => upper[index] === undefined || lower[index] === undefined
      ? {}
      : { upper: upper[index], middle: (upper[index]! + lower[index]!) / 2, lower: lower[index] })
  }
}

const indicators: IndicatorTemplate[] = [
  atr,
  vwap,
  stochasticRsi,
  supertrend,
  ichimoku,
  wma,
  hma,
  vwma,
  keltnerChannels,
  donchianChannels,
  // core RSI/KDJ/WR re-registered with guide lines (shadow the built-ins)
  rsi,
  kdj,
  wr,
  ...secondWaveIndicators,
  ...remainingIndicators,
  ...volumeProfileIndicators,
  ...fourthWaveIndicators,
  ...fifthWaveIndicators,
  ...sixthWaveIndicators,
  ...seventhWaveIndicators,
  ...candlePatternIndicators,
  ...chartPatternIndicators,
  // M5: compare symbols ride the indicator system (see docs/m5-compare.md)
  compareIndicator
]

export const calculateIndicator = <D>(
  template: IndicatorTemplate<D>,
  dataList: KLineData[],
  calcParams = template.calcParams ?? []
): D[] => template.calc(dataList, { ...template, calcParams } as Indicator<D>) as D[]

export default indicators
