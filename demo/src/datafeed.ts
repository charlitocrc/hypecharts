/**
 * Demo feed wiring: one composite datafeed over every reachable venue, so the
 * chart is built once and symbol switches are just `setSymbol('VENUE:SYMBOL')`.
 * Each venue is probed once; a venue that fails the probe (geo-block, offline)
 * is left out of the routes and surfaced to the UI. If nothing is reachable the
 * page falls back to a synthetic random walk routed under HYPERLIQUID keys.
 */
import type { Datafeed, KLineData } from '../../src'
import { BinanceDatafeed, HyperliquidDatafeed, createAggregatingDatafeed, createCompositeDatafeed } from '../../src'
import type { CompositeRoute } from '../../src'
import type { DatafeedSubscribeCallback, Period, SymbolInfo } from '../../src/types'

/** Custom intervals served by client-side aggregation (UX-002). */
export const DEMO_CUSTOM_PERIODS: Period[] = [
  { multiplier: 2, timespan: 'minute', text: '2m' },
  { multiplier: 3, timespan: 'minute', text: '3m' },
  { multiplier: 12, timespan: 'hour', text: '12h' }
]

export interface DemoFeed {
  datafeed: Datafeed
  /** Venue keys with a live route, e.g. ['HYPERLIQUID', 'BINANCE']. */
  venues: string[]
  label: string
}

async function probe (url: string, init: RequestInit): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) return false
    await response.json()
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'

const hlProbe = () => probe(HL_INFO_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'candleSnapshot',
    req: { coin: 'BTC', interval: '15m', startTime: Date.now() - 3600e3, endTime: Date.now() }
  })
})

const binanceProbe = () => probe(
  `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&startTime=${Date.now() - 3600e3}&endTime=${Date.now()}&limit=1`
)

export async function createDemoFeed (): Promise<DemoFeed> {
  const [hlOk, binanceOk] = await Promise.all([hlProbe(), binanceProbe()])
  const routes: CompositeRoute[] = []
  if (hlOk) routes.push({ feed: new HyperliquidDatafeed(), exchanges: ['HYPERLIQUID'] })
  if (binanceOk) routes.push({ feed: new BinanceDatafeed('spot'), exchanges: ['BINANCE'] })

  if (routes.length > 0) {
    return {
      // UX-002: the aggregator layers custom intervals (2m/3m/12h plus anything
      // built in the period menu) over the composite's native series.
      datafeed: createAggregatingDatafeed(createCompositeDatafeed(routes), { customPeriods: DEMO_CUSTOM_PERIODS }),
      venues: routes.flatMap(route => route.exchanges),
      label: `LIVE · ${routes.map(route => route.exchanges[0] === 'HYPERLIQUID' ? 'Hyperliquid' : 'Binance').join(' + ')}`
    }
  }
  return {
    datafeed: createAggregatingDatafeed(
      createCompositeDatafeed([{ feed: new SyntheticDatafeed(), exchanges: ['HYPERLIQUID'] }]),
      { customPeriods: DEMO_CUSTOM_PERIODS }
    ),
    venues: [],
    label: 'SIMULATED · venues unreachable'
  }
}

/* ---------------- offline random-walk fallback ---------------- */

interface SyntheticSeries {
  bars: KLineData[]
  barMs: number
  rng: () => number
}

function hashSeed (text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32 (seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BASE_PRICES: Record<string, number> = {
  BTC: 68000, ETH: 3200, SOL: 165, DOGE: 0.16, XRP: 0.6
}

/** Random-walk feed so the demo always works, online or not. */
export class SyntheticDatafeed implements Datafeed {
  private series = new Map<string, SyntheticSeries>()
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private subs = new Map<string, DatafeedSubscribeCallback>()

  private ensure (symbol: SymbolInfo, period: Period): SyntheticSeries {
    const key = `${symbol.ticker}|${period.text}`
    let entry = this.series.get(key)
    if (entry) return entry

    const unitMs: Record<string, number> = { second: 1e3, minute: 60e3, hour: 3600e3, day: 86400e3, week: 604800e3, month: 2592000e3 }
    const barMs = (unitMs[period.timespan] ?? 60e3) * period.multiplier
    const rng = mulberry32(hashSeed(key))
    const base = BASE_PRICES[symbol.ticker] ?? 100
    const vol = 0.004

    const count = 2000
    const lastOpen = Math.floor(Date.now() / barMs) * barMs
    const bars: KLineData[] = []
    let close = base * (0.8 + rng() * 0.4)
    for (let i = count - 1; i >= 0; i--) {
      const timestamp = lastOpen - i * barMs
      const open = close
      const drift = (rng() - 0.5) * 2 * vol
      close = open * (1 + drift)
      const high = Math.max(open, close) * (1 + rng() * vol)
      const low = Math.min(open, close) * (1 - rng() * vol)
      bars.push({ timestamp, open, high, low, close, volume: 50 + rng() * 500 })
    }
    entry = { bars, barMs, rng }
    this.series.set(key, entry)
    return entry
  }

  async getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
    const entry = this.ensure(symbol, period)
    while (entry.bars[0].timestamp > from) {
      const first = entry.bars[0]
      const open = first.open
      const close = open * (1 + (entry.rng() - 0.5) * 0.008)
      entry.bars.unshift({
        timestamp: first.timestamp - entry.barMs,
        open,
        high: Math.max(open, close) * 1.002,
        low: Math.min(open, close) * 0.998,
        close,
        volume: 50 + entry.rng() * 500
      })
    }
    return entry.bars.filter(k => k.timestamp >= from && k.timestamp <= to)
  }

  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    const key = `${symbol.ticker}|${period.text}`
    const entry = this.ensure(symbol, period)
    this.subs.set(key, callback)
    if (this.timers.has(key)) return
    const timer = setInterval(() => {
      const last = entry.bars[entry.bars.length - 1]
      const now = Date.now()
      if (now >= last.timestamp + entry.barMs) {
        entry.bars.push({
          timestamp: last.timestamp + entry.barMs,
          open: last.close,
          high: last.close,
          low: last.close,
          close: last.close,
          volume: 1
        })
      } else {
        const move = (entry.rng() - 0.5) * 0.0015
        last.close = last.close * (1 + move)
        last.high = Math.max(last.high, last.close)
        last.low = Math.min(last.low, last.close)
        last.volume += entry.rng() * 4
      }
      this.subs.get(key)?.(last)
    }, 400)
    this.timers.set(key, timer)
  }

  unsubscribe (symbol: SymbolInfo, period: Period): void {
    const key = `${symbol.ticker}|${period.text}`
    this.subs.delete(key)
    const timer = this.timers.get(key)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(key)
    }
  }
}
