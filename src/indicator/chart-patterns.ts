/**
 * Auto chart patterns (Supercharts Technicals → Patterns): the 16 classic
 * patterns, All Chart Patterns and Elliott Wave as main-pane overlays.
 *
 * Documented reference behavior used here: 5/5 pivots, a 600-bar scan, close-
 * based breakouts, the Awaiting/Reached/Failed/Indefinable statuses, the
 * overlap precedence and the per-pattern inputs. The reference publishes no
 * input defaults or exact formulas, so those are conventional choices — this
 * is definition-level parity, not numerical parity (see the parity matrix).
 */
import {
  IndicatorSeries,
  type IndicatorDrawCallback,
  type IndicatorTemplate,
  type KLineData
} from 'klinecharts'

const PIVOT_BARS = 5
const SCAN_BARS = 600
const CUP_MIN_BARS = 20
// ponytail: fixed judgment calls with no documented input; promote to inputs if users need to tune them
const SHOULDER_TOLERANCE = 0.25
const FLAT_TOLERANCE = 0.1
// Tuned against real candles: a straight V keeps about a third of its closes in the lower third.
const CUP_LOWER_THIRD = 0.45
// A rim must be reached by closes, not just a wick (fraction of cup height, within RIM_BARS bars).
const CUP_RIM_CLOSE = 0.25
const RIM_BARS = 3
// A range whose height exceeds half its midpoint is a trend leg, not a consolidation.
const RANGE_MAX_HEIGHT = 0.5
// Zigzag 5-3-5 sub-swings, counted on 1/1 pivots between the 5/5 wave points.
// ponytail: impulses skip this; strong legs are too straight to show 5 swings at this resolution (0 of 29 real candidates passed).
const SUB_PIVOT_BARS = 1

export type PatternStatus = 'awaiting' | 'reached' | 'failed' | 'indefinable' | 'formed'

export interface PatternPoint {
  i: number
  price: number
  label?: string
  tentative?: boolean
}

export interface ChartPattern {
  name: string
  label: string
  direction: 1 | -1 | 0
  status: PatternStatus
  /** In Progress pattern: drawn with dotted lines. */
  dotted: boolean
  /** The first three points are a cup's rim, bottom and rim: drawn as a curve. */
  bowl?: boolean
  points: PatternPoint[]
  lines: Array<[PatternPoint, PatternPoint]>
  breakIndex?: number
  target?: number
  showTarget: boolean
}

export interface ChartPatternRow { patterns?: ChartPattern[] }

interface Pivot extends PatternPoint { kind: 'H' | 'L' }

interface View {
  data: KLineData[]
  pivots: Pivot[]
  inProgress: boolean
  /** Prices are negated: a top detector is finding a bottom. */
  flip: boolean
}

type Level = (i: number) => number

interface WatchSpec {
  up?: Level
  down?: Level
  /** Close beyond this before a breakout: true discards, 'failed' keeps it as Failed. */
  guard?: (bar: KLineData, i: number) => boolean | 'failed'
  height: number
  /** Price level that fails an upward / downward breakout. */
  stopUp?: number
  stopDown?: number
  maxWait: number
  /** Reversals are only patterns once the neckline breaks, unless In Progress is on. */
  reversal?: boolean
}

interface Outcome {
  status: PatternStatus
  /** Bar where the pattern was decided (or the latest bar), so its lines stop there. */
  endIndex: number
  breakIndex?: number
  breakLevel?: number
  target?: number
}

type Raw = Pick<ChartPattern, 'points' | 'lines' | 'breakIndex' | 'target' | 'status' | 'dotted' | 'bowl'>
type Detector = (view: View, inputs: number[]) => Raw[]

/* ---------- pivots and geometry ---------- */

const pivotAt = (data: KLineData[], i: number, bars: number, kind: 'H' | 'L'): boolean => {
  if (i < bars || i + bars >= data.length) return false
  for (let k = i - bars; k <= i + bars; k++) {
    if (kind === 'H' ? data[k].high > data[i].high : data[k].low < data[i].low) return false
  }
  return true
}

/** Alternating N/N pivots; In Progress appends the live extreme as a tentative point. */
export const findPivots = (data: KLineData[], inProgress = false, bars = PIVOT_BARS): Pivot[] => {
  const pivots: Pivot[] = []
  const add = (kind: 'H' | 'L', i: number): void => {
    const price = kind === 'H' ? data[i].high : data[i].low
    const last = pivots[pivots.length - 1]
    if (last?.kind !== kind) {
      pivots.push({ i, price, kind })
    } else if (kind === 'H' ? price > last.price : price < last.price) {
      pivots[pivots.length - 1] = { i, price, kind }
    }
  }
  for (let i = bars; i + bars < data.length; i++) {
    // an outside bar can be both: take the kind that keeps the sequence alternating
    const order: Array<'H' | 'L'> = pivots[pivots.length - 1]?.kind === 'H' ? ['L', 'H'] : ['H', 'L']
    for (const kind of order) {
      if (pivotAt(data, i, bars, kind)) add(kind, i)
    }
  }
  const last = pivots[pivots.length - 1]
  if (inProgress && last !== undefined && last.i + 1 < data.length) {
    const kind = last.kind === 'H' ? 'L' : 'H'
    let best = last.i + 1
    for (let i = last.i + 2; i < data.length; i++) {
      if (kind === 'H' ? data[i].high > data[best].high : data[i].low < data[best].low) best = i
    }
    pivots.push({ i: best, price: kind === 'H' ? data[best].high : data[best].low, kind, tentative: true })
  }
  return pivots
}

