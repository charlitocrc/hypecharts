import { describe, expect, it } from 'vitest'
import type { IndicatorTemplate, KLineData } from 'klinecharts'

import settings from '../widget/indicator-setting-modal/data'
import indicators, {
  allChartPatterns,
  applyDisplayInputs,
  chartBearishFlag,
  chartBullishFlag,
  chartBullishPennant,
  chartCupAndHandle,
  chartDoubleBottom,
  chartDoubleTop,
  chartFallingWedge,
  chartHeadAndShoulders,
  chartInverseHeadAndShoulders,
  chartInvertedCupAndHandle,
  chartRectangle,
  chartRisingWedge,
  chartTriangle,
  chartTripleBottom,
  chartTripleTop,
  elliottWave,
  findPivots,
  resolveOverlaps,
  type ChartPattern,
  type ChartPatternRow
} from './chart-patterns'

/** Bars walking straight between [barIndex, price] waypoints, so pivots land exactly on them. */
const path = (waypoints: Array<[number, number]>): KLineData[] => {
  const bars: KLineData[] = []
  for (let w = 0; w + 1 < waypoints.length; w++) {
    const [i0, p0] = waypoints[w]
    const [i1, p1] = waypoints[w + 1]
    for (let i = w === 0 ? i0 : i0 + 1; i <= i1; i++) {
      const close = p0 + (p1 - p0) * (i - i0) / (i1 - i0)
      bars.push({ timestamp: i * 60_000, open: close, high: close, low: close, close, volume: 1 })
    }
  }
  return bars
}

const mirror = (waypoints: Array<[number, number]>): Array<[number, number]> =>
  waypoints.map(([i, price]) => [i, 300 - price])

const run = (template: IndicatorTemplate<ChartPatternRow>, data: KLineData[], params?: number[]): ChartPattern[] =>
  (template.calc(data, { ...template, calcParams: params ?? template.calcParams } as any) as ChartPatternRow[])
    .flatMap(row => row.patterns ?? [])

const params = (template: IndicatorTemplate<ChartPatternRow>, overrides: Record<number, number>): number[] => {
  const next = [...template.calcParams!] as number[]
  Object.entries(overrides).forEach(([index, value]) => { next[Number(index)] = value })
  return next
}

const DOUBLE_TOP: Array<[number, number]> = [[0, 90], [8, 80], [20, 120], [32, 100], [44, 120], [56, 100], [62, 92], [70, 85]]
const TRIPLE_TOP: Array<[number, number]> = [[0, 90], [8, 80], [20, 120], [30, 100], [40, 120], [50, 100], [60, 120], [70, 100], [76, 92], [84, 85]]
const HEAD_SHOULDERS: Array<[number, number]> = [[0, 80], [8, 70], [20, 110], [30, 95], [42, 130], [54, 95], [66, 110], [76, 95], [80, 88], [100, 50]]
const BULL_FLAG: Array<[number, number]> = [[0, 110], [8, 100], [20, 160], [28, 145], [36, 155], [44, 140], [52, 151], [60, 175], [70, 225]]
const PENNANT: Array<[number, number]> = [[0, 110], [8, 100], [20, 160], [28, 140], [36, 155], [44, 146], [50, 152], [56, 175], [66, 225]]
const RISING_WEDGE: Array<[number, number]> = [[0, 110], [6, 100], [16, 130], [26, 115], [36, 138], [60, 90]]
const TRIANGLE: Array<[number, number]> = [[0, 110], [6, 100], [16, 140], [26, 106], [36, 134], [46, 112], [52, 135], [70, 190]]
const RECTANGLE: Array<[number, number]> = [[0, 110], [6, 120], [16, 100], [26, 120], [36, 100], [42, 112], [48, 130], [60, 150]]
const CUP: Array<[number, number]> = [
  [0, 80], [20, 150], [24, 118], [28, 104], [32, 100], [36, 100], [40, 102], [44, 106], [48, 122], [52, 150],
  [60, 138], [66, 148], [72, 158], [80, 205]
]

