/**
 * The 44 standard candlestick-pattern indicators, ported as individual
 * main-pane overlays that flag their completion bar with a labeled marker.
 * Reference descriptions define each pattern's shape qualitatively
 * without numeric thresholds, so detection uses fixed classic ratios (doji
 * body ≤ 10% of range, small body ≤ 30%, long body ≥ 60%, marubozu wicks
 * ≤ 5%) — name-level parity, documented in the parity matrix caveats.
 * Patterns are marked at the bar that completes them.
 */
import {
  IndicatorSeries,
  type IndicatorDrawCallback,
  type IndicatorFigure,
  type IndicatorTemplate,
  type KLineData
} from 'klinecharts'

import { fillTriangle } from './math'

interface FlagResult { value?: number }

const BODY_DOJI = 0.1
const BODY_SMALL = 0.3
const BODY_LONG = 0.6
const WICK_NONE = 0.05
const RANGE_DOMINANT = 0.6

const body = (bar: KLineData): number => Math.abs(bar.close - bar.open)
const rangeOf = (bar: KLineData): number => bar.high - bar.low
const upperWick = (bar: KLineData): number => bar.high - Math.max(bar.open, bar.close)
const lowerWick = (bar: KLineData): number => Math.min(bar.open, bar.close) - bar.low
const bull = (bar: KLineData): boolean => bar.close > bar.open
const bear = (bar: KLineData): boolean => bar.close < bar.open

const isDoji = (bar: KLineData): boolean => rangeOf(bar) > 0 && body(bar) <= BODY_DOJI * rangeOf(bar)
const smallBody = (bar: KLineData): boolean => rangeOf(bar) > 0 && body(bar) <= BODY_SMALL * rangeOf(bar)
const longBody = (bar: KLineData): boolean => rangeOf(bar) > 0 && body(bar) >= BODY_LONG * rangeOf(bar)
const wickless = (bar: KLineData): boolean =>
  rangeOf(bar) > 0 && upperWick(bar) <= WICK_NONE * rangeOf(bar) && lowerWick(bar) <= WICK_NONE * rangeOf(bar)

const netDown = (data: KLineData[], i: number): boolean => i >= 4 && data[i - 1].close < data[i - 4].close
const netUp = (data: KLineData[], i: number): boolean => i >= 4 && data[i - 1].close > data[i - 4].close
const bodyGapUp = (cur: KLineData, prev: KLineData): boolean => Math.min(cur.open, cur.close) > Math.max(prev.open, prev.close)
const bodyGapDown = (cur: KLineData, prev: KLineData): boolean => Math.max(cur.open, cur.close) < Math.min(prev.open, prev.close)
const rangeGapUp = (cur: KLineData, prev: KLineData): boolean => cur.low > prev.high
const rangeGapDown = (cur: KLineData, prev: KLineData): boolean => cur.high < prev.low
const sameLevel = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) <= tolerance

type Detector = (data: KLineData[], i: number) => boolean

const drawFlags = (kind: 'bullish' | 'bearish' | 'neutral', label: string): IndicatorDrawCallback =>
  ({ ctx, indicator, visibleRange, xAxis, yAxis }) => {
    const rows = indicator.result as FlagResult[]
    const color = kind === 'bullish' ? '#26a69a' : kind === 'bearish' ? '#ef5350' : '#bfb48f'
    const from = Math.max(0, visibleRange.from)
    const to = Math.min(rows.length, visibleRange.to)
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    for (let i = from; i < to; i++) {
      const value = rows[i].value
      if (value === undefined) continue
      const x = xAxis.convertToPixel(i)
      const y = yAxis.convertToPixel(value)
      ctx.fillStyle = color
      // bullish flags sit under the low pointing up; bearish/neutral above
      const anchor = kind === 'bullish' ? y + 12 : y - 12
      fillTriangle(ctx, x, anchor, kind === 'bearish' ? -1 : 1, 4)
      ctx.fillText(label, x, anchor + (kind === 'bullish' ? 12 : -12))
    }
    return false
  }

