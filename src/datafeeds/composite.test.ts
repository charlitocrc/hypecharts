import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'

import { createCompositeDatafeed } from './composite'
import type { CompositeRoute } from './composite'
import type { Datafeed, Period, SymbolInfo, SymbolSearchResult } from '../types'

const PERIOD: Period = { multiplier: 15, timespan: 'minute', text: '15m' }
const BAR: KLineData = { timestamp: 1700000000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }

interface FakeFeedOptions {
  exchanges?: string[]
  search?: SymbolSearchResult[]
  failSearch?: boolean
}

function fakeFeed (options: FakeFeedOptions = {}): Datafeed {
  return {
    async getHistoryKLineData (symbol: SymbolInfo) {
      if (symbol.exchange === undefined || options.exchanges?.includes(symbol.exchange)) {
        return [{ ...BAR, volume: (BAR.volume ?? 0) + symbol.ticker.length }]
      }
      throw new Error(`wrong venue: ${symbol.exchange}`)
    },
    subscribe () {},
    unsubscribe () {},
    ...(options.search || options.failSearch
      ? {
          searchSymbols: async (query: string): Promise<SymbolSearchResult[]> => {
            if (options.failSearch) throw new Error('search down')
            const search = query.trim().toLowerCase()
            return (options.search ?? []).filter(result =>
              search === '' ||
              result.ticker.toLowerCase().includes(search) ||
              (result.symbol ?? '').toLowerCase().includes(search))
          }
        }
      : {})
  }
}

const ROUTE_A: CompositeRoute = {
  feed: fakeFeed({
    exchanges: ['HYPERLIQUID'],
    search: [
      { ticker: 'BTC', symbol: 'BTC-PERP', description: 'BTC perpetual', exchange: 'HYPERLIQUID', market: 'perp' },
      { ticker: 'ETH', symbol: 'ETH-PERP', exchange: 'HYPERLIQUID' }
    ]
  }),
  exchanges: ['HYPERLIQUID']
}

const ROUTE_B: CompositeRoute = {
  feed: fakeFeed({
    exchanges: ['BINANCE'],
    search: [
      { ticker: 'BTCUSDT', symbol: 'BTC', description: 'BTC / USDT', exchange: 'BINANCE', market: 'spot' },
      { ticker: 'ETHUSDT', symbol: 'ETH', exchange: 'BINANCE' }
    ]
  }),
  exchanges: ['BINANCE']
}

describe('composite datafeed routing', () => {
  it('routes transport calls by symbol exchange', async () => {
    const composite = createCompositeDatafeed([ROUTE_A, ROUTE_B])
    const bars = await composite.getHistoryKLineData({ ticker: 'BTCUSDT', exchange: 'BINANCE' }, PERIOD, 0, 1)
    expect(bars[0].volume).toBe(17) // 10 + 'BTCUSDT'.length → proves the Binance route served it
  })

  it('rejects unknown exchanges and keeps the code on the error', async () => {
    const composite = createCompositeDatafeed([ROUTE_A])
    await expect(composite.getHistoryKLineData({ ticker: 'BTCUSDT', exchange: 'OKX' }, PERIOD, 0, 1))
      .rejects.toEqual({ code: 'unknown_exchange', name: 'OKX' })
    await expect(composite.getHistoryKLineData({ ticker: 'BTC', exchange: 'HYPERLIQUID' }, PERIOD, 0, 1)).resolves.toHaveLength(1)
  })

  it('serves unqualified symbols only when unambiguous', async () => {
    const single = createCompositeDatafeed([ROUTE_A])
    await expect(single.getHistoryKLineData({ ticker: 'BTC' }, PERIOD, 0, 1)).resolves.toHaveLength(1)
    const both = createCompositeDatafeed([ROUTE_A, ROUTE_B])
    await expect(both.getHistoryKLineData({ ticker: 'BTC' }, PERIOD, 0, 1))
      .rejects.toEqual({ code: 'unknown_exchange', name: 'BTC' })
  })

  it('routes subscribe and unsubscribe by exchange', () => {
    const composite = createCompositeDatafeed([ROUTE_A, ROUTE_B])
    const symbol = { ticker: 'BTC', exchange: 'HYPERLIQUID' }
    expect(() => composite.subscribe(symbol, PERIOD, () => {})).not.toThrow()
    expect(() => composite.unsubscribe(symbol, PERIOD, () => {})).not.toThrow()
    expect(() => composite.subscribe({ ticker: 'X', exchange: 'OKX' }, PERIOD, () => {})).toThrow()
  })
})

