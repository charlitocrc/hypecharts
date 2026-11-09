import { afterEach, describe, it, expect, vi } from 'vitest'

import { BINANCE_INTERVAL_PERIODS, BinanceDatafeed, binanceStreamName, parseAggTrades, parseKlines, parseTradeMessage, toBinanceInterval, toBinanceSymbol, precisionFromStep, parseExchangeInfo } from './binance'
import { isSecondPeriod } from './tradeBars'

// https://api.binance.com/api/v3/klines rows (strings for prices/volumes)
const fixture = [
  [1700000000000, '36500.10', '36600.00', '36400.50', '36550.20', '120.5', 1700000059999, '4400000.1', 900, '0', '0', '0'],
  [1700000060000, '36550.20', '36700.00', '36500.00', '36680.90', '98.2', 1700000119999, '3600000.0', 750, '0', '0', '0']
]

describe('binance datafeed', () => {
  it('parses kline rows into ascending KLineData', () => {
    const bars = parseKlines(fixture)
    expect(bars).toHaveLength(2)
    expect(bars[0]).toEqual({
      timestamp: 1700000000000,
      open: 36500.1,
      high: 36600,
      low: 36400.5,
      close: 36550.2,
      volume: 120.5
    })
    expect(bars.map(b => b.timestamp)).toEqual([...bars.map(b => b.timestamp)].sort((a, b) => a - b))
  })

  it('drops rows with non-finite timestamps', () => {
    expect(parseKlines([[undefined, '1', '1', '1', '1', '1']])).toHaveLength(0)
  })

  it('maps periods to binance intervals', () => {
    expect(toBinanceInterval({ multiplier: 1, timespan: 'second', text: '1s' })).toBe('1s')
    expect(toBinanceInterval({ multiplier: 15, timespan: 'minute', text: '15m' })).toBe('15m')
    expect(toBinanceInterval({ multiplier: 4, timespan: 'hour', text: '4h' })).toBe('4h')
    expect(toBinanceInterval({ multiplier: 1, timespan: 'week', text: '1w' })).toBe('1w')
    expect(toBinanceInterval({ multiplier: 1, timespan: 'month', text: '1M' })).toBe('1M')
  })

  it('lists 1s first among the supported intervals', () => {
    expect(isSecondPeriod(BINANCE_INTERVAL_PERIODS[0])).toBe(true)
  })

  it('maps symbols to USDT pairs', () => {
    expect(toBinanceSymbol({ ticker: 'BTC' })).toBe('BTCUSDT')
    expect(toBinanceSymbol({ ticker: 'XRP' })).toBe('XRPUSDT')
    expect(toBinanceSymbol({ ticker: 'BTCUSDT' })).toBe('BTCUSDT')
    expect(toBinanceSymbol({ ticker: 'ETH/USDT' })).toBe('ETHUSDT')
  })
})

describe('binance 1s (trade-derived)', () => {
  // Spot @trade payload (USDT-M @aggTrade carries the same p/q/T fields).
  const trade = { e: 'trade', E: 1793621829990, s: 'BTCUSDT', t: 1, p: '78040.01000000', q: '0.00129000', T: 1793621829989, m: false }

  it('parses trade payloads into ticks', () => {
    expect(parseTradeMessage(trade)).toEqual({ price: 78040.01, size: 0.00129, time: 1793621829989 })
    expect(parseTradeMessage({ p: 'x', q: '1', T: 1 })).toBeNull()
    expect(parseTradeMessage({ p: '1', q: '1' })).toBeNull()
  })

  it('parses /aggTrades rows into ticks', () => {
    const rows = [['6811396211', '6811396211', '78040.01000000', '0.00100000', '78041.00000000', '0.00200000', 1793621829989, 'Q', 'B']]
    expect(parseAggTrades(rows)).toEqual([{ price: 78041, size: 0.002, time: 1793621829989 }])
    expect(parseAggTrades([[]])).toEqual([])
  })

  it('routes the WS stream: klines above 1s, trades at 1s', () => {
    expect(binanceStreamName('BTCUSDT', '1m')).toBe('btcusdt@kline_1m')
    expect(binanceStreamName('BTCUSDT', '15m')).toBe('btcusdt@kline_15m')
    expect(binanceStreamName('BTCUSDT', '1s')).toBe('btcusdt@trade')
    expect(binanceStreamName('BTCUSDT', '1s', 'usdm')).toBe('btcusdt@aggTrade')
    expect(binanceStreamName('BTCUSDT', '5m', 'usdm')).toBe('btcusdt@kline_5m')
  })
})