const lineThrough = (a: PatternPoint, b: PatternPoint): Level => {
  const slope = (b.price - a.price) / (b.i - a.i)
  return i => a.price + slope * (i - a.i)
}

const segment = (level: Level, from: number, to: number): [PatternPoint, PatternPoint] =>
  [{ i: from, price: level(from) }, { i: to, price: level(to) }]

const closesInside = (view: View, from: number, to: number, upper: Level, lower: Level, tolerance = 0): boolean => {
  for (let i = from; i <= to; i++) {
    const close = view.data[i].close
    if (close > upper(i) + tolerance || close < lower(i) - tolerance) return false
  }
  return true
}

/** Walk forward from the last pattern point: close-based breakout, then the target/stop race. */
const watch = (view: View, from: number, spec: WatchSpec): Outcome | null => {
  const { data } = view
  let dir = 0
  let breakIndex = -1
  let breakLevel = 0
  let target = 0
  for (let i = from + 1; i < data.length; i++) {
    const bar = data[i]
    if (dir === 0) {
      if (i - from > spec.maxWait) return null
      if (spec.up !== undefined && bar.close > spec.up(i)) {
        dir = 1
        breakLevel = spec.up(i)
      } else if (spec.down !== undefined && bar.close < spec.down(i)) {
        dir = -1
        breakLevel = spec.down(i)
      } else {
        const guard = spec.guard?.(bar, i)
        if (guard === 'failed') return { status: 'failed', endIndex: i }
        if (guard === true) return null
        continue
      }
      breakIndex = i
      target = breakLevel + dir * spec.height
      continue
    }
    const hitTarget = dir > 0 ? bar.high >= target : bar.low <= target
    const stop = dir > 0 ? spec.stopUp : spec.stopDown
    const hitStop = stop !== undefined && (dir > 0 ? bar.low <= stop : bar.high >= stop)
    const outcome = { breakIndex, breakLevel, target, endIndex: breakIndex }
    if (hitTarget && hitStop) return { status: 'indefinable', ...outcome }
    if (hitTarget) return { status: 'reached', ...outcome }
    if (hitStop) return { status: 'failed', ...outcome }
  }
  const endIndex = data.length - 1
  if (dir !== 0) return { status: 'awaiting', breakIndex, breakLevel, target, endIndex: breakIndex }
  return spec.reversal === true && !view.inProgress ? null : { status: 'awaiting', endIndex }
}

const raw = (
  points: Array<PatternPoint | undefined>,
  lines: Array<[PatternPoint, PatternPoint]>,
  outcome: Outcome,
  reversal = false
): Raw => {
  const present = points.filter((point): point is PatternPoint => point !== undefined)
  const unbroken = outcome.breakIndex === undefined
  return {
    points: unbroken || outcome.breakLevel === undefined
      ? present
      : [...present, { i: outcome.breakIndex!, price: outcome.breakLevel }],
    lines,
    status: outcome.status,
    breakIndex: outcome.breakIndex,
    target: outcome.target,
    dotted: present.some(point => point.tentative === true) || (reversal && unbroken)
  }
}

const trendOk = (pivots: Pivot[], k: number, height: number, trendPercent: number): boolean => {
  if (trendPercent <= 0) return true
  const prev = pivots[k - 1]
  return prev !== undefined && pivots[k].price - prev.price >= trendPercent / 100 * height
}

/* ---------- reversals (canonical: tops) ---------- */

const doubleTop: Detector = (view, [trend, second, deviation]) => {
  const { pivots } = view
  const out: Raw[] = []
  for (let k = 0; k + 2 < pivots.length; k++) {
    const [a, m, b] = [pivots[k], pivots[k + 1], pivots[k + 2]]
    if (a.kind !== 'H') continue
    const height = Math.max(a.price, b.price) - m.price
    if (Math.abs(a.price - b.price) > deviation / 100 * height) continue
    const rise = (b.price - a.price) * (view.flip ? -1 : 1)
    if ((second === 1 && rise <= 0) || (second === 2 && rise >= 0)) continue
    if (!trendOk(pivots, k, height, trend)) continue
    const outcome = watch(view, b.i, {
      down: () => m.price,
      guard: bar => bar.close > b.price,
      height,
      stopDown: b.price,
      maxWait: b.i - a.i,
      reversal: true
    })
    if (outcome === null) continue
    out.push(raw([pivots[k - 1], a, m, b], [segment(() => m.price, m.i, outcome.endIndex)], outcome, true))
  }
  return out
}

