export type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume' | 'moving_average' | 'pattern' | 'chart_pattern'
export type IndicatorPlacement = 'main' | 'sub'

export interface IndicatorMenuItem {
  name: string
  category: IndicatorCategory
  placements: IndicatorPlacement[]
  popularRank?: number
  keywords?: string
}

const both: IndicatorPlacement[] = ['main', 'sub']
const main: IndicatorPlacement[] = ['main']
const sub: IndicatorPlacement[] = ['sub']

/**
 * Candlestick patterns (TV's Patterns → Candlestick patterns folder): each
 * flags its completion bar on the main pane. Shape-based detection with
 * fixed classic thresholds — see src/indicator/candle-patterns.ts.
 */
const CANDLE_PATTERN_ITEMS: IndicatorMenuItem[] = [
  { name: 'ABB', category: 'pattern', placements: main, keywords: 'abandoned baby bullish doji gap downtrend' },
  { name: 'ABBR', category: 'pattern', placements: main, keywords: 'abandoned baby bearish doji gap uptrend' },
  { name: 'DCC', category: 'pattern', placements: main, keywords: 'dark cloud cover bearish reversal' },
  { name: 'DOJI', category: 'pattern', placements: main, keywords: 'doji indecision spinning cross' },
  { name: 'DSB', category: 'pattern', placements: main, keywords: 'doji star bullish downtrend gap' },
  { name: 'DSBR', category: 'pattern', placements: main, keywords: 'doji star bearish uptrend gap' },
  { name: 'DTSG', category: 'pattern', placements: main, keywords: 'downside tasuki gap bearish continuation' },
  { name: 'DFDJ', category: 'pattern', placements: main, keywords: 'dragonfly doji bullish reversal long lower wick' },
  { name: 'ENGB', category: 'pattern', placements: main, keywords: 'bullish engulfing reversal' },
  { name: 'ENGBR', category: 'pattern', placements: main, keywords: 'bearish engulfing reversal' },
  { name: 'EDJS', category: 'pattern', placements: main, keywords: 'evening doji star bearish three bar' },
  { name: 'EVST', category: 'pattern', placements: main, keywords: 'evening star bearish three bar' },
  { name: 'FTM3', category: 'pattern', placements: main, keywords: 'falling three methods bearish five bar' },
  { name: 'FWIN', category: 'pattern', placements: main, keywords: 'falling window gap down' },
  { name: 'GRDJ', category: 'pattern', placements: main, keywords: 'gravestone doji bearish long upper wick' },
  { name: 'HAMR', category: 'pattern', placements: main, keywords: 'hammer bullish reversal long lower wick' },
  { name: 'HGMR', category: 'pattern', placements: main, keywords: 'hanging man bearish reversal long lower wick' },
  { name: 'HRMB', category: 'pattern', placements: main, keywords: 'bullish harami inside body' },
  { name: 'HRMBR', category: 'pattern', placements: main, keywords: 'bearish harami inside body' },
  { name: 'HRXB', category: 'pattern', placements: main, keywords: 'bullish harami cross doji inside body' },
  { name: 'HRXBR', category: 'pattern', placements: main, keywords: 'bearish harami cross doji inside body' },
  { name: 'IVHM', category: 'pattern', placements: main, keywords: 'inverted hammer bullish long upper wick' },
  { name: 'KIKB', category: 'pattern', placements: main, keywords: 'kicking bullish marubozu gap' },
  { name: 'KIKBR', category: 'pattern', placements: main, keywords: 'kicking bearish marubozu gap' },
  { name: 'LLS', category: 'pattern', placements: main, keywords: 'long lower shadow bullish wick' },
  { name: 'LUS', category: 'pattern', placements: main, keywords: 'long upper shadow bearish wick' },
  { name: 'MZBW', category: 'pattern', placements: main, keywords: 'marubozu white bull no wicks' },
  { name: 'MZBB', category: 'pattern', placements: main, keywords: 'marubozu black bear no wicks' },
  { name: 'MDJS', category: 'pattern', placements: main, keywords: 'morning doji star bullish three bar' },
  { name: 'MOST', category: 'pattern', placements: main, keywords: 'morning star bullish three bar reversal' },
  { name: 'ONNK', category: 'pattern', placements: main, keywords: 'on neck bearish continuation close at low' },
  { name: 'PIER', category: 'pattern', placements: main, keywords: 'piercing bullish reversal midpoint' },
  { name: 'RTM3', category: 'pattern', placements: main, keywords: 'rising three methods bullish five bar consolidation' },
  { name: 'RWIN', category: 'pattern', placements: main, keywords: 'rising window gap up' },
  { name: 'SHST', category: 'pattern', placements: main, keywords: 'shooting star bearish long upper wick' },
  { name: 'SPTW', category: 'pattern', placements: main, keywords: 'spinning top white indecision' },
  { name: 'SPTB', category: 'pattern', placements: main, keywords: 'spinning top black indecision' },
  { name: 'TBC', category: 'pattern', placements: main, keywords: 'three black crows bearish' },
  { name: 'TWS', category: 'pattern', placements: main, keywords: 'three white soldiers bullish' },
  { name: 'TJSTB', category: 'pattern', placements: main, keywords: 'tri star bullish three doji' },
  { name: 'TJSTBR', category: 'pattern', placements: main, keywords: 'tri star bearish three doji' },
  { name: 'TWB', category: 'pattern', placements: main, keywords: 'tweezer bottom equal lows bullish' },
  { name: 'TWT', category: 'pattern', placements: main, keywords: 'tweezer top equal highs bearish' },
  { name: 'UTSG', category: 'pattern', placements: main, keywords: 'upside tasuki gap bullish continuation' }
]

