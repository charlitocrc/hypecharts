import {
  IndicatorSeries,
  type IndicatorTemplate
} from 'klinecharts'

import { guideLines, optionalEma, positiveInt, positiveNumber, rollingSum } from './math'

interface SingleResult { value?: number }
interface ChannelResult { upper?: number, middle?: number, lower?: number }
interface VortexResult { plus?: number, minus?: number }

export const linearRegressionChannel: IndicatorTemplate<ChannelResult> = {
  name: 'LRC',
  shortName: 'Linear Regression Channel',
  series: IndicatorSeries.Price,
  calcParams: [100, 2],
  precision: 4,
  shouldOhlc: true,
  figures: [
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'middle', title: 'Regression: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const period = Math.max(2, positiveInt(indicator.calcParams[0], 100))
    const multiplier = positiveNumber(indicator.calcParams[1], 2)
    const result: ChannelResult[] = dataList.map(() => ({}))
    const sumX = period * (period - 1) / 2
    const sumX2 = period * (period - 1) * (2 * period - 1) / 6
    const denominator = period * sumX2 - sumX * sumX
    let sumY = 0
    let sumY2 = 0
    let sumXY = 0

    for (let i = 0; i < dataList.length; i++) {
      const close = dataList[i].close
      if (i < period) {
        sumY += close
        sumY2 += close * close
        sumXY += i * close
      } else {
        const outgoing = dataList[i - period].close
        const retainedSum = sumY - outgoing
        sumXY = sumXY - retainedSum + (period - 1) * close
        sumY = retainedSum + close
        sumY2 += close * close - outgoing * outgoing
      }
      if (i < period - 1) continue

      const slope = (period * sumXY - sumX * sumY) / denominator
      const intercept = (sumY - slope * sumX) / period
      const fitted = intercept + slope * (period - 1)
      const squaredError = Math.max(0,
        sumY2 - 2 * intercept * sumY - 2 * slope * sumXY +
        period * intercept * intercept + 2 * intercept * slope * sumX + slope * slope * sumX2
      )
      const deviation = Math.sqrt(squaredError / period) * multiplier
      result[i] = { upper: fitted + deviation, middle: fitted, lower: fitted - deviation }
    }
    return result
  }
}

export const accumulationDistribution: IndicatorTemplate<SingleResult> = {
  name: 'ADL',
  shortName: 'Accumulation/Distribution',
  precision: 2,
  shouldFormatBigNumber: true,
  figures: [{ key: 'value', title: 'ADL: ', type: 'line' }],
  calc: dataList => {
    let cumulative = 0
    return dataList.map(bar => {
      const range = bar.high - bar.low
      const multiplier = range === 0 ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / range
      cumulative += multiplier * (bar.volume ?? 0)
      return { value: cumulative }
    })
  }
}

export const elderForceIndex: IndicatorTemplate<SingleResult> = {
  name: 'EFI',
  shortName: 'Elder Force Index',
  calcParams: [13],
  precision: 2,
  shouldFormatBigNumber: true,
  figures: [{ key: 'value', title: 'EFI: ', type: 'line' }],
  draw: guideLines([0]),
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 13)
    const force = dataList.map((bar, index) => index === 0
      ? undefined
      : (bar.close - dataList[index - 1].close) * (bar.volume ?? 0))
    const smoothed = optionalEma(force, period)
    return dataList.map((_, index) => smoothed[index] === undefined ? {} : { value: smoothed[index] })
  }
}

export const vortex: IndicatorTemplate<VortexResult> = {
  name: 'VORTEX',
  shortName: 'Vortex',
  calcParams: [14],
  precision: 4,
  minValue: 0,
  figures: [
    { key: 'plus', title: 'VI+: ', type: 'line', styles: () => ({ color: '#26a69a' }) },
    { key: 'minus', title: 'VI-: ', type: 'line', styles: () => ({ color: '#ef5350' }) }
  ],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 14)
    const trueRange = dataList.map((bar, index) => {
      if (index === 0) return 0
      const previousClose = dataList[index - 1].close
      return Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - previousClose),
        Math.abs(bar.low - previousClose)
      )
    })
    const positiveMovement = dataList.map((bar, index) => index === 0
      ? 0
      : Math.abs(bar.high - dataList[index - 1].low))
    const negativeMovement = dataList.map((bar, index) => index === 0
      ? 0
      : Math.abs(bar.low - dataList[index - 1].high))
    const rangeSum = rollingSum(trueRange, period)
    const positiveSum = rollingSum(positiveMovement, period)
    const negativeSum = rollingSum(negativeMovement, period)
    return dataList.map((_, index) => index < period || rangeSum[index] === 0
      ? {}
      : { plus: positiveSum[index] / rangeSum[index], minus: negativeSum[index] / rangeSum[index] })
  }
}

const remainingIndicators: IndicatorTemplate[] = [
  linearRegressionChannel,
  accumulationDistribution,
  elderForceIndex,
  vortex
]

export default remainingIndicators
