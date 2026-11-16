import type { KLineData } from 'klinecharts'
import type { Period } from './types'
import { chartIndexAtTime, chartTimeAtIndex } from './multiChartTime'
import { periodDurationMs } from './symbolSelect'

export interface ChartTimeRange { from: number, to: number }
export interface ChartViewportMember { data: KLineData[], period: Period, width: number }

/**
 * Find a common viewport within the core's 1..50 px bar spacing and its
 * two-visible-bar scroll limits. Keep the requested right endpoint whenever
 * possible, so reaching a follower's zoom limit does not split linked charts.
 * Empty/hidden members do not constrain the group. Incompatible histories or
 * intervals retain the requested range; individual cores must then clamp it.
 */
export function constrainChartRange (requested: ChartTimeRange, members: ChartViewportMember[]): ChartTimeRange {
  const fallback = Number.isFinite(requested.from) && Number.isFinite(requested.to) && requested.to > requested.from
    ? { ...requested }
    : { from: 0, to: 1 }
  const usable = members.filter(member => member.data.length > 0 && Number.isFinite(member.width) && member.width > 0 &&
    Number.isFinite(member.data[0].timestamp) && Number.isFinite(member.data[member.data.length - 1].timestamp) &&
    Number.isFinite(periodDurationMs(member.period)) && periodDurationMs(member.period) > 0)
  if (!usable.length) return fallback

  let earliestRight = -Infinity
  let latestRight = Infinity
  for (const member of usable) {
    const count = member.data.length
    const visible = Math.min(2, count)
    // offset = right + .5 - count; the core clamps it to
    // [-count + visible, span - visible], hence these endpoint bounds.
    const minimum = chartTimeAtIndex(member.data, visible - 0.5, member.period)
    const maximum = chartTimeAtIndex(member.data, count - visible - 0.5 + member.width, member.period)
    if (minimum === undefined || maximum === undefined || !Number.isFinite(minimum) || !Number.isFinite(maximum)) return fallback
    earliestRight = Math.max(earliestRight, minimum)
    latestRight = Math.min(latestRight, maximum)
  }
  if (earliestRight > latestRight) return fallback
  const to = Math.max(earliestRight, Math.min(latestRight, fallback.to))
  let earliestLeft = -Infinity
  let latestLeft = Infinity
  for (const member of usable) {
    const right = chartIndexAtTime(member.data, to, member.period)
    if (right === undefined || !Number.isFinite(right)) return fallback
    const minimum = chartTimeAtIndex(member.data, right - member.width, member.period)
    const maximum = chartTimeAtIndex(member.data,
      Math.min(right - member.width / 50, member.data.length - Math.min(2, member.data.length) - 0.5), member.period)
    if (minimum === undefined || maximum === undefined || !Number.isFinite(minimum) || !Number.isFinite(maximum)) return fallback
    earliestLeft = Math.max(earliestLeft, minimum)
    latestLeft = Math.min(latestLeft, maximum)
  }
  if (earliestLeft > latestLeft) return fallback
  const from = Math.max(earliestLeft, Math.min(latestLeft, fallback.from))
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : fallback
}
