/**
 * Binance datafeed — public market data, no API key.
 *
 * REST:  GET /api/v3/klines        (spot)      https://api.binance.com
 *        GET /fapi/v1/klines       (USDT-M)    https://fapi.binance.com
 * WS:    /ws/<symbol>@kline_<interval>         wss://stream.binance.com:9443 (spot)
 *                                              wss://fstream.binance.com     (USDT-M)
 *
 * Klines are bar-open aligned, millisecond timestamps, returned as arrays:
 * [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, ...].
 * History paging is capped at 500 bars per request (Binance allows up to 1000).
 *
 * 1s charts have no kline stream on either market; they are built from the
 * trades WS (`@trade` spot, `@aggTrade` USDT-M) aggregated into second buckets
 * (tradeBars.ts). Spot history comes from the real `interval=1s` klines REST;
 * USDT-M history is the latest aggTrades page aggregated the same way.
 */
import type { KLineData } from 'klinecharts'
import type {
  Datafeed, DatafeedConfiguration, DatafeedSubscribeCallback, Period,
  SymbolInfo, SymbolSearchFilters, SymbolSearchResult
} from '../types'
import { parseSymbolName } from '../symbolSelect'
import { SECOND_PERIOD, TradeBarBuilder, barsFromTrades, isSecondIntervalText, isSecondPeriod } from './tradeBars'
import type { TradeTick } from './tradeBars'

const HISTORY_PAGE_SIZE = 500
const REST_BASE = { spot: 'https://api.binance.com', usdm: 'https://fapi.binance.com' } as const
const REST_PATH = { spot: '/api/v3/klines', usdm: '/fapi/v1/klines' } as const
const AGG_TRADES_PATH = { spot: '/api/v3/aggTrades', usdm: '/fapi/v1/aggTrades' } as const
const EXCHANGE_INFO_PATH = { spot: '/api/v3/exchangeInfo', usdm: '/fapi/v1/exchangeInfo' } as const
const WS_BASE = { spot: 'wss://stream.binance.com:9443', usdm: 'wss://fstream.binance.com' } as const

export type BinanceMarket = keyof typeof REST_BASE

export const BINANCE_EXCHANGE = 'BINANCE'

const UNIT_TO_INTERVAL: Record<string, string> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
  month: 'M'
}