const noisy = (length: number): KLineData[] => {
  let seed = 7
  let close = 100
  return Array.from({ length }, (_, i) => {
    seed = (seed * 16807) % 2147483647
    close = Math.max(5, close + ((seed % 2000) / 1000 - 1))
    return { timestamp: i * 60_000, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1 }
  })
}

describe('pivots', () => {
  it('finds alternating 5/5 pivots and ignores bars too close to the edges', () => {
    const pivots = findPivots(path(DOUBLE_TOP))
    expect(pivots.slice(0, 4).map(p => [p.kind, p.i])).toEqual([['L', 8], ['H', 20], ['L', 32], ['H', 44]])
    pivots.slice(1).forEach((pivot, index) => expect(pivot.kind).not.toBe(pivots[index].kind))
  })

  it('appends the live extreme as tentative only when In Progress is on', () => {
    const data = path([[0, 80], [20, 120], [32, 100], [44, 118]])
    expect(findPivots(data).some(p => p.tentative === true)).toBe(false)
    const last = findPivots(data, true).pop()!
    expect(last).toMatchObject({ i: 44, kind: 'H', tentative: true })
  })
})

describe('reversal patterns', () => {
  it('forms a double top only after a close below the neckline', () => {
    const [pattern] = run(chartDoubleTop, path(DOUBLE_TOP))
    expect(pattern).toMatchObject({ name: 'CPDT', direction: -1, status: 'awaiting', dotted: false })
    expect(pattern.breakIndex).toBe(57)
    expect(pattern.target).toBeCloseTo(80)
    expect(run(chartDoubleTop, path(DOUBLE_TOP.slice(0, 6)).slice(0, 56))).toEqual([])
  })

  it('rejects unequal tops beyond the permissible deviation', () => {
    const uneven: Array<[number, number]> = [[0, 90], [8, 80], [20, 120], [32, 100], [44, 110], [56, 100], [62, 92], [70, 85]]
    expect(run(chartDoubleTop, path(uneven))).toEqual([])
    expect(run(chartDoubleTop, path(uneven), params(chartDoubleTop, { 5: 60 }))).toHaveLength(1)
  })

  it('applies the required trend height and the second-top filter', () => {
    expect(run(chartDoubleTop, path(DOUBLE_TOP), params(chartDoubleTop, { 3: 500 }))).toEqual([])
    const lower: Array<[number, number]> = [[0, 90], [8, 80], [20, 120], [32, 100], [44, 119], [56, 100], [62, 92], [70, 85]]
    expect(run(chartDoubleTop, path(lower), params(chartDoubleTop, { 4: 1 }))).toEqual([])
    expect(run(chartDoubleTop, path(lower), params(chartDoubleTop, { 4: 2 }))).toHaveLength(1)
  })

  it('finds the mirrored double bottom at real prices and keeps the second-extreme meaning', () => {
    const [pattern] = run(chartDoubleBottom, path(mirror(DOUBLE_TOP)))
    expect(pattern).toMatchObject({ name: 'CPDB', direction: 1 })
    expect(pattern.points.every(point => point.price > 0)).toBe(true)
    expect(pattern.target).toBeCloseTo(220)
    const higher = mirror([[0, 90], [8, 80], [20, 120], [32, 100], [44, 119], [56, 100], [62, 92], [70, 85]])
    expect(run(chartDoubleBottom, path(higher), params(chartDoubleBottom, { 4: 1 }))).toHaveLength(1)
    expect(run(chartDoubleBottom, path(higher), params(chartDoubleBottom, { 4: 2 }))).toEqual([])
  })

  it('finds triple tops and bottoms', () => {
    expect(run(chartTripleTop, path(TRIPLE_TOP))[0]).toMatchObject({ name: 'CPTT', status: 'awaiting' })
    expect(run(chartTripleBottom, path(mirror(TRIPLE_TOP)))[0]).toMatchObject({ name: 'CPTB', direction: 1 })
  })

  it('requires a head above both shoulders and reports the target as reached', () => {
    const [pattern] = run(chartHeadAndShoulders, path(HEAD_SHOULDERS))
    expect(pattern).toMatchObject({ name: 'CPHS', status: 'reached' })
    expect(pattern.target).toBeCloseTo(60)
    const flat: Array<[number, number]> = [[0, 80], [8, 70], [20, 130], [30, 95], [42, 120], [54, 95], [66, 130], [76, 95], [80, 88], [100, 50]]
    expect(run(chartHeadAndShoulders, path(flat))).toEqual([])
    expect(run(chartInverseHeadAndShoulders, path(mirror(HEAD_SHOULDERS)))[0]).toMatchObject({ name: 'CPIHS', status: 'reached' })
  })

  it('marks a reversal Failed when price clears the last top after the break', () => {
    const failed: Array<[number, number]> = [[0, 90], [8, 80], [20, 120], [32, 100], [44, 120], [56, 100], [60, 96], [72, 130]]
    expect(run(chartDoubleTop, path(failed))[0].status).toBe('failed')
  })

  it('shows an unbroken reversal as dotted only with In Progress on', () => {
    const forming: Array<[number, number]> = [[0, 90], [8, 80], [20, 120], [32, 100], [44, 119], [50, 110]]
    expect(run(chartDoubleTop, path(forming))).toEqual([])
    const [pattern] = run(chartDoubleTop, path(forming), params(chartDoubleTop, { 2: 1 }))
    expect(pattern).toMatchObject({ status: 'awaiting', dotted: true })
  })
})

