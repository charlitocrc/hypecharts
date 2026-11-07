import { describe, expect, it } from 'vitest'
import type { IndicatorTemplate, KLineData } from 'klinecharts'

import enUS from '../i18n/en-US.json'
import zhCN from '../i18n/zh-CN.json'
import indicatorSettings from '../widget/indicator-setting-modal/data'

import indicators, {
  accumulationDistribution,
  arnaudLegouxMovingAverage,
  aroon,
  atr,
  bollingerBandWidth,
  bollingerPercentB,
  calculateIndicator,
  chaikinVolatility,
  chaikinOscillator,
  chaikinMoneyFlow,
  chandeKrollStop,
  chandeMomentumOscillator,
  chandelierExit,
  choppinessIndex,
  connorsRsi,
  coppockCurve,
  dema,
  detectMaCrosses,
  detrendedPriceOscillator,
  donchianChannels,
  emaCross,
  envelopes,
  elderForceIndex,
  fisherTransform,
  hma,
  historicalVolatility,
  ichimoku,
  kama,
  kdj,
  keltnerChannels,
  klingerOscillator,
  knowSureThing,
  leastSquaresMovingAverage,
  linearRegressionChannel,
  linearRegressionSlope,
  maCross,
  maEmaCross,
  massIndex,
  mcginleyDynamic,
  medianPrice,
  moneyFlowIndex,
  patternAbandonedBabyBullish,
  patternBullishEngulfing,
  patternHammer,
  patternHangingMan,
  patternMarubozuWhite,
  patternMorningStar,
  patternPiercing,
  patternRisingThreeMethods,
  patternRisingWindow,
  patternThreeBlackCrows,
  patternTweezerBottom,
  patternTriStarBearish,
  pivotPoints,
  priceOscillator,
  relativeVigorIndex,
  relativeVolatilityIndex,
  rsi,
  wr,
  sessionVolumeProfile,
  smiErgodic,
  standardDeviation,
  stochastic,
  stochasticMomentumIndex,
  stochasticRsi,
  supertrend,
  tema,
  trueStrengthIndex,
  typicalPrice,
  ulcerIndex,
  ultimateOscillator,
  visibleRangeVolumeProfile,
  volatilityCloseToClose,
  volatilityOhlc,
  volatilityStop,
  volatilityZeroTrendCloseToClose,
  volumeOscillator,
  vortex,
  vwap,
  vwma,
  week52HighLow,
  weightedMovingAverage,
  williamsAlligator,
  williamsFractal,
  wma,
  zigzag
} from './index'

const DAY = 86_400_000

const bars = (closes: number[], volumes: number[] = closes.map(() => 1)): KLineData[] =>
  closes.map((close, index) => ({
    timestamp: index * 60_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: volumes[index]
  }))

describe('custom indicator registry', () => {
  it('registers unique indicators in a stable order', () => {
    expect(indicators.map(indicator => indicator.name)).toEqual([
      'ATR', 'VWAP', 'STOCHRSI', 'SUPERTREND', 'ICHIMOKU',
      'WMA', 'HMA', 'VWMA', 'KC', 'DC',
      'RSI', 'KDJ', 'WR',
      'MFI', 'CMF', 'STOCH', 'AROON', 'UO',
      'TSI', 'DEMA', 'TEMA', 'ENV', 'PIVOT',
      'CHAIKIN', 'HV', 'ALLIGATOR',
      'LRC', 'ADL', 'EFI', 'VORTEX',
      'VRVP', 'SVP',
      'KAMA', 'CE', 'CHOP', 'FISHER', 'BBW',
      'BBB', 'STDDEV', 'TYP', 'MED', 'PPO', 'VO',
      'MACROSS', 'MAEMACROSS', 'EMACROSS',
      'DPO', 'COPPOCK', 'KVO', 'KST', 'MCGINLEY', 'ALMA', 'LSMA', 'LRSLOPE',
      'ZIGZAG', 'FRACTAL', 'W52',
      'CHAVOL', 'RVI', 'C2C', 'C2CZT', 'VOHLC', 'UI', 'VSTOP', 'CKS',
      'CMO', 'CRSI', 'SMI', 'MASS', 'SMIE', 'RVGI',
      'ABB', 'ABBR', 'DCC', 'DOJI', 'DSB', 'DSBR', 'DTSG', 'DFDJ',
      'ENGB', 'ENGBR', 'EDJS', 'EVST', 'FTM3', 'FWIN', 'GRDJ', 'HAMR',
      'HGMR', 'HRMB', 'HRMBR', 'HRXB', 'HRXBR', 'IVHM', 'KIKB', 'KIKBR',
      'LLS', 'LUS', 'MZBW', 'MZBB', 'MDJS', 'MOST', 'ONNK', 'PIER',
      'RTM3', 'RWIN', 'SHST', 'SPTW', 'SPTB', 'TBC', 'TWS', 'TJSTB',
      'TJSTBR', 'TWB', 'TWT', 'UTSG',
      'CPALL', 'CPBFLAG', 'CPBRFLAG', 'CPBPEN', 'CPBRPEN', 'CPDT', 'CPDB', 'CPTT', 'CPTB',
      'CPHS', 'CPIHS', 'CPRW', 'CPFW', 'CPTRI', 'CPRECT', 'CPCUP', 'CPICUP', 'CPEW',
      'COMPARE'
    ])
    expect(new Set(indicators.map(indicator => indicator.name))).toHaveLength(134)
  })

  it('keeps every custom indicator wired to settings and both locales', () => {
    const settings = indicatorSettings as Record<string, unknown>
    const english = enUS as Record<string, string>
    const chinese = zhCN as Record<string, string>
    indicators.forEach(indicator => {
      expect(settings).toHaveProperty(indicator.name)
      expect(english[indicator.name.toLowerCase()]).toBeTypeOf('string')
      expect(chinese[indicator.name.toLowerCase()]).toBeTypeOf('string')
    })
    expect(indicatorSettings.MACD.map(item => item.paramNameKey)).toEqual([
      'fast_period', 'slow_period', 'signal_period'
    ])
  })
})