const patternTemplate = (
  name: string,
  label: string,
  kind: 'bullish' | 'bearish' | 'neutral',
  lookback: number,
  detect: Detector
): IndicatorTemplate<FlagResult> => {
  const bullish = kind === 'bullish'
  const figures: IndicatorFigure<FlagResult>[] = [
    { key: 'value', title: `${label}: `, type: 'line' }
  ]
  return {
    name,
    shortName: label,
    series: IndicatorSeries.Price,
    shouldOhlc: true,
    figures,
    calc: dataList => dataList.map((bar, i) =>
      i < lookback ? {} : detect(dataList, i) ? { value: bullish ? bar.low : bar.high } : {}),
    draw: drawFlags(kind, label)
  }
}

/* ---------- single-bar shapes ---------- */

export const patternDoji = patternTemplate('DOJI', 'Doji', 'neutral', 0, (d, i) => isDoji(d[i]))

export const patternDojiStarBullish = patternTemplate('DSB', 'Doji Star Bullish', 'bullish', 3, (d, i) =>
  netDown(d, i) && isDoji(d[i]) && bodyGapDown(d[i], d[i - 1]))

export const patternDojiStarBearish = patternTemplate('DSBR', 'Doji Star Bearish', 'bearish', 3, (d, i) =>
  netUp(d, i) && isDoji(d[i]) && bodyGapUp(d[i], d[i - 1]))

export const patternDragonflyDoji = patternTemplate('DFDJ', 'Dragonfly Doji', 'bullish', 0, (d, i) =>
  isDoji(d[i]) && lowerWick(d[i]) >= RANGE_DOMINANT * rangeOf(d[i]))

export const patternGravestoneDoji = patternTemplate('GRDJ', 'Gravestone Doji', 'bearish', 0, (d, i) =>
  isDoji(d[i]) && upperWick(d[i]) >= RANGE_DOMINANT * rangeOf(d[i]))

export const patternSpinningTopWhite = patternTemplate('SPTW', 'Spinning Top White', 'bullish', 0, (d, i) => {
  const bar = d[i]
  return bull(bar) && rangeOf(bar) > 0 && body(bar) <= BODY_SMALL * rangeOf(bar) &&
    upperWick(bar) >= body(bar) && lowerWick(bar) >= body(bar)
})

export const patternSpinningTopBlack = patternTemplate('SPTB', 'Spinning Top Black', 'bearish', 0, (d, i) => {
  const bar = d[i]
  return bear(bar) && rangeOf(bar) > 0 && body(bar) <= BODY_SMALL * rangeOf(bar) &&
    upperWick(bar) >= body(bar) && lowerWick(bar) >= body(bar)
})

export const patternLongLowerShadow = patternTemplate('LLS', 'Long Lower Shadow', 'bullish', 0, (d, i) => {
  const bar = d[i]
  return rangeOf(bar) > 0 && lowerWick(bar) >= 2 * body(bar) && lowerWick(bar) >= 0.5 * rangeOf(bar)
})

export const patternLongUpperShadow = patternTemplate('LUS', 'Long Upper Shadow', 'bearish', 0, (d, i) => {
  const bar = d[i]
  return rangeOf(bar) > 0 && upperWick(bar) >= 2 * body(bar) && upperWick(bar) >= 0.5 * rangeOf(bar)
})

export const patternMarubozuWhite = patternTemplate('MZBW', 'Marubozu White', 'bullish', 0, (d, i) =>
  bull(d[i]) && wickless(d[i]))

export const patternMarubozuBlack = patternTemplate('MZBB', 'Marubozu Black', 'bearish', 0, (d, i) =>
  bear(d[i]) && wickless(d[i]))

const hammerShape = (bar: KLineData): boolean =>
  smallBody(bar) && lowerWick(bar) >= 2 * body(bar) && upperWick(bar) <= body(bar)

const invertedHammerShape = (bar: KLineData): boolean =>
  smallBody(bar) && upperWick(bar) >= 2 * body(bar) && lowerWick(bar) <= body(bar)

export const patternHammer = patternTemplate('HAMR', 'Hammer', 'bullish', 3, (d, i) =>
  netDown(d, i) && hammerShape(d[i]))

export const patternHangingMan = patternTemplate('HGMR', 'Hanging Man', 'bearish', 3, (d, i) =>
  netUp(d, i) && hammerShape(d[i]))