describe('continuation and neutral patterns', () => {
  it('finds a bullish flag with a pole-height target and mirrors it', () => {
    const [pattern] = run(chartBullishFlag, path(BULL_FLAG))
    expect(pattern).toMatchObject({ name: 'CPBFLAG', direction: 1, status: 'reached' })
    expect(pattern.target! - pattern.points[pattern.points.length - 1].price).toBeCloseTo(60)
    expect(run(chartBearishFlag, path(mirror(BULL_FLAG)))[0]).toMatchObject({ name: 'CPBRFLAG', direction: -1 })
  })

  it('rejects a flag whose pullback exceeds Max Rollback', () => {
    expect(run(chartBullishFlag, path(BULL_FLAG), params(chartBullishFlag, { 4: 10 }))).toEqual([])
  })

  it('finds a converging bullish pennant', () => {
    expect(run(chartBullishPennant, path(PENNANT))[0]).toMatchObject({ name: 'CPBPEN', status: 'reached' })
  })

  it('finds a rising wedge breaking down and the mirrored falling wedge', () => {
    expect(run(chartRisingWedge, path(RISING_WEDGE))[0]).toMatchObject({ name: 'CPRW', direction: -1 })
    expect(run(chartFallingWedge, path(mirror(RISING_WEDGE)))[0]).toMatchObject({ name: 'CPFW', direction: 1 })
    expect(run(chartRisingWedge, path(mirror(RISING_WEDGE)))).toEqual([])
  })

  it('stops channel lines at the bar that decided the pattern, never past their apex', () => {
    // closes through the wrong side right after the last point: Failed at that bar
    const failed = run(chartRisingWedge, path([[0, 110], [6, 100], [16, 130], [26, 115], [36, 138], [42, 134], [50, 175]]))[0]
    expect(failed.status).toBe('failed')
    const decided = Math.max(...failed.lines.flat().map(point => point.i))
    expect(decided).toBeLessThanOrEqual(50)
    const [upper, lower] = failed.lines
    expect(upper[1].price).toBeGreaterThan(lower[1].price)
  })

  it('takes a triangle breakout in whichever direction the close exits', () => {
    const up = run(chartTriangle, path(TRIANGLE))[0]
    expect(up).toMatchObject({ name: 'CPTRI', direction: 0, status: 'reached' })
    expect(up.target!).toBeGreaterThan(145)
    const down = run(chartTriangle, path(mirror(TRIANGLE)))[0]
    expect(down.target!).toBeLessThan(155)
  })

  it('finds a rectangle only when both sides stay flat', () => {
    expect(run(chartRectangle, path(RECTANGLE))[0]).toMatchObject({ name: 'CPRECT', status: 'reached' })
    const sloped: Array<[number, number]> = [[0, 100], [6, 120], [16, 100], [26, 140], [36, 120], [46, 160], [60, 180]]
    expect(run(chartRectangle, path(sloped))).toEqual([])
  })

  it('finds a cup and handle, enforcing the 20-bar minimum width', () => {
    const [pattern] = run(chartCupAndHandle, path(CUP))
    expect(pattern).toMatchObject({ name: 'CPCUP', status: 'reached' })
    expect(pattern.target).toBeCloseTo(200)
    expect(run(chartInvertedCupAndHandle, path(mirror(CUP)))[0]).toMatchObject({ name: 'CPICUP', direction: -1 })
    const narrow: Array<[number, number]> = [[0, 80], [20, 150], [28, 100], [36, 150], [44, 138], [50, 148], [56, 158], [64, 205]]
    expect(run(chartCupAndHandle, path(narrow))).toEqual([])
  })
})