describe('ATR', () => {
  it('uses true range and Wilder smoothing after the warm-up window', () => {
    const result = calculateIndicator(atr, bars([10, 12, 11, 14]), [3])
    expect(result[0].atr).toBeUndefined()
    expect(result[1].atr).toBeUndefined()
    expect(result[2].atr).toBeCloseTo(7 / 3)
    expect(result[3].atr).toBeCloseTo(26 / 9)
  })
})

describe('core studies re-registered with guide lines', () => {
  const rising = bars([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])

  it('RSI stays bounded, reads 0 on a zero-loss window (core semantics) and exposes the 20/80 guides', () => {
    const result = calculateIndicator(rsi, rising, [6, 12, 24])
    expect(result[0].rsi1).toBeUndefined()
    expect(result[5].rsi1).toBe(0)
    expect(result.every(value => value.rsi1 === undefined || (value.rsi1 >= 0 && value.rsi1 <= 100))).toBe(true)
    expect(rsi.draw).toBeDefined()
  })

  it('WR stays in [-100, 0] with -20/-80 guides', () => {
    const falling = bars([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10])
    const result = calculateIndicator(wr, falling, [6])
    // bars() gives each candle a ±1 wick, so the first full window reads -600/7
    expect(result[5].wr1).toBeCloseTo(-600 / 7, 5)
    expect(result.every(value => value.wr1 === undefined || (value.wr1 <= 0 && value.wr1 >= -100))).toBe(true)
    expect(wr.draw).toBeDefined()
  })

  it('KDJ seeds K/D at 50 and follows the stochastics', () => {
    const result = calculateIndicator(kdj, rising, [9, 3, 3])
    expect(result[8].k).toBeDefined()
    expect(result[9].k).toBeGreaterThan(result[8].k!)
    expect(kdj.draw).toBeDefined()
  })
})

describe('VWAP', () => {
  it('weights typical price by volume and resets at each UTC day', () => {
    const data = bars([10, 20, 30], [1, 3, 2])
    data[0].high = data[0].low = 10
    data[1].high = data[1].low = 20
    data[2].high = data[2].low = 30
    data[2].timestamp = DAY
    const result = calculateIndicator(vwap, data)
    expect(result.map(value => value.vwap)).toEqual([10, 17.5, 30])
  })

  it('adds volume-weighted deviation bands and honors the anchor period', () => {
    const data = bars([10, 20])
    data.forEach(bar => { bar.high = bar.low = bar.close })
    data[1].timestamp = DAY
    expect(calculateIndicator(vwap, data, [1, 1, 2])[1]).toEqual({ vwap: 15, upper1: 20, lower1: 10, upper2: 25, lower2: 5 })
    expect(calculateIndicator(vwap, data, [0, 1])[1]).toEqual({ vwap: 20, upper1: 20, lower1: 20 })
    expect(vwap.regenerateFigures!([0, 1, 2, 3]).map(figure => figure.key)).toEqual([
      'vwap', 'upper1', 'lower1', 'upper2', 'lower2', 'upper3', 'lower3'
    ])
  })
})

describe('weighted moving averages', () => {
  it('calculates an O(n) WMA with recent values carrying more weight', () => {
    expect(weightedMovingAverage([1, 2, 3, 4], 3)).toEqual([
      undefined,
      undefined,
      14 / 6,
      20 / 6
    ])
    expect(calculateIndicator(wma, bars([1, 2, 3, 4]), [3])[3].value).toBeCloseTo(20 / 6)
  })

  it('composes Hull MA from half, full and square-root WMAs', () => {
    const result = calculateIndicator(hma, bars([1, 2, 3, 4, 5, 6]), [4])
    expect(result[3].value).toBeUndefined()
    expect(result[4].value).toBeCloseTo(5)
  })

  it('uses volume as the weighting input for VWMA', () => {
    const result = calculateIndicator(vwma, bars([10, 20], [1, 3]), [2])
    expect(result[1].value).toBe(17.5)
  })
})

describe('channels', () => {
  it('builds Keltner bands from an EMA and Wilder ATR', () => {
    const result = calculateIndicator(keltnerChannels, bars([10, 12]), [2, 2, 1])
    expect(result[1]).toEqual({ upper: 13.5, middle: 11, lower: 8.5 })
  })

  it('builds Donchian bands from rolling highs and lows', () => {
    const result = calculateIndicator(donchianChannels, bars([1, 2, 3, 2]), [3])
    expect(result[1]).toEqual({})
    expect(result[2]).toEqual({ upper: 4, middle: 2, lower: 0 })
    expect(result[3]).toEqual({ upper: 4, middle: 2.5, lower: 1 })
  })
})

