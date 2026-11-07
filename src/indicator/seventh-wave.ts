/**
 * Seventh wave: the volatility family from the parity matrix — Chaikin
 * Volatility, Relative Volatility Index, the three TV Volatility estimators,
 * Ulcer Index, Volatility Stop, Chande Kroll Stop, CMO, Connors RSI, SMI,
 * Mass Index, SMI Ergodic and Relative Vigor Index. Where published
 * articles document formulas they are followed (SMI, Connors RSI, Mass
 * Index, Ulcer Index, SMI Ergodic); the rest use the classic definitions
 * (docs/indicator-parity-matrix.md caveats track what is undocumented).
 */
import {
  IndicatorSeries,
  type IndicatorTemplate
} from 'klinecharts'

import {
  atrSeries, guideLines, optionalEma, percentRank, positiveInt, positiveNumber,
  rateOfChange, rollingExtrema, rollingRms, rollingStdDev, rsiSeries,
  simpleMovingAverage, trueRange, wilderAverage, type Value
} from './math'

interface SingleResult { value?: number }
interface TwoLineResult { value?: number, signal?: number }
interface StopResult { up?: number, down?: number }
interface ChandeKrollResult { long?: number, short?: number }
interface ErgodicResult { ergodic?: number, signal?: number, oscillator?: number }

const logReturns = (closes: number[]): number[] =>
  closes.slice(1).map((close, index) => Math.log(close / closes[index]))

const annualize = (value: number, barsPerYear: number): number =>
  Math.sqrt(barsPerYear) * value * 100

