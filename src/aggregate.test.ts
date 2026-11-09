import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'

import { aggregateBars, bucketEnd, bucketStart, mergeIntoBucket, newBucket, parsePeriodText, periodText, pickBasePeriod } from './aggregate'
import { periodDurationMs } from './symbolSelect'
import type { Period } from './types'

const MINUTE: Period = { multiplier: 6, timespan: 'minute', text: '6m' }
const HOUR: Period = { multiplier: 2, timespan: 'hour', text: '2h' }
const DAY: Period = { multiplier: 1, timespan: 'day', text: '1d' }
const WEEK: Period = { multiplier: 1, timespan: 'week', text: '1w' }
const MONTH: Period = { multiplier: 1, timespan: 'month', text: '1M' }

/** 1-minute bars starting at an offset inside the first bucket. */
function minuteBars (startMs: number, count: number, base = 100): KLineData[] {
  const out: KLineData[] = []
  for (let i = 0; i < count; i++) {
    const timestamp = startMs + i * 60_000
    const open = base + i
    out.push({ timestamp, open, high: open + 2, low: open - 1, close: open + 1, volume: 5 })
  }
  return out
}

describe('bucketStart', () => {
  it('anchors buckets to the epoch', () => {
    // 2023-11-14 22:31 UTC falls into the 22:00 bucket.
    expect(bucketStart(Date.UTC(2023, 10, 14, 22, 31), HOUR)).toBe(Date.UTC(2023, 10, 14, 22))
    expect(bucketStart(Date.UTC(2023, 10, 14, 22), HOUR)).toBe(Date.UTC(2023, 10, 14, 22))
  })

  it('keeps day buckets aligned to UTC midnight', () => {
    expect(bucketStart(Date.UTC(2023, 10, 15, 13, 5), DAY)).toBe(Date.UTC(2023, 10, 15))
  })

  it('opens weeks on Monday 00:00 UTC', () => {
    const monday = Date.UTC(2023, 10, 13)
    expect(bucketStart(monday, WEEK)).toBe(monday)
    expect(bucketStart(Date.UTC(2023, 10, 16, 9), WEEK)).toBe(monday) // Thursday
    expect(bucketStart(Date.UTC(2023, 10, 19, 23, 59), WEEK)).toBe(monday) // Sunday
    expect(bucketStart(Date.UTC(2024, 0, 1), WEEK)).toBe(Date.UTC(2024, 0, 1)) // Monday, across the year
  })

  it('opens months on the 1st at 00:00 UTC, whatever their length', () => {
    expect(bucketStart(Date.UTC(2024, 1, 29, 23), MONTH)).toBe(Date.UTC(2024, 1, 1))
    expect(bucketStart(Date.UTC(2024, 2, 31), MONTH)).toBe(Date.UTC(2024, 2, 1))
    expect(bucketStart(Date.UTC(2024, 4, 15), { multiplier: 3, timespan: 'month', text: '3M' })).toBe(Date.UTC(2024, 3, 1))
  })

  it('ends a bucket at the next one\'s open', () => {
    expect(bucketEnd(Date.UTC(2024, 1, 1), MONTH)).toBe(Date.UTC(2024, 2, 1))
    expect(bucketEnd(Date.UTC(2024, 11, 1), MONTH)).toBe(Date.UTC(2025, 0, 1))
    expect(bucketEnd(Date.UTC(2023, 10, 13), WEEK)).toBe(Date.UTC(2023, 10, 20))
  })
})

