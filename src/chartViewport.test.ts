import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import type { Period } from './types'
import { constrainChartRange, type ChartViewportMember } from './chartViewport'
import { chartIndexAtTime } from './multiChartTime'

const minute: Period = { multiplier: 1, timespan: 'minute', text: '1m' }
const bars = (start: number, count: number, step = 60000): KLineData[] => Array.from({ length: count }, (_, index) =>
  ({ timestamp: start + index * step, open: 1, high: 1, low: 1, close: 1 }))
const member = (width: number, data = bars(0, 1000), period = minute): ChartViewportMember => ({ width, data, period })
const range = (from: number, to: number) => ({ from: from * 60000, to: to * 60000 })

function expectFeasible (result: { from: number, to: number }, members: ChartViewportMember[]): void {
  for (const current of members) {
    const left = chartIndexAtTime(current.data, result.from, current.period)!
    const right = chartIndexAtTime(current.data, result.to, current.period)!
    const bar = current.width / (right - left)
    expect(bar).toBeGreaterThanOrEqual(1 - 1e-9)
    expect(bar).toBeLessThanOrEqual(50 + 1e-9)
    expect(right).toBeGreaterThanOrEqual(Math.min(2, current.data.length) - 0.5 - 1e-9)
    expect(left).toBeLessThanOrEqual(current.data.length - Math.min(2, current.data.length) - 0.5 + 1e-9)
  }
}

describe('shared viewport constraints', () => {
  it('limits zoom-out to the narrowest chart while preserving the right endpoint', () => {
    const members = [member(300), member(150)]
    const result = constrainChartRange(range(600, 900), members)
    expect(result).toEqual(range(750, 900))
    expectFeasible(result, members)
  })

  it('limits zoom-in to the widest chart and leaves already feasible ranges unchanged', () => {
    const members = [member(300), member(150)]
    expect(constrainChartRange(range(850, 900), members)).toEqual(range(850, 900))
    const result = constrainChartRange(range(897, 900), members)
    expect(result).toEqual(range(894, 900))
    expectFeasible(result, members)
  })

  it('uses actual compressed gaps when constraining unequal histories', () => {
    const sparse = bars(0, 1000).filter((_, index) => index < 800 || index >= 850)
    const members = [member(300), member(150, sparse)]
    const result = constrainChartRange(range(600, 900), members)
    expect(result).toEqual(range(700, 900))
    expectFeasible(result, members)
  })

  it('keeps at least two available candles when the requested right precedes follower history', () => {
    const members = [member(300), member(150, bars(100 * 60000, 900))]
    const result = constrainChartRange(range(-100, 10), members)
    expect(result.to).toBe(101.5 * 60000)
    expectFeasible(result, members)
  })

  it('bounds far-future blank space and supports a one-candle history', () => {
    const members = [member(300), member(150)]
    const result = constrainChartRange(range(2000, 2200), members)
    expect(result).toEqual(range(997.5, 1147.5))
    expectFeasible(result, members)
    const single = [member(150, bars(0, 1))]
    expectFeasible(constrainChartRange(range(-50, 50), single), single)
  })

  it('ignores empty or hidden charts and returns finite values for invalid requests', () => {
    const requested = range(600, 900)
    expect(constrainChartRange(requested, [member(150, []), member(0), member(NaN)])).toEqual(requested)
    expect(constrainChartRange({ from: NaN, to: Infinity }, [])).toEqual({ from: 0, to: 1 })
  })

  it('retains the requested range when history or interval constraints have no intersection', () => {
    const requested = range(600, 900)
    expect(constrainChartRange(requested, [member(300, bars(0, 10)), member(150, bars(10000 * 60000, 10))])).toEqual(requested)
    const day: Period = { multiplier: 1, timespan: 'day', text: '1D' }
    expect(constrainChartRange(requested, [member(300), member(300, bars(0, 1000, 86400000), day)])).toEqual(requested)
  })
})
