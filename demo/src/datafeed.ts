/**
 * Demo feed wiring: one composite datafeed over every reachable venue, so the
 * chart is built once and symbol switches are just `setSymbol('VENUE:SYMBOL')`.
 * Each venue is probed once; the initial workspace waits only for its venues.
 * A venue that fails the probe (geo-block, offline)
 * is left out of the routes and surfaced to the UI. If nothing is reachable the
 * page falls back to a synthetic random walk routed under HYPERLIQUID keys.
 */
import type { KLineData } from 'klinecharts'
import { BinanceDatafeed } from '../../src/datafeeds/binance'
import { HyperliquidDatafeed } from '../../src/datafeeds/hyperliquid'
import { createAggregatingDatafeed } from '../../src/datafeeds/aggregate'
import { createCompositeDatafeed } from '../../src/datafeeds/composite'
import type { Datafeed } from '../../src/types'
import type { DatafeedSubscribeCallback, Period, SymbolInfo } from '../../src/types'

/** Custom intervals served by client-side aggregation (UX-002). */
export const DEMO_CUSTOM_PERIODS: Period[] = [
  { multiplier: 2, timespan: 'minute', text: '2m' },
  { multiplier: 3, timespan: 'minute', text: '3m' },
  { multiplier: 12, timespan: 'hour', text: '12h' }
]

export interface DemoFeedStatus {
  /** Venue keys with a live route, e.g. ['HYPERLIQUID', 'BINANCE']. */
  venues: string[]
  label: string
}

export interface DemoFeed extends DemoFeedStatus {
  datafeed: Datafeed
  /** Final availability, including venues not needed by the initial workspace. */
  discoveryComplete: Promise<DemoFeedStatus>
}

async function probe (url: string, init: RequestInit = {}): Promise<boolean> {
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

export async function createDemoFeed (requiredVenues: string[] = ['HYPERLIQUID']): Promise<DemoFeed> {
  const composite = createCompositeDatafeed()
  const available = new Set<string>()
  const probes = new Map([
    ['HYPERLIQUID', hlProbe().then(ok => {
      if (ok) { composite.addRoute({ feed: new HyperliquidDatafeed(), exchanges: ['HYPERLIQUID'] }); available.add('HYPERLIQUID') }
      return ok
    })],
    ['BINANCE', binanceProbe().then(ok => {
      if (ok) { composite.addRoute({ feed: new BinanceDatafeed('spot'), exchanges: ['BINANCE'] }); available.add('BINANCE') }
      return ok
    })]
  ])
  const status = (): DemoFeedStatus => {
    // Stable ordering independent of which probe completed first.
    const venues = ['HYPERLIQUID', 'BINANCE'].filter(venue => available.has(venue))
    return { venues, label: venues.length
      ? `LIVE · ${venues.map(venue => venue === 'HYPERLIQUID' ? 'Hyperliquid' : 'Binance').join(' + ')}`
      : 'SIMULATED · venues unreachable' }
  }
  const discoveryComplete = Promise.all(probes.values()).then(status)
  const required = [...new Set(requiredVenues.map(venue => venue.toUpperCase()))]
  const ready = await Promise.all((required.length ? required : ['HYPERLIQUID']).map(venue => probes.get(venue) ?? Promise.resolve(false)))
  // A failed required venue needs full discovery before choosing a fallback.
  // A healthy selected venue never waits for an unrelated venue's timeout.
  if (ready.some(ok => !ok)) await discoveryComplete

  if (available.size > 0) {
    // Discovery/search still see every reachable venue. Config waits before the
    // aggregation wrapper caches the intersection of the venues' intervals.
    const completeFeed: Datafeed = {
      ...composite,
      config: async () => { await discoveryComplete; return composite.config() },
      searchSymbols: async (query, filters) => { await discoveryComplete; return composite.searchSymbols(query, filters) },
      resolveSymbol: async name => {
        const venue = name.split(':')[0].toUpperCase()
        await (probes.get(venue) ?? discoveryComplete)
        return composite.resolveSymbol(name)
      }
    }
    return {
      // UX-002: the aggregator layers custom intervals (2m/3m/12h plus anything
      // built in the period menu) over the composite's native series.
      datafeed: createAggregatingDatafeed(completeFeed, { customPeriods: DEMO_CUSTOM_PERIODS }),
      ...status(), discoveryComplete
    }
  }
  return {
    datafeed: createAggregatingDatafeed(
      createCompositeDatafeed([{ feed: new SyntheticDatafeed(), exchanges: ['HYPERLIQUID'] }]),
      { customPeriods: DEMO_CUSTOM_PERIODS }
    ),
    venues: [],
    label: 'SIMULATED · venues unreachable', discoveryComplete
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
        last.volume = (last.volume ?? 0) + entry.rng() * 4
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
