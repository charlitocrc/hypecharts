import { afterEach, describe, it, expect, vi } from 'vitest'

import { HL_INTERVAL_PERIODS, HyperliquidDatafeed, hlSubscription, parseCandleSnapshot, parseHlTrade, toHlInterval, parseHlUniverse, hlPricePrecision } from './hyperliquid'
import { barsFromTrades, isSecondPeriod } from './tradeBars'

// https://api.hyperliquid.xyz/info candleSnapshot rows are objects
// ({ t, T, s, i, o, h, l, c, v, n }) with string prices.
const objectFixture = [
  { t: 1793521800000, T: 1793522699999, s: 'BTC', i: '15m', o: '77961.0', c: '78155.0', h: '78174.0', l: '77961.0', v: '345.01919', n: 4659 },
  { t: 1793522700000, T: 1793523599999, s: 'BTC', i: '15m', o: '78155.0', c: '78230.0', h: '78238.0', l: '78148.0', v: '163.70321', n: 3311 }
]

const legacyArrayFixture = [
  [1793521800000, '77961.0', '78174.0', '77961.0', '78155.0', '345.01919'],
  [1793522700000, '78155.0', '78238.0', '78148.0', '78230.0', '163.70321']
]

describe('hyperliquid datafeed', () => {
  it('parses candleSnapshot objects into ascending KLineData', () => {
    const bars = parseCandleSnapshot(objectFixture)
    expect(bars).toHaveLength(2)
    expect(bars[0]).toEqual({
      timestamp: 1793521800000,
      open: 77961,
      high: 78174,
      low: 77961,
      close: 78155,
      volume: 345.01919
    })
  })

  it('still parses the legacy array row shape', () => {
    expect(parseCandleSnapshot(legacyArrayFixture)).toEqual(parseCandleSnapshot(objectFixture))
  })

  it('sorts out-of-order rows by timestamp', () => {
    const bars = parseCandleSnapshot([objectFixture[1], objectFixture[0]])
    expect(bars[0].timestamp).toBe(1793521800000)
  })

  it('drops rows with non-finite timestamps', () => {
    expect(parseCandleSnapshot([{ o: '1', h: '1', l: '1', c: '1', v: '1' }])).toHaveLength(0)
  })

  it('maps periods to hyperliquid intervals', () => {
    expect(toHlInterval({ multiplier: 1, timespan: 'second', text: '1s' })).toBe('1s')
    expect(toHlInterval({ multiplier: 15, timespan: 'minute', text: '15m' })).toBe('15m')
    expect(toHlInterval({ multiplier: 4, timespan: 'hour', text: '4h' })).toBe('4h')
    expect(toHlInterval({ multiplier: 1, timespan: 'day', text: '1d' })).toBe('1d')
    expect(toHlInterval({ multiplier: 1, timespan: 'month', text: '1M' })).toBe('1M')
  })
})

describe('hyperliquid 1s (trade-derived)', () => {
  // recentTrades rows / WS trades entries, newest first.
  const trades = [
    { coin: 'BTC', side: 'A', px: '78050.0', sz: '0.0976', time: 1793621815957, tid: 1 },
    { coin: 'BTC', side: 'B', px: '78032.0', sz: '0.00013', time: 1793621824357, tid: 2 }
  ]

  it('parses trade rows into ticks', () => {
    expect(parseHlTrade(trades[0])).toEqual({ price: 78050, size: 0.0976, time: 1793621815957 })
    expect(parseHlTrade({ px: 'bad', sz: '1', time: 1 })).toBeNull()
    expect(parseHlTrade({ px: '1', sz: '1' })).toBeNull()
  })

  it('aggregates the recentTrades seed into 1s bars', () => {
    const bars = barsFromTrades(trades.map(parseHlTrade).filter((t): t is NonNullable<typeof t> => t !== null).reverse())
    expect(bars).toHaveLength(2)
    expect(bars[0]).toEqual({ timestamp: 1793621815000, open: 78050, high: 78050, low: 78050, close: 78050, volume: 0.0976 })
  })

  it('lists 1s first among the advertised intervals', () => {
    expect(isSecondPeriod(HL_INTERVAL_PERIODS[0])).toBe(true)
    expect(HL_INTERVAL_PERIODS[1].text).toBe('1m')
  })

  it('subscribes trades at 1s and candles above it', () => {
    expect(hlSubscription('BTC', '1s')).toEqual({ type: 'trades', coin: 'BTC' })
    expect(hlSubscription('BTC', '15m')).toEqual({ type: 'candle', coin: 'BTC', interval: '15m' })
  })
})