describe('aggregateBars', () => {
  it('merges bars within one bucket', () => {
    const start = Date.UTC(2023, 10, 14, 22, 1) // 22:01–22:04 all inside the 22:00 6m bucket
    const bars = minuteBars(start, 4)
    const out = aggregateBars(bars, MINUTE)
    expect(out).toHaveLength(1)
    expect(out[0].timestamp).toBe(bucketStart(start, MINUTE))
    expect(out[0].open).toBe(bars[0].open)
    expect(out[0].close).toBe(bars[3].close)
    expect(out[0].high).toBe(Math.max(...bars.map(b => b.high)))
    expect(out[0].low).toBe(Math.min(...bars.map(b => b.low)))
    expect(out[0].volume).toBe(20)
  })

  it('rolls buckets on the bucket boundary, anchored to the epoch', () => {
    const start = Date.UTC(2023, 10, 14, 21, 58)
    const bars = minuteBars(start, 8) // spans 22:00 across 2h buckets
    const out = aggregateBars(bars, HOUR)
    expect(out).toHaveLength(2)
    expect(out[0].timestamp).toBe(Date.UTC(2023, 10, 14, 20))
    expect(out[1].timestamp).toBe(Date.UTC(2023, 10, 14, 22))
    // The 21:58/21:59 bars are in the first bucket, the rest in the second.
    expect(out[0].close).toBe(bars[1].close)
    expect(out[1].open).toBe(bars[2].open)
  })

  it('emits only buckets that contain bars (gaps stay gaps)', () => {
    const bars = [...minuteBars(Date.UTC(2023, 10, 14, 20, 0), 2), ...minuteBars(Date.UTC(2023, 10, 14, 23, 0), 2)]
    const out = aggregateBars(bars, HOUR)
    // 20:00 bars → bucket 20:00; 23:00 bars → bucket 22:00; nothing fabricated between.
    expect(out.map(bar => bar.timestamp)).toEqual([Date.UTC(2023, 10, 14, 20), Date.UTC(2023, 10, 14, 22)])
    expect(out[1].open).toBe(bars[2].open)
  })

  it('passes through when the bucket duration is invalid', () => {
    const bars = minuteBars(Date.UTC(2023, 10, 14, 22, 0), 3)
    expect(aggregateBars(bars, { multiplier: 0, timespan: 'minute', text: '0m' })).toBe(bars)
  })
})

describe('mergeIntoBucket / newBucket', () => {
  it('keeps extremes and accumulates volume', () => {
    const bucket = newBucket(1000, { timestamp: 1000, open: 5, high: 6, low: 4, close: 5.5, volume: 3 })
    mergeIntoBucket(bucket, { timestamp: 1030, open: 5.5, high: 7, low: 3.5, close: 6, volume: 2 })
    expect(bucket).toMatchObject({ open: 5, high: 7, low: 3.5, close: 6, volume: 5 })
  })

  it('treats a missing base volume as zero', () => {
    const bucket = newBucket(1000, { timestamp: 1000, open: 5, high: 6, low: 4, close: 5.5 })
    mergeIntoBucket(bucket, { timestamp: 1030, open: 5.5, high: 7, low: 3.5, close: 6 })
    expect(bucket.volume).toBe(0)
  })
})