const tripleTop: Detector = (view, [trend, tops, minima]) => {
  const { pivots } = view
  const out: Raw[] = []
  for (let k = 0; k + 4 < pivots.length; k++) {
    const [a, m, b, n, c] = pivots.slice(k, k + 5)
    if (a.kind !== 'H') continue
    const highest = Math.max(a.price, b.price, c.price)
    const neck = Math.min(m.price, n.price)
    const height = highest - neck
    if (highest - Math.min(a.price, b.price, c.price) > tops / 100 * height) continue
    if (Math.abs(m.price - n.price) > minima / 100 * height) continue
    if (!trendOk(pivots, k, height, trend)) continue
    const outcome = watch(view, c.i, {
      down: () => neck,
      guard: bar => bar.close > c.price,
      height,
      stopDown: c.price,
      maxWait: c.i - a.i,
      reversal: true
    })
    if (outcome === null) continue
    out.push(raw([pivots[k - 1], a, m, b, n, c], [segment(() => neck, m.i, outcome.endIndex)], outcome, true))
  }
  return out
}

const headAndShoulders: Detector = (view, [trend]) => {
  const { pivots } = view
  const out: Raw[] = []
  for (let k = 0; k + 4 < pivots.length; k++) {
    const [left, m, head, n, right] = pivots.slice(k, k + 5)
    if (left.kind !== 'H' || head.price <= left.price || head.price <= right.price) continue
    const neck = lineThrough(m, n)
    const height = head.price - neck(head.i)
    if (height <= 0 || Math.abs(left.price - right.price) > SHOULDER_TOLERANCE * height) continue
    if (left.price <= neck(left.i) || right.price <= neck(right.i)) continue
    if (!trendOk(pivots, k, height, trend)) continue
    const outcome = watch(view, right.i, {
      down: neck,
      guard: bar => bar.close > right.price,
      height,
      stopDown: right.price,
      maxWait: right.i - left.i,
      reversal: true
    })
    if (outcome === null) continue
    out.push(raw([pivots[k - 1], left, m, head, n, right], [segment(neck, m.i, outcome.endIndex)], outcome, true))
  }
  return out
}

/* ---------- continuations (canonical: bullish flag / pennant, rising wedge) ---------- */

const flag: Detector = (view, [deviation, rollback]) => {
  const { pivots } = view
  const out: Raw[] = []
  for (let k = 0; k + 4 < pivots.length; k++) {
    const [start, p2, p3, p4, p5] = pivots.slice(k, k + 5)
    if (start.kind !== 'L') continue
    const pole = p2.price - start.price
    const upper = lineThrough(p2, p4)
    // a flag corrects against the pole, so its channel may not rise
    if (pole <= 0 || p4.price > p2.price) continue
    const height = upper(p3.i) - p3.price
    if (height <= 0) continue
    const lower: Level = i => upper(i) - height
    const tolerance = deviation / 100 * height
    if (Math.abs(p5.price - lower(p5.i)) > tolerance) continue
    if (p2.price - Math.min(p3.price, p5.price) > rollback / 100 * pole) continue
    if (!closesInside(view, p2.i, p5.i, upper, lower, tolerance)) continue
    const maxWait = p5.i - p2.i
    const outcome = watch(view, p5.i, {
      up: upper,
      guard: (bar, i) => bar.close < lower(i) - tolerance ? 'failed' : false,
      height: pole,
      stopUp: p5.price,
      maxWait
    })
    if (outcome === null) continue
    out.push(raw([start, p2, p3, p4, p5], [segment(upper, p2.i, outcome.endIndex), segment(lower, p3.i, outcome.endIndex)], outcome))
  }
  return out
}

const pennant: Detector = (view, [rollback]) => {
  const { pivots } = view
  const out: Raw[] = []
  for (let k = 0; k + 4 < pivots.length; k++) {
    const [start, p2, p3, p4, p5] = pivots.slice(k, k + 5)
    if (start.kind !== 'L') continue
    const pole = p2.price - start.price
    if (pole <= 0 || p4.price >= p2.price || p5.price <= p3.price) continue
    if (p2.price - p3.price > rollback / 100 * pole) continue
    const upper = lineThrough(p2, p4)
    const lower = lineThrough(p3, p5)
    if (upper(p5.i) <= lower(p5.i) || !closesInside(view, p2.i, p5.i, upper, lower)) continue
    const outcome = watch(view, p5.i, {
      up: upper,
      guard: (bar, i) => {
        if (bar.close < lower(i)) return 'failed'
        return upper(i) <= lower(i)
      },
      height: pole,
      stopUp: p5.price,
      maxWait: p5.i - p2.i
    })
    if (outcome === null) continue
    out.push(raw([start, p2, p3, p4, p5], [segment(upper, p2.i, outcome.endIndex), segment(lower, p3.i, outcome.endIndex)], outcome))
  }
  return out
}

