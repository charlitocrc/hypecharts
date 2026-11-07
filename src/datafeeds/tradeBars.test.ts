import { describe, expect, it } from 'vitest'

import {
  SECOND_PERIOD, TradeBarBuilder, barsFromTrades, isSecondIntervalText, isSecondPeriod, secondBucket
} from './tradeBars'

describe('tradeBars (1s aggregation)', () => {
  it('identifies the second period and interval text', () => {
    expect(SECOND_PERIOD).toEqual({ multiplier: 1, timespan: 'second', text: '1s' })
    expect(isSecondPeriod(SECOND_PERIOD)).toBe(true)
    expect(isSecondPeriod({ multiplier: 1, timespan: 'minute', text: '1m' })).toBe(false)
    expect(isSecondIntervalText('1s')).toBe(true)
    expect(isSecondIntervalText('15m')).toBe(false)
    expect(isSecondIntervalText('1M')).toBe(false)
  })

  it('floors trade times onto second buckets', () => {
    expect(secondBucket(1793621829989)).toBe(1793621829000)
    expect(secondBucket(1793621829000)).toBe(1793621829000)
  })

  it('opens a bucket at the first trade and updates OHLC in place', () => {
    const builder = new TradeBarBuilder()
    const first = builder.push({ price: 100, size: 1, time: 1793621829000 })
    expect(first).toEqual({ timestamp: 1793621829000, open: 100, high: 100, low: 100, close: 100, volume: 1 })

    const same = builder.push({ price: 110, size: 2, time: 1793621829500 })
    const dips = builder.push({ price: 95, size: 0.5, time: 1793621829900 })
    expect(same).toBe(first)
    expect(dips).toBe(first)
    expect(first).toEqual({ timestamp: 1793621829000, open: 100, high: 110, low: 95, close: 95, volume: 3.5 })
  })

  it('rolls into a new bar at the next second', () => {
    const builder = new TradeBarBuilder()
    const first = builder.push({ price: 100, size: 1, time: 1000 })
    const second = builder.push({ price: 105, size: 2, time: 2000 })
    expect(second).not.toBe(first)
    expect(second).toEqual({ timestamp: 2000, open: 105, high: 105, low: 105, close: 105, volume: 2 })
    expect(first).toEqual({ timestamp: 1000, open: 100, high: 100, low: 100, close: 100, volume: 1 })
  })

  it('drops stale trades for an already-emitted bucket', () => {
    const builder = new TradeBarBuilder()
    builder.push({ price: 100, size: 1, time: 1000 })
    expect(builder.push({ price: 105, size: 1, time: 2500 })).not.toBeNull()
    expect(builder.push({ price: 120, size: 9, time: 1500 })).toBeNull()
    expect(builder.current()).toEqual({ timestamp: 2000, open: 105, high: 105, low: 105, close: 105, volume: 1 })
  })

  it('ignores invalid ticks', () => {
    const builder = new TradeBarBuilder()
    expect(builder.push({ price: 0, size: 1, time: 1000 })).toBeNull()
    expect(builder.push({ price: Number.NaN, size: 1, time: 1000 })).toBeNull()
    expect(builder.push({ price: 100, size: 1, time: Number.NaN })).toBeNull()
    expect(builder.push({ price: 100, size: Number.NaN, time: 1000 })).not.toBeNull()
    expect(builder.current()?.volume).toBe(0)
  })

  it('aggregates a settled trade list into ordered bars', () => {
    const bars = barsFromTrades([
      { price: 10, size: 1, time: 1000 },
      { price: 11, size: 1, time: 1200 },
      { price: 12, size: 1, time: 1600 },
      { price: 13, size: 2, time: 2100 },
      { price: 12.5, size: 1, time: 2400 }
    ])
    expect(bars).toHaveLength(2)
    expect(bars[0]).toEqual({ timestamp: 1000, open: 10, high: 12, low: 10, close: 12, volume: 3 })
    expect(bars[1]).toEqual({ timestamp: 2000, open: 13, high: 13, low: 12.5, close: 12.5, volume: 3 })
  })

  it('sorts newest-first input (recentTrades page order) before aggregating', () => {
    const bars = barsFromTrades([
      { price: 13, size: 2, time: 2100 },
      { price: 10, size: 1, time: 1000 }
    ])
    expect(bars.map(bar => bar.timestamp)).toEqual([1000, 2000])
  })
})
