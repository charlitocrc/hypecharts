import type { KLineData } from 'klinecharts'
import type { Period } from './types'
import { periodDurationMs } from './symbolSelect'

/** Fractional calendar steps preserve monthly/yearly outer-axis spacing. */
export function shiftChartTime (timestamp: number, steps: number, period: Period): number {
  if (period.timespan !== 'month' && period.timespan !== 'year') return timestamp + steps * periodDurationMs(period)
  const date = new Date(timestamp)
  const months = period.multiplier * (period.timespan === 'year' ? 12 : 1)
  const whole = Math.floor(steps)
  const at = (step: number): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + step * months,
    date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds())
  const from = at(whole)
  return from + (at(whole + 1) - from) * (steps - whole)
}

export function chartTimeAtIndex (data: KLineData[], index: number, period: Period): number | undefined {
  if (!data.length || !Number.isFinite(index)) return undefined
  if (index < 0) return shiftChartTime(data[0].timestamp, index, period)
  const last = data.length - 1
  if (index >= last) return shiftChartTime(data[last].timestamp, index - last, period)
  const before = Math.floor(index)
  return data[before].timestamp + (data[before + 1].timestamp - data[before].timestamp) * (index - before)
}

function outerIndex (edge: number, timestamp: number, period: Period): number {
  if (period.timespan !== 'month' && period.timespan !== 'year') return (timestamp - edge) / periodDurationMs(period)
  const origin = new Date(edge)
  const target = new Date(timestamp)
  const months = period.multiplier * (period.timespan === 'year' ? 12 : 1)
  let whole = Math.floor(((target.getUTCFullYear() - origin.getUTCFullYear()) * 12 + target.getUTCMonth() - origin.getUTCMonth()) / months)
  while (shiftChartTime(edge, whole, period) > timestamp) whole--
  while (shiftChartTime(edge, whole + 1, period) <= timestamp) whole++
  const from = shiftChartTime(edge, whole, period)
  return whole + (timestamp - from) / (shiftChartTime(edge, whole + 1, period) - from)
}

/** Continuous index mapping for viewport endpoints, including compressed gaps. */
export function chartIndexAtTime (data: KLineData[], timestamp: number, period: Period): number | undefined {
  if (!data.length || !Number.isFinite(timestamp) || !(periodDurationMs(period) > 0)) return undefined
  const last = data.length - 1
  if (timestamp < data[0].timestamp) return outerIndex(data[0].timestamp, timestamp, period)
  if (timestamp >= data[last].timestamp) return last + outerIndex(data[last].timestamp, timestamp, period)
  let lo = 0
  let hi = last
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1
    if (data[mid].timestamp <= timestamp) lo = mid
    else hi = mid
  }
  return lo + (timestamp - data[lo].timestamp) / (data[hi].timestamp - data[lo].timestamp)
}

/** Crosshairs never snap across missing candles or outside the available series. */
export function containingChartIndex (data: KLineData[], timestamp: number, period: Period): number | undefined {
  if (!data.length || timestamp < data[0].timestamp || !Number.isFinite(timestamp)) return undefined
  let lo = 0
  let hi = data.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (data[mid].timestamp <= timestamp) lo = mid + 1
    else hi = mid
  }
  const index = lo - 1
  return timestamp < shiftChartTime(data[index].timestamp, 1, period) ? index : undefined
}