export const patternInvertedHammer = patternTemplate('IVHM', 'Inverted Hammer', 'bullish', 3, (d, i) =>
  netDown(d, i) && invertedHammerShape(d[i]))

export const patternShootingStar = patternTemplate('SHST', 'Shooting Star', 'bearish', 3, (d, i) =>
  netUp(d, i) && invertedHammerShape(d[i]))

/* ---------- two-bar shapes ---------- */

const bullishEngulfing = (d: KLineData[], i: number): boolean =>
  bear(d[i - 1]) && bull(d[i]) && body(d[i]) > body(d[i - 1]) &&
  d[i].open <= d[i - 1].close && d[i].close >= d[i - 1].open

const bearishEngulfing = (d: KLineData[], i: number): boolean =>
  bull(d[i - 1]) && bear(d[i]) && body(d[i]) > body(d[i - 1]) &&
  d[i].open >= d[i - 1].close && d[i].close <= d[i - 1].open

export const patternBullishEngulfing = patternTemplate('ENGB', 'Bullish Engulfing', 'bullish', 1, bullishEngulfing)

export const patternBearishEngulfing = patternTemplate('ENGBR', 'Bearish Engulfing', 'bearish', 1, bearishEngulfing)

const harami = (d: KLineData[], i: number): boolean => {
  const prev = d[i - 1]
  const cur = d[i]
  return longBody(prev) && body(cur) < body(prev) &&
    Math.max(cur.open, cur.close) <= Math.max(prev.open, prev.close) &&
    Math.min(cur.open, cur.close) >= Math.min(prev.open, prev.close)
}

export const patternBullishHarami = patternTemplate('HRMB', 'Bullish Harami', 'bullish', 1, (d, i) =>
  bear(d[i - 1]) && bull(d[i]) && harami(d, i))

export const patternBearishHarami = patternTemplate('HRMBR', 'Bearish Harami', 'bearish', 1, (d, i) =>
  bull(d[i - 1]) && bear(d[i]) && harami(d, i))

export const patternBullishHaramiCross = patternTemplate('HRXB', 'Bullish Harami Cross', 'bullish', 1, (d, i) =>
  bear(d[i - 1]) && isDoji(d[i]) && harami(d, i))

export const patternBearishHaramiCross = patternTemplate('HRXBR', 'Bearish Harami Cross', 'bearish', 1, (d, i) =>
  bull(d[i - 1]) && isDoji(d[i]) && harami(d, i))

export const patternKickingBullish = patternTemplate('KIKB', 'Kicking Bullish', 'bullish', 1, (d, i) =>
  wickless(d[i - 1]) && bear(d[i - 1]) && wickless(d[i]) && bull(d[i]) && d[i].open > d[i - 1].close)

export const patternKickingBearish = patternTemplate('KIKBR', 'Kicking Bearish', 'bearish', 1, (d, i) =>
  wickless(d[i - 1]) && bull(d[i - 1]) && wickless(d[i]) && bear(d[i]) && d[i].open < d[i - 1].close)

export const patternPiercing = patternTemplate('PIER', 'Piercing', 'bullish', 1, (d, i) => {
  const prev = d[i - 1]
  const cur = d[i]
  const midpoint = (prev.open + prev.close) / 2
  return bear(prev) && longBody(prev) && bull(cur) &&
    cur.open < prev.close && cur.close > midpoint && cur.close < prev.open
})

export const patternDarkCloudCover = patternTemplate('DCC', 'Dark Cloud Cover', 'bearish', 1, (d, i) => {
  const prev = d[i - 1]
  const cur = d[i]
  const midpoint = (prev.open + prev.close) / 2
  return bull(prev) && longBody(prev) && bear(cur) &&
    cur.open > prev.close && cur.close < midpoint && cur.close > prev.open
})

export const patternRisingWindow = patternTemplate('RWIN', 'Rising Window', 'bullish', 1, (d, i) =>
  rangeGapUp(d[i], d[i - 1]))

export const patternFallingWindow = patternTemplate('FWIN', 'Falling Window', 'bearish', 1, (d, i) =>
  rangeGapDown(d[i], d[i - 1]))

