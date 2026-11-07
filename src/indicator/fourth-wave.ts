import {
  IndicatorSeries,
  type IndicatorTemplate
} from 'klinecharts'

import {
  atrSeries, guideLines, positiveInt, positiveNumber, rollingExtrema, rollingSum, trueRange
} from './math'

interface SingleResult { value?: number }
interface ChandelierResult { long?: number, short?: number }
interface FisherResult { fisher?: number, trigger?: number }
interface BandWidthResult { bbw?: number, expansion?: number, contraction?: number }

export const kama: IndicatorTemplate<SingleResult> = {
  name: 'KAMA',
  shortName: 'KAMA',
  series: IndicatorSeries.Price,
  calcParams: [10, 2, 30],
  precision: 4,
  shouldOhlc: true,
  figures: [{ key: 'value', title: 'KAMA: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 10)
    const fast = 2 / (positiveInt(indicator.calcParams[1], 2) + 1)
    const slow = 2 / (positiveInt(indicator.calcParams[2], 30) + 1)
    const result: SingleResult[] = dataList.map(() => ({}))
    let volatility = 0
    let value: number | undefined
    for (let i = 1; i < dataList.length; i++) {
      const close = dataList[i].close
      volatility += Math.abs(close - dataList[i - 1].close)
      if (i > period) volatility -= Math.abs(dataList[i - period].close - dataList[i - period - 1].close)
      if (i < period) continue
      const efficiency = volatility <= 0 ? 0 : Math.min(1, Math.abs(close - dataList[i - period].close) / volatility)
      const smoothing = (efficiency * (fast - slow) + slow) ** 2
      value = value ?? dataList[i - 1].close
      value += smoothing * (close - value)
      result[i] = { value }
    }
    return result
  }
}

export const chandelierExit: IndicatorTemplate<ChandelierResult> = {
  name: 'CE',
  shortName: 'Chandelier Exit',
  series: IndicatorSeries.Price,
  calcParams: [22, 3],
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'long', title: 'Long Stop: ', type: 'line', styles: () => ({ color: '#26a69a' }) },
    { key: 'short', title: 'Short Stop: ', type: 'line', styles: () => ({ color: '#ef5350' }) }
  ],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 22)
    const multiplier = positiveNumber(indicator.calcParams[1], 3)
    const atr = atrSeries(dataList, period)
    const highest = rollingExtrema(dataList.map(bar => bar.high), period, 'max')
    const lowest = rollingExtrema(dataList.map(bar => bar.low), period, 'min')
    const result: ChandelierResult[] = dataList.map(() => ({}))
    let longStop: number | undefined
    let shortStop: number | undefined
    let direction = 1
    for (let i = 0; i < dataList.length; i++) {
      const range = atr[i]
      const high = highest[i]
      const low = lowest[i]
      if (range === undefined || high === undefined || low === undefined) continue
      const close = dataList[i].close
      const previousClose = i > 0 ? dataList[i - 1].close : close
      let nextLong = high - multiplier * range
      let nextShort = low + multiplier * range
      if (longStop !== undefined && previousClose > longStop) nextLong = Math.max(nextLong, longStop)
      if (shortStop !== undefined && previousClose < shortStop) nextShort = Math.min(nextShort, shortStop)
      if (shortStop !== undefined && close > shortStop) direction = 1
      else if (longStop !== undefined && close < longStop) direction = -1
      longStop = nextLong
      shortStop = nextShort
      result[i] = direction === 1 ? { long: longStop } : { short: shortStop }
    }
    return result
  }
}

