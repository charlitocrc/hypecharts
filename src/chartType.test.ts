import { describe, expect, it } from 'vitest'
import { CandleType } from 'klinecharts'
import type { KLineData } from 'klinecharts'

import { divergenceIndex, heikinAshi, isLineLockedPeriod, lineBreak, renko, resolveChartTypeForPeriod } from './chartType'

const candle = (timestamp: number, open: number, high: number, low: number, close: number, volume = 1): KLineData =>
  ({ timestamp, open, high, low, close, volume })

const closes = (values: number[]): KLineData[] =>
  values.map((close, index) => candle(index * 60_000, close, close, close, close))

const bodies = (data: KLineData[]) => data.map(item => [item.open, item.close])

describe('chart types', () => {
  it('builds Heikin Ashi bars from the previous HA body', () => {
    const result = heikinAshi([candle(0, 10, 12, 8, 11), candle(1, 11, 13, 10, 12)])
    expect(result[0]).toMatchObject({ open: 10.5, close: 10.25, high: 12, low: 8 })
    expect(result[1]).toMatchObject({ open: 10.375, close: 11.5, high: 13, low: 10 })
  })

  it('forms Renko bricks that need two boxes to reverse, with unique increasing timestamps', () => {
    const result = renko(closes([10, 12.5, 13, 9.5]), 1)
    expect(bodies(result)).toEqual([[10, 11], [11, 12], [12, 13], [12, 11], [11, 10]])
    expect(result.map(item => item.timestamp)).toEqual([60_000, 60_001, 120_000, 180_000, 180_001])
  })

  it('reverses a three-line break only past the extreme of the last three lines', () => {
    const data = [candle(0, 1, 2, 1, 2), ...closes([3, 4, 2.5, 0.5, 3.5]).map((item, index) => ({ ...item, timestamp: index + 1 }))]
    expect(bodies(lineBreak(data))).toEqual([[1, 2], [2, 3], [3, 4], [3, 0.5]])
  })

  it('finds where a realtime brick list diverges from the drawn one', () => {
    const drawn = closes([1, 2, 3])
    expect(divergenceIndex(drawn, closes([1, 2, 3]))).toBeNull()
    expect(divergenceIndex(drawn, closes([1, 2, 3, 4]))).toBe(3)
    expect(divergenceIndex(drawn, closes([1, 2, 5]))).toBe(2)
    expect(divergenceIndex(drawn, closes([1, 2]))).toBe(1)
  })
})

describe('1s line lock', () => {
  const second = { multiplier: 1, timespan: 'second', text: '1s' } as const
  const minute = { multiplier: 1, timespan: 'minute', text: '1m' } as const

  it('locks second periods and only them', () => {
    expect(isLineLockedPeriod(second)).toBe(true)
    expect(isLineLockedPeriod(minute)).toBe(false)
  })

  it('resolves every chart type to a line on second periods', () => {
    expect(resolveChartTypeForPeriod(second, CandleType.CandleSolid)).toBe(CandleType.Line)
    expect(resolveChartTypeForPeriod(second, 'renko')).toBe(CandleType.Line)
    expect(resolveChartTypeForPeriod(second, CandleType.Line)).toBe(CandleType.Line)
    // Other periods keep the requested type untouched.
    expect(resolveChartTypeForPeriod(minute, CandleType.CandleSolid)).toBe(CandleType.CandleSolid)
    expect(resolveChartTypeForPeriod(minute, 'renko')).toBe('renko')
  })
})