export const patternTweezerBottom = patternTemplate('TWB', 'Tweezer Bottom', 'bullish', 3, (d, i) => {
  const prev = d[i - 1]
  const cur = d[i]
  return netDown(d, i) && rangeOf(prev) > 0 && sameLevel(cur.low, prev.low, 0.1 * rangeOf(prev))
})

export const patternTweezerTop = patternTemplate('TWT', 'Tweezer Top', 'bearish', 3, (d, i) => {
  const prev = d[i - 1]
  const cur = d[i]
  return netUp(d, i) && rangeOf(prev) > 0 && sameLevel(cur.high, prev.high, 0.1 * rangeOf(prev))
})

export const patternOnNeck = patternTemplate('ONNK', 'On Neck', 'bearish', 3, (d, i) => {
  const prev = d[i - 1]
  const cur = d[i]
  return netDown(d, i) && bear(prev) && bull(cur) && cur.close < prev.open &&
    sameLevel(cur.close, prev.low, 0.1 * rangeOf(prev))
})

/* ---------- three-bar shapes ---------- */

const starMiddle = (d: KLineData[], i: number, doji: boolean): boolean => {
  const first = d[i - 2]
  const middle = d[i - 1]
  return longBody(first) && bear(first) && (doji ? isDoji(middle) : smallBody(middle)) &&
    bodyGapDown(middle, first)
}

const completesBelowMidpoint = (d: KLineData[], i: number): boolean => {
  const first = d[i - 2]
  const cur = d[i]
  return bull(cur) && cur.close > (first.open + first.close) / 2
}

const completesAboveMidpoint = (d: KLineData[], i: number): boolean => {
  const first = d[i - 2]
  const cur = d[i]
  return bear(cur) && cur.close < (first.open + first.close) / 2
}

export const patternMorningStar = patternTemplate('MOST', 'Morning Star', 'bullish', 2, (d, i) =>
  starMiddle(d, i, false) && completesBelowMidpoint(d, i))

export const patternMorningDojiStar = patternTemplate('MDJS', 'Morning Doji Star', 'bullish', 2, (d, i) =>
  starMiddle(d, i, true) && completesBelowMidpoint(d, i))

export const patternEveningStar = patternTemplate('EVST', 'Evening Star', 'bearish', 2, (d, i) => {
  const first = d[i - 2]
  const middle = d[i - 1]
  return longBody(first) && bull(first) && smallBody(middle) &&
    bodyGapUp(middle, first) && completesAboveMidpoint(d, i)
})

export const patternEveningDojiStar = patternTemplate('EDJS', 'Evening Doji Star', 'bearish', 2, (d, i) => {
  const first = d[i - 2]
  const middle = d[i - 1]
  return longBody(first) && bull(first) && isDoji(middle) &&
    bodyGapUp(middle, first) && completesAboveMidpoint(d, i)
})

const threeOfColor = (d: KLineData[], i: number, color: (bar: KLineData) => boolean): boolean => {
  const a = d[i - 2]
  const b = d[i - 1]
  const c = d[i]
  return color(a) && color(b) && color(c) &&
    b.close > a.close && c.close > b.close &&
    b.open > a.open && b.open < a.close &&
    c.open > b.open && c.open < b.close
}

export const patternThreeWhiteSoldiers = patternTemplate('TWS', 'Three White Soldiers', 'bullish', 2, (d, i) =>
  threeOfColor(d, i, bull))

export const patternThreeBlackCrows = patternTemplate('TBC', 'Three Black Crows', 'bearish', 2, (d, i) => {
  const a = d[i - 2]
  const b = d[i - 1]
  const c = d[i]
  return bear(a) && bear(b) && bear(c) &&
    b.close < a.close && c.close < b.close &&
    b.open < a.open && b.open > a.close &&
    c.open < b.open && c.open > b.close
})

export const patternTriStarBullish = patternTemplate('TJSTB', 'Tri Star Bullish', 'bullish', 2, (d, i) =>
  isDoji(d[i - 2]) && isDoji(d[i - 1]) && isDoji(d[i]) &&
  bodyGapDown(d[i - 1], d[i - 2]) && bodyGapUp(d[i], d[i - 1]))

