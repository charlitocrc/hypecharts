import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoFeed, SyntheticDatafeed } from './datafeed'

const period = { multiplier: 15, timespan: 'minute', text: '15m' } as const

// Exercise the real feeds, composite routing and aggregation with fixture HTTP responses.
function network (hlMs: number, binanceMs: number, hlOk = true, binanceOk = true) {
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => new Promise((resolve, reject) => {
    const hl = url.includes('hyperliquid')
    if (!init.signal) {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const data = body?.type === 'meta' ? { universe: [{ name: 'BTC', szDecimals: 3 }] }
        : url.includes('exchangeInfo') ? { symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', filters: [] }] }
        : [{ t: 1, o: '1', h: '2', l: '1', c: '2', v: '1' }]
      resolve({ ok: true, json: async () => data })
      return
    }
    const timer = setTimeout(() => resolve({ ok: hl ? hlOk : binanceOk, json: async () => [] }), hl ? hlMs : binanceMs)
    init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) })
  })))
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('demo startup discovery', () => {
  it('serves the selected venue before a slow secondary probe finishes, then retains both venues', async () => {
    network(100, 3000)
    const started = createDemoFeed()
    await vi.advanceTimersByTimeAsync(100)
    const demo = await started
    expect(demo.venues).toEqual(['HYPERLIQUID'])
    expect(await demo.datafeed.getHistoryKLineData({ ticker: 'BTC', exchange: 'HYPERLIQUID' }, period, 0, 2)).toHaveLength(1)
    let configured = false
    const config = demo.datafeed.config!().then(value => { configured = true; return value })
    await vi.advanceTimersByTimeAsync(100)
    expect(configured).toBe(false)
    await vi.advanceTimersByTimeAsync(2800)
    expect((await demo.discoveryComplete).venues).toEqual(['HYPERLIQUID', 'BINANCE'])
    expect((await config).exchanges.map(item => item.key)).toEqual(['HYPERLIQUID', 'BINANCE'])
    expect(await demo.datafeed.searchSymbols!('BTC')).toHaveLength(2)
    expect((await demo.datafeed.resolveSymbol!('BINANCE:BTCUSDT')).exchange).toBe('BINANCE')
  })

  it('waits for the saved selected venue even when the default venue is faster', async () => {
    network(10, 700)
    let ready = false
    const started = createDemoFeed(['BINANCE']).then(value => { ready = true; return value })
    await vi.advanceTimersByTimeAsync(100)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(600)
    expect((await started).venues).toEqual(['HYPERLIQUID', 'BINANCE'])
  })

  it('waits for both venues needed by a split workspace', async () => {
    network(100, 600)
    let ready = false
    const started = createDemoFeed(['HYPERLIQUID', 'BINANCE']).then(value => { ready = true; return value })
    await vi.advanceTimersByTimeAsync(100)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect((await started).venues).toHaveLength(2)
  })

  it('keeps a healthy primary usable when the secondary times out', async () => {
    network(100, 10000)
    const started = createDemoFeed()
    await vi.advanceTimersByTimeAsync(100)
    const demo = await started
    expect(demo.venues).toEqual(['HYPERLIQUID'])
    await vi.advanceTimersByTimeAsync(4900)
    expect((await demo.discoveryComplete).venues).toEqual(['HYPERLIQUID'])
  })

  it('uses the other live venue when the required venue fails', async () => {
    network(100, 500, false)
    const started = createDemoFeed()
    await vi.advanceTimersByTimeAsync(500)
    expect((await started).venues).toEqual(['BINANCE'])
  })

  it('retains the simulated fallback when neither venue is reachable', async () => {
    network(100, 200, false, false)
    const started = createDemoFeed()
    await vi.advanceTimersByTimeAsync(200)
    const demo = await started
    expect(demo.venues).toEqual([])
    expect(demo.label).toMatch(/^SIMULATED/)
    const now = Date.now()
    expect(await demo.datafeed.getHistoryKLineData({ ticker: 'BTC', exchange: 'HYPERLIQUID' }, period, now - 3600000, now)).not.toHaveLength(0)
  })
})

describe('synthetic fallback calendar bars', () => {
  const symbol = { ticker: 'BTC', exchange: 'HYPERLIQUID', pricePrecision: 1, volumePrecision: 2 }

  it('opens weeks on Monday and months on the 1st, including backfill', async () => {
    const now = Date.now()
    const feed = new SyntheticDatafeed()
    const weeks = await feed.getHistoryKLineData(symbol, { multiplier: 1, timespan: 'week', text: '1w' }, now - 3000 * 7 * 86_400_000, now)
    const months = await feed.getHistoryKLineData(symbol, { multiplier: 1, timespan: 'month', text: '1M' }, now - 2100 * 31 * 86_400_000, now)
    expect(weeks.length).toBeGreaterThan(2000)
    expect(weeks.every(bar => new Date(bar.timestamp).getUTCDay() === 1)).toBe(true)
    expect(months.length).toBeGreaterThan(2000)
    expect(months.every(bar => new Date(bar.timestamp).getUTCDate() === 1)).toBe(true)
  })
})
