import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { chartTimeAtIndex, chartIndexAtTime, containingChartIndex } from './multiChartTime'
import { gridDimension, gridWeights, resizeGridPair } from './gridSizing'
const minute = { multiplier: 1, timespan: 'minute', text: '1m' }
const bars = (times: number[]): KLineData[] => times.map(timestamp => ({ timestamp, open: 1, high: 1, low: 1, close: 1 }))

describe('timestamp viewport mapping', () => {
  it('round-trips fractional endpoints across unequal history and compressed gaps', () => {
    const data = bars([0, 60000, 300000, 360000])
    for (const index of [-12.5, -0.5, 0, 0.7, 1.5, 2.2, 3, 15.5]) {
      expect(chartIndexAtTime(data, chartTimeAtIndex(data, index, minute)!, minute)).toBeCloseTo(index, 9)
    }
    expect(chartTimeAtIndex(data, 1.5, minute)).toBe(180000)
  })
  it('handles leap-year monthly edges without a fixed 30-day assumption', () => {
    const month = { multiplier: 1, timespan: 'month', text: '1M' }
    const data = bars([Date.UTC(2024, 0, 1)])
    expect(chartTimeAtIndex(data, 2, month)).toBe(Date.UTC(2024, 2, 1))
    for (const index of [-1.5, 0.5, 2.5]) expect(chartIndexAtTime(data, chartTimeAtIndex(data, index, month)!, month)).toBeCloseTo(index, 9)
  })
  it('maps crosshairs to containing candles and clears gaps/out-of-history', () => {
    const data = bars([0, 60000, 300000])
    expect(containingChartIndex(data, 90000, minute)).toBe(1)
    expect(containingChartIndex(data, 120000, minute)).toBeUndefined()
    expect(containingChartIndex(data, -1, minute)).toBeUndefined()
    expect(containingChartIndex(data, 360000, minute)).toBeUndefined()
    expect(containingChartIndex([], 0, minute)).toBeUndefined()
  })
})
describe('grid sizing', () => {
  it('normalizes positive weights and rejects invalid dimensions/sizes', () => {
    expect(gridWeights([3, 1], 2)).toEqual([0.75, 0.25])
    expect(gridWeights([0, 2], 2)).toEqual([0.5, 0.5])
    expect(gridWeights([Infinity, 1], 2)).toEqual([0.5, 0.5])
    expect(gridDimension(NaN, 2)).toBe(2)
    expect(gridDimension(-2)).toBe(1)
    expect(gridDimension(2.8)).toBe(2)
  })
  it('keeps other tracks fixed and clamps adjacent minima without changing their sum', () => {
    expect(resizeGridPair([0.2, 0.3, 0.5], 1, 100, 1000, 100)).toEqual([0.2, 0.4, 0.4])
    const clamped = resizeGridPair([0.5, 0.5], 0, 1000, 600, 100)
    expect(clamped[0]).toBeCloseTo(5 / 6)
    expect(clamped[1]).toBeCloseTo(1 / 6)
    expect(resizeGridPair([0.5, 0.5], 0, 20, 100, 100)).toEqual([0.5, 0.5])
  })
})