describe('binance metadata (search/resolve)', () => {
  it('counts decimals in step/tick strings', () => {
    expect(precisionFromStep('0.01000000')).toBe(2)
    expect(precisionFromStep('0.00100000')).toBe(3)
    expect(precisionFromStep('1.00000000')).toBe(0)
    expect(precisionFromStep('1')).toBe(0)
  })

  it('parses exchangeInfo into tradable symbols with tick/lot precision', () => {
    const info = {
      symbols: [
        {
          symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT',
          isSpotTradingAllowed: true,
          filters: [
            { filterType: 'PRICE_FILTER', tickSize: '0.01000000' },
            { filterType: 'LOT_SIZE', stepSize: '0.00001000' }
          ]
        },
        { symbol: 'BTCUSDC', status: 'BREAK', baseAsset: 'BTC', quoteAsset: 'USDC' },
        { symbol: 'ETHUSDT', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT', isSpotTradingAllowed: false },
        { symbol: 'NOFILTER', status: 'TRADING', baseAsset: 'N', quoteAsset: 'F' }
      ]
    }
    const meta = parseExchangeInfo(info, 'spot')
    expect(meta.map(m => m.ticker)).toEqual(['BTCUSDT', 'NOFILTER'])
    expect(meta[0]).toEqual({
      ticker: 'BTCUSDT', base: 'BTC', quote: 'USDT',
      pricePrecision: 2, volumePrecision: 5, minPriceDelta: 0.01
    })
  })
})

describe('binance history paging', () => {
  const SYMBOL = { ticker: 'BTCUSDT', exchange: 'BINANCE', pricePrecision: 2, volumePrecision: 3 }
  const MINUTE = { multiplier: 1, timespan: 'minute', text: '1m' }

  afterEach(() => { vi.unstubAllGlobals() })

  it('keeps requesting until the window is exhausted', async () => {
    const row = (t: number) => [t, '1', '2', '0.5', '1.5', '3', t + 59_999, '4', 5, '0', '0', '0']
    const pages = [Array.from({ length: 500 }, (_, i) => row(i * 60_000)), [row(500 * 60_000), row(501 * 60_000)]]
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => pages[urls.length - 1] }
    }))
    const bars = await new BinanceDatafeed('spot').getHistoryKLineData(SYMBOL, MINUTE, 0, 600 * 60_000)
    expect(bars).toHaveLength(502)
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain(`startTime=${499 * 60_000 + 1}`)
  })
})

describe('binance listeners', () => {
  const SYMBOL = { ticker: 'BTCUSDT', exchange: 'BINANCE', pricePrecision: 2, volumePrecision: 3 }
  const FOUR_HOURS = { multiplier: 4, timespan: 'hour', text: '4h' }

  class FakeSocket {
    static OPEN = 1
    static all: FakeSocket[] = []
    readyState = 1
    onmessage?: (event: { data: string }) => void
    onclose?: (() => void) | null
    constructor () { FakeSocket.all.push(this) }
    close (): void { this.readyState = 3 }
    kline (t: number): void {
      this.onmessage?.({ data: JSON.stringify({ e: 'kline', k: { t, o: '1', h: '2', l: '1', c: '2', v: '3' } }) })
    }
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('shares one socket and closes it after the last listener leaves', () => {
    FakeSocket.all = []
    vi.stubGlobal('WebSocket', FakeSocket)
    const feed = new BinanceDatafeed('spot')
    const study: number[] = []
    const chart: number[] = []
    const onStudy = (bar: { timestamp: number }): void => { study.push(bar.timestamp) }
    const onChart = (bar: { timestamp: number }): void => { chart.push(bar.timestamp) }
    feed.subscribe(SYMBOL, FOUR_HOURS, onStudy)
    feed.subscribe(SYMBOL, FOUR_HOURS, onChart)
    expect(FakeSocket.all).toHaveLength(1)
    const socket = FakeSocket.all[0]
    socket.kline(1)
    feed.unsubscribe(SYMBOL, FOUR_HOURS, onStudy)
    socket.kline(2)
    expect(study).toEqual([1])
    expect(chart).toEqual([1, 2])
    expect(socket.readyState).toBe(1)
    feed.unsubscribe(SYMBOL, FOUR_HOURS, onChart)
    expect(socket.readyState).toBe(3)
  })
})