describe('shapes that only look like the pattern', () => {
  const V_CUP: Array<[number, number]> = [[0, 80], [20, 150], [36, 100], [52, 150], [60, 138], [66, 148], [72, 158], [80, 205]]

  it('rejects a straight V as a cup', () => {
    expect(run(chartCupAndHandle, path(V_CUP))).toEqual([])
  })

  it('rejects a cup whose rims are only wicks above the closes', () => {
    const data = path(CUP)
    data[20] = { ...data[20], high: 200 }
    data[52] = { ...data[52], high: 200 }
    // a generous handle limit isolates the rim rule: the handle is now deep relative to the taller cup
    expect(run(chartCupAndHandle, data, params(chartCupAndHandle, { 4: 100 }))).toEqual([])
  })

  it('rejects a handle deeper than Handle Max Rollback', () => {
    const deep: Array<[number, number]> = [...CUP.slice(0, 10), [60, 125], [66, 148], [72, 158], [80, 205]]
    expect(run(chartCupAndHandle, path(deep))).toEqual([])
    expect(run(chartCupAndHandle, path(deep), params(chartCupAndHandle, { 4: 60 }))).toHaveLength(1)
  })

  it('rejects a trend leg whose range dwarfs its midpoint as a rectangle', () => {
    const trend: Array<[number, number]> = [[0, 10], [6, 4], [20, 70], [30, 16], [44, 72], [50, 50], [60, 90]]
    expect(run(chartRectangle, path(trend), params(chartRectangle, { 3: 100 }))).toEqual([])
  })

  it('applies the default rectangle deviation', () => {
    const loose: Array<[number, number]> = [[0, 110], [6, 120], [16, 100], [26, 116], [36, 100], [42, 112], [48, 130], [60, 150]]
    expect(run(chartRectangle, path(loose))).toEqual([])
    expect(run(chartRectangle, path(loose), params(chartRectangle, { 3: 20 }))).toHaveLength(1)
  })
})

