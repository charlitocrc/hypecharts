/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { KLineData } from 'klinecharts'

import { periodDurationMs } from './symbolSelect'
import type { Period } from './types'

/**
 * UX-002: client-side candle aggregation. Custom intervals are built by
 * merging a natively-served base series into fixed UTC buckets, so a 6h bucket
 * is always 00/06/12/18 UTC regardless of which base bars fed it. Intraday and
 * day buckets are anchored to the epoch; weeks open Monday 00:00 UTC and months
 * on the 1st at 00:00 UTC, on every venue.
 */

const DAY_MS = 24 * 60 * 60 * 1000
/** 1970-01-05, the first Monday after the epoch. */
const FIRST_MONDAY_MS = 4 * DAY_MS

export const isCalendar = (period: Period): boolean => period.timespan === 'week' || period.timespan === 'month'

/** UTC open timestamp of the `period` bucket that `timestamp` falls into. */
export function bucketStart (timestamp: number, period: Period): number {
  if (period.timespan === 'month') {
    const date = new Date(timestamp)
    const months = date.getUTCFullYear() * 12 + date.getUTCMonth()
    const start = Math.floor(months / period.multiplier) * period.multiplier
    return Date.UTC(Math.floor(start / 12), start % 12)
  }
  const bucketMs = periodDurationMs(period)
  const anchor = period.timespan === 'week' ? FIRST_MONDAY_MS : 0
  return Math.floor((timestamp - anchor) / bucketMs) * bucketMs + anchor
}

/** Close timestamp of the `period` bucket opening at `start`; months vary in length. */
export function bucketEnd (start: number, period: Period): number {
  if (period.timespan !== 'month') return start + periodDurationMs(period)
  const date = new Date(start)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + period.multiplier)
}

/** Merge `bar` into `bucket` (open kept, extremes kept, close/volume replaced/summed). */
export function mergeIntoBucket (bucket: KLineData, bar: KLineData): KLineData {
  bucket.high = Math.max(bucket.high, bar.high)
  bucket.low = Math.min(bucket.low, bar.low)
  bucket.close = bar.close
  bucket.volume = (bucket.volume ?? 0) + (bar.volume ?? 0)
  return bucket
}

export function newBucket (timestamp: number, bar: KLineData): KLineData {
  return { timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume ?? 0 }
}

/** Aggregate a timestamp-ascending series into `period` buckets; gaps are dropped. */
export function aggregateBars (bars: KLineData[], period: Period): KLineData[] {
  const bucketMs = periodDurationMs(period)
  if (!Number.isFinite(bucketMs) || bucketMs <= 0) return bars
  const out: KLineData[] = []
  let current: KLineData | null = null
  let currentStart = Number.NaN
  for (const bar of bars) {
    const start = bucketStart(bar.timestamp, period)
    if (start === currentStart && current !== null) {
      mergeIntoBucket(current, bar)
    } else {
      if (current !== null) out.push(current)
      currentStart = start
      current = newBucket(start, bar)
    }
  }
  if (current !== null) out.push(current)
  return out
}

/**
 * Pick the widest natively-served period that divides `period` evenly, so no
 * base bar straddles a bucket boundary and history fetches stay cheap. Week and
 * month targets need a base that fits inside one UTC day, or the same calendar
 * unit; week and month bases never feed epoch-anchored targets. Null when no
 * candidate qualifies.
 */
export function pickBasePeriod (period: Period, candidates: Period[]): Period | null {
  if (candidates.length === 0) return null
  const targetMs = periodDurationMs(period)
  const usable = candidates.filter(candidate => {
    const ms = periodDurationMs(candidate)
    if (ms <= 0 || ms >= targetMs || targetMs % ms !== 0) return false
    if (isCalendar(candidate)) return candidate.timespan === period.timespan
    return !isCalendar(period) || DAY_MS % ms === 0
  })
  if (usable.length === 0) return null
  return usable.reduce((best, candidate) =>
    periodDurationMs(candidate) > periodDurationMs(best) ? candidate : best)
}

/** Canonical period text for a built interval, e.g. `{3, minute}` → '3m'. */
const UNIT_CHAR: Record<Period['timespan'], string> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
  month: 'M'
}

export function periodText (multiplier: number, timespan: Period['timespan']): string {
  return `${multiplier}${UNIT_CHAR[timespan]}`
}

/** Parse a canonical interval text ('90m', '2h', '3M') back into a Period. */
export function parsePeriodText (text: string): Period | null {
  const match = /^(\d+)([smhdwM])$/.exec(text)
  if (!match) return null
  const multiplier = Number(match[1])
  if (!Number.isInteger(multiplier) || multiplier < 1) return null
  const timespan = (Object.keys(UNIT_CHAR) as Array<Period['timespan']>)
    .find(unit => UNIT_CHAR[unit] === match[2])
  return timespan ? { multiplier, timespan, text } : null
}