/** Auto chart patterns (TV's Patterns list) — see src/indicator/chart-patterns.ts. */
const CHART_PATTERN_ITEMS: IndicatorMenuItem[] = [
  { name: 'CPALL', category: 'chart_pattern', placements: main, keywords: 'all chart patterns auto detection' },
  { name: 'CPBFLAG', category: 'chart_pattern', placements: main, keywords: 'bullish flag auto chart pattern continuation pole' },
  { name: 'CPBRFLAG', category: 'chart_pattern', placements: main, keywords: 'bearish flag auto chart pattern continuation pole' },
  { name: 'CPBPEN', category: 'chart_pattern', placements: main, keywords: 'bullish pennant auto chart pattern continuation pole' },
  { name: 'CPBRPEN', category: 'chart_pattern', placements: main, keywords: 'bearish pennant auto chart pattern continuation pole' },
  { name: 'CPDT', category: 'chart_pattern', placements: main, keywords: 'double top auto chart pattern reversal neckline' },
  { name: 'CPDB', category: 'chart_pattern', placements: main, keywords: 'double bottom auto chart pattern reversal neckline' },
  { name: 'CPTT', category: 'chart_pattern', placements: main, keywords: 'triple top auto chart pattern reversal neckline' },
  { name: 'CPTB', category: 'chart_pattern', placements: main, keywords: 'triple bottom auto chart pattern reversal neckline' },
  { name: 'CPHS', category: 'chart_pattern', placements: main, keywords: 'head and shoulders auto chart pattern reversal neckline' },
  { name: 'CPIHS', category: 'chart_pattern', placements: main, keywords: 'inverse head and shoulders auto chart pattern reversal neckline' },
  { name: 'CPRW', category: 'chart_pattern', placements: main, keywords: 'rising wedge auto chart pattern converging' },
  { name: 'CPFW', category: 'chart_pattern', placements: main, keywords: 'falling wedge auto chart pattern converging' },
  { name: 'CPTRI', category: 'chart_pattern', placements: main, keywords: 'triangle auto chart pattern converging neutral' },
  { name: 'CPRECT', category: 'chart_pattern', placements: main, keywords: 'rectangle auto chart pattern range neutral' },
  { name: 'CPCUP', category: 'chart_pattern', placements: main, keywords: 'cup and handle auto chart pattern bowl' },
  { name: 'CPICUP', category: 'chart_pattern', placements: main, keywords: 'inverted cup and handle auto chart pattern' },
  { name: 'CPEW', category: 'chart_pattern', placements: main, keywords: 'elliott wave auto chart pattern impulse zigzag' }
]