describe('Elliott Wave', () => {
  const IMPULSE: Array<[number, number]> = [[0, 110], [10, 100], [20, 120], [30, 110], [40, 150], [50, 130], [60, 160], [70, 130]]

  it('labels an impulse that obeys the documented wave rules', () => {
    const [pattern] = run(elliottWave, path(IMPULSE)).filter(p => p.label === 'Impulse')
    expect(pattern.direction).toBe(1)
    expect(pattern.points.map(p => p.label)).toEqual(['0', '1', '2', '3', '4', '5'])
    expect(pattern.points.map(p => p.price)).toEqual([100, 120, 110, 150, 130, 160])
  })

  it('rejects an impulse whose wave 4 enters wave 1 territory', () => {
    const overlap: Array<[number, number]> = [[0, 110], [10, 100], [20, 120], [30, 110], [40, 150], [50, 115], [60, 160], [70, 130]]
    expect(run(elliottWave, path(overlap)).filter(p => p.label === 'Impulse')).toEqual([])
  })

  it('requires 5-3-5 sub-swings on a zigzag, not just three smooth legs', () => {
    const swings: Array<[number, number]> = [
      [0, 120], [10, 130], [14, 120], [16, 123], [20, 112], [22, 115], [30, 100],
      [34, 110], [36, 107], [42, 115],
      [46, 107], [48, 110], [52, 100], [54, 103], [62, 90], [70, 100]
    ]
    const [pattern] = run(elliottWave, path(swings)).filter(p => p.label === 'Zigzag')
    expect(pattern.points.map(p => p.label)).toEqual(['0', 'a', 'b', 'c'])
    expect(pattern.points.map(p => p.i)).toEqual([10, 30, 42, 62])
    const smooth: Array<[number, number]> = [[0, 120], [10, 130], [30, 100], [42, 115], [62, 90], [70, 100]]
    expect(run(elliottWave, path(smooth)).filter(p => p.label === 'Zigzag')).toEqual([])
  })

  it('swaps directions with Invert', () => {
    const [pattern] = run(elliottWave, path(mirror(IMPULSE)), [1, 0, 0]).filter(p => p.label === 'Impulse')
    expect(pattern.direction).toBe(-1)
  })
})

describe('display inputs and overlaps', () => {
  const make = (status: ChartPattern['status'], from: number, to: number): ChartPattern => ({
    name: 'X',
    label: 'X',
    direction: 0,
    status,
    dotted: false,
    points: [{ i: from, price: 1 }, { i: to, price: 2 }],
    lines: [],
    target: 3,
    showTarget: true
  })

  it('prefers Awaiting, then the larger pattern, and drops Indefinable on overlap', () => {
    expect(resolveOverlaps([make('reached', 0, 50), make('awaiting', 40, 45)]).map(p => p.status)).toEqual(['awaiting'])
    expect(resolveOverlaps([make('reached', 0, 10), make('failed', 5, 40)]).map(p => p.status)).toEqual(['failed'])
    expect(resolveOverlaps([make('indefinable', 0, 50), make('failed', 40, 45)]).map(p => p.status)).toEqual(['failed'])
    expect(resolveOverlaps([make('reached', 0, 10), make('failed', 11, 20)])).toHaveLength(2)
  })

  it('filters by Patterns and Price Targets, with Last Awaiting picking the rightmost first point', () => {
    const list = [make('reached', 0, 5), make('awaiting', 10, 15), make('failed', 20, 25), make('awaiting', 30, 35)]
    expect(applyDisplayInputs(list, 0, 0)).toHaveLength(4)
    expect(applyDisplayInputs(list, 1, 0).map(p => p.status)).toEqual(['reached', 'awaiting', 'awaiting'])
    expect(applyDisplayInputs(list, 2, 0)).toHaveLength(2)
    expect(applyDisplayInputs(list, 3, 0).map(p => p.points[0].i)).toEqual([30])
    expect(applyDisplayInputs(list, 0, 1).map(p => p.showTarget)).toEqual([false, true, false, true])
    expect(applyDisplayInputs(list, 0, 2).map(p => p.showTarget)).toEqual([true, true, false, true])
    expect(applyDisplayInputs(list, 0, 3).every(p => !p.showTarget)).toBe(true)
  })
})

