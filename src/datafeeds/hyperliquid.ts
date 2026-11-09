/**
 * Hyperliquid datafeed — public REST + WebSocket market data, no API key.
 *
 * REST:  POST /info { type: 'candleSnapshot', req: { coin, interval, startTime, endTime } }
 *        POST /info { type: 'recentTrades', coin }                (1s seed: ~latest trades only)
 * WS:    { method: 'subscribe', subscription: { type: 'candle', coin, interval } }
 *        { method: 'subscribe', subscription: { type: 'trades', coin } }
 *
 * Candles are bar-open aligned, millisecond timestamps. The snapshot endpoint
 * returns objects ({ t, o, h, l, c, v }); the legacy array form is accepted too.
 *
 * Hyperliquid serves no sub-minute candles, so 1s charts are built from the
 * trades WS aggregated into second buckets (tradeBars.ts), seeded by the
 * recentTrades REST page (which caps at the latest handful of trades — the
 * series grows live from connection).
 */
import type { KLineData } from 'klinecharts'
import type {
  Datafeed, DatafeedConfiguration, DatafeedSubscribeCallback, Period,
  SymbolInfo, SymbolSearchFilters, SymbolSearchResult
} from '../types'
import { isCalendar } from '../aggregate'
import { parseSymbolName } from '../symbolSelect'
import { createAggregatingDatafeed } from './aggregate'
import { SECOND_PERIOD, TradeBarBuilder, barsFromTrades, isSecondIntervalText, isSecondPeriod } from './tradeBars'
import type { TradeTick } from './tradeBars'

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws'

export const HL_EXCHANGE = 'HYPERLIQUID'

const UNIT_TO_INTERVAL: Record<string, string> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
  month: 'M'
}

