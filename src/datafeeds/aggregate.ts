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

import { aggregateBars, bucketStart, mergeIntoBucket, newBucket, pickBasePeriod } from '../aggregate'
import { periodDurationMs } from '../symbolSelect'
import type {
  Datafeed, DatafeedConfiguration, DatafeedSubscribeCallback,
  Period, SymbolInfo, SymbolSearchFilters, SymbolSearchResult
} from '../types'

/**
 * UX-002: wrap a feed so intervals it does not natively serve are built by
 * client-side aggregation from its widest finer base interval. Everything the
 * base feed serves passes through untouched; the chart pipeline (history
 * paging, live updates, HTF studies, compares) needs no changes.
 */

export interface AggregatingDatafeedOptions {
  /** Periods to serve through aggregation (or already declared via declareInterval). */
  customPeriods?: Period[]
}

interface TargetState {
  targetKey: string
  targetPeriod: Period
  symbol: SymbolInfo
  callback: DatafeedSubscribeCallback
  /** The last aggregated bar; seeds live merging after the history handoff. */
  tail: KLineData | null
}

interface BaseSubscription {
  symbol: SymbolInfo
  period: Period
  targets: Map<string, TargetState>
}

const stateKey = (symbol: SymbolInfo, period: Period): string =>
  `${symbol.exchange ?? ''}:${symbol.ticker}|${period.multiplier}${period.timespan}`

export interface AggregatingDatafeed extends Datafeed {
  /** The wrapper always exposes capabilities. */
  config (): Promise<DatafeedConfiguration>
  /** Register a period built at runtime (the interval builder) as aggregatable. */
  declareInterval (period: Period): void
}

