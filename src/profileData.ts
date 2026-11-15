import type { KLineData } from 'klinecharts'
import { bucketEnd } from './aggregate'
import { periodDurationMs } from './symbolSelect'
import type { Datafeed, Period, SymbolInfo } from './types'
import { symbolKey } from './persist'
import { validProfileBar } from './volumeProfile'

export const MAX_PROFILE_BARS = 5000
export interface ProfileSource {
  bars: KLineData[]
  detailedParents: number
  detailedTimestamps?: number[]
  fallbackParents: number
  period?: Period
  state: 'ready' | 'loading' | 'unavailable'
  unsupported?: boolean
}

/** Finest advertised candle interval fitting the request budget. Seconds are recent trades, not reliable history. */
export function profileDetailPeriod (parent: Period, periods: Period[], from: number, to: number): Period | undefined {
  const duration = periodDurationMs(parent)
  return periods.filter(p => ['minute', 'hour', 'day'].includes(p.timespan))
    .filter(p => {
      const ms = periodDurationMs(p)
      return ms > 0 && ms < duration && Math.ceil((to - from) / ms) <= MAX_PROFILE_BARS &&
        (parent.timespan === 'month' ? 86_400_000 % ms === 0 : duration % ms === 0)
    }).sort((a, b) => periodDurationMs(a) - periodDurationMs(b))[0]
}

/** All-or-nothing replacement per CLOSED parent: no partial-detail double counting. */
export function profileSource (
  parents: KLineData[], parentPeriod: Period, detail: KLineData[], detailPeriod?: Period, now = Date.now()
): ProfileSource {
  const byTime = new Map(detail.filter(validProfileBar).map(bar => [bar.timestamp, bar]))
  const bars: KLineData[] = []
  let detailedParents = 0
  const detailedTimestamps: number[] = []
  let fallbackParents = 0
  const step = detailPeriod ? periodDurationMs(detailPeriod) : 0
  for (const parent of parents) {
    const end = bucketEnd(parent.timestamp, parentPeriod)
    const expected = step > 0 ? (end - parent.timestamp) / step : 0
    const children: KLineData[] = []
    if (validProfileBar(parent) && end <= now && Number.isInteger(expected) && expected > 0 && expected <= MAX_PROFILE_BARS) {
      for (let t = parent.timestamp; t < end; t += step) {
        const bar = byTime.get(t)
        if (!bar) break
        children.push(bar)
      }
    }
    const volume = children.reduce((sum, bar) => sum + (bar.volume ?? 0), 0)
    // Candle endpoints can be independently revised. Inconsistent volume stays coarse.
    const sameVolume = Math.abs(volume - (parent.volume ?? 0)) <= Math.max(1e-8, Math.abs(parent.volume ?? 0) * 1e-6)
    const matchesPrices = children.length > 0 && children[0].open === parent.open &&
      children[children.length - 1].close === parent.close &&
      Math.max(...children.map(b => b.high)) === parent.high && Math.min(...children.map(b => b.low)) === parent.low
    if (children.length === expected && expected > 0 && sameVolume && matchesPrices) {
      bars.push(...children)
      detailedParents++
      detailedTimestamps.push(parent.timestamp)
    } else {
      bars.push(parent)
      fallbackParents++
    }
  }
  return { bars, detailedParents, detailedTimestamps, fallbackParents, period: detailPeriod, state: 'ready' }
}

/** Per-chart bounded cache. Epoch guards prevent stale pages or disposal from launching more work. */
export class ProfileHistory {
  private epoch = 0
  private pendingRequest: Promise<KLineData[]> | undefined
  private cache = new Map<string, { promise: Promise<KLineData[]>, settled: boolean }>()
  reset (): void { this.epoch++; this.cache.clear() }
  cancelPending (): void {
    this.epoch++
    for (const [key, entry] of this.cache) if (!entry.settled) this.cache.delete(key)
  }

  load (feed: Datafeed, symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
    const step = periodDurationMs(period)
    if (!(step > 0) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from || Math.ceil((to - from) / step) > MAX_PROFILE_BARS) {
      return Promise.resolve([])
    }
    const key = `${symbolKey(symbol)}|${period.multiplier}${period.timespan}|${from}|${to}`
    const cached = this.cache.get(key)
    if (cached) return cached.promise
    const epoch = this.epoch
    const job = (async () => {
      const bars = new Map<number, KLineData>()
      for (let cursor = from; cursor < to; cursor += step * 500) {
        if (epoch !== this.epoch) return []
        const end = Math.min(to, cursor + step * 500)
        // One wire request per chart at a time, including obsolete ranges awaiting
        // their current page. The legacy feed has no AbortSignal contract.
        while (this.pendingRequest) await this.pendingRequest.catch(() => {})
        if (epoch !== this.epoch) return []
        const request = feed.getHistoryKLineData(symbol, period, cursor, end - 1)
        this.pendingRequest = request
        let page: KLineData[]
        try { page = await request } finally {
          if (this.pendingRequest === request) this.pendingRequest = undefined
        }
        if (epoch !== this.epoch) return []
        for (const bar of page) if (validProfileBar(bar) && bar.timestamp >= from && bar.timestamp < to) bars.set(bar.timestamp, bar)
      }
      return [...bars.values()].sort((a, b) => a.timestamp - b.timestamp)
    })()
    // Failed requests fall back. Retain the settled failure until the range changes;
    // dragging over the same range must not spin retry requests on every repaint.
    const entry = { promise: job.catch(() => []), settled: false }
    entry.promise = entry.promise.then(bars => { entry.settled = true; return bars })
    this.cache.set(key, entry)
    if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value as string)
    return entry.promise
  }
}