const risingWedge: Detector = (view, [ratio]) => {
  const { pivots } = view
  const out: Raw[] = []
  for (let k = 0; k + 3 < pivots.length; k++) {
    const four = pivots.slice(k, k + 4)
    const [h1, h2] = four.filter(p => p.kind === 'H')
    const [l1, l2] = four.filter(p => p.kind === 'L')
    const upper = lineThrough(h1, h2)
    const lower = lineThrough(l1, l2)
    const from = four[0].i
    const to = four[3].i
    const startWidth = upper(from) - lower(from)
    const endWidth = upper(to) - lower(to)
    if (startWidth <= 0 || endWidth <= 0 || (startWidth - endWidth) / startWidth < ratio / 100) continue
    // both channel lines must point up by more than a flat line's wobble
    const flat = FLAT_TOLERANCE * startWidth
    if (upper(to) - upper(from) <= flat || lower(to) - lower(from) <= flat) continue
    if (!closesInside(view, from, to, upper, lower)) continue
    const outcome = watch(view, to, {
      down: lower,
      guard: (bar, i) => {
        if (bar.close > upper(i)) return 'failed'
        return upper(i) <= lower(i)
      },
      height: startWidth,
      stopDown: h2.price,
      maxWait: to - from
    })
    if (outcome === null) continue
    out.push(raw(four, [segment(upper, h1.i, outcome.endIndex), segment(lower, l1.i, outcome.endIndex)], outcome))
  }
  return out
}

/* ---------- neutral ---------- */

const triangle: Detector = (view, [deviation]) => {
  const { pivots } = view
  const out: Raw[] = []
  for (let k = 0; k + 4 < pivots.length; k++) {
    const five = pivots.slice(k, k + 5)
    const [p1, p2, p3, p4, p5] = five
    const outer = lineThrough(p1, p5)
    const inner = lineThrough(p2, p4)
    const upper = p1.kind === 'H' ? outer : inner
    const lower = p1.kind === 'H' ? inner : outer
    const width: Level = i => upper(i) - lower(i)
    const startWidth = width(p1.i)
    const endWidth = width(p5.i)
    if (startWidth <= 0 || endWidth <= 0 || endWidth >= startWidth) continue
    if (Math.abs(p3.price - outer(p3.i)) > deviation / 100 * width(p3.i)) continue
    // same-direction lines are a wedge; a triangle's lines oppose or one stays flat
    const flat = FLAT_TOLERANCE * startWidth
    if (upper(p5.i) - upper(p1.i) > flat || lower(p5.i) - lower(p1.i) < -flat) continue
    if (!closesInside(view, p1.i, p5.i, upper, lower, deviation / 100 * endWidth)) continue
    const lastHigh = p5.kind === 'H' ? p5 : p4
    const lastLow = p5.kind === 'L' ? p5 : p4
    const outcome = watch(view, p5.i, {
      up: upper,
      down: lower,
      guard: (_, i) => width(i) <= 0,
      height: startWidth,
      stopUp: lastLow.price,
      stopDown: lastHigh.price,
      maxWait: p5.i - p1.i
    })
    if (outcome === null) continue
    const [first, second] = p1.kind === 'H' ? [p1, p2] : [p2, p1]
    out.push(raw(five, [segment(upper, first.i, outcome.endIndex), segment(lower, second.i, outcome.endIndex)], outcome))
  }
  return out
}

const rectangle: Detector = (view, [deviation]) => {
  const { pivots } = view
  const out: Raw[] = []
  for (let k = 0; k + 3 < pivots.length; k++) {
    const four = pivots.slice(k, k + 4)
    const [h1, h2] = four.filter(p => p.kind === 'H')
    const [l1, l2] = four.filter(p => p.kind === 'L')
    const top = (h1.price + h2.price) / 2
    const bottom = (l1.price + l2.price) / 2
    const height = top - bottom
    const tolerance = deviation / 100 * height
    if (height <= 0 || Math.abs(h1.price - top) > tolerance || Math.abs(l1.price - bottom) > tolerance) continue
    if (height > RANGE_MAX_HEIGHT * Math.abs(top + bottom) / 2) continue
    const from = four[0].i
    const to = four[3].i
    if (!closesInside(view, from, to, () => top, () => bottom, tolerance)) continue
    const outcome = watch(view, to, {
      up: () => top,
      down: () => bottom,
      height,
      stopUp: l2.price,
      stopDown: h2.price,
      maxWait: to - from
    })
    if (outcome === null) continue
    out.push(raw(four, [segment(() => top, from, outcome.endIndex), segment(() => bottom, from, outcome.endIndex)], outcome))
  }
  return out
}

/* ---------- cup and handle (canonical: bullish) ---------- */