/** Every interval Binance serves, in ascending order; 1s is trade-derived. */
export const BINANCE_INTERVAL_PERIODS: Period[] = [
  SECOND_PERIOD,
  { multiplier: 1, timespan: 'minute', text: '1m' },
  { multiplier: 3, timespan: 'minute', text: '3m' },
  { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m' },
  { multiplier: 30, timespan: 'minute', text: '30m' },
  { multiplier: 1, timespan: 'hour', text: '1h' },
  { multiplier: 2, timespan: 'hour', text: '2h' },
  { multiplier: 4, timespan: 'hour', text: '4h' },
  { multiplier: 6, timespan: 'hour', text: '6h' },
  { multiplier: 8, timespan: 'hour', text: '8h' },
  { multiplier: 12, timespan: 'hour', text: '12h' },
  { multiplier: 1, timespan: 'day', text: '1d' },
  { multiplier: 3, timespan: 'day', text: '3d' },
  { multiplier: 1, timespan: 'week', text: '1w' },
  { multiplier: 1, timespan: 'month', text: '1M' }
]

export function toBinanceInterval (period: Period): string {
  const unit = UNIT_TO_INTERVAL[period.timespan] ?? 'm'
  return `${period.multiplier}${unit}`
}

/** `BTC` → `BTCUSDT`; a ticker that already carries its quote asset passes through. */
export function toBinanceSymbol (symbol: SymbolInfo, market: BinanceMarket = 'spot'): string {
  void market
  if (symbol.ticker.includes('/')) return symbol.ticker.replace('/', '')
  if (symbol.ticker.endsWith('USDT') || symbol.ticker.endsWith('USDC')) return symbol.ticker
  return `${symbol.ticker}USDT`
}

export function parseKlines (rows: unknown[]): KLineData[] {
  return (rows as unknown[])
    .map(row => {
      const r = row as unknown[]
      return {
        timestamp: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5])
      }
    })
    .filter(k => Number.isFinite(k.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
}

/** Spot `@trade` / USDT-M `@aggTrade` payloads → ticks: {p, q, T}. */
export function parseTradeMessage (msg: Record<string, unknown>): TradeTick | null {
  const price = Number(msg?.p)
  const size = Number(msg?.q)
  const time = Number(msg?.T)
  if (!Number.isFinite(price) || !Number.isFinite(time)) return null
  return { price, size, time }
}

/** `/aggTrades` REST rows → ticks (newest first, as the endpoint returns them). */
export function parseAggTrades (rows: unknown[]): TradeTick[] {
  return (rows as unknown[])
    .map(row => {
      const r = row as unknown[]
      const tick = parseTradeMessage({ p: r[4], q: r[5], T: r[6] })
      return tick
    })
    .filter((tick): tick is TradeTick => tick !== null)
}

/** WS stream for a subscription key: klines, except 1s which rides the trades feed. */
export function binanceStreamName (symbol: string, interval: string, market: BinanceMarket = 'spot'): string {
  const pair = symbol.toLowerCase()
  if (isSecondIntervalText(interval)) {
    return `${pair}@${market === 'spot' ? 'trade' : 'aggTrade'}`
  }
  return `${pair}@kline_${interval}`
}

/** Decimal places of a Binance step/tick string: '0.00100000' → 3. */
export function precisionFromStep (step: string): number {
  const trimmed = String(step).replace(/0+$/, '')
  const dot = trimmed.indexOf('.')
  return dot === -1 ? 0 : trimmed.length - dot - 1
}

export interface BinanceSymbolMeta {
  ticker: string
  base: string
  quote: string
  pricePrecision: number
  volumePrecision: number
  minPriceDelta: number
}

/** exchangeInfo → tradable symbols with precision derived from PRICE_FILTER/LOT_SIZE. */
export function parseExchangeInfo (info: unknown, market: BinanceMarket): BinanceSymbolMeta[] {
  const symbols = (info as { symbols?: unknown } | null)?.symbols
  if (!Array.isArray(symbols)) return []
  const out: BinanceSymbolMeta[] = []
  for (const raw of symbols as any[]) {
    if (raw?.status !== 'TRADING' || typeof raw.symbol !== 'string') continue
    if (market === 'spot' && raw.isSpotTradingAllowed === false) continue
    if (market === 'usdm' && raw.contractType !== undefined && raw.contractType !== 'PERPETUAL') continue
    let tickSize: string | undefined
    let stepSize: string | undefined
    if (Array.isArray(raw.filters)) {
      for (const filter of raw.filters) {
        if (filter?.filterType === 'PRICE_FILTER' && typeof filter.tickSize === 'string') tickSize = filter.tickSize
        if (filter?.filterType === 'LOT_SIZE' && typeof filter.stepSize === 'string') stepSize = filter.stepSize
      }
    }
    out.push({
      ticker: raw.symbol,
      base: typeof raw.baseAsset === 'string' ? raw.baseAsset : '',
      quote: typeof raw.quoteAsset === 'string' ? raw.quoteAsset : '',
      pricePrecision: precisionFromStep(tickSize ?? '0.01'),
      volumePrecision: precisionFromStep(stepSize ?? '0.001'),
      minPriceDelta: Number(tickSize ?? 0.01)
    })
  }
  return out.sort((a, b) => a.ticker.localeCompare(b.ticker))
}

export class BinanceDatafeed implements Datafeed {
  private sockets = new Map<string, WebSocket>()
  private retries = new Map<string, ReturnType<typeof setTimeout>>()
  private subs = new Map<string, Set<DatafeedSubscribeCallback>>()
  private builders = new Map<string, TradeBarBuilder>()
  private destroyed = false
  private metadata: Promise<BinanceSymbolMeta[]> | null = null

  constructor (private market: BinanceMarket = 'spot') {}

  config (): Promise<DatafeedConfiguration> {
    return Promise.resolve({
      exchanges: [{ key: BINANCE_EXCHANGE, name: 'Binance', markets: [this.market] }],
      symbolTypes: [{ key: 'crypto' }],
      intervals: BINANCE_INTERVAL_PERIODS,
      searchDelayMs: 250
    })
  }

  searchSymbols (query: string, filters?: SymbolSearchFilters): Promise<SymbolSearchResult[]> {
    if (filters?.exchange !== undefined && filters.exchange !== BINANCE_EXCHANGE) return Promise.resolve([])
    return this.loadMetadata().then(metadata => {
      const search = query.trim().toLowerCase()
      const matched = metadata
        .filter(meta => {
          if (search === '') return true
          return meta.ticker.toLowerCase().includes(search) || meta.base.toLowerCase().includes(search)
        })
        .map(meta => ({
          ticker: meta.ticker,
          symbol: meta.base,
          description: `${meta.base} / ${meta.quote}`,
          exchange: BINANCE_EXCHANGE,
          market: this.market,
          type: 'crypto'
        }))
      // Base-asset prefix matches first: 'btc' ranks BTCUSDT above USDTBTC.
      const keyed = matched.map(result => {
        const base = (result.symbol ?? '').toLowerCase()
        return { result, prefix: search !== '' && base.startsWith(search) }
      })
      keyed.sort((a, b) => a.prefix === b.prefix
        ? a.result.ticker.localeCompare(b.result.ticker)
        : (a.prefix ? -1 : 1))
      return keyed.slice(0, filters?.limit ?? 50).map(item => item.result)
    })
  }

  resolveSymbol (name: string): Promise<SymbolInfo> {
    const parsed = parseSymbolName(name)
    if (parsed.exchange !== undefined && parsed.exchange !== BINANCE_EXCHANGE) {
      return Promise.reject({ name, code: 'unknown_exchange' })
    }
    const upper = parsed.ticker.toUpperCase()
    return this.loadMetadata().then(metadata => {
      const meta = metadata.find(candidate =>
        candidate.ticker === upper || candidate.base === upper)
      if (!meta) {
        return Promise.reject({ name, code: 'unknown_symbol' })
      }
      return {
        ticker: meta.ticker,
        name: `${meta.base}/${meta.quote}`,
        shortName: meta.base,
        description: `${meta.base} / ${meta.quote}`,
        exchange: BINANCE_EXCHANGE,
        market: this.market,
        type: 'crypto',
        pricePrecision: meta.pricePrecision,
        volumePrecision: meta.volumePrecision,
        priceCurrency: meta.quote,
        minPriceDelta: meta.minPriceDelta,
        session: '24x7',
        timezone: 'Etc/UTC',
        intervals: BINANCE_INTERVAL_PERIODS,
        dataStatus: 'streaming'
      }
    })
  }

  private loadMetadata (): Promise<BinanceSymbolMeta[]> {
    if (!this.metadata) {
      this.metadata = fetch(`${REST_BASE[this.market]}${EXCHANGE_INFO_PATH[this.market]}`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Binance exchangeInfo failed: ${response.status}`)
          }
          return parseExchangeInfo(await response.json(), this.market)
        })
        .catch(error => {
          // Retry the next search after a failed metadata load.
          this.metadata = null
          throw error
        })
    }
    return this.metadata
  }

  async getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
    if (isSecondPeriod(period)) return this.getSecondHistory(symbol, from, to)
    // Built intervals can span more than one request's worth of base bars.
    const bars: KLineData[] = []
    let startTime = from
    while (true) {
      const url = `${REST_BASE[this.market]}${REST_PATH[this.market]
      }?symbol=${toBinanceSymbol(symbol, this.market)
      }&interval=${toBinanceInterval(period)}&startTime=${startTime}&endTime=${to}&limit=${HISTORY_PAGE_SIZE}`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Binance history failed: ${response.status}`)
      }
      const rows = await response.json()
      if (!Array.isArray(rows)) return bars
      const page = parseKlines(rows)
      bars.push(...page)
      if (page.length < HISTORY_PAGE_SIZE) return bars
      startTime = page[page.length - 1].timestamp + 1
    }
  }

  /** 1s history: real spot 1s klines; USDT-M has none, so aggregate the latest aggTrades page. */
  private async getSecondHistory (symbol: SymbolInfo, from: number, to: number): Promise<KLineData[]> {
    const pair = toBinanceSymbol(symbol, this.market)
    if (this.market === 'spot') {
      const url = `${REST_BASE.spot}${REST_PATH.spot}?symbol=${pair}&interval=1s&startTime=${from}&endTime=${to}&limit=500`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Binance history failed: ${response.status}`)
      }
      const rows = await response.json()
      return Array.isArray(rows) ? parseKlines(rows) : []
    }
    const url = `${REST_BASE.usdm}${AGG_TRADES_PATH.usdm}?symbol=${pair}&limit=1000`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Binance aggTrades failed: ${response.status}`)
    }
    const rows = await response.json()
    const trades = Array.isArray(rows) ? parseAggTrades(rows) : []
    return barsFromTrades(trades)
      .filter(k => k.timestamp >= from && k.timestamp <= to)
  }

  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    const key = `${toBinanceSymbol(symbol, this.market)}|${toBinanceInterval(period)}`
    const listeners = this.subs.get(key)
    if (listeners !== undefined) {
      listeners.add(callback)
      return
    }
    this.subs.set(key, new Set([callback]))
    this.connect(key)
  }

  unsubscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    const key = `${toBinanceSymbol(symbol, this.market)}|${toBinanceInterval(period)}`
    const listeners = this.subs.get(key)
    if (listeners?.delete(callback) !== true || listeners.size > 0) return
    this.subs.delete(key)
    this.builders.delete(key)
    const retry = this.retries.get(key)
    if (retry) clearTimeout(retry)
    this.retries.delete(key)
    const ws = this.sockets.get(key)
    if (ws) {
      ws.onclose = null
      ws.close()
      this.sockets.delete(key)
    }
  }

  destroy (): void {
    this.destroyed = true
    this.retries.forEach(timer => clearTimeout(timer))
    this.retries.clear()
    this.subs.clear()
    this.builders.clear()
    this.sockets.forEach(ws => {
      ws.onclose = null
      ws.close()
    })
    this.sockets.clear()
  }

  private connect (key: string): void {
    if (this.sockets.get(key)?.readyState === WebSocket.OPEN) return
    const [symbol, interval] = key.split('|')
    const ws = new WebSocket(`${WS_BASE[this.market]}/ws/${binanceStreamName(symbol, interval, this.market)}`)
    this.sockets.set(key, ws)
    if (isSecondIntervalText(interval) && !this.builders.has(key)) {
      this.builders.set(key, new TradeBarBuilder())
    }

    ws.onmessage = event => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(event.data) } catch { return }
      if (msg?.e === 'trade' || msg?.e === 'aggTrade') {
        const builder = this.builders.get(key)
        const listeners = this.subs.get(key)
        if (!builder || !listeners) return
        const tick = parseTradeMessage(msg)
        if (!tick) return
        const bar = builder.push(tick)
        if (bar) listeners.forEach(listener => { listener({ ...bar }) })
        return
      }
      if (msg?.e !== 'kline' || !msg.k) return
      const k = msg.k as Record<string, unknown>
      const bar: KLineData = {
        timestamp: Number(k.t),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v)
      }
      this.subs.get(key)?.forEach(listener => { listener({ ...bar }) })
    }

    ws.onclose = () => {
      this.sockets.delete(key)
      if (this.destroyed || !this.subs.has(key)) return
      this.retries.set(key, setTimeout(() => this.connect(key), 2000))
    }
  }
}