describe('Stochastic RSI', () => {
  it('honors RSI, stochastic and smoothing warm-up windows', () => {
    const result = calculateIndicator(stochasticRsi, bars([10, 12, 11, 14, 13, 15, 12, 16, 14, 17]), [3, 3, 2, 2])
    expect(result.slice(0, 6).every(value => value.k === undefined)).toBe(true)
    expect(result[6].k).toBeTypeOf('number')
    expect(result[6].d).toBeUndefined()
    expect(result[7].d).toBeTypeOf('number')
    for (const value of result) {
      if (value.k !== undefined) expect(value.k).toBeGreaterThanOrEqual(0)
      if (value.k !== undefined) expect(value.k).toBeLessThanOrEqual(100)
      if (value.d !== undefined) expect(value.d).toBeGreaterThanOrEqual(0)
      if (value.d !== undefined) expect(value.d).toBeLessThanOrEqual(100)
    }
  })
})

describe('Supertrend', () => {
  it('warms up on ATR and emits one direction at a time', () => {
    const result = calculateIndicator(supertrend, bars([10, 11, 12, 15, 16, 12, 8]), [3, 1])
    expect(result[0]).toEqual({})
    expect(result[1]).toEqual({})
    expect(result.slice(2).every(value => (value.up === undefined) !== (value.down === undefined))).toBe(true)
    expect(result.some(value => value.up !== undefined)).toBe(true)
    expect(result.some(value => value.down !== undefined)).toBe(true)
  })
})

describe('Ichimoku Cloud', () => {
  it('displaces leading spans forward and the lagging span backward', () => {
    const result = calculateIndicator(ichimoku, bars([1, 2, 3, 4, 5, 6, 7, 8]), [2, 3, 4, 2])
    expect(result[0].lagging).toBe(3)
    expect(result[5].conversion).toBe(5.5)
    expect(result[5].base).toBe(5)
    expect(result[5].spanA).toBe(3.25)
    expect(result[5].spanB).toBe(2.5)
    expect(result[6].lagging).toBeUndefined()
  })
})

describe('volume and money flow indicators', () => {
  it('calculates MFI from positive and negative raw money flow', () => {
    const result = calculateIndicator(moneyFlowIndex, bars([10, 11, 12, 11]), [2])
    expect(result[1]).toEqual({})
    expect(result[2].value).toBe(100)
    expect(result[3].value).toBeCloseTo(12 / 23 * 100)
  })

  it('handles CMF buying and selling pressure plus flat ranges', () => {
    const data = bars([10, 0, 5])
    data[0] = { ...data[0], high: 10, low: 0, close: 10 }
    data[1] = { ...data[1], high: 10, low: 0, close: 0 }
    data[2] = { ...data[2], high: 5, low: 5, close: 5 }
    const result = calculateIndicator(chaikinMoneyFlow, data, [2])
    expect(result[0]).toEqual({})
    expect(result[1].value).toBe(0)
    expect(result[2].value).toBe(-0.5)
  })
})

describe('second-wave oscillators', () => {
  it('calculates classic Stochastic K and D', () => {
    const result = calculateIndicator(stochastic, bars([1, 2, 3, 2]), [3, 1, 2])
    expect(result[2].first).toBe(75)
    expect(result[3].first).toBeCloseTo(100 / 3)
    expect(result[3].second).toBeCloseTo((75 + 100 / 3) / 2)
  })

  it('uses the most recent high and low for Aroon', () => {
    const result = calculateIndicator(aroon, bars([1, 3, 2]), [2])
    expect(result[2]).toEqual({ first: 50, second: 0 })
  })

  it('weights three buying-pressure windows in Ultimate Oscillator', () => {
    const result = calculateIndicator(ultimateOscillator, bars([10, 10, 10, 10]), [2, 3, 4])
    expect(result[2]).toEqual({})
    expect(result[3].value).toBe(50)
  })

  it('double-smooths price change for TSI and its signal line', () => {
    const result = calculateIndicator(trueStrengthIndex, bars([1, 2, 3, 4, 5, 6]), [2, 2, 2])
    expect(result[3].first).toBe(100)
    expect(result[3].second).toBeUndefined()
    expect(result[4]).toEqual({ first: 100, second: 100 })
  })
})

describe('second-wave price overlays', () => {
  it('warms nested EMA stages independently for DEMA and TEMA', () => {
    const data = bars([10, 10, 10, 10, 10])
    const double = calculateIndicator(dema, data, [2])
    const triple = calculateIndicator(tema, data, [2])
    expect(double[1]).toEqual({})
    expect(double[2].value).toBe(10)
    expect(triple[2]).toEqual({})
    expect(triple[3].value).toBe(10)
  })

  it('places Envelopes at a percentage around an SMA basis', () => {
    const result = calculateIndicator(envelopes, bars([10, 20]), [2, 10])
    expect(result[1]).toEqual({ upper: 16.5, middle: 15, lower: 13.5 })
  })

  it('uses the completed UTC period for traditional Pivot Points', () => {
    const data = bars([10, 12, 20])
    data[0] = { ...data[0], high: 12, low: 8, close: 10, timestamp: 0 }
    data[1] = { ...data[1], high: 14, low: 9, close: 12, timestamp: 60_000 }
    data[2] = { ...data[2], high: 22, low: 18, close: 20, timestamp: DAY }
    const result = calculateIndicator(pivotPoints, data)
    expect(result[0]).toEqual({})
    expect(result[1]).toEqual({})
    expect(result[2].p).toBeCloseTo(34 / 3)
    expect(result[2].r1).toBeCloseTo(44 / 3)
    expect(result[2].s1).toBeCloseTo(26 / 3)
    expect(result[2].r2).toBeCloseTo(52 / 3)
    expect(result[2].s2).toBeCloseTo(16 / 3)
  })
})