const cupAndHandle: Detector = (view, [deviation, handleRollback, cupRollback]) => {
  const { pivots, data } = view
  const out: Raw[] = []
  for (let k = 0; k < pivots.length; k++) {
    const left = pivots[k]
    if (left.kind !== 'H') continue
    let bottom = pivots[k + 1]
    for (let j = k + 2; j + 1 < pivots.length; j += 2) {
      const right = pivots[j]
      if (pivots[j - 1].price < bottom.price) bottom = pivots[j - 1]
      const height = left.price - bottom.price
      if (height <= 0) break
      const tolerance = deviation / 100 * height
      // price cleared the left edge: this cup can no longer complete from here
      if (right.price > left.price + tolerance) break
      if (left.price - right.price > tolerance) continue
      const width = right.i - left.i
      const center = (bottom.i - left.i) / width
      if (width < CUP_MIN_BARS || center < 0.3 || center > 0.7) continue
      if (cupRollback > 0) {
        const prev = pivots[k - 1]
        if (prev === undefined || height > cupRollback / 100 * (left.price - prev.price)) continue
      }
      let lowerThird = 0
      for (let i = left.i; i <= right.i; i++) {
        if (data[i].close < bottom.price + height / 3) lowerThird++
      }
      if (lowerThird / (width + 1) < CUP_LOWER_THIRD) continue
      const rimReached = (rim: PatternPoint): boolean => {
        const nearby = data.slice(Math.max(0, rim.i - RIM_BARS), rim.i + RIM_BARS + 1)
        return rim.price - Math.max(...nearby.map(bar => bar.close)) <= CUP_RIM_CLOSE * height
      }
      if (!rimReached(left) || !rimReached(right)) continue
      if (!closesInside(view, left.i, right.i, () => Math.max(left.price, right.price), () => bottom.price)) continue
      const handle = pivots[j + 1]
      const rollback = handleRollback / 100 * height
      if (handle.i - right.i > width || right.price - handle.price > rollback) continue
      const floor = right.price - rollback
      const outcome = watch(view, handle.i, {
        up: () => right.price,
        guard: bar => bar.close < floor ? 'failed' : false,
        height,
        stopUp: handle.price,
        maxWait: width
      })
      if (outcome === null) continue
      out.push({ ...raw([left, bottom, right, handle], [segment(() => right.price, right.i, outcome.endIndex)], outcome), bowl: true })
      break
    }
  }
  return out
}

/* ---------- Elliott Wave (documented wave rules; 5-3-5 substructure on zigzags only) ---------- */

const waveLength = (a: PatternPoint, b: PatternPoint, percent: boolean): number =>
  Math.abs(b.price - a.price) / (percent ? Math.abs(a.price) : 1)

const elliottRaw = (points: PatternPoint[], labels: string[]): Raw => ({
  points: points.map((point, index) => ({ ...point, label: labels[index] })),
  lines: [],
  status: 'formed',
  dotted: points.some(point => point.tentative === true)
})

const impulse = (view: View, percent: boolean): Raw[] => {
  const { pivots } = view
  const out: Raw[] = []
  for (let k = 0; k + 5 < pivots.length; k++) {
    const [p0, p1, p2, p3, p4, p5] = pivots.slice(k, k + 6)
    if (p0.kind !== 'L') continue
    if (p2.price <= p0.price || p3.price <= p1.price || p4.price <= p1.price) continue
    const wave3 = waveLength(p2, p3, percent)
    if (wave3 < waveLength(p0, p1, percent) && wave3 < waveLength(p4, p5, percent)) continue
    out.push(elliottRaw([p0, p1, p2, p3, p4, p5], ['0', '1', '2', '3', '4', '5']))
  }
  return out
}

const zigzagWave = (view: View, percent: boolean): Raw[] => {
  const { pivots } = view
  const sub = findPivots(view.data, false, SUB_PIVOT_BARS)
  const swings = (from: PatternPoint, to: PatternPoint): number =>
    sub.filter(pivot => pivot.i > from.i && pivot.i < to.i).length + 1
  const out: Raw[] = []
  for (let k = 0; k + 3 < pivots.length; k++) {
    const [start, a, b, c] = pivots.slice(k, k + 4)
    if (start.kind !== 'H') continue
    if (waveLength(a, b, percent) >= waveLength(start, a, percent) || c.price >= a.price) continue
    if (swings(start, a) < 5 || swings(a, b) < 3 || swings(b, c) < 5) continue
    out.push(elliottRaw([start, a, b, c], ['0', 'a', 'b', 'c']))
  }
  return out
}

/* ---------- running, filtering, drawing ---------- */

const mirrorBars = (data: KLineData[]): KLineData[] => data.map(bar => ({
  ...bar,
  open: -bar.open,
  high: -bar.low,
  low: -bar.high,
  close: -bar.close
}))

const scanWindow = (data: KLineData[]): { bars: KLineData[], base: number } => {
  const base = Math.max(0, data.length - SCAN_BARS)
  return { bars: data.slice(base), base }
}