export const chaikinVolatility: IndicatorTemplate<SingleResult> = {
  name: 'CHAVOL',
  shortName: 'Chaikin Volatility',
  calcParams: [10, 10],
  precision: 2,
  figures: [{ key: 'value', title: 'CHV: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const emaPeriod = positiveInt(indicator.calcParams[0], 10)
    const span = positiveInt(indicator.calcParams[1], 10)
    const spread = dataList.map(bar => bar.high - bar.low)
    const ema = optionalEma(spread, emaPeriod)
    return dataList.map((_, index) => {
      const base = ema[index - span]
      const current = ema[index]
      if (base === undefined || current === undefined || base === 0) return {}
      return { value: (current - base) / base * 100 }
    })
  }
}

export const relativeVolatilityIndex: IndicatorTemplate<SingleResult> = {
  name: 'RVI',
  shortName: 'Rel Volatility Index',
  calcParams: [10, 14],
  precision: 2,
  minValue: 0,
  maxValue: 100,
  figures: [{ key: 'value', title: 'RVI: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 10)
    const smoothing = positiveInt(indicator.calcParams[1], 14)
    const closes = dataList.map(bar => bar.close)
    const deviation = rollingStdDev(closes, period)
    // Dorsey: feed the standard deviation through an RSI-style smoother,
    // counting it as upside when the close rises and downside when it falls.
    let sumUp = 0
    let sumDown = 0
    let averageUp = 0
    let averageDown = 0
    let count = 0
    return dataList.map((bar, index) => {
      const deviationValue = deviation[index]
      if (index === 0 || deviationValue === undefined) return {}
      const up = bar.close > dataList[index - 1].close ? deviationValue : 0
      const down = bar.close < dataList[index - 1].close ? deviationValue : 0
      if (count < smoothing) {
        sumUp += up
        sumDown += down
        count++
        if (count < smoothing) return {}
        averageUp = sumUp / smoothing
        averageDown = sumDown / smoothing
      } else {
        averageUp = (averageUp * (smoothing - 1) + up) / smoothing
        averageDown = (averageDown * (smoothing - 1) + down) / smoothing
      }
      const total = averageUp + averageDown
      return { value: total === 0 ? 50 : averageUp / total * 100 }
    })
  }
}

export const volatilityCloseToClose: IndicatorTemplate<SingleResult> = {
  name: 'C2C',
  shortName: 'Volatility C2C',
  calcParams: [10, 252],
  precision: 2,
  minValue: 0,
  figures: [{ key: 'value', title: 'C2C: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 10)
    const barsPerYear = positiveNumber(indicator.calcParams[1], 252)
    // Close-to-close keeps the drift: RMS of log returns, not the de-meaned
    // standard deviation (that is the Zero Trend variant below).
    const rms = rollingRms(logReturns(dataList.map(bar => bar.close)), period)
    return dataList.map((_, index) => {
      const value = rms[index - 1]
      return value === undefined ? {} : { value: annualize(value, barsPerYear) }
    })
  }
}

export const volatilityZeroTrendCloseToClose: IndicatorTemplate<SingleResult> = {
  name: 'C2CZT',
  shortName: 'Volatility C2C ZT',
  calcParams: [10, 252],
  precision: 2,
  minValue: 0,
  figures: [{ key: 'value', title: 'C2C ZT: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 10)
    const barsPerYear = positiveNumber(indicator.calcParams[1], 252)
    const deviation = rollingStdDev(logReturns(dataList.map(bar => bar.close)), period)
    return dataList.map((_, index) => {
      const value = deviation[index - 1]
      return value === undefined ? {} : { value: annualize(value, barsPerYear) }
    })
  }
}

export const volatilityOhlc: IndicatorTemplate<SingleResult> = {
  name: 'VOHLC',
  shortName: 'Volatility O-H-L-C',
  calcParams: [10, 252],
  precision: 2,
  minValue: 0,
  figures: [{ key: 'value', title: 'O-H-L-C: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 10)
    const barsPerYear = positiveNumber(indicator.calcParams[1], 252)
    // Per-bar squared log ratios of the four prices, sliding-summed.
    const squares: number[] = dataList.map((bar, index) => {
      if (index === 0) return 0
      const previousClose = dataList[index - 1].close
      return Math.log(bar.open / previousClose) ** 2 +
        Math.log(bar.high / bar.open) ** 2 +
        Math.log(bar.low / bar.high) ** 2 +
        Math.log(bar.close / bar.low) ** 2
    })
    let sum = 0
    return dataList.map((_, index) => {
      sum += squares[index]
      if (index >= period) sum -= squares[index - period]
      if (index < period) return {}
      return { value: annualize(Math.sqrt(sum / (4 * period)), barsPerYear) }
    })
  }
}

export const ulcerIndex: IndicatorTemplate<SingleResult> = {
  name: 'UI',
  shortName: 'Ulcer Index',
  calcParams: [14],
  precision: 2,
  minValue: 0,
  figures: [{ key: 'value', title: 'UI: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 14)
    const closes = dataList.map(bar => bar.close)
    const highest = rollingExtrema(closes, period, 'max')
    const squaredDrawdowns: Value[] = closes.map((close, index) => {
      const peak = highest[index]
      return peak === undefined ? undefined : ((close - peak) / peak * 100) ** 2
    })
    const meanSquare = simpleMovingAverage(squaredDrawdowns, period)
    return dataList.map((_, index) => {
      const value = meanSquare[index]
      return value === undefined ? {} : { value: Math.sqrt(value) }
    })
  }
}

export const volatilityStop: IndicatorTemplate<StopResult> = {
  name: 'VSTOP',
  shortName: 'Volatility Stop',
  series: IndicatorSeries.Price,
  shouldOhlc: true,
  calcParams: [20, 2],
  precision: 4,
  figures: [
    { key: 'up', title: 'Up: ', type: 'line', styles: () => ({ color: '#26a69a' }) },
    { key: 'down', title: 'Down: ', type: 'line', styles: () => ({ color: '#ef5350' }) }
  ],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 20)
    const coefficient = positiveNumber(indicator.calcParams[1], 2)
    const atr = wilderAverage(trueRange(dataList), period)
    const result: StopResult[] = dataList.map(() => ({}))
    let upBound: number | undefined
    let dnBound: number | undefined
    let stop: number | undefined
    for (let i = 0; i < dataList.length; i++) {
      const atrValue = atr[i]
      if (atrValue === undefined) continue
      const bar = dataList[i]
      const up = bar.low - coefficient * atrValue
      const down = bar.high + coefficient * atrValue
      const previousClose = i > 0 ? dataList[i - 1].close : bar.close
      // bounds compare against the previous bar's values (Pine's [1] series)
      const previousUp = upBound
      const previousDown = dnBound
      const inDowntrend = previousDown !== undefined && previousClose < previousDown
      const inUptrend = previousUp !== undefined && previousClose > previousUp
      upBound = inDowntrend || previousClose > (previousUp ?? up)
        ? Math.max(up, previousUp ?? up)
        : up
      dnBound = inUptrend || previousClose < (previousDown ?? down)
        ? Math.min(down, previousDown ?? down)
        : down
      if (i > 0 && previousClose > (previousUp ?? up)) stop = upBound
      else if (i > 0 && previousClose < (previousDown ?? down)) stop = dnBound
      else stop = stop ?? dnBound
      if (bar.close >= stop) result[i].up = stop
      else result[i].down = stop
    }
    return result
  }
}

export const chandeKrollStop: IndicatorTemplate<ChandeKrollResult> = {
  name: 'CKS',
  shortName: 'Chande Kroll Stop',
  series: IndicatorSeries.Price,
  shouldOhlc: true,
  calcParams: [10, 9, 1],
  precision: 4,
  figures: [
    { key: 'long', title: 'Long Stop: ', type: 'line', styles: () => ({ color: '#26a69a' }) },
    { key: 'short', title: 'Short Stop: ', type: 'line', styles: () => ({ color: '#ef5350' }) }
  ],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 10)
    const offset = positiveInt(indicator.calcParams[1], 9)
    const coefficient = positiveNumber(indicator.calcParams[2], 1)
    const highs = dataList.map(bar => bar.high)
    const lows = dataList.map(bar => bar.low)
    const atr = atrSeries(dataList, period)
    const highest = rollingExtrema(highs, period, 'max')
    const lowest = rollingExtrema(lows, period, 'min')
    // first-pass stops, shifted so the extrema helpers see gap-free arrays
    const rawLong = highest.map((peak, index) =>
      peak === undefined || atr[index] === undefined ? undefined : peak - coefficient * atr[index]!)
    const rawShort = lowest.map((floor, index) =>
      floor === undefined || atr[index] === undefined ? undefined : floor + coefficient * atr[index]!)
    const shift = period - 1
    const longStops = rollingExtrema(rawLong.slice(shift).map(value => value ?? Infinity), offset, 'min')
    const shortStops = rollingExtrema(rawShort.slice(shift).map(value => value ?? -Infinity), offset, 'max')
    return dataList.map((_, index) => {
      if (index < shift + offset - 1) return {}
      return {
        long: longStops[index - shift],
        short: shortStops[index - shift]
      }
    })
  }
}

export const chandeMomentumOscillator: IndicatorTemplate<SingleResult> = {
  name: 'CMO',
  shortName: 'CMO',
  calcParams: [20],
  precision: 2,
  minValue: -100,
  maxValue: 100,
  figures: [{ key: 'value', title: 'CMO: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 20)
    const changes = dataList.map((bar, index) =>
      index === 0 ? 0 : bar.close - dataList[index - 1].close)
    let upSum = 0
    let downSum = 0
    return dataList.map((_, index) => {
      const change = changes[index]
      if (index >= period) {
        const outgoing = changes[index - period]
        upSum -= Math.max(outgoing, 0)
        downSum -= Math.max(-outgoing, 0)
      }
      upSum += Math.max(change, 0)
      downSum += Math.max(-change, 0)
      if (index < period) return {}
      const total = upSum + downSum
      return { value: total === 0 ? 0 : (upSum - downSum) / total * 100 }
    })
  },
  draw: guideLines([-50, 50])
}

export const connorsRsi: IndicatorTemplate<SingleResult> = {
  name: 'CRSI',
  shortName: 'Connors RSI',
  calcParams: [3, 2, 100],
  precision: 2,
  minValue: 0,
  maxValue: 100,
  figures: [{ key: 'value', title: 'CRSI: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const rsiPeriod = positiveInt(indicator.calcParams[0], 3)
    const streakPeriod = positiveInt(indicator.calcParams[1], 2)
    const rankPeriod = positiveInt(indicator.calcParams[2], 100)
    const closes = dataList.map(bar => bar.close)
    const baseRsi = rsiSeries(closes, rsiPeriod)
    const streaks: number[] = new Array(dataList.length).fill(0)
    for (let index = 1; index < dataList.length; index++) {
      const change = dataList[index].close - dataList[index - 1].close
      if (change === 0) continue
      const previous = streaks[index - 1]
      streaks[index] = change > 0
        ? (previous > 0 ? previous + 1 : 1)
        : (previous < 0 ? previous - 1 : -1)
    }
    const streakRsi = rsiSeries(streaks, streakPeriod)
    const rank = percentRank(rateOfChange(closes, 1), rankPeriod)
    return dataList.map((_, index) => {
      const rsiValue = baseRsi[index]
      const streakValue = streakRsi[index]
      const rankValue = rank[index]
      if (rsiValue === undefined || streakValue === undefined || rankValue === undefined) return {}
      return { value: (rsiValue + streakValue + rankValue) / 3 }
    })
  },
  draw: guideLines([10, 90])
}

export const stochasticMomentumIndex: IndicatorTemplate<TwoLineResult> = {
  name: 'SMI',
  shortName: 'Stochastic Momentum Index',
  calcParams: [10, 3, 5],
  precision: 2,
  minValue: -100,
  maxValue: 100,
  figures: [
    { key: 'value', title: 'SMI: ', type: 'line' },
    { key: 'signal', title: 'Signal: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const period = positiveInt(indicator.calcParams[0], 10)
    const smoothing = positiveInt(indicator.calcParams[1], 3)
    const signalPeriod = positiveInt(indicator.calcParams[2], 5)
    const highest = rollingExtrema(dataList.map(bar => bar.high), period, 'max')
    const lowest = rollingExtrema(dataList.map(bar => bar.low), period, 'min')
    // SMI: both sides are double-EMA-smoothed with the %D
    // length and the ratio scales by 200 against the full range.
    const relative = dataList.map((bar, index) => {
      const peak = highest[index]
      const floor = lowest[index]
      return peak === undefined || floor === undefined
        ? undefined
        : bar.close - (peak + floor) / 2
    })
    const range = highest.map((peak, index) => {
      const floor = lowest[index]
      return peak === undefined || floor === undefined ? undefined : peak - floor
    })
    const numerator = optionalEma(optionalEma(relative, smoothing), smoothing)
    const denominator = optionalEma(optionalEma(range, smoothing), smoothing)
    const smi = numerator.map((value, index) => {
      const base = denominator[index]
      return value === undefined || base === undefined || base === 0 ? undefined : value / base * 200
    })
    const signal = optionalEma(smi, signalPeriod)
    return dataList.map((_, index) => ({
      value: smi[index],
      signal: signal[index]
    }))
  },
  draw: guideLines([-40, 40])
}

export const massIndex: IndicatorTemplate<SingleResult> = {
  name: 'MASS',
  shortName: 'Mass Index',
  calcParams: [9, 25],
  precision: 2,
  minValue: 0,
  figures: [{ key: 'value', title: 'Mass: ', type: 'line' }],
  calc: (dataList, indicator) => {
    const emaPeriod = positiveInt(indicator.calcParams[0], 9)
    const sumPeriod = positiveInt(indicator.calcParams[1], 25)
    const spreads = dataList.map(bar => bar.high - bar.low)
    const smoothed = optionalEma(spreads, emaPeriod)
    const doubleSmoothed = optionalEma(smoothed, emaPeriod)
    const ratios = smoothed.map((value, index) => {
      const base = doubleSmoothed[index]
      return value === undefined || base === undefined || base === 0 ? undefined : value / base
    })
    // TV's documented formula is the SUM of the ratios over sumPeriod bars
    // (a flat market reads 25, so the 26.5/27 bulge guides are reachable) —
    // the SMA helper gives the mean, so scale back up.
    const mean = simpleMovingAverage(ratios, sumPeriod)
    return dataList.map((_, index) => {
      const value = mean[index]
      return value === undefined ? {} : { value: value * sumPeriod }
    })
  },
  draw: guideLines([26.5, 27])
}

export const smiErgodic: IndicatorTemplate<ErgodicResult> = {
  name: 'SMIE',
  shortName: 'SMI Ergodic',
  calcParams: [13, 25, 5],
  precision: 2,
  figures: [
    { key: 'ergodic', title: 'Ergodic: ', type: 'line' },
    { key: 'signal', title: 'Signal: ', type: 'line' },
    { key: 'oscillator', title: 'Oscillator: ', type: 'bar' }
  ],
  calc: (dataList, indicator) => {
    const fastPeriod = positiveInt(indicator.calcParams[0], 13)
    const slowPeriod = positiveInt(indicator.calcParams[1], 25)
    const signalPeriod = positiveInt(indicator.calcParams[2], 5)
    const momentum: Value[] = dataList.map((bar, index) =>
      index === 0 ? undefined : bar.close - dataList[index - 1].close)
    const absolute: Value[] = momentum.map(value => value === undefined ? undefined : Math.abs(value))
    // the article's pseudo-code applies the fast MA first, then the slow MA
    const smoothed = optionalEma(optionalEma(momentum, fastPeriod), slowPeriod)
    const smoothedAbsolute = optionalEma(optionalEma(absolute, fastPeriod), slowPeriod)
    const ergodic = smoothed.map((value, index) => {
      const base = smoothedAbsolute[index]
      return value === undefined || base === undefined || base === 0 ? undefined : value / base * 100
    })
    const signal = optionalEma(ergodic, signalPeriod)
    return dataList.map((_, index) => ({
      ergodic: ergodic[index],
      signal: signal[index],
      oscillator: ergodic[index] === undefined || signal[index] === undefined
        ? undefined
        : ergodic[index]! - signal[index]!
    }))
  },
  draw: guideLines([0])
}

const symmetricWeightedMa = (values: Value[]): Value[] => values.map((value, index) => {
  const oldest = values[index - 3]
  const older = values[index - 2]
  const newer = values[index - 1]
  return index < 3 || oldest === undefined || older === undefined || newer === undefined || value === undefined
    ? undefined
    : (oldest + 2 * older + 2 * newer + value) / 6
})

export const relativeVigorIndex: IndicatorTemplate<TwoLineResult> = {
  name: 'RVGI',
  shortName: 'Relative Vigor Index',
  precision: 2,
  figures: [
    { key: 'value', title: 'RVGI: ', type: 'line' },
    { key: 'signal', title: 'Signal: ', type: 'line' }
  ],
  calc: dataList => {
    const numerators = dataList.map(bar => bar.close - bar.open)
    const denominators = dataList.map(bar => bar.high - bar.low)
    const smoothedNum = symmetricWeightedMa(numerators)
    const smoothedDen = symmetricWeightedMa(denominators)
    const vigor = smoothedNum.map((value, index) => {
      const base = smoothedDen[index]
      return value === undefined || base === undefined || base === 0 ? undefined : value / base
    })
    const signal = symmetricWeightedMa(vigor)
    return dataList.map((_, index) => ({
      value: vigor[index],
      signal: signal[index]
    }))
  }
}

const indicators: IndicatorTemplate[] = [
  chaikinVolatility,
  relativeVolatilityIndex,
  volatilityCloseToClose,
  volatilityZeroTrendCloseToClose,
  volatilityOhlc,
  ulcerIndex,
  volatilityStop,
  chandeKrollStop,
  chandeMomentumOscillator,
  connorsRsi,
  stochasticMomentumIndex,
  massIndex,
  smiErgodic,
  relativeVigorIndex
]

export default indicators