export function createAggregatingDatafeed (base: Datafeed, options: AggregatingDatafeedOptions = {}): AggregatingDatafeed {
  const declared = new Map<string, Period>(
    (options.customPeriods ?? []).map(period => [`${period.multiplier}${period.timespan}`, period])
  )
  let baseIntervals: Period[] | null = null

  const customPeriodsSorted = (): Period[] =>
    [...declared.values()].sort((a, b) => periodDurationMs(a) - periodDurationMs(b))

  const isNative = (period: Period): boolean => {
    if (declared.has(`${period.multiplier}${period.timespan}`)) return false
    if (baseIntervals === null) return true // config not loaded yet: stay transparent
    return baseIntervals.some(candidate => candidate.multiplier === period.multiplier && candidate.timespan === period.timespan)
  }

  const basePeriodFor = (period: Period): Period | null =>
    pickBasePeriod(period, baseIntervals ?? [{ multiplier: 1, timespan: 'minute', text: '1m' }])

  // ---- live aggregation: one base subscription fanned out to N targets ----
  // Base feeds keep a single callback per key (subs.set), so the wrapper must
  // multiplex: only one forwarded subscribe per (symbol, basePeriod) exists.
  const baseSubs = new Map<string, BaseSubscription>()
  const targets = new Map<string, TargetState>()

  const emitTarget = (target: TargetState, baseBar: KLineData, basePeriodMs: number): void => {
    const bucketMs = periodDurationMs(target.targetPeriod)
    const start = bucketStart(baseBar.timestamp, bucketMs)
    const tail = target.tail
    if (tail === null || start > bucketStart(tail.timestamp, bucketMs)) {
      // Rollover: the previous bucket is complete (every merge already emitted
      // it, and history handed it to the chart), so only the fresh bucket goes
      // out. The chart pushes bars newer than its last timestamp.
      target.tail = newBucket(start, baseBar)
      target.callback(target.tail)
      return
    }
    if (start < bucketStart(tail.timestamp, bucketMs)) return // stale base bar
    // Same bucket: merge in place and emit a clone (the chart replaces
    // same-timestamp bars).
    mergeIntoBucket(tail, baseBar)
    if (basePeriodMs >= bucketMs) return // defensive; pickBasePeriod prevents this
    target.callback({ ...tail })
  }

  const attachTarget = (baseKey: string, target: TargetState): void => {
    let sub = baseSubs.get(baseKey)
    if (sub === undefined) {
      const basePeriod = basePeriodFor(target.targetPeriod)
      if (basePeriod === null) return
      sub = { symbol: target.symbol, period: basePeriod, targets: new Map() }
      baseSubs.set(baseKey, sub)
      base.subscribe(sub.symbol, sub.period, bar => {
        sub!.targets.forEach(target => emitTarget(target, bar, periodDurationMs(sub!.period)))
      })
    }
    sub.targets.set(target.targetKey, target)
  }

  const detachTarget = (targetKey: string): void => {
    const target = targets.get(targetKey)
    targets.delete(targetKey)
    if (target === undefined) return
    const basePeriod = basePeriodFor(target.targetPeriod)
    if (basePeriod === null) return
    const baseKey = stateKey(target.symbol, basePeriod)
    const sub = baseSubs.get(baseKey)
    if (sub === undefined) return
    sub.targets.delete(targetKey)
    if (sub.targets.size === 0) {
      base.unsubscribe(sub.symbol, sub.period)
      baseSubs.delete(baseKey)
    }
  }

  return {
    async getHistoryKLineData (symbol, period, from, to): Promise<KLineData[]> {
      if (!isNative(period)) {
        const basePeriod = basePeriodFor(period)
        if (basePeriod !== null) {
          // Fetch from the bucket opening so the first bucket is complete.
          const bucketMs = periodDurationMs(period)
          const bars = await base.getHistoryKLineData(symbol, basePeriod, bucketStart(from, bucketMs), to)
          const aggregated = aggregateBars(bars, period)
          // Seed the live state so subscribe() hands off from this exact bar.
          // Forward-only: an older-history backfill must not regress a newer
          // live bucket.
          const targetKey = stateKey(symbol, period)
          const target = targets.get(targetKey)
          if (target !== undefined && aggregated.length > 0) {
            const tail = aggregated[aggregated.length - 1]
            if (target.tail === null || tail.timestamp > target.tail.timestamp) {
              target.tail = { ...tail }
            }
          }
          // Keep every bucket whose opening the window covers — the fetch
          // clamp made the boundary bucket complete, so the left edge is a
          // full candle instead of a half-formed one.
          return aggregated.filter(bar => bar.timestamp >= bucketStart(from, bucketMs) && bar.timestamp <= to)
        }
      }
      return base.getHistoryKLineData(symbol, period, from, to)
    },

    subscribe (symbol, period, callback): void {
      if (isNative(period)) {
        base.subscribe(symbol, period, callback)
        return
      }
      const targetKey = stateKey(symbol, period)
      const basePeriod = basePeriodFor(period)
      if (basePeriod === null) {
        // Nothing finer to aggregate from: forward and let the base feed
        // apply its own fallback policy.
        base.subscribe(symbol, period, callback)
        return
      }
      const existing = targets.get(targetKey)
      if (existing !== undefined) detachTarget(targetKey)
      targets.set(targetKey, { targetKey, targetPeriod: period, symbol, callback, tail: existing?.tail ?? null })
      attachTarget(stateKey(symbol, basePeriod), targets.get(targetKey)!)
    },

    unsubscribe (symbol, period): void {
      if (isNative(period)) {
        base.unsubscribe(symbol, period)
        return
      }
      detachTarget(stateKey(symbol, period))
    },

    async config (): Promise<DatafeedConfiguration> {
      const config = await base.config?.() ?? { exchanges: [] }
      const custom = customPeriodsSorted()
      if (custom.length === 0) {
        baseIntervals = config.intervals ?? null
        return config
      }
      const intervals = [...(config.intervals ?? []), ...custom]
        .filter((period, index, all) =>
          all.findIndex(candidate => candidate.multiplier === period.multiplier && candidate.timespan === period.timespan) === index)
        .sort((a, b) => periodDurationMs(a) - periodDurationMs(b))
      baseIntervals = config.intervals ?? null
      return { ...config, intervals }
    },

    searchSymbols (query: string, filters?: SymbolSearchFilters): Promise<SymbolSearchResult[]> {
      return base.searchSymbols!(query, filters)
    },

    async resolveSymbol (name: string): Promise<SymbolInfo> {
      const info = await base.resolveSymbol!(name)
      const custom = customPeriodsSorted()
      if (info.intervals === undefined || custom.length === 0) return info
      // Aggregation serves the declared periods for every symbol, so they
      // belong in the per-symbol interval grid as well.
      const intervals = [...info.intervals, ...custom]
        .filter((period, index, all) =>
          all.findIndex(candidate => candidate.multiplier === period.multiplier && candidate.timespan === period.timespan) === index)
        .sort((a, b) => periodDurationMs(a) - periodDurationMs(b))
      return { ...info, intervals }
    },

    getServerTime (): Promise<number> {
      return base.getServerTime!()
    },

    declareInterval (period: Period): void {
      declared.set(`${period.multiplier}${period.timespan}`, period)
    }
  }
}