const runView = (bars: KLineData[], flip: boolean, inProgress: boolean, detect: (view: View) => Raw[]): Raw[] => {
  const data = flip ? mirrorBars(bars) : bars
  const found = detect({ data, pivots: findPivots(data, inProgress), inProgress, flip })
  if (!flip) return found
  const unflip = (point: PatternPoint): PatternPoint => ({ ...point, price: -point.price })
  return found.map(item => ({
    ...item,
    points: item.points.map(unflip),
    lines: item.lines.map(([a, b]): [PatternPoint, PatternPoint] => [unflip(a), unflip(b)]),
    target: item.target === undefined ? undefined : -item.target
  }))
}

const finish = (item: Raw, label: string, name: string, direction: 1 | -1 | 0): ChartPattern => ({
  ...item,
  name,
  label,
  direction,
  showTarget: item.target !== undefined
})

const firstBar = (pattern: ChartPattern): number => pattern.points[0].i
const lastBar = (pattern: ChartPattern): number => pattern.points[pattern.points.length - 1].i

/**
 * Documented overlap rule: Awaiting beats other statuses, the larger pattern
 * wins ties, and Indefinable yields to any other overlapping status.
 */
export const resolveOverlaps = (patterns: ChartPattern[]): ChartPattern[] => {
  const rank = (pattern: ChartPattern): number =>
    pattern.status === 'awaiting' ? 0 : pattern.status === 'indefinable' ? 2 : 1
  const ordered = patterns
    .map((pattern, order) => ({ pattern, order }))
    .sort((a, b) =>
      rank(a.pattern) - rank(b.pattern) ||
      (lastBar(b.pattern) - firstBar(b.pattern)) - (lastBar(a.pattern) - firstBar(a.pattern)) ||
      a.order - b.order)
  const kept: ChartPattern[] = []
  for (const { pattern } of ordered) {
    if (kept.every(other => lastBar(pattern) < firstBar(other) || firstBar(pattern) > lastBar(other))) {
      kept.push(pattern)
    }
  }
  return kept.sort((a, b) => firstBar(a) - firstBar(b))
}

/** Apply the Patterns (0 All, 1 Awaiting and Reached, 2 Only Awaiting, 3 Last Awaiting) and Price Targets inputs. */
export const applyDisplayInputs = (patterns: ChartPattern[], show: number, targets: number): ChartPattern[] => {
  let shown = patterns
  if (show === 1) shown = patterns.filter(p => p.status === 'awaiting' || p.status === 'reached')
  if (show >= 2) shown = patterns.filter(p => p.status === 'awaiting')
  if (show === 3) shown = shown.slice().sort((a, b) => firstBar(b) - firstBar(a)).slice(0, 1)
  return shown.map(pattern => ({
    ...pattern,
    showTarget: pattern.target !== undefined && (
      targets === 0 ||
      (targets === 1 && pattern.status === 'awaiting') ||
      (targets === 2 && (pattern.status === 'awaiting' || pattern.status === 'reached'))
    )
  }))
}

const toRows = (length: number, base: number, patterns: ChartPattern[]): ChartPatternRow[] => {
  const rows: ChartPatternRow[] = Array.from({ length }, () => ({}))
  for (const pattern of patterns) {
    const shift = (point: PatternPoint): PatternPoint => ({ ...point, i: point.i + base })
    const moved: ChartPattern = {
      ...pattern,
      points: pattern.points.map(shift),
      lines: pattern.lines.map(([a, b]): [PatternPoint, PatternPoint] => [shift(a), shift(b)]),
      breakIndex: pattern.breakIndex === undefined ? undefined : pattern.breakIndex + base
    }
    const row = rows[lastBar(moved)]
    row.patterns = [...(row.patterns ?? []), moved]
  }
  return rows
}

const STATUS_TEXT: Record<PatternStatus, string> = {
  awaiting: 'Awaiting',
  reached: 'Reached',
  failed: 'Failed',
  indefinable: 'Indefinable',
  formed: ''
}