describe('third-wave indicators', () => {
  it('calculates Chaikin Oscillator as fast ADL EMA minus slow ADL EMA', () => {
    const data = bars([10, 0, 10])
    data.forEach((bar, index) => {
      data[index] = { ...bar, high: 10, low: 0, close: index % 2 === 0 ? 10 : 0, volume: 1 }
    })
    const result = calculateIndicator(chaikinOscillator, data, [2, 3])
    expect(result[1]).toEqual({})
    expect(result[2].value).toBeCloseTo(1 / 6)
  })

  it('annualizes the population deviation of log returns', () => {
    const data = bars([100, 100 * Math.exp(0.1), 100 * Math.exp(0.3), 100 * Math.exp(0.6)])
    data.forEach((bar, index) => { bar.timestamp = index * DAY })
    const result = calculateIndicator(historicalVolatility, data, [3])
    const populationDeviation = Math.sqrt(0.02 / 3)
    expect(result[2]).toEqual({})
    expect(result[3].value).toBeCloseTo(populationDeviation * Math.sqrt(365.25) * 100)
  })

  it('smooths median price and applies independent Alligator shifts', () => {
    const result = calculateIndicator(williamsAlligator, bars([1, 2, 3, 4, 5]), [3, 1, 2, 1, 2, 0])
    expect(result[1].lips).toBe(1.5)
    expect(result[2].teeth).toBe(1.5)
    expect(result[3].jaw).toBe(2)
    expect(result[3].teeth).toBe(2.25)
    expect(result[3].lips).toBe(3.125)
  })
})

describe('remaining candle-only indicators', () => {
  it('produces an exact regression endpoint and zero-width channel for a straight line', () => {
    const result = calculateIndicator(linearRegressionChannel, bars([1, 2, 3, 4]), [3, 2])
    expect(result[1]).toEqual({})
    expect(result[2]).toEqual({ upper: 3, middle: 3, lower: 3 })
    expect(result[3]).toEqual({ upper: 4, middle: 4, lower: 4 })
  })

  it('accumulates signed money-flow volume for ADL', () => {
    const data = bars([10, 0, 5], [2, 1, 10])
    data[0] = { ...data[0], high: 10, low: 0, close: 10 }
    data[1] = { ...data[1], high: 10, low: 0, close: 0 }
    data[2] = { ...data[2], high: 5, low: 5, close: 5 }
    expect(calculateIndicator(accumulationDistribution, data).map(value => value.value)).toEqual([2, 1, 1])
  })

  it('smooths close-change times volume for Elder Force Index', () => {
    const result = calculateIndicator(elderForceIndex, bars([1, 2, 4], [1, 2, 3]), [2])
    expect(result[1]).toEqual({})
    expect(result[2].value).toBe(4)
  })

  it('normalizes Vortex movement by rolling true range', () => {
    const data = bars([1, 2, 3])
    data[0] = { ...data[0], high: 2, low: 0 }
    data[1] = { ...data[1], high: 3, low: 1 }
    data[2] = { ...data[2], high: 4, low: 2 }
    const result = calculateIndicator(vortex, data, [2])
    expect(result[1]).toEqual({})
    expect(result[2]).toEqual({ plus: 1.5, minus: 0.5 })
  })
})

describe('fourth wave', () => {
  it('seeds KAMA from the prior close and applies the squared efficiency constant', () => {
    const result = calculateIndicator(kama, bars([1, 2, 3, 4]), [2, 2, 30])
    expect(result[1]).toEqual({})
    expect(result[2].value).toBeCloseTo(22 / 9)
  })

  it('ratchets the Chandelier long stop and flips short when close breaks it', () => {
    const result = calculateIndicator(chandelierExit, bars([1, 2, 3, 4, 5, 1]), [2, 1])
    expect(result[0]).toEqual({})
    expect(result[1]).toEqual({ long: 1 })
    expect(result[4]).toEqual({ long: 4 })
    expect(result[5]).toEqual({ short: 3.5 })
  })

  it('scores a flat range as maximally choppy and a trend lower', () => {
    expect(calculateIndicator(choppinessIndex, bars([5, 5, 5]), [2])[2].value).toBeCloseTo(100)
    expect(calculateIndicator(choppinessIndex, bars([1, 2, 3]), [2])[2].value).toBeCloseTo(100 * Math.log10(4 / 3) / Math.log10(2))
  })

  it('pushes Fisher positive on a rally with the trigger lagging one bar', () => {
    const result = calculateIndicator(fisherTransform, bars([1, 2, 3, 4]), [2])
    expect(result[0]).toEqual({})
    expect(result[1].trigger).toBeUndefined()
    expect(result[2].fisher).toBeGreaterThan(result[1].fisher!)
    expect(result[2].trigger).toBe(result[1].fisher)
  })

  it('measures BandWidth with population deviation and rolling extremes', () => {
    const result = calculateIndicator(bollingerBandWidth, bars([1, 3, 3]), [2, 2, 2])
    expect(result[0]).toEqual({})
    expect(result[1].bbw).toBeCloseTo(200)
    expect(result[2]).toEqual({ bbw: 0, expansion: 200, contraction: 0 })
  })
})