/**
 * One record per unique indicator. Placement capabilities intentionally mirror
 * the chart's supported main/sub menus; keeping them here prevents duplicates
 * in the picker without removing the ability to add an indicator to both panes.
 */
export const INDICATOR_MENU_ITEMS: IndicatorMenuItem[] = [
  { name: 'MA', category: 'moving_average', placements: both, popularRank: 1, keywords: 'moving average simple' },
  { name: 'EMA', category: 'moving_average', placements: both, popularRank: 2, keywords: 'exponential moving average' },
  { name: 'SMA', category: 'moving_average', placements: both, keywords: 'smoothed moving average' },
  { name: 'BBI', category: 'moving_average', placements: both, keywords: 'bull bear index average' },
  { name: 'WMA', category: 'moving_average', placements: main, keywords: 'weighted moving average' },
  { name: 'HMA', category: 'moving_average', placements: main, keywords: 'hull moving average' },
  { name: 'VWMA', category: 'moving_average', placements: main, keywords: 'volume weighted moving average' },
  { name: 'DEMA', category: 'moving_average', placements: main, keywords: 'double exponential moving average' },
  { name: 'TEMA', category: 'moving_average', placements: main, keywords: 'triple exponential moving average' },
  { name: 'KAMA', category: 'moving_average', placements: main, keywords: 'kaufman adaptive moving average efficiency ratio' },
  { name: 'ALMA', category: 'moving_average', placements: main, keywords: 'alma arnaud legoux moving average gaussian' },
  { name: 'MCGINLEY', category: 'moving_average', placements: main, keywords: 'mcginley dynamic moving average' },
  { name: 'LSMA', category: 'moving_average', placements: main, keywords: 'lsma least squares linear regression moving average curve' },
  { name: 'TYP', category: 'moving_average', placements: main, keywords: 'typical price hlc3 average' },
  { name: 'MED', category: 'moving_average', placements: main, keywords: 'median price hl2 middle' },
  { name: 'MACROSS', category: 'moving_average', placements: main, keywords: 'ma cross golden death crossover simple moving average' },
  { name: 'MAEMACROSS', category: 'moving_average', placements: main, keywords: 'ma with ema cross golden death crossover' },
  { name: 'EMACROSS', category: 'moving_average', placements: main, keywords: 'ema cross golden death crossover exponential' },
  { name: 'DMA', category: 'moving_average', placements: sub, keywords: 'different moving average' },
  { name: 'TRIX', category: 'moving_average', placements: sub, keywords: 'triple exponential average oscillator' },

  { name: 'SAR', category: 'trend', placements: both, keywords: 'parabolic stop reverse' },
  { name: 'SUPERTREND', category: 'trend', placements: main, popularRank: 10, keywords: 'super trend' },
  { name: 'ICHIMOKU', category: 'trend', placements: main, popularRank: 11, keywords: 'ichimoku cloud conversion base span' },
  { name: 'DC', category: 'trend', placements: main, keywords: 'donchian channel' },
  { name: 'PIVOT', category: 'trend', placements: main, keywords: 'pivot points support resistance' },
  { name: 'ALLIGATOR', category: 'trend', placements: main, keywords: 'williams alligator jaw teeth lips' },
  { name: 'LRC', category: 'trend', placements: main, keywords: 'linear regression channel' },
  { name: 'CE', category: 'trend', placements: main, keywords: 'chandelier exit atr trailing stop' },
  { name: 'DMI', category: 'trend', placements: sub, keywords: 'directional movement index adx' },
  { name: 'AROON', category: 'trend', placements: sub, keywords: 'aroon up down' },
  { name: 'VORTEX', category: 'trend', placements: sub, keywords: 'vortex indicator vi' },
  { name: 'LRSLOPE', category: 'trend', placements: sub, keywords: 'linear regression slope linreg' },
  { name: 'ZIGZAG', category: 'trend', placements: main, keywords: 'zigzag zig zag pivots deviation' },
  { name: 'FRACTAL', category: 'trend', placements: main, keywords: 'williams fractal alligator' },
  { name: 'W52', category: 'trend', placements: main, keywords: '52 week high low yearly range' },

  { name: 'MACD', category: 'momentum', placements: sub, popularRank: 4, keywords: 'moving average convergence divergence' },
  { name: 'KDJ', category: 'momentum', placements: sub, keywords: 'stochastic k d j' },
  { name: 'RSI', category: 'momentum', placements: sub, popularRank: 5, keywords: 'relative strength index' },
  { name: 'BIAS', category: 'momentum', placements: sub, keywords: 'bias ratio' },
  { name: 'BRAR', category: 'momentum', placements: sub, keywords: 'sentiment ar br' },
  { name: 'CCI', category: 'momentum', placements: sub, keywords: 'commodity channel index' },
  { name: 'CR', category: 'momentum', placements: sub, keywords: 'energy index' },
  { name: 'PSY', category: 'momentum', placements: sub, keywords: 'psychological line' },
  { name: 'WR', category: 'momentum', placements: sub, keywords: 'williams percent r' },
  { name: 'MTM', category: 'momentum', placements: sub, keywords: 'momentum' },
  { name: 'ROC', category: 'momentum', placements: sub, keywords: 'rate of change' },
  { name: 'AO', category: 'momentum', placements: sub, keywords: 'awesome oscillator' },
  { name: 'STOCHRSI', category: 'momentum', placements: sub, popularRank: 12, keywords: 'stochastic rsi relative strength' },
  { name: 'STOCH', category: 'momentum', placements: sub, popularRank: 9, keywords: 'stochastic oscillator k d' },
  { name: 'UO', category: 'momentum', placements: sub, keywords: 'ultimate oscillator' },
  { name: 'TSI', category: 'momentum', placements: sub, keywords: 'true strength index' },
  { name: 'FISHER', category: 'momentum', placements: sub, keywords: 'fisher transform ehlers' },
  { name: 'PPO', category: 'momentum', placements: sub, keywords: 'price oscillator percentage ppo absolute macd' },
  { name: 'DPO', category: 'momentum', placements: sub, keywords: 'detrended price oscillator cycle' },
  { name: 'COPPOCK', category: 'momentum', placements: sub, keywords: 'coppock curve buy indicator roc wma' },
  { name: 'KVO', category: 'momentum', placements: sub, keywords: 'klinger oscillator volume force kvo' },
  { name: 'KST', category: 'momentum', placements: sub, keywords: 'know sure thing kst pring' },
  { name: 'CMO', category: 'momentum', placements: sub, keywords: 'chande momentum oscillator cmo' },
  { name: 'CRSI', category: 'momentum', placements: sub, keywords: 'connors rsi streak percent rank' },
  { name: 'SMI', category: 'momentum', placements: sub, keywords: 'stochastic momentum index double smoothed' },
  { name: 'MASS', category: 'momentum', placements: sub, keywords: 'mass index range expansion bulge' },
  { name: 'SMIE', category: 'momentum', placements: sub, keywords: 'smi ergodic tsi true strength histogram' },
  { name: 'RVGI', category: 'momentum', placements: sub, keywords: 'relative vigor index rvgi close open' },

  { name: 'BOLL', category: 'volatility', placements: both, popularRank: 6, keywords: 'bollinger bands standard deviation' },
  { name: 'KC', category: 'volatility', placements: main, keywords: 'keltner channels atr' },
  { name: 'ENV', category: 'volatility', placements: main, keywords: 'moving average envelopes' },
  { name: 'ATR', category: 'volatility', placements: sub, popularRank: 8, keywords: 'average true range' },
  { name: 'HV', category: 'volatility', placements: sub, keywords: 'historical volatility' },
  { name: 'BBW', category: 'volatility', placements: sub, keywords: 'bollinger bandwidth squeeze' },
  { name: 'BBB', category: 'volatility', placements: sub, keywords: 'bollinger percent b %b lower band position' },
  { name: 'STDDEV', category: 'volatility', placements: sub, keywords: 'standard deviation dispersion sigma' },
  { name: 'CHAVOL', category: 'volatility', placements: sub, keywords: 'chaikin volatility high low ema' },
  { name: 'RVI', category: 'volatility', placements: sub, keywords: 'relative volatility index rvi chande dorsey' },
  { name: 'C2C', category: 'volatility', placements: sub, keywords: 'volatility close to close annualized log returns' },
  { name: 'C2CZT', category: 'volatility', placements: sub, keywords: 'volatility zero trend close to close demeaned' },
  { name: 'VOHLC', category: 'volatility', placements: sub, keywords: 'volatility open high low close estimator' },
  { name: 'UI', category: 'volatility', placements: sub, keywords: 'ulcer index drawdown depth' },
  { name: 'VSTOP', category: 'volatility', placements: main, keywords: 'volatility stop atr trailing' },
  { name: 'CKS', category: 'volatility', placements: main, keywords: 'chande kroll stop atr bands' },
  { name: 'CHOP', category: 'volatility', placements: sub, keywords: 'choppiness index trend range' },

  { name: 'VOL', category: 'volume', placements: sub, popularRank: 3, keywords: 'volume' },
  { name: 'VWAP', category: 'volume', placements: main, popularRank: 7, keywords: 'volume weighted average price' },
  { name: 'VRVP', category: 'volume', placements: main, keywords: 'volume profile visible range vpvr poc value area' },
  { name: 'SVP', category: 'volume', placements: main, keywords: 'session volume profile poc value area' },
  { name: 'OBV', category: 'volume', placements: sub, keywords: 'on balance volume' },
  { name: 'VR', category: 'volume', placements: sub, keywords: 'volume ratio' },
  { name: 'EMV', category: 'volume', placements: sub, keywords: 'ease of movement volume' },
  { name: 'PVT', category: 'volume', placements: sub, keywords: 'price volume trend' },
  { name: 'MFI', category: 'volume', placements: sub, keywords: 'money flow index' },
  { name: 'CMF', category: 'volume', placements: sub, keywords: 'chaikin money flow' },
  { name: 'CHAIKIN', category: 'volume', placements: sub, keywords: 'chaikin oscillator accumulation distribution' },
  { name: 'ADL', category: 'volume', placements: sub, keywords: 'accumulation distribution line' },
  { name: 'EFI', category: 'volume', placements: sub, keywords: 'elder force index' },
  { name: 'VO', category: 'volume', placements: sub, keywords: 'volume oscillator fast slow percentage' },
  ...CANDLE_PATTERN_ITEMS,
  ...CHART_PATTERN_ITEMS
]

export const POPULAR_INDICATORS = INDICATOR_MENU_ITEMS
  .filter(item => item.popularRank !== undefined)
  .sort((a, b) => a.popularRank! - b.popularRank!)

export function searchIndicatorItems (
  query: string,
  labelFor: (item: IndicatorMenuItem) => string = item => item.name
): IndicatorMenuItem[] {
  const search = query.trim().toLocaleLowerCase()
  if (search === '') return []
  return INDICATOR_MENU_ITEMS
    .filter(item => `${item.name} ${labelFor(item)} ${item.keywords ?? ''}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => {
      const rankA = a.popularRank ?? Number.MAX_SAFE_INTEGER
      const rankB = b.popularRank ?? Number.MAX_SAFE_INTEGER
      return rankA - rankB || labelFor(a).localeCompare(labelFor(b))
    })
}