const drawPatterns: IndicatorDrawCallback = ({ ctx, indicator, visibleRange, xAxis, yAxis }) => {
  const rows = indicator.result as ChartPatternRow[]
  const offset = Number((indicator as { offset?: number }).offset) || 0
  const x = (i: number): number => xAxis.convertToPixel(i + offset)
  const y = (price: number): number => yAxis.convertToPixel(price)
  ctx.save()
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  // every pattern ends inside the scan window, so the tail covers them all
  for (let r = Math.max(0, rows.length - SCAN_BARS); r < rows.length; r++) {
    for (const pattern of rows[r].patterns ?? []) {
      const end = lastBar(pattern)
      const span = end - firstBar(pattern)
      if (firstBar(pattern) > visibleRange.to || end + span < visibleRange.from) continue
      const color = pattern.direction > 0 ? '#26a69a' : pattern.direction < 0 ? '#ef5350' : '#42a5f5'
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 1.5
      ctx.setLineDash(pattern.dotted ? [2, 3] : [])
      ctx.beginPath()
      const curved = pattern.bowl === true ? 3 : 1
      if (pattern.bowl === true) {
        const [rimA, base, rimB] = pattern.points
        const baseY = y(base.price)
        const leftWidth = x(base.i) - x(rimA.i)
        const rightWidth = x(rimB.i) - x(base.i)
        ctx.moveTo(x(rimA.i), y(rimA.price))
        ctx.bezierCurveTo(x(rimA.i) + 0.15 * leftWidth, baseY, x(base.i) - 0.5 * leftWidth, baseY, x(base.i), baseY)
        ctx.bezierCurveTo(x(base.i) + 0.5 * rightWidth, baseY, x(rimB.i) - 0.15 * rightWidth, baseY, x(rimB.i), y(rimB.price))
      } else {
        ctx.moveTo(x(pattern.points[0].i), y(pattern.points[0].price))
      }
      pattern.points.slice(curved).forEach(point => ctx.lineTo(x(point.i), y(point.price)))
      ctx.stroke()
      ctx.lineWidth = 1
      for (const [a, b] of pattern.lines) {
        ctx.beginPath()
        ctx.moveTo(x(a.i), y(a.price))
        ctx.lineTo(x(b.i), y(b.price))
        ctx.stroke()
      }
      // labels sit outside the swing — above highs, below lows — so candles don't hide them
      const isHigh = (index: number): boolean => {
        const neighbor = pattern.points[index - 1] ?? pattern.points[index + 1]
        return pattern.points[index].price >= neighbor.price
      }
      pattern.points.forEach((point, index) => {
        if (point.label !== undefined) ctx.fillText(point.label, x(point.i), y(point.price) + (isHigh(index) ? -6 : 14))
      })
      const lastIndex = pattern.points.length - 1
      const last = pattern.points[lastIndex]
      const status = STATUS_TEXT[pattern.status]
      ctx.fillText(status === '' ? pattern.label : `${pattern.label} · ${status}`, x(last.i), y(last.price) + (isHigh(lastIndex) ? -18 : 26))
      if (pattern.showTarget && pattern.target !== undefined) {
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(x(end), y(pattern.target))
        ctx.lineTo(x(end + Math.max(span / 2, 10)), y(pattern.target))
        ctx.stroke()
        ctx.fillText('Target', x(end + Math.max(span / 4, 5)), y(pattern.target) - 4)
      }
    }
  }
  ctx.restore()
  return false
}

/* ---------- templates ---------- */

interface Definition {
  name: string
  label: string
  direction: 1 | -1 | 0
  flip: boolean
  detect: Detector
  defaults: number[]
}

const DOUBLE = [50, 0, 10]
const TRIPLE = [50, 10, 25]
const HS = [50]
const FLAG = [25, 50]
const PENNANT = [50]
const WEDGE = [30]
const TRIANGLE = [20]
const RECTANGLE = [10]
const CUP = [10, 33, 0]

const DEFINITIONS: Definition[] = [
  { name: 'CPBFLAG', label: 'Bullish Flag', direction: 1, flip: false, detect: flag, defaults: FLAG },
  { name: 'CPBRFLAG', label: 'Bearish Flag', direction: -1, flip: true, detect: flag, defaults: FLAG },
  { name: 'CPBPEN', label: 'Bullish Pennant', direction: 1, flip: false, detect: pennant, defaults: PENNANT },
  { name: 'CPBRPEN', label: 'Bearish Pennant', direction: -1, flip: true, detect: pennant, defaults: PENNANT },
  { name: 'CPDT', label: 'Double Top', direction: -1, flip: false, detect: doubleTop, defaults: DOUBLE },
  { name: 'CPDB', label: 'Double Bottom', direction: 1, flip: true, detect: doubleTop, defaults: DOUBLE },
  { name: 'CPTT', label: 'Triple Top', direction: -1, flip: false, detect: tripleTop, defaults: TRIPLE },
  { name: 'CPTB', label: 'Triple Bottom', direction: 1, flip: true, detect: tripleTop, defaults: TRIPLE },
  { name: 'CPHS', label: 'Head and Shoulders', direction: -1, flip: false, detect: headAndShoulders, defaults: HS },
  { name: 'CPIHS', label: 'Inverse Head and Shoulders', direction: 1, flip: true, detect: headAndShoulders, defaults: HS },
  { name: 'CPRW', label: 'Rising Wedge', direction: -1, flip: false, detect: risingWedge, defaults: WEDGE },
  { name: 'CPFW', label: 'Falling Wedge', direction: 1, flip: true, detect: risingWedge, defaults: WEDGE },
  { name: 'CPTRI', label: 'Triangle', direction: 0, flip: false, detect: triangle, defaults: TRIANGLE },
  { name: 'CPRECT', label: 'Rectangle', direction: 0, flip: false, detect: rectangle, defaults: RECTANGLE },
  { name: 'CPCUP', label: 'Cup and Handle', direction: 1, flip: false, detect: cupAndHandle, defaults: CUP },
  { name: 'CPICUP', label: 'Inverted Cup and Handle', direction: -1, flip: true, detect: cupAndHandle, defaults: CUP }
]