describe('fifth wave', () => {
  it('reads %B position inside the Bollinger bands and goes blank on a flat window', () => {
    const result = calculateIndicator(bollingerPercentB, bars([1, 3, 3]), [2, 2])
    expect(result[0]).toEqual({})
    // window [1, 3]: mid 2, population deviation 1, 2σ bands [0, 4] → (3 - 0) / 4
    expect(result[1].percent).toBe(0.75)
    // window [3, 3]: zero-width band has no position
    expect(result[2]).toEqual({})
    expect(bollingerPercentB.draw).toBeDefined()
  })

  it('exposes rolling population standard deviation of the close', () => {
    const result = calculateIndicator(standardDeviation, bars([1, 2, 3]), [2])
    expect(result[0]).toEqual({})
    expect(result[1].value).toBe(0.5)
    expect(result[2].value).toBe(0.5)
  })

  it('derives typical and median price per bar without warm-up', () => {
    const data = bars([9])
    data[0].high = 13
    data[0].low = 7
    expect(calculateIndicator(typicalPrice, data)[0].value).toBeCloseTo(29 / 3)
    expect(calculateIndicator(medianPrice, data)[0].value).toBe(10)
  })

  it('splits the Price Oscillator into percentage and absolute EMA spreads', () => {
    const result = calculateIndicator(priceOscillator, bars([1, 2, 3, 4, 5, 6]), [2, 3])
    expect(result[1]).toEqual({})
    expect(result[4]).toEqual({ ppo: 12.5, absolute: 0.5 })
    expect(result[5]).toEqual({ ppo: 10, absolute: 0.5 })
    expect(priceOscillator.draw).toBeDefined()
  })

  it('measures the Volume Oscillator as the fast/slow volume MA percentage gap', () => {
    const result = calculateIndicator(volumeOscillator, bars([10, 10, 10], [1, 2, 3]), [2, 3])
    expect(result[1]).toEqual({})
    expect(result[2].value).toBe(25)
  })

  it('keeps the Volume Oscillator finite when the fast period exceeds the slow period', () => {
    const result = calculateIndicator(volumeOscillator, bars([10, 10, 10, 10], [1, 2, 3, 4]), [3, 2])
    // index 1 has slow defined but fast still warming up — must stay blank, not NaN
    expect(result[1]).toEqual({})
    expect(result[2].value).toBe(-20)
    expect(result[3].value).toBeCloseTo(-100 / 7, 5)
    expect(result.some(row => Number.isNaN(row.value))).toBe(false)
  })

  it('flags a golden cross once when the fast EMA overtakes the slow EMA', () => {
    const result = calculateIndicator(emaCross, bars([5, 5, 5, 5, 9, 9, 9, 9]), [2, 3])
    expect(result[3]).toEqual({ fast: 5, slow: 5 })
    // first 9 closes at index 4: fast EMA jumps to 23/3 while slow EMA reaches 7
    expect(result[4].fast).toBeCloseTo(23 / 3)
    expect(result[4].slow).toBe(7)
    const crosses = detectMaCrosses(result.map(row => row.fast), result.map(row => row.slow))
    expect(crosses[4]).toBe('golden')
    expect(crosses.filter(Boolean)).toHaveLength(1)
    expect(emaCross.draw).toBeDefined()
  })

  it('builds the cross family from SMA and EMA pairs', () => {
    const data = bars([1, 2, 3, 10])
    expect(calculateIndicator(maCross, data, [2, 3])[3]).toEqual({ fast: 6.5, slow: 5 })
    expect(calculateIndicator(maEmaCross, data, [2, 3])[3]).toEqual({ fast: 6.5, slow: 6 })
    expect(calculateIndicator(emaCross, data, [2, 3])[3]).toEqual({ fast: 7.5, slow: 6 })
  })
})

