import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'

import { PRICE_SOURCES, mapHtfBuckets } from './timeframe'

const bar = (timestamp: number, close: number): KLineData =>
  ({ timestamp, open: close, high: close, low: close, close, volume: 1 })

describe('mapHtfBuckets (IND-002 per-study timeframes)', () => {
  const htf = [bar(1_000_000, 10), bar(3_600_000, 11), bar(7_200_000, 12)]

  it('assigns each chart bar the bucket containing its timestamp', () => {
    const chart = [bar(1_200_000, 1), bar(1_500_000, 2), bar(3_700_000, 3)]
    const mapped = mapHtfBuckets(chart, htf)
    expect(mapped.map(m => m.close)).toEqual([10, 10, 11])
    // timestamps stay on the chart's grid so values align by index
    expect(mapped.map(m => m.timestamp)).toEqual([1_200_000, 1_500_000, 3_700_000])
  })

  it('keeps the forming bucket live (last chart bar reads the last HTF bar)', () => {
    const chart = [bar(3_700_000, 1), bar(4_100_000, 2)]
    expect(mapHtfBuckets(chart, htf).map(m => m.close)).toEqual([11, 11])
  })

  it('falls back to the first bucket for bars before the HTF history starts', () => {
    const chart = [bar(500_000, 1), bar(3_700_000, 2)]
    expect(mapHtfBuckets(chart, htf).map(m => m.close)).toEqual([10, 11])
  })

  it('passes chart data through when there is no HTF history', () => {
    const chart = [bar(1, 1)]
    expect(mapHtfBuckets(chart, [])).toEqual(chart)
  })

  it('exposes the seven TV price sources', () => {
    expect(PRICE_SOURCES).toEqual(['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'])
  })
})
