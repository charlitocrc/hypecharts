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
import type { Period } from '../types'

/**
 * Trade-tick aggregation for second-based periods.
 *
 * Neither venue serves 1s candles over a stream, so second bars are built
 * client-side: every trade lands in a floor-to-second bucket and updates the
 * bucket's OHLCV in place. The builder returns the same object reference for
 * all trades inside one bucket, so the live callback can hand the chart's
 * update path a mutating bar the way the kline streams do.
 */

export const SECOND_PERIOD: Period = { multiplier: 1, timespan: 'second', text: '1s' }

export const isSecondPeriod = (period: Period): boolean =>
  period.multiplier === 1 && period.timespan === 'second'

/** Subscription/history keys carry the period text; '1s' marks a trade-derived stream. */
export const isSecondIntervalText = (interval: string): boolean => /^\d+s$/.test(interval)

export const secondBucket = (timeMs: number): number => Math.floor(timeMs / 1000) * 1000

export interface TradeTick {
  price: number
  size: number
  /** Trade time in milliseconds. */
  time: number
}

export class TradeBarBuilder {
  private bar: KLineData | null = null

  /** Apply one trade; returns the live bucket bar when it lands in the current second, else null. */
  push (tick: TradeTick): KLineData | null {
    if (!Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.time)) return null
    const timestamp = secondBucket(tick.time)
    const size = Number.isFinite(tick.size) && tick.size > 0 ? tick.size : 0
    const bar = this.bar
    if (bar === null || timestamp > bar.timestamp) {
      const next = { timestamp, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: size }
      this.bar = next
      return next
    }
    if (timestamp < bar.timestamp) return null
    bar.high = Math.max(bar.high, tick.price)
    bar.low = Math.min(bar.low, tick.price)
    bar.close = tick.price
    bar.volume = (bar.volume ?? 0) + size
    return bar
  }

  current (): KLineData | null {
    return this.bar
  }
}

/** Aggregate settled trades into ordered 1s bars; input order does not matter (venue trade pages are newest-first). */
export function barsFromTrades (trades: TradeTick[]): KLineData[] {
  const builder = new TradeBarBuilder()
  const bars: KLineData[] = []
  let last: KLineData | null = null
  const ordered = trades.slice().sort((a, b) => a.time - b.time)
  for (const tick of ordered) {
    const bar = builder.push(tick)
    if (bar && bar !== last) bars.push(bar)
    last = bar ?? last
  }
  return bars
}