export const choppinessIndex: IndicatorTemplate<SingleResult> = {
  name: 'CHOP',
  shortName: 'Choppiness Index',
  calcParams: [14],
  precision: 2,
  minValue: 0,
  maxValue: 100,
  figures: [{ key: 'value', title: 'CHOP: ', type: 'line' }],
  draw: guideLines([38.2, 61.8]),
  calc: (dataList, indicator) => {
    const period = Math.max(2, positiveInt(indicator.calcParams[0], 14))
    const rangeSum = rollingSum(trueRange(dataList), period)
    const highest = rollingExtrema(dataList.map(bar => bar.high), period, 'max')
    const lowest = rollingExtrema(dataList.map(bar => bar.low), period, 'min')
    return dataList.map((_, index) => {
      const range = highest[index] === undefined || lowest[index] === undefined ? 0 : highest[index]! - lowest[index]!
      return range > 0 ? { value: 100 * Math.log10(rangeSum[index] / range) / Math.log10(period) } : {}
    })
  }
}

export const fisherTransform: IndicatorTemplate<FisherResult> = {
  name: 'FISHER',
  shortName: 'Fisher Transform',
  calcParams: [9],
  precision: 2,
  figures: [
    { key: 'fisher', title: 'Fisher: ', type: 'line' },
    { key: 'trigger', title: 'Trigger: ', type: 'line' }
  ],
  draw: guideLines([1.5, 0.75, 0, -0.75, -1.5]),
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 9)
    const median = dataList.map(bar => (bar.high + bar.low) / 2)
    const highest = rollingExtrema(median, period, 'max')
    const lowest = rollingExtrema(median, period, 'min')
    const result: FisherResult[] = dataList.map(() => ({}))
    let value = 0
    let fisher: number | undefined
    for (let i = 0; i < dataList.length; i++) {
      const high = highest[i]
      const low = lowest[i]
      if (high === undefined || low === undefined) continue
      const position = high === low ? 0 : (median[i] - low) / (high - low) - 0.5
      value = Math.max(-0.999, Math.min(0.999, 0.66 * position + 0.67 * value))
      const trigger = fisher
      fisher = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * (fisher ?? 0)
      result[i] = { fisher, trigger }
    }
    return result
  }
}

export const bollingerBandWidth: IndicatorTemplate<BandWidthResult> = {
  name: 'BBW',
  shortName: 'Bollinger BandWidth',
  calcParams: [20, 2, 125],
  precision: 2,
  minValue: 0,
  figures: [
    { key: 'bbw', title: 'BBW: ', type: 'line' },
    { key: 'expansion', title: 'Highest Expansion: ', type: 'line', styles: () => ({ color: '#ef5350' }) },
    { key: 'contraction', title: 'Lowest Contraction: ', type: 'line', styles: () => ({ color: '#26a69a' }) }
  ],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 20)
    const multiplier = positiveNumber(indicator.calcParams[1], 2)
    const lookback = positiveInt(indicator.calcParams[2], 125)
    const widths: number[] = []
    let mean = 0
    let squaredDeviation = 0
    for (let i = 0; i < dataList.length; i++) {
      const close = dataList[i].close
      if (i < period) {
        const delta = close - mean
        mean += delta / (i + 1)
        squaredDeviation += delta * (close - mean)
      } else {
        const outgoing = dataList[i - period].close
        const nextMean = mean + (close - outgoing) / period
        squaredDeviation += (close - outgoing) * (close - nextMean + outgoing - mean)
        mean = nextMean
      }
      if (i < period - 1) continue
      const deviation = Math.sqrt(Math.max(0, squaredDeviation / period))
      widths.push(mean === 0 ? 0 : 2 * multiplier * deviation / mean * 100)
    }
    const expansion = rollingExtrema(widths, lookback, 'max')
    const contraction = rollingExtrema(widths, lookback, 'min')
    return dataList.map((_, index) => {
      const offset = index - period + 1
      return offset < 0
        ? {}
        : { bbw: widths[offset], expansion: expansion[offset], contraction: contraction[offset] }
    })
  }
}

const fourthWaveIndicators: IndicatorTemplate[] = [
  kama,
  chandelierExit,
  choppinessIndex,
  fisherTransform,
  bollingerBandWidth
]

export default fourthWaveIndicators