export const patternTriStarBearish = patternTemplate('TJSTBR', 'Tri Star Bearish', 'bearish', 2, (d, i) =>
  isDoji(d[i - 2]) && isDoji(d[i - 1]) && isDoji(d[i]) &&
  bodyGapUp(d[i - 1], d[i - 2]) && bodyGapDown(d[i], d[i - 1]))

export const patternUpsideTasukiGap = patternTemplate('UTSG', 'Upside Tasuki Gap', 'bullish', 2, (d, i) => {
  const first = d[i - 2]
  const middle = d[i - 1]
  const cur = d[i]
  return bull(first) && rangeGapUp(middle, first) && bull(middle) && bear(cur) &&
    cur.open < middle.close && cur.open > middle.open && cur.close > first.high
})

export const patternDownsideTasukiGap = patternTemplate('DTSG', 'Downside Tasuki Gap', 'bearish', 2, (d, i) => {
  const first = d[i - 2]
  const middle = d[i - 1]
  const cur = d[i]
  return bear(first) && rangeGapDown(middle, first) && bear(middle) && bull(cur) &&
    cur.open < middle.open && cur.open > middle.close && cur.close < first.low
})

export const patternAbandonedBabyBullish = patternTemplate('ABB', 'Abandoned Baby Bullish', 'bullish', 3, (d, i) => {
  const middle = d[i - 1]
  return netDown(d, i) && isDoji(middle) &&
    rangeGapDown(middle, d[i - 2]) && rangeGapUp(d[i], middle)
})

export const patternAbandonedBabyBearish = patternTemplate('ABBR', 'Abandoned Baby Bearish', 'bearish', 3, (d, i) => {
  const middle = d[i - 1]
  return netUp(d, i) && isDoji(middle) &&
    rangeGapUp(middle, d[i - 2]) && rangeGapDown(d[i], middle)
})

/* ---------- five-bar shapes ---------- */

const threeContainedBars = (d: KLineData[], i: number, color: (bar: KLineData) => boolean): boolean => {
  const base = d[i - 4]
  for (let k = i - 3; k <= i - 1; k++) {
    const bar = d[k]
    if (!color(bar) || !smallBody(bar)) return false
    if (bar.high > base.high || bar.low < base.low) return false
  }
  return true
}

export const patternRisingThreeMethods = patternTemplate('RTM3', 'Rising Three Methods', 'bullish', 4, (d, i) => {
  const base = d[i - 4]
  const cur = d[i]
  return bull(base) && longBody(base) && threeContainedBars(d, i, bear) &&
    bull(cur) && cur.close > base.close
})

export const patternFallingThreeMethods = patternTemplate('FTM3', 'Falling Three Methods', 'bearish', 4, (d, i) => {
  const base = d[i - 4]
  const cur = d[i]
  return bear(base) && longBody(base) && threeContainedBars(d, i, bull) &&
    bear(cur) && cur.close < base.close
})

const indicators: IndicatorTemplate<FlagResult>[] = [
  patternAbandonedBabyBullish,
  patternAbandonedBabyBearish,
  patternDarkCloudCover,
  patternDoji,
  patternDojiStarBullish,
  patternDojiStarBearish,
  patternDownsideTasukiGap,
  patternDragonflyDoji,
  patternBullishEngulfing,
  patternBearishEngulfing,
  patternEveningDojiStar,
  patternEveningStar,
  patternFallingThreeMethods,
  patternFallingWindow,
  patternGravestoneDoji,
  patternHammer,
  patternHangingMan,
  patternBullishHarami,
  patternBearishHarami,
  patternBullishHaramiCross,
  patternBearishHaramiCross,
  patternInvertedHammer,
  patternKickingBullish,
  patternKickingBearish,
  patternLongLowerShadow,
  patternLongUpperShadow,
  patternMarubozuWhite,
  patternMarubozuBlack,
  patternMorningDojiStar,
  patternMorningStar,
  patternOnNeck,
  patternPiercing,
  patternRisingThreeMethods,
  patternRisingWindow,
  patternShootingStar,
  patternSpinningTopWhite,
  patternSpinningTopBlack,
  patternThreeBlackCrows,
  patternThreeWhiteSoldiers,
  patternTriStarBullish,
  patternTriStarBearish,
  patternTweezerBottom,
  patternTweezerTop,
  patternUpsideTasukiGap
]

export default indicators