describe('pickBasePeriod', () => {
  const candidates: Period[] = [
    { multiplier: 1, timespan: 'minute', text: '1m' },
    { multiplier: 15, timespan: 'minute', text: '15m' },
    { multiplier: 1, timespan: 'hour', text: '1h' },
    { multiplier: 1, timespan: 'day', text: '1d' }
  ]

  it('picks the widest period strictly finer than the target', () => {
    expect(pickBasePeriod(HOUR, candidates)).toBe(candidates[2]) // 1h < 2h, widest allowed
    expect(pickBasePeriod({ multiplier: 12, timespan: 'hour', text: '12h' }, candidates)).toBe(candidates[2]) // 1d is wider than 12h, so 1h
  })

  it('excludes periods as wide as or wider than the target', () => {
    expect(pickBasePeriod({ multiplier: 1, timespan: 'hour', text: '1h' }, candidates)).toBe(candidates[1]) // 15m
  })

  it('returns null when nothing is finer', () => {
    expect(pickBasePeriod({ multiplier: 1, timespan: 'minute', text: '1m' }, [candidates[3]])).toBeNull()
    expect(pickBasePeriod(HOUR, [])).toBeNull()
  })

  const min = (multiplier: number): Period => ({ multiplier, timespan: 'minute', text: `${multiplier}m` })

  it('skips finer periods that do not divide the target evenly', () => {
    const ladder = [min(1), min(5), min(15)]
    expect(pickBasePeriod(min(7), ladder)).toBe(ladder[0])
    expect(pickBasePeriod(min(6), ladder)).toBe(ladder[0])
    expect(pickBasePeriod(min(45), ladder)).toBe(ladder[2])
  })

  it('returns null when no candidate divides the target', () => {
    expect(pickBasePeriod(min(7), [min(5), min(15)])).toBeNull()
  })

  it('builds calendar targets only from bases that stay aligned', () => {
    const threeDay: Period = { multiplier: 3, timespan: 'day', text: '3d' }
    expect(pickBasePeriod(WEEK, [DAY, threeDay])).toBe(DAY)
    expect(pickBasePeriod(MONTH, [DAY, threeDay])).toBe(DAY) // 3d divides 30d but crosses month starts
    expect(pickBasePeriod(MONTH, [threeDay])).toBeNull()
    expect(pickBasePeriod({ multiplier: 2, timespan: 'week', text: '2w' }, [DAY, WEEK])).toBe(WEEK)
    expect(pickBasePeriod({ multiplier: 2, timespan: 'month', text: '2M' }, [DAY, MONTH])).toBe(MONTH)
    expect(pickBasePeriod({ multiplier: 14, timespan: 'day', text: '14d' }, [WEEK])).toBeNull()
  })

  it('groups daily bars into Monday weeks and calendar months', () => {
    const days: KLineData[] = []
    for (let i = 0; i < 62; i++) {
      days.push({ timestamp: Date.UTC(2024, 0, 29 + i), open: i, high: i + 1, low: i - 1, close: i, volume: 1 })
    }
    const weeks = aggregateBars(days, WEEK)
    expect(weeks[0].timestamp).toBe(Date.UTC(2024, 0, 29))
    expect(weeks[1].timestamp).toBe(Date.UTC(2024, 1, 5))
    expect(weeks[0].volume).toBe(7)
    expect(aggregateBars(days, MONTH).map(bar => [bar.timestamp, bar.volume])).toEqual([
      [Date.UTC(2024, 0, 1), 3], [Date.UTC(2024, 1, 1), 29], [Date.UTC(2024, 2, 1), 30]
    ])
  })

  it('builds the same candles through the chosen base as from 1m bars', () => {
    const source = minuteBars(Date.UTC(2023, 10, 14), 24 * 60)
    const ladder = [min(1), min(5), min(15), min(120)]
    for (const target of [min(6), min(7), min(45), min(180), min(240)]) {
      const base = pickBasePeriod(target, ladder)!
      expect(aggregateBars(aggregateBars(source, base), target)).toEqual(aggregateBars(source, target))
    }
  })
})

describe('period text round-trip', () => {
  it('builds canonical texts', () => {
    expect(periodText(3, 'minute')).toBe('3m')
    expect(periodText(12, 'hour')).toBe('12h')
    expect(periodText(2, 'month')).toBe('2M')
  })

  it('parses back into periods', () => {
    expect(parsePeriodText('90m')).toEqual({ multiplier: 90, timespan: 'minute', text: '90m' })
    expect(parsePeriodText('2w')).toEqual({ multiplier: 2, timespan: 'week', text: '2w' })
    expect(parsePeriodText('5s')).toEqual({ multiplier: 5, timespan: 'second', text: '5s' })
  })

  it('rejects junk', () => {
    expect(parsePeriodText('m3')).toBeNull()
    expect(parsePeriodText('0m')).toBeNull()
    expect(parsePeriodText('3x')).toBeNull()
    expect(parsePeriodText('')).toBeNull()
  })
})