const number = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const inputsFrom = (params: unknown[], defaults: number[]): number[] =>
  defaults.map((fallback, index) => number(params[index], fallback))

const detectDefinition = (definition: Definition, bars: KLineData[], inProgress: boolean, inputs: number[]): ChartPattern[] =>
  runView(bars, definition.flip, inProgress, view => definition.detect(view, inputs))
    .map(item => finish(item, definition.label, definition.name, definition.direction))

const shell = {
  series: IndicatorSeries.Price,
  shouldOhlc: true,
  figures: [],
  draw: drawPatterns
}

/** Filters before the overlap rule so a hidden failed pattern can't suppress a valid one it overlaps. */
const visiblePatterns = (found: ChartPattern[], hideFailed: unknown, show: unknown, targets: unknown): ChartPattern[] => {
  const kept = number(hideFailed, 0) === 1 ? found.filter(pattern => pattern.status !== 'failed') : found
  return applyDisplayInputs(resolveOverlaps(kept), number(show, 0), number(targets, 0))
}

/**
 * calcParams: [Patterns, Price Targets, In Progress, ...pattern inputs, Failed Patterns (0 show, 1 hide)]
 * Failed Patterns stays last so layouts saved before it keep their positions.
 */
const singlePattern = (definition: Definition): IndicatorTemplate<ChartPatternRow> => ({
  ...shell,
  name: definition.name,
  shortName: definition.label,
  calcParams: [0, 0, 0, ...definition.defaults, 0],
  calc: (dataList, indicator) => {
    const [show, targets, inProgress, ...rest] = indicator.calcParams
    const { bars, base } = scanWindow(dataList)
    const found = detectDefinition(definition, bars, number(inProgress, 0) === 1, inputsFrom(rest, definition.defaults))
    return toRows(dataList.length, base, visiblePatterns(found, rest[definition.defaults.length], show, targets))
  }
})

const byName = (name: string): IndicatorTemplate<ChartPatternRow> =>
  singlePattern(DEFINITIONS.find(definition => definition.name === name)!)

export const chartBullishFlag = byName('CPBFLAG')
export const chartBearishFlag = byName('CPBRFLAG')
export const chartBullishPennant = byName('CPBPEN')
export const chartBearishPennant = byName('CPBRPEN')
export const chartDoubleTop = byName('CPDT')
export const chartDoubleBottom = byName('CPDB')
export const chartTripleTop = byName('CPTT')
export const chartTripleBottom = byName('CPTB')
export const chartHeadAndShoulders = byName('CPHS')
export const chartInverseHeadAndShoulders = byName('CPIHS')
export const chartRisingWedge = byName('CPRW')
export const chartFallingWedge = byName('CPFW')
export const chartTriangle = byName('CPTRI')
export const chartRectangle = byName('CPRECT')
export const chartCupAndHandle = byName('CPCUP')
export const chartInvertedCupAndHandle = byName('CPICUP')

/** Runs every classic pattern with its default inputs, per the reference's description. calcParams: [Patterns, Price Targets, In Progress, Failed Patterns] */
export const allChartPatterns: IndicatorTemplate<ChartPatternRow> = {
  ...shell,
  name: 'CPALL',
  shortName: 'All Chart Patterns',
  calcParams: [0, 0, 0, 0],
  calc: (dataList, indicator) => {
    const [show, targets, inProgress, hideFailed] = indicator.calcParams
    const { bars, base } = scanWindow(dataList)
    const found = DEFINITIONS.flatMap(definition =>
      detectDefinition(definition, bars, number(inProgress, 0) === 1, definition.defaults))
    return toRows(dataList.length, base, visiblePatterns(found, hideFailed, show, targets))
  }
}

/** calcParams: [Invert pattern, Length type (0 absolute, 1 percent), In Progress] */
export const elliottWave: IndicatorTemplate<ChartPatternRow> = {
  ...shell,
  name: 'CPEW',
  shortName: 'Elliott Wave',
  calcParams: [0, 0, 0],
  calc: (dataList, indicator) => {
    const [invert, lengthType, inProgressParam] = indicator.calcParams
    const inverted = number(invert, 0) === 1
    const percent = number(lengthType, 0) === 1
    const inProgress = number(inProgressParam, 0) === 1
    const { bars, base } = scanWindow(dataList)
    // default: impulses in uptrends, zigzags in downtrends; Invert swaps both
    const found = [
      ...runView(bars, inverted, inProgress, view => impulse(view, percent))
        .map(item => finish(item, 'Impulse', 'CPEW', inverted ? -1 : 1)),
      ...runView(bars, inverted, inProgress, view => zigzagWave(view, percent))
        .map(item => finish(item, 'Zigzag', 'CPEW', inverted ? 1 : -1))
    ]
    return toRows(dataList.length, base, resolveOverlaps(found))
  }
}

const indicators: IndicatorTemplate<ChartPatternRow>[] = [
  allChartPatterns,
  ...DEFINITIONS.map(definition => byName(definition.name)),
  elliottWave
]

export default indicators