describe('hyperliquid metadata (search/resolve)', () => {
  it('parses the meta universe rows', () => {
    expect(parseHlUniverse({ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }, { name: 'DOGE', szDecimals: 1 }, { name: '' }]}))
      .toEqual([{ name: 'BTC', szDecimals: 5 }, { name: 'DOGE', szDecimals: 1 }])
    expect(parseHlUniverse(null)).toEqual([])
    expect(parseHlUniverse({})).toEqual([])
  })

  it('derives price precision from szDecimals (tick = 10^-(6-szDecimals))', () => {
    expect(hlPricePrecision(5)).toBe(1)   // BTC: 0.1 tick
    expect(hlPricePrecision(1)).toBe(5)   // DOGE-like
    expect(hlPricePrecision(0)).toBe(6)
    expect(hlPricePrecision(8)).toBe(0)
  })
})

describe('hyperliquid calendar periods', () => {
  const SYMBOL = { ticker: 'BTC', exchange: 'HYPERLIQUID', pricePrecision: 1, volumePrecision: 2 }
  const WEEK = { multiplier: 1, timespan: 'week', text: '1w' }
  const DAY = { multiplier: 1, timespan: 'day', text: '1d' }

  class FakeSocket {
    static OPEN = 1
    static last: FakeSocket
    readyState = 1
    sent: Array<{ method: string, subscription: { interval: string } }> = []
    onopen?: () => void
    onmessage?: (event: { data: string }) => void
    constructor () { FakeSocket.last = this }
    send (text: string): void { this.sent.push(JSON.parse(text)) }
    close (): void { this.readyState = 3 }
    candle (t: number, v: number): void {
      this.onmessage?.({ data: JSON.stringify({ channel: 'candle', data: { s: 'BTC', i: '1d', t, o: 1, h: 2, l: 1, c: 2, v } }) })
    }
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('rebuilds 1w from 1d into Monday weeks', async () => {
    const rows = [Date.UTC(2024, 0, 7), Date.UTC(2024, 0, 8), Date.UTC(2024, 0, 9)].map(t =>
      ({ t, s: 'BTC', i: '1d', o: '1', c: '2', h: '3', l: '0.5', v: '4' }))
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => rows }))
    vi.stubGlobal('fetch', fetchMock)
    const feed = new HyperliquidDatafeed()
    await feed.config()
    const bars = await feed.getHistoryKLineData(SYMBOL, WEEK, Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 10))
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body).req.interval).toBe('1d')
    expect(bars.map(bar => [bar.timestamp, bar.volume])).toEqual([[Date.UTC(2024, 0, 1), 4], [Date.UTC(2024, 0, 8), 8]])
  })

  it('shares the 1d stream between a daily chart and a weekly study', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const feed = new HyperliquidDatafeed()
    await feed.config()
    const daily: number[] = []
    const weekly: number[] = []
    feed.subscribe(SYMBOL, DAY, bar => daily.push(bar.timestamp))
    const socket = FakeSocket.last
    feed.subscribe(SYMBOL, WEEK, bar => weekly.push(bar.timestamp))
    expect(socket.sent).toHaveLength(0) // onopen sends it; no duplicate venue subscribe
    const tuesday = Date.UTC(2024, 0, 9)
    socket.candle(tuesday, 1)
    expect(daily).toEqual([tuesday])
    expect(weekly).toEqual([Date.UTC(2024, 0, 8)])
    feed.unsubscribe(SYMBOL, DAY)
    expect(socket.sent).toHaveLength(0) // the weekly study still needs it
    feed.unsubscribe(SYMBOL, WEEK)
    expect(socket.sent.map(message => message.method)).toEqual(['unsubscribe'])
  })
})
