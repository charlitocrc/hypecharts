/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Period, SymbolInfo } from './types'

/**
 * Split a user-facing symbol name into its exchange-qualified parts.
 * 'BINANCE:BTCUSDT' → { exchange: 'BINANCE', ticker: 'BTCUSDT' };
 * 'BTCUSDT' → { ticker: 'BTCUSDT' }.
 */
export function parseSymbolName (name: string): { exchange?: string, ticker: string } {
  const trimmed = name.trim()
  const sep = trimmed.indexOf(':')
  if (sep <= 0 || sep === trimmed.length - 1) {
    return { ticker: trimmed }
  }
  return { exchange: trimmed.slice(0, sep).trim().toUpperCase(), ticker: trimmed.slice(sep + 1).trim() }
}

/** 'BINANCE:BTCUSDT'-style canonical name for a resolved symbol. */
export function qualifiedSymbolName (symbol: SymbolInfo): string {
  return symbol.exchange ? `${symbol.exchange}:${symbol.ticker}` : symbol.ticker
}

const TIMESPAN_MS: Record<string, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000
}

export function periodDurationMs (period: Period): number {
  return (TIMESPAN_MS[period.timespan] ?? 0) * period.multiplier
}

const samePeriod = (a: Period, b: Period): boolean =>
  a.multiplier === b.multiplier && a.timespan === b.timespan

/**
 * Snap a period to the closest one of `candidates`: same timespan wins
 * (nearest multiplier, ties round up), otherwise the nearest bar duration.
 */
export function snapPeriod (period: Period, candidates: Period[]): Period | null {
  if (candidates.length === 0) return null
  if (candidates.some(candidate => samePeriod(candidate, period))) return period
  const sameTimespan = candidates.filter(candidate => candidate.timespan === period.timespan)
  if (sameTimespan.length > 0) {
    // <= so a tie (3m between 1m and 5m) rounds up to the longer period.
    return sameTimespan.reduce((best, candidate) =>
      Math.abs(candidate.multiplier - period.multiplier) <= Math.abs(best.multiplier - period.multiplier) ? candidate : best)
  }
  const duration = periodDurationMs(period)
  return candidates.reduce((best, candidate) =>
    Math.abs(periodDurationMs(candidate) - duration) < Math.abs(periodDurationMs(best) - duration) ? candidate : best)
}

/**
 * Effective period-bar list: host options intersected with the symbol's
 * declared intervals and the feed config's venue-wide intervals. An empty
 * result falls back to the host list so a symbol never empties the bar.
 */
export function effectivePeriods (
  hostPeriods: Period[],
  constraints: Array<Period[] | undefined>
): Period[] {
  let list = hostPeriods
  for (const constraint of constraints) {
    if (!constraint || constraint.length === 0) continue
    list = list.filter(period => constraint.some(candidate => samePeriod(candidate, period)))
  }
  return list.length > 0 ? list : hostPeriods
}