/** Candle intervals Hyperliquid serves, in ascending order. */
export const HL_CANDLE_PERIODS: Period[] = [
  { multiplier: 1, timespan: 'minute', text: '1m' },
  { multiplier: 3, timespan: 'minute', text: '3m' },
  { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m' },
  { multiplier: 30, timespan: 'minute', text: '30m' },
  { multiplier: 1, timespan: 'hour', text: '1h' },
  { multiplier: 2, timespan: 'hour', text: '2h' },
  { multiplier: 4, timespan: 'hour', text: '4h' },
  { multiplier: 8, timespan: 'hour', text: '8h' },
  { multiplier: 12, timespan: 'hour', text: '12h' },
  { multiplier: 1, timespan: 'day', text: '1d' },
  { multiplier: 3, timespan: 'day', text: '3d' },
  { multiplier: 1, timespan: 'week', text: '1w' },
  { multiplier: 1, timespan: 'month', text: '1M' }
]

/** Everything the period bar offers: 1s (trade-derived) plus the candle intervals. */
export const HL_INTERVAL_PERIODS: Period[] = [SECOND_PERIOD, ...HL_CANDLE_PERIODS]

export function toHlInterval (period: Period): string {
  const unit = UNIT_TO_INTERVAL[period.timespan] ?? 'm'
  return `${period.multiplier}${unit}`
}

export function parseCandleSnapshot (rows: unknown[]): KLineData[] {
  return (rows as unknown[])
    .map(row => {
      if (Array.isArray(row)) {
        return {
          timestamp: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5])
        }
      }
      const r = row as Record<string, unknown>
      return {
        timestamp: Number(r.t),
        open: Number(r.o),
        high: Number(r.h),
        low: Number(r.l),
        close: Number(r.c),
        volume: Number(r.v)
      }
    })
    .filter(k => Number.isFinite(k.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
}

/** recentTrades rows / trades WS entries ({px, sz, time}) → ticks. */
export function parseHlTrade (row: Record<string, unknown>): TradeTick | null {
  const price = Number(row?.px)
  const size = Number(row?.sz)
  const time = Number(row?.time)
  if (!Number.isFinite(price) || !Number.isFinite(time)) return null
  return { price, size, time }
}

/** WS subscription body for a `coin|interval` key: trades for 1s, candles otherwise. */
export function hlSubscription (coin: string, interval: string): Record<string, unknown> {
  return isSecondIntervalText(interval)
    ? { type: 'trades', coin }
    : { type: 'candle', coin, interval }
}

export interface HlMetaAsset {
  name: string
  szDecimals?: number
}

/** `POST /info {type:'meta'}` → `{ universe: [{ name, szDecimals }] }` rows. */
export function parseHlUniverse (meta: unknown): HlMetaAsset[] {
  const universe = (meta as { universe?: unknown } | null)?.universe
  if (!Array.isArray(universe)) return []
  return universe
    .map((row: any) => ({ name: typeof row?.name === 'string' ? row.name : '', szDecimals: Number(row?.szDecimals) }))
    .filter(asset => asset.name.length > 0)
}

/** Hyperliquid tick is 10^-(6 - szDecimals); express that as price precision digits. */
export function hlPricePrecision (szDecimals: number): number {
  return Math.min(6, Math.max(0, 6 - szDecimals))
}

const symbolInfoFor = (asset: HlMetaAsset): SymbolInfo => ({
  ticker: asset.name,
  name: asset.name,
  shortName: `${asset.name}-PERP`,
  description: `${asset.name} perpetual`,
  exchange: HL_EXCHANGE,
  market: 'perp',
  type: 'crypto',
  pricePrecision: hlPricePrecision(asset.szDecimals ?? 2),
  volumePrecision: 2,
  session: '24x7',
  timezone: 'Etc/UTC',
  intervals: HL_INTERVAL_PERIODS,
  dataStatus: 'streaming'
})

function subKey (symbol: SymbolInfo, period: Period): string {
  return `${symbol.ticker}|${toHlInterval(period)}`
}

export class HyperliquidDatafeed implements Datafeed {
  private ws: WebSocket | null = null
  private subs = new Map<string, DatafeedSubscribeCallback>()
  private builders = new Map<string, TradeBarBuilder>()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private universe: Promise<HlMetaAsset[]> | null = null
  /** The calendar builder's 1d streams, kept apart so a chart can also stream 1d. */
  private calendarStreams = new Map<string, DatafeedSubscribeCallback>()
  /** Native 1w opens Thursday and 1M every 30 days, so both are rebuilt from 1d. */
  private calendar = createAggregatingDatafeed({
    getHistoryKLineData: (symbol, period, from, to) => this.getCandles(symbol, period, from, to),
    subscribe: (symbol, period, callback) => {
      const key = subKey(symbol, period)
      const streaming = this.streamKeys().has(key)
      this.calendarStreams.set(key, callback)
      if (!streaming) this.openStream(key)
    },
    unsubscribe: (symbol, period) => {
      const key = subKey(symbol, period)
      this.calendarStreams.delete(key)
      this.closeStream(key)
    },
    config: async () => ({ exchanges: [], intervals: [{ multiplier: 1, timespan: 'day', text: '1d' }] })
  })

  constructor () {
    void this.calendar.config()
  }

  config (): Promise<DatafeedConfiguration> {
    return Promise.resolve({
      exchanges: [{ key: HL_EXCHANGE, name: 'Hyperliquid', markets: ['perp'] }],
      symbolTypes: [{ key: 'crypto' }],
      intervals: HL_INTERVAL_PERIODS,
      searchDelayMs: 250
    })
  }

  searchSymbols (query: string, filters?: SymbolSearchFilters): Promise<SymbolSearchResult[]> {
    if (filters?.exchange !== undefined && filters.exchange !== HL_EXCHANGE) return Promise.resolve([])
    return this.loadUniverse().then(universe => {
      const search = query.trim().toLowerCase()
      const display = (asset: HlMetaAsset): SymbolSearchResult => {
        const info = symbolInfoFor(asset)
        return {
          ticker: info.ticker,
          symbol: info.shortName,
          description: info.description,
          exchange: HL_EXCHANGE,
          market: info.market,
          type: info.type
        }
      }
      const matched = universe
        .filter(asset => search === '' || asset.name.toLowerCase().includes(search))
        .map(display)
      // Prefix matches first, so 'btc' ranks BTC above ABTC.
      const keyed = matched.map(result => {
        const ticker = result.ticker.toLowerCase()
        return { result, prefix: search !== '' && ticker.startsWith(search) }
      })
      keyed.sort((a, b) => a.prefix === b.prefix
        ? a.result.ticker.localeCompare(b.result.ticker)
        : (a.prefix ? -1 : 1))
      return keyed.slice(0, filters?.limit ?? 50).map(item => item.result)
    })
  }

  resolveSymbol (name: string): Promise<SymbolInfo> {
    const parsed = parseSymbolName(name)
    if (parsed.exchange !== undefined && parsed.exchange !== HL_EXCHANGE) {
      return Promise.reject({ name, code: 'unknown_exchange' })
    }
    // Display form 'BTC-PERP' resolves back to the venue-native ticker.
    const ticker = parsed.ticker.replace(/-PERP$/i, '')
    return this.loadUniverse().then(universe => {
      const asset = universe.find(candidate => candidate.name.toLowerCase() === ticker.toLowerCase())
      if (!asset) {
        return Promise.reject({ name, code: 'unknown_symbol' })
      }
      return symbolInfoFor(asset)
    })
  }

  private loadUniverse (): Promise<HlMetaAsset[]> {
    if (!this.universe) {
      this.universe = fetch(HL_INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'meta' })
      }).then(async response => {
        if (!response.ok) {
          throw new Error(`Hyperliquid meta failed: ${response.status}`)
        }
        return parseHlUniverse(await response.json())
      }).catch(error => {
        // Retry the next search after a failed metadata load.
        this.universe = null
        throw error
      })
    }
    return this.universe
  }

  async getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
    if (isSecondPeriod(period)) return this.getSecondHistory(symbol, from, to)
    if (isCalendar(period)) return this.calendar.getHistoryKLineData(symbol, period, from, to)
    return this.getCandles(symbol, period, from, to)
  }

  private async getCandles (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
    const response = await fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin: symbol.ticker, interval: toHlInterval(period), startTime: from, endTime: to }
      })
    })
    if (!response.ok) {
      throw new Error(`Hyperliquid history failed: ${response.status}`)
    }
    const rows = await response.json()
    if (!Array.isArray(rows)) return []
    return parseCandleSnapshot(rows).filter(k => k.timestamp >= from && k.timestamp <= to)
  }

  /** 1s seed: the recentTrades page caps at the latest handful of trades; the rest grows live. */
  private async getSecondHistory (symbol: SymbolInfo, from: number, to: number): Promise<KLineData[]> {
    const response = await fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recentTrades', coin: symbol.ticker })
    })
    if (!response.ok) {
      throw new Error(`Hyperliquid recentTrades failed: ${response.status}`)
    }
    const rows = await response.json()
    const trades = (Array.isArray(rows) ? rows : [])
      .map(row => parseHlTrade(row as Record<string, unknown>))
      .filter((tick): tick is TradeTick => tick !== null)
    return barsFromTrades(trades)
      .filter(k => k.timestamp >= from && k.timestamp <= to)
  }

  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    if (isCalendar(period)) {
      this.calendar.subscribe(symbol, period, callback)
      return
    }
    const key = subKey(symbol, period)
    const streaming = this.streamKeys().has(key)
    this.subs.set(key, callback)
    if (!streaming) this.openStream(key)
  }

  unsubscribe (symbol: SymbolInfo, period: Period): void {
    if (isCalendar(period)) {
      this.calendar.unsubscribe(symbol, period)
      return
    }
    const key = subKey(symbol, period)
    this.subs.delete(key)
    this.builders.delete(key)
    this.closeStream(key)
  }

  private streamKeys (): Set<string> {
    return new Set([...this.subs.keys(), ...this.calendarStreams.keys()])
  }

  private openStream (key: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.connect()
      return
    }
    const [coin, interval] = key.split('|')
    this.ws.send(JSON.stringify({ method: 'subscribe', subscription: hlSubscription(coin, interval) }))
  }

  /** Drop the venue stream once nothing listens to `key`; close the socket once idle. */
  private closeStream (key: string): void {
    const keys = this.streamKeys()
    if (!keys.has(key) && this.ws?.readyState === WebSocket.OPEN) {
      const [coin, interval] = key.split('|')
      this.ws.send(JSON.stringify({ method: 'unsubscribe', subscription: hlSubscription(coin, interval) }))
    }
    if (keys.size === 0) this.closeWs()
  }

  destroy (): void {
    this.destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.subs.clear()
    this.calendarStreams.clear()
    this.builders.clear()
    this.closeWs()
  }

  private connect (): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return

    const ws = new WebSocket(HL_WS_URL)
    this.ws = ws

    ws.onopen = () => {
      this.startPing()
      this.streamKeys().forEach(key => {
        const [coin, interval] = key.split('|')
        ws.send(JSON.stringify({ method: 'subscribe', subscription: hlSubscription(coin, interval) }))
      })
    }

    ws.onmessage = event => {
      let msg: { channel?: string; data?: unknown }
      try { msg = JSON.parse(event.data) } catch { return }
      if (msg?.channel === 'trades' && Array.isArray(msg.data)) {
        for (const row of msg.data as Record<string, unknown>[]) {
          const trade = parseHlTrade(row)
          if (!trade) continue
          const key = `${row?.coin}|1s`
          const builder = this.builders.get(key) ?? this.builders.set(key, new TradeBarBuilder()).get(key)
          const callback = this.subs.get(key)
          if (!builder || !callback) continue
          const bar = builder.push(trade)
          if (bar) callback(bar)
        }
        return
      }
      if (msg?.channel !== 'candle' || !msg.data) return
      const d = msg.data as Record<string, unknown>
      const key = `${d.s}|${d.i}`
      const bar: KLineData = {
        timestamp: Number(d.t),
        open: Number(d.o),
        high: Number(d.h),
        low: Number(d.l),
        close: Number(d.c),
        volume: Number(d.v)
      }
      this.subs.get(key)?.(bar)
      this.calendarStreams.get(key)?.({ ...bar })
    }

    ws.onclose = () => {
      this.stopPing()
      if (this.destroyed || this.streamKeys().size === 0) return
      this.reconnectTimer = setTimeout(() => this.connect(), 2000)
    }
  }

  private startPing (): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method: 'ping' }))
    }, 30000)
  }

  private stopPing (): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private closeWs (): void {
    this.stopPing()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
  }
}