describe('Failed Patterns setting', () => {
  const FAILED_TOP: Array<[number, number]> = [[0, 90], [8, 80], [20, 120], [32, 100], [44, 120], [56, 100], [60, 96], [72, 130]]

  it('hides failed patterns only when set to Hide, on the last parameter', () => {
    expect(run(chartDoubleTop, path(FAILED_TOP))[0].status).toBe('failed')
    const last = chartDoubleTop.calcParams!.length - 1
    expect(chartDoubleTop.calcParams![last]).toBe(0)
    expect(run(chartDoubleTop, path(FAILED_TOP), params(chartDoubleTop, { [last]: 1 }))).toEqual([])
  })

  it('keeps showing failed patterns for layouts saved before the setting existed', () => {
    const saved = (chartDoubleTop.calcParams as number[]).slice(0, -1)
    expect(run(chartDoubleTop, path(FAILED_TOP), saved)[0].status).toBe('failed')
  })

  it('leaves reached patterns visible when hiding failed ones', () => {
    const last = chartDoubleTop.calcParams!.length - 1
    expect(run(chartDoubleTop, path([[0, 90], [8, 80], [20, 120], [32, 100], [44, 120], [56, 100], [70, 70]]), params(chartDoubleTop, { [last]: 1 }))[0].status).toBe('reached')
  })

  it('works on All Chart Patterns, where a hidden failure no longer suppresses what it overlaps', () => {
    const data = noisy(800)
    const key = (pattern: ChartPattern): string => `${pattern.name}:${pattern.points[0].i}:${pattern.points[pattern.points.length - 1].i}`
    const shown = run(allChartPatterns, data)
    const hidden = run(allChartPatterns, data, [0, 0, 0, 1])
    expect(shown.some(pattern => pattern.status === 'failed')).toBe(true)
    expect(hidden.some(pattern => pattern.status === 'failed')).toBe(false)
    const kept = new Set(hidden.map(key))
    shown.filter(pattern => pattern.status !== 'failed').forEach(pattern => expect(kept.has(key(pattern))).toBe(true))
    expect(hidden.length).toBeGreaterThan(shown.filter(pattern => pattern.status !== 'failed').length)
  })

  it('offers the setting on every pattern study except Elliott Wave, which has no Failed status', () => {
    for (const template of indicators) {
      const config = settings[template.name]
      expect(config, template.name).toHaveLength(template.calcParams!.length)
      expect(config.some(item => item.paramNameKey === 'pattern_failed'), template.name).toBe(template.name !== 'CPEW')
      if (template.name !== 'CPEW') expect(config[config.length - 1].paramNameKey).toBe('pattern_failed')
      config.forEach((item, index) => expect(item.default, `${template.name} ${item.paramNameKey}`).toBe(template.calcParams![index]))
    }
  })
})

describe('whole-study behavior', () => {
  it('only places patterns on the last 600 bars, with one result row per bar', () => {
    const data = [...noisy(1000)]
    const rows = allChartPatterns.calc(data, { ...allChartPatterns, calcParams: [0, 0, 0] } as any) as ChartPatternRow[]
    expect(rows).toHaveLength(1000)
    const patterns = rows.flatMap(row => row.patterns ?? [])
    expect(patterns.length).toBeGreaterThan(0)
    patterns.forEach(pattern => pattern.points.forEach(point => expect(point.i).toBeGreaterThanOrEqual(400)))
  })

  it('keeps All Chart Patterns free of overlaps', () => {
    const patterns = run(allChartPatterns, noisy(800)).sort((a, b) => a.points[0].i - b.points[0].i)
    patterns.slice(1).forEach((pattern, index) => {
      const previous = patterns[index]
      expect(pattern.points[0].i).toBeGreaterThan(previous.points[previous.points.length - 1].i)
    })
  })

  it('does not use future bars: a confirmed pattern is unchanged by truncating after its last point', () => {
    const data = path(DOUBLE_TOP)
    const [pattern] = run(chartDoubleTop, data)
    const [early] = run(chartDoubleTop, data.slice(0, pattern.breakIndex! + 1))
    expect(early.points).toEqual(pattern.points)
    expect(early.breakIndex).toBe(pattern.breakIndex)
  })

  it('handles empty and short data', () => {
    for (const data of [[], path([[0, 1], [3, 2]])]) {
      expect(run(allChartPatterns, data)).toEqual([])
      expect(run(elliottWave, data)).toEqual([])
    }
  })

  it('computes All Chart Patterns on a full scan window within one frame budget', () => {
    const data = noisy(5000)
    const start = performance.now()
    run(allChartPatterns, data)
    expect(performance.now() - start).toBeLessThan(50)
  })
})
