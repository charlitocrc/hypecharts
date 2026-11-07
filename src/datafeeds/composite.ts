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

import type {
  Datafeed, DatafeedConfiguration, DatafeedSubscribeCallback, DatafeedSymbolType, Period,
  SymbolInfo, SymbolSearchFilters, SymbolSearchResult
} from '../types'
import { parseSymbolName } from '../symbolSelect'

export interface CompositeRoute {
  feed: Datafeed
  /** Exchange keys this feed serves, e.g. ['BINANCE']. */
  exchanges: string[]
}

/** A composite always provides discovery: its declared methods are non-optional. */
export type CompositeDatafeed = Datafeed & {
  addRoute (route: CompositeRoute): void
  destroy (): void
  config (): Promise<DatafeedConfiguration>
  searchSymbols (query: string, filters?: SymbolSearchFilters): Promise<SymbolSearchResult[]>
  resolveSymbol (name: string): Promise<SymbolInfo>
}

/**
 * One feed instance, many venues. Transport calls route by `SymbolInfo.exchange`;
 * search and config aggregate across routes. Exchange switching becomes
 * `setSymbol('OKX:BTC-USDT')` — no chart disposal, no feed swap.
 */
export function createCompositeDatafeed (routes: CompositeRoute[] = []): CompositeDatafeed {
  let routeList = routes.slice()

  const feedFor = (symbol: SymbolInfo): Datafeed | null => {
    const exchange = symbol.exchange?.toUpperCase()
    if (exchange === undefined) {
      // Unqualified symbols are only meaningful when routing is unambiguous.
      return routeList.length === 1 ? routeList[0].feed : null
    }
    return routeList.find(route => route.exchanges.some(key => key.toUpperCase() === exchange))?.feed ?? null
  }

  const routedFeed = (symbol: SymbolInfo): Datafeed => {
    const feed = feedFor(symbol)
    if (!feed) {
      throw { code: 'unknown_exchange', name: symbol.exchange ?? symbol.ticker }
    }
    return feed
  }

  return {
    addRoute (route: CompositeRoute): void {
      routeList.push(route)
    },

    destroy (): void {
      routeList.forEach(route => {
        const feed = route.feed as Datafeed & { destroy?: () => void }
        feed.destroy?.()
      })
    },

    async getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number) {
      return routedFeed(symbol).getHistoryKLineData(symbol, period, from, to)
    },

    subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
      routedFeed(symbol).subscribe(symbol, period, callback)
    },

    unsubscribe (symbol: SymbolInfo, period: Period): void {
      routedFeed(symbol).unsubscribe(symbol, period)
    },

    async config (): Promise<DatafeedConfiguration> {
      const configs = await Promise.all(routeList.map(async route => {
        try {
          return await route.feed.config?.() ?? null
        } catch (e) {
          return null
        }
      }))
      const exchanges = new Map<string, DatafeedConfiguration['exchanges'][number]>()
      const symbolTypes = new Map<string, DatafeedSymbolType>()
      configs.forEach(config => {
        config?.exchanges.forEach(exchange => {
          // First feed wins on duplicate exchange keys.
          if (!exchanges.has(exchange.key.toUpperCase())) {
            exchanges.set(exchange.key.toUpperCase(), exchange)
          }
        })
        config?.symbolTypes?.forEach(type => {
          if (!symbolTypes.has(type.key)) symbolTypes.set(type.key, type)
        })
      })
      // Intersect venue-wide intervals so the fallback only advertises periods
      // every configured venue serves; per-symbol intervals refine further.
      let intervals: Period[] | undefined
      configs.forEach(config => {
        if (config?.intervals?.length) {
          intervals = intervals
            ? intervals.filter(period => config.intervals!.some(candidate =>
              candidate.multiplier === period.multiplier && candidate.timespan === period.timespan))
            : config.intervals.slice()
        }
      })
      return {
        exchanges: [...exchanges.values()],
        symbolTypes: symbolTypes.size > 0 ? [...symbolTypes.values()] : [{ key: 'crypto' }],
        ...(intervals ? { intervals } : {})
      }
    },

    async searchSymbols (query: string, filters?: SymbolSearchFilters): Promise<SymbolSearchResult[]> {
      const capable = routeList.filter(route => typeof route.feed.searchSymbols === 'function')
      const limit = filters?.limit ?? 50
      const settled = await Promise.allSettled(capable.map(async route => {
        const results = await route.feed.searchSymbols!(query, filters)
        return results.filter(result => result.ticker && result.exchange)
      }))
      const merged = new Map<string, SymbolSearchResult>()
      let failures = 0
      settled.forEach(result => {
        if (result.status === 'fulfilled') {
          result.value.forEach(item => {
            const key = `${item.exchange.toUpperCase()}:${item.ticker}`
            if (!merged.has(key)) merged.set(key, item)
          })
        } else {
          failures++
        }
      })
      if (failures === capable.length && capable.length > 0) {
        throw (settled.find(result => result.status === 'rejected') as PromiseRejectedResult).reason
      }
      return [...merged.values()].slice(0, limit)
    },

    async resolveSymbol (name: string): Promise<SymbolInfo> {
      const parsed = parseSymbolName(name)
      if (parsed.exchange !== undefined) {
        const route = routeList.find(route =>
          route.exchanges.some(key => key.toUpperCase() === parsed.exchange))
        if (!route) {
          throw { code: 'unknown_exchange', name }
        }
        if (typeof route.feed.resolveSymbol !== 'function') {
          throw { code: 'unknown_symbol', name }
        }
        return route.feed.resolveSymbol(name)
      }
      // Bare name: ask each route in order, first resolution wins.
      const capable = routeList.filter(route => typeof route.feed.resolveSymbol === 'function')
      for (const route of capable) {
        try {
          return await route.feed.resolveSymbol!(name)
        } catch (e) {}
      }
      throw { code: 'unknown_symbol', name }
    }
  }
}