describe('composite config', () => {
  it('merges exchanges (first feed wins on duplicates) and unions symbol types', async () => {
    const withConfig = (key: string, exchanges: any[], symbolTypes?: any[]): CompositeRoute => ({
      feed: {
        getHistoryKLineData: async () => [],
        subscribe: () => {},
        unsubscribe: () => {},
        config: async () => ({ exchanges, ...(symbolTypes ? { symbolTypes } : {}) })
      },
      exchanges: [key]
    })
    const composite = createCompositeDatafeed([
      withConfig('A', [{ key: 'HYPERLIQUID', name: 'Hyperliquid' }, { key: 'BINANCE', name: 'Binance' }], [{ key: 'crypto' }]),
      withConfig('B', [{ key: 'BINANCE', name: 'Binance US' }], [{ key: 'crypto' }, { key: 'index' }])
    ])
    const config = await composite.config()
    expect(config.exchanges.map(exchange => exchange.key)).toEqual(['HYPERLIQUID', 'BINANCE'])
    expect(config.exchanges[1].name).toBe('Binance')
    expect(config.symbolTypes?.map(type => type.key)).toEqual(['crypto', 'index'])
  })

  it('intersects venue-wide intervals', async () => {
    const withIntervals = (texts: string[]): CompositeRoute => ({
      feed: {
        getHistoryKLineData: async () => [],
        subscribe: () => {},
        unsubscribe: () => {},
        config: async () => ({
          exchanges: [{ key: 'X', name: 'X' }],
          intervals: texts.map(text => ({ multiplier: parseInt(text, 10), timespan: 'minute', text }))
        })
      },
      exchanges: ['X']
    })
    const composite = createCompositeDatafeed([withIntervals(['1m', '5m', '15m']), withIntervals(['5m', '15m', '30m'])])
    expect((await composite.config()).intervals?.map(period => period.text)).toEqual(['5m', '15m'])
  })
})

describe('composite search', () => {
  it('fans out, merges by exchange+ticker, honors the limit', async () => {
    const composite = createCompositeDatafeed([ROUTE_A, ROUTE_B])
    const results = await composite.searchSymbols('btc', { limit: 10 })
    expect(results.map(result => `${result.exchange}:${result.ticker}`))
      .toEqual(['HYPERLIQUID:BTC', 'BINANCE:BTCUSDT'])
    const capped = await createCompositeDatafeed([ROUTE_A, ROUTE_B]).searchSymbols('', { limit: 2 })
    expect(capped).toHaveLength(2)
  })

  it('survives one route failing and fails when all fail', async () => {
    const healthy = createCompositeDatafeed([ROUTE_A, { feed: fakeFeed({ exchanges: ['X'], failSearch: true }), exchanges: ['X'] }])
    await expect(healthy.searchSymbols('btc')).resolves.toHaveLength(1)
    const allDown = createCompositeDatafeed([
      { feed: fakeFeed({ exchanges: ['X'], failSearch: true }), exchanges: ['X'] },
      { feed: fakeFeed({ exchanges: ['Y'], failSearch: true }), exchanges: ['Y'] }
    ])
    await expect(allDown.searchSymbols('btc')).rejects.toThrow()
  })

  it('resolves qualified names through the matching route', async () => {
    const feed: Datafeed = {
      ...fakeFeed({ exchanges: ['BINANCE'] }),
      resolveSymbol: async (name: string) => ({ ticker: 'BTCUSDT', exchange: 'BINANCE', name })
    }
    const composite = createCompositeDatafeed([{ feed, exchanges: ['BINANCE'] }])
    const info = await composite.resolveSymbol('BINANCE:BTCUSDT')
    expect(info.ticker).toBe('BTCUSDT')
    await expect(composite.resolveSymbol('HYPERLIQUID:BTC')).rejects.toEqual({ code: 'unknown_exchange', name: 'HYPERLIQUID:BTC' })
  })

  it('resolves bare names route by route, first win', async () => {
    const a: Datafeed = {
      ...fakeFeed({ exchanges: ['A'] }),
      resolveSymbol: async () => { throw { code: 'unknown_symbol' } }
    }
    const b: Datafeed = {
      ...fakeFeed({ exchanges: ['B'] }),
      resolveSymbol: async () => ({ ticker: 'BTC', exchange: 'B' })
    }
    const composite = createCompositeDatafeed([{ feed: a, exchanges: ['A'] }, { feed: b, exchanges: ['B'] }])
    expect(await composite.resolveSymbol('BTC')).toEqual({ ticker: 'BTC', exchange: 'B' })
    const none: Datafeed = { ...fakeFeed({ exchanges: ['C'] }), resolveSymbol: async () => { throw { code: 'unknown_symbol' } } }
    await expect(createCompositeDatafeed([{ feed: none, exchanges: ['C'] }]).resolveSymbol('NOPE'))
      .rejects.toEqual({ code: 'unknown_symbol', name: 'NOPE' })
  })

  it('addRoute extends routing for later venues', async () => {
    const composite = createCompositeDatafeed([ROUTE_A])
    await expect(composite.getHistoryKLineData({ ticker: 'BTCUSDT', exchange: 'BINANCE' }, PERIOD, 0, 1)).rejects.toThrow()
    composite.addRoute(ROUTE_B)
    await expect(composite.getHistoryKLineData({ ticker: 'BTCUSDT', exchange: 'BINANCE' }, PERIOD, 0, 1)).resolves.toHaveLength(1)
  })
})