describe('sixth wave', () => {
  it('detrends price against the SMA displaced back by n/2 + 1 bars', () => {
    const result = calculateIndicator(detrendedPriceOscillator, bars([1, 2, 3, 4, 5, 6]), [2])
    expect(result[2]).toEqual({})
    // close 4 minus the SMA two bars back (sma2 = 1.5)
    expect(result[3].value).toBe(2.5)
    expect(result[5].value).toBe(2.5)
    expect(detrendedPriceOscillator.draw).toBeDefined()
  })

  it('smooths the summed ROCs of the Coppock Curve with a WMA', () => {
    const result = calculateIndicator(coppockCurve, bars([5, 5, 5, 5, 10, 10, 10]), [2, 3, 3])
    expect(result[4]).toEqual({})
    // summed ROCs read 0, 200, 200, 100 — the WMA lags the doubling step
    expect(result[5].value).toBeCloseTo(1000 / 6)
    expect(result[6].value).toBeCloseTo(150)
    expect(coppockCurve.draw).toBeDefined()
  })

  it('computes the Klinger volume force from dm/cm accumulation and trend flips on ties', () => {
    const result = calculateIndicator(klingerOscillator, bars([1, 2, 1], [1, 1, 1]), [2, 3, 2])
    // force = [0, -100, 100]; EMA2(force) seeds at 2, EMA3 seeds at 3
    expect(result[2].kvo).toBeCloseTo(50)
    expect(result[2].signal).toBeUndefined()
    expect(klingerOscillator.draw).toBeDefined()
  })

  it('weights the four smoothed KST ROCs 1-4 with a signal line', () => {
    const result = calculateIndicator(knowSureThing, bars([1, 2, 2]), [1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(result[1]).toEqual({ kst: 1000, signal: 1000 })
    expect(result[2]).toEqual({ kst: 0, signal: 0 })
  })

  it('speeds McGinley Dynamic up in downtrends via the ratio term', () => {
    const result = calculateIndicator(mcginleyDynamic, bars([100, 110]), [1])
    expect(result[0].value).toBe(100)
    expect(result[1].value).toBeCloseTo(100 + 10 / 1.1 ** 4)
  })

  it('biases ALMA weights toward the oldest bar at offset zero', () => {
    const result = calculateIndicator(arnaudLegouxMovingAverage, bars([1, 2, 3]), [3, 0, 6])
    const expected = (1 + 2 * Math.exp(-2) + 3 * Math.exp(-8)) / (1 + Math.exp(-2) + Math.exp(-8))
    expect(result[1]).toEqual({})
    expect(result[2].value).toBeCloseTo(expected, 6)
  })

  it('fits LSMA endpoints exactly on straight lines and slopes the rest', () => {
    const line = calculateIndicator(leastSquaresMovingAverage, bars([1, 2, 3, 4]), [3])
    expect(line[1]).toEqual({})
    expect(line[2].value).toBe(3)
    expect(line[3].value).toBe(4)
    const bent = calculateIndicator(leastSquaresMovingAverage, bars([1, 2, 3, 10]), [3])
    expect(bent[3].value).toBe(9)
    const slopes = calculateIndicator(linearRegressionSlope, bars([1, 2, 3, 10]), [3])
    expect(slopes[3].value).toBe(4)
    expect(linearRegressionSlope.draw).toBeDefined()
  })

  it('marks zigzag pivots on deviation reversals and renders the live leg', () => {
    const data = bars([1, 1, 1, 1])
    const ranges = [[5, 4], [10, 8], [9.4, 8], [9, 7]]
    ranges.forEach(([high, low], index) => { data[index] = { ...data[index], high, low } })
    const result = calculateIndicator(zigzag, data, [1, 5])
    expect(result[1].value).toBe(10)
    // the live leg tracks the running low of the down leg (bar 3's low)
    expect(result[3].value).toBe(7)
    expect(result[0]).toEqual({})
    expect(zigzag.draw).toBeDefined()
  })

  it('draws zigzag legs that span the whole viewport even when both pivots are off-screen', () => {
    const data = bars(new Array(11).fill(1))
    data[0].high = 10
    data.forEach(bar => { bar.low = 1 })
    calculateIndicator(zigzag, data, [10, 5])
    const lines: number[][] = []
    const ctx = {
      beginPath: () => {},
      moveTo: (x: number) => { lines.push([x]) },
      lineTo: (x: number) => { lines[lines.length - 1].push(x) },
      stroke: () => {}
    }
    zigzag.draw!({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      kLineDataList: data,
      indicator: { ...zigzag, result: calculateIndicator(zigzag, data, [10, 5]) } as any,
      visibleRange: { from: 4, to: 6 },
      bounding: { width: 1000 } as any,
      barSpace: { halfBar: 5 } as any,
      defaultStyles: {} as any,
      xAxis: { convertToPixel: (index: number) => index * 10 } as any,
      yAxis: { convertToPixel: (value: number) => -value } as any
    })
    // pivots at 0 (high 10) and 10 (live leg) straddle the viewport — one leg renders
    expect(lines).toEqual([[0, 100]])
  })

  it('flags Williams fractals strictly above or below every neighbor bar', () => {
    const result = calculateIndicator(williamsFractal, bars([1, 2, 5, 2, 1, 2, 5, 2, 1]), [1])
    expect(result[0]).toEqual({})
    expect(result[2]).toEqual({ up: 6, down: undefined })
    expect(result[4]).toEqual({ up: undefined, down: 0 })
    expect(result[6]).toEqual({ up: 6, down: undefined })
    expect(williamsFractal.draw).toBeDefined()
  })

  it('evicts 52-week extremes once they leave the trailing time window', () => {
    const data = bars([10, 20, 30])
    data.forEach((bar, index) => { bar.timestamp = index * 8 * DAY })
    const result = calculateIndicator(week52HighLow, data, [1])
    expect(result[0]).toEqual({ high: 11, low: 9 })
    expect(result[1]).toEqual({ high: 21, low: 19 })
    expect(result[2]).toEqual({ high: 31, low: 29 })
    // inside the window both bars count toward the extremes
    data.forEach((bar, index) => { bar.timestamp = index * DAY })
    expect(calculateIndicator(week52HighLow, data, [1])[2]).toEqual({ high: 31, low: 9 })
  })
})

describe('seventh wave', () => {
  it('reads Chaikin Volatility as the EMA spread of the high-low range', () => {
    const result = calculateIndicator(chaikinVolatility, bars([1, 2, 3, 4]), [2, 1])
    expect(result[1]).toEqual({})
    // constant 2-point range: every EMA equals 2, so the spread reads zero
    expect(result[2].value).toBe(0)
  })

  it('pins the Relative Volatility Index to 100 on rallies and 0 on slides', () => {
    const rising = calculateIndicator(relativeVolatilityIndex, bars([1, 2, 3, 4]), [2, 2])
    expect(rising[1]).toEqual({})
    expect(rising[2].value).toBe(100)
    expect(calculateIndicator(relativeVolatilityIndex, bars([4, 3, 2, 1]), [2, 2])[2].value).toBe(0)
  })

  it('keeps drift in Close-to-Close but removes it in the Zero Trend variant', () => {
    const data = bars([1, 2, 4, 8])
    const c2c = calculateIndicator(volatilityCloseToClose, data, [1, 1])
    const zt = calculateIndicator(volatilityZeroTrendCloseToClose, data, [1, 1])
    expect(c2c[1].value).toBeCloseTo(100 * Math.log(2))
    expect(zt[1].value).toBe(0)
  })

  it('annualizes the four log ratios of each bar for O-H-L-C volatility', () => {
    const data = bars([1, 2])
    const q = Math.log(2) ** 2 + Math.log(1.5) ** 2 + Math.log(1 / 3) ** 2 + Math.log(2) ** 2
    const result = calculateIndicator(volatilityOhlc, data, [1, 1])
    expect(result[0]).toEqual({})
    expect(result[1].value).toBeCloseTo(Math.sqrt(q / 4) * 100)
  })

  it('measures Ulcer Index as the RMS drawdown from the rolling peak', () => {
    const result = calculateIndicator(ulcerIndex, bars([12, 11, 10]), [2])
    expect(result[1]).toEqual({})
    // the peak itself rolls: bar 2's window peaks at 11, not 12
    expect(result[2].value).toBeCloseTo(Math.sqrt(((100 / 12) ** 2 + (100 / 11) ** 2) / 2))
  })

  it('ratchets the Volatility Stop under an uptrend', () => {
    const result = calculateIndicator(volatilityStop, bars([10, 11, 12, 13]), [2, 1])
    expect(result[0]).toEqual({})
    expect(result[1]).toEqual({ up: 8 })
    expect(result[2]).toEqual({ up: 9 })
  })

  it('bounds Chande Kroll stops by the first-pass extremes and the offset window', () => {
    const result = calculateIndicator(chandeKrollStop, bars([10, 10, 10]), [1, 1, 1])
    expect(result[0]).toEqual({ long: 9, short: 11 })
    expect(result[2]).toEqual({ long: 9, short: 11 })
  })

  it('reads CMO as the signed share of directional change', () => {
    expect(calculateIndicator(chandeMomentumOscillator, bars([1, 2, 3]), [2])[2].value).toBe(100)
    const mixed = calculateIndicator(chandeMomentumOscillator, bars([1, 2, 1, 2]), [2])
    expect(mixed[1]).toEqual({})
    expect(mixed[2].value).toBe(0)
    expect(mixed[3].value).toBe(0)
    expect(chandeMomentumOscillator.draw).toBeDefined()
  })

  it('averages price RSI, streak RSI and PercentRank for Connors RSI', () => {
    // closes start at 1 so the first ROC is defined (a 0 close divides by zero)
    const data = bars(Array.from({ length: 110 }, (_, i) => i + 1))
    const result = calculateIndicator(connorsRsi, data, [3, 2, 100])
    // the PercentRank window needs 100 defined ROCs — the first lands on bar 101
    expect(result[100]).toEqual({})
    // RSI and streak RSI both read 100, but an additive rally's *percentage*
    // change decays, so the current bar ranks last: (100 + 100 + 0) / 3
    expect(result[101].value).toBeCloseTo(200 / 3)
    const flat = calculateIndicator(connorsRsi, bars(new Array(110).fill(5)), [3, 2, 100])
    expect(flat[101].value).toBeCloseTo(200 / 3)
    expect(connorsRsi.draw).toBeDefined()
  })

  it('reads 50 on linear closes and stays blank on flat ranges for SMI', () => {
    const result = calculateIndicator(stochasticMomentumIndex, bars([1, 2, 3, 4, 5, 6]), [3, 2, 2])
    expect(result[3]).toEqual({})
    // linear closes put the close a quarter-range above the midpoint (the ±1
    // wick), and TV's 200× ratio turns that quarter into 50
    expect(result[4].value).toBe(50)
    expect(result[4].signal).toBeUndefined()
    expect(result[5]).toEqual({ value: 50, signal: 50 })
    const flat = calculateIndicator(stochasticMomentumIndex, bars([5, 5, 5, 5]), [3, 2, 2])
    expect(flat[3]).toEqual({})
    expect(stochasticMomentumIndex.draw).toBeDefined()
  })

  it('sums the double-smoothed range ratio for Mass Index', () => {
    const result = calculateIndicator(massIndex, bars([10, 11, 12, 13, 14]), [2, 2])
    expect(result[2]).toEqual({})
    // constant range: every ratio is 1, so the documented sum reads sumPeriod
    expect(result[3].value).toBe(2)
    expect(massIndex.draw).toBeDefined()
  })

  it('scales the Ergodic to 100 on steady momentum with a lagging signal', () => {
    const result = calculateIndicator(smiErgodic, bars([1, 2, 3, 4]), [1, 1, 2])
    expect(result[1]).toEqual({ ergodic: 100, signal: undefined, oscillator: undefined })
    expect(result[2]).toEqual({ ergodic: 100, signal: 100, oscillator: 0 })
    expect(smiErgodic.draw).toBeDefined()
  })

  it('divides the smoothed close-open spread by the smoothed range for RVGI', () => {
    const result = calculateIndicator(relativeVigorIndex, bars([1, 2, 3, 4, 5, 6, 7]))
    expect(result[2]).toEqual({})
    // bars() opens at the close, so the numerator is always zero
    expect(result[3]).toEqual({ value: 0, signal: undefined })
    expect(result[6]).toEqual({ value: 0, signal: 0 })
  })
})

describe('candlestick patterns', () => {
  const ohlcs = (rows: Array<[number, number, number, number]>): KLineData[] =>
    rows.map(([open, high, low, close], index) => ({
      timestamp: index * 60_000, open, high, low, close, volume: 1
    }))
  const flags = (rows: Array<[number, number, number, number]>, template: IndicatorTemplate<{ value?: number }>) =>
    calculateIndicator(template, ohlcs(rows)).map(row => row.value !== undefined)

  it('flags a doji on a tiny body and a marubozu on a full-range body', () => {
    const rows: Array<[number, number, number, number]> = [[10, 10.5, 10, 10.5], [10, 10.1, 9.9, 10]]
    const flags1 = calculateIndicator(patternMarubozuWhite, ohlcs(rows))
    expect(flags1[0].value).toBeDefined()
    expect(flags1[1].value).toBeUndefined()
    expect(patternMarubozuWhite.draw).toBeDefined()
  })

  it('flags a bullish engulfing when the body swallows the previous one', () => {
    const rows: Array<[number, number, number, number]> = [[10, 10.2, 9.7, 9.8], [9.7, 10.3, 9.6, 10.1]]
    expect(flags(rows, patternBullishEngulfing)).toEqual([false, true])
  })

  it('reads a hammer after a decline and a hanging man after a rise for the same shape', () => {
    const decline: Array<[number, number, number, number]> = [[12.5, 12.9, 12.1, 12.4], [12, 12.4, 11.6, 12], [11.8, 12.2, 11, 11.2], [11, 11.4, 10.4, 10.6], [10, 10.3, 8.8, 10.2]]
    expect(flags(decline, patternHammer)).toEqual([false, false, false, false, true])
    expect(flags(decline, patternHangingMan)).toEqual([false, false, false, false, false])
    const rise: Array<[number, number, number, number]> = [[7.5, 7.9, 7.1, 7.4], [8, 8.4, 7.6, 8], [8.2, 8.6, 7.8, 8.4], [8.5, 8.9, 8.1, 8.8], [9.4, 9.7, 8.2, 9.6]]
    expect(flags(rise, patternHammer)).toEqual([false, false, false, false, false])
    expect(flags(rise, patternHangingMan)).toEqual([false, false, false, false, true])
  })

  it('flags a piercing only when the close reclaims the midpoint without closing the gap', () => {
    const rows: Array<[number, number, number, number]> = [[10, 10.1, 9.6, 9.7], [9.6, 10.0, 9.5, 9.95]]
    expect(flags(rows, patternPiercing)).toEqual([false, true])
    const shallow: Array<[number, number, number, number]> = [[10, 10.1, 9.6, 9.7], [9.6, 9.85, 9.55, 9.8]]
    expect(flags(shallow, patternPiercing)).toEqual([false, false])
  })

  it('completes a morning star on its third bar above the first body midpoint', () => {
    const rows: Array<[number, number, number, number]> = [
      [10, 10.2, 9.4, 9.5],
      [9.35, 9.4, 9.3, 9.32],
      [9.4, 10.2, 9.3, 9.85]
    ]
    expect(flags(rows, patternMorningStar)).toEqual([false, false, true])
  })

  it('flags a rising window on a full gap up and tweezer bottoms on equal lows', () => {
    const gap: Array<[number, number, number, number]> = [[10, 10.5, 10.2, 10.4], [10.9, 11.5, 10.9, 11.3]]
    expect(flags(gap, patternRisingWindow)).toEqual([false, true])
    const decline: Array<[number, number, number, number]> = [[12, 12.4, 11.6, 12], [11.8, 12.2, 11, 11.2], [10.9, 11.1, 10.4, 10.6], [10.5, 10.7, 9.9, 10.2], [10.2, 10.9, 9.9, 10.8]]
    expect(flags(decline, patternTweezerBottom)).toEqual([false, false, false, false, true])
  })

  it('sees three black crows descending through open positions inside prior bodies', () => {
    const rows: Array<[number, number, number, number]> = [[10.4, 10.5, 10.0, 10.1], [10.3, 10.35, 9.9, 10.0], [10.05, 10.1, 9.6, 9.7], [9.75, 9.8, 9.3, 9.4]]
    expect(flags(rows, patternThreeBlackCrows)).toEqual([false, false, true, true])
  })

  it('marks the tri star bearish on a doji that gaps up between two others', () => {
    const rows: Array<[number, number, number, number]> = [[10, 10.1, 9.9, 10], [10.1, 10.2, 10.05, 10.1], [10, 10.1, 9.9, 10]]
    expect(flags(rows, patternTriStarBearish)).toEqual([false, false, true])
  })

  it('requires five contained bars plus a breakout close for rising three methods', () => {
    const rows: Array<[number, number, number, number]> = [
      [10, 11, 9.8, 10.8],
      [10.45, 10.75, 10.3, 10.33],
      [10.3, 10.6, 10.15, 10.2],
      [10.2, 10.5, 10.05, 10.1],
      [10.1, 11.2, 10.05, 11.0]
    ]
    expect(flags(rows, patternRisingThreeMethods)).toEqual([false, false, false, false, true])
  })
})

describe('volume profiles', () => {
  const pocLines = (template: typeof sessionVolumeProfile, data: KLineData[], visibleRange: { from: number, to: number }) => {
    const lines: number[][] = []
    const ctx = {
      fillRect: () => {},
      beginPath: () => {},
      moveTo: (x: number) => { lines.push([x]) },
      lineTo: (x: number) => { lines[lines.length - 1].push(x) },
      stroke: () => {}
    }
    template.draw!({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      kLineDataList: data,
      indicator: { ...template, calcParams: template.calcParams } as any,
      visibleRange,
      bounding: { width: 1000 } as any,
      barSpace: { halfBar: 5 } as any,
      defaultStyles: {} as any,
      xAxis: { convertToPixel: (index: number) => index * 10 } as any,
      yAxis: { convertToPixel: (value: number) => -value } as any
    })
    return lines
  }

  it('draws one session profile per UTC day, including sessions cut by the viewport', () => {
    const data = bars([10, 11, 12, 13, 14, 15]).map((bar, index) => ({ ...bar, timestamp: Math.floor(index / 3) * DAY + index * 60_000 }))
    expect(pocLines(sessionVolumeProfile, data, { from: 1, to: 6 })).toEqual([[-5, 25], [25, 55]])
  })

  it('draws the visible-range POC from the first visible bar to the right edge', () => {
    expect(pocLines(visibleRangeVolumeProfile, bars([10, 11, 12, 13]), { from: 1, to: 4 })).toEqual([[10, 1000]])
  })
})
