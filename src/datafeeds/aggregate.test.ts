import { describe, expect, it, vi } from 'vitest'
import type { KLineData } from 'klinecharts'

import { createAggregatingDatafeed } from './aggregate'
import { periodDurationMs } from '../symbolSelect'
import type { Datafeed, DatafeedSubscribeCallback, Period, SymbolInfo, SymbolSearchResult } from '../types'

const MINUTE: Period = { multiplier: 1, timespan: 'minute', text: '1m' }
const THREE_M: Period = { multiplier: 3, timespan: 'minute', text: '3m' }
const SYMBOL: SymbolInfo = { ticker: 'BTC', exchange: 'HYPERLIQUID', pricePrecision: 1, volumePrecision: 2 }

interface RecordedFeedOptions {
  intervals?: Period[]
  history?: KLineData[]
}

/** Base feed that records every subscribe/unsubscribe and serves canned history. */
function recordedFeed (options: RecordedFeedOptions = {}): Datafeed & {
  subs: Map<string, DatafeedSubscribeCallback>
  historyCalls: Array<{ from: number, to: number }>
  emit (period: Period, bar: KLineData): void
} {
  const subs = new Map<string, DatafeedSubscribeCallback>()
  const historyCalls: Array<{ from: number, to: number }> = []
  return {
    subs,
    historyCalls,
    async getHistoryKLineData (_symbol, period, from, to) {
      historyCalls.push({ from, to })
      return (options.history ?? []).filter(bar => bar.timestamp >= from && bar.timestamp <= to)
    },
    subscribe (symbol, period, callback) {
      subs.set(`${symbol.ticker}|${period.text}`, callback)
    },
    unsubscribe (symbol, period) {
      subs.delete(`${symbol.ticker}|${period.text}`)
    },
    async config () {
      return { exchanges: [{ key: 'HYPERLIQUID', name: 'Hyperliquid' }], intervals: options.intervals ?? [MINUTE] }
    },
    searchSymbols: async (query: string): Promise<SymbolSearchResult[]> => [{ ticker: query || 'BTC', exchange: 'HYPERLIQUID' }],
    resolveSymbol: async (name: string): Promise<SymbolInfo> => ({ ...SYMBOL, ticker: name }),
    emit (period, bar) {
      subs.get(`BTC|${period.text}`)?.(bar)
    }
  }
}

/** Ascending 1-minute bars from `from`, deterministic prices. */
function minuteBars (from: number, count: number): KLineData[] {
  const out: KLineData[] = []
  for (let i = 0; i < count; i++) {
    const open = 100 + i
    out.push({ timestamp: from + i * 60_000, open, high: open + 2, low: open - 1, close: open + 1, volume: 5 })
  }
  return out
}

describe('createAggregatingDatafeed — history', () => {
  it('aggregates custom periods and clamps the fetch window to the bucket opening', async () => {
    const base = recordedFeed({ intervals: [MINUTE], history: minuteBars(Date.UTC(2023, 10, 14, 22, 0), 12) })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    const from = Date.UTC(2023, 10, 14, 22, 2) // inside the 22:00 bucket
    const bars = await feed.getHistoryKLineData(SYMBOL, THREE_M, from, Date.UTC(2023, 10, 14, 22, 30))
    expect(base.historyCalls[0].from).toBe(Date.UTC(2023, 10, 14, 22, 0)) // bucket opening
    expect(bars.map(bar => bar.timestamp)).toEqual([
      Date.UTC(2023, 10, 14, 22, 0), Date.UTC(2023, 10, 14, 22, 3), Date.UTC(2023, 10, 14, 22, 6), Date.UTC(2023, 10, 14, 22, 9)
    ])
    const first = bars[0]
    const source = minuteBars(Date.UTC(2023, 10, 14, 22, 0), 12)
    expect(first.open).toBe(source[0].open)
    expect(first.close).toBe(source[2].close)
    expect(first.volume).toBe(15)
  })

  it('loads the venue intervals before picking a base', async () => {
    const FIVE_M: Period = { multiplier: 5, timespan: 'minute', text: '5m' }
    const TEN_M: Period = { multiplier: 10, timespan: 'minute', text: '10m' }
    const base = recordedFeed({ intervals: [MINUTE, FIVE_M] })
    const history = vi.spyOn(base, 'getHistoryKLineData')
    const feed = createAggregatingDatafeed(base, { customPeriods: [TEN_M] })
    await feed.getHistoryKLineData(SYMBOL, TEN_M, 0, 600_000) // config() never called by the host
    expect(history.mock.calls[0][1]).toBe(FIVE_M)
  })

  it('keeps optional capabilities absent and forwards destroy', () => {
    const { searchSymbols, resolveSymbol, ...minimal } = recordedFeed()
    const destroy = vi.fn()
    const feed = createAggregatingDatafeed({ ...minimal, destroy } as Datafeed)
    expect(feed.searchSymbols).toBeUndefined()
    expect(feed.resolveSymbol).toBeUndefined()
    expect(feed.getServerTime).toBeUndefined()
    feed.destroy()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('passes native periods through untouched', async () => {
    const history = minuteBars(Date.UTC(2023, 10, 14, 22, 0), 5)
    const base = recordedFeed({ intervals: [MINUTE], history })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    const bars = await feed.getHistoryKLineData(SYMBOL, MINUTE, Date.UTC(2023, 10, 14, 22, 0), Date.UTC(2023, 10, 14, 23, 0))
    expect(bars).toEqual(history)
    expect(base.historyCalls[0]).toEqual({ from: Date.UTC(2023, 10, 14, 22, 0), to: Date.UTC(2023, 10, 14, 23, 0) })
  })
})

describe('createAggregatingDatafeed — live', () => {
  it('multiplexes onto one base subscription and rolls buckets over', () => {
    const base = recordedFeed({ intervals: [MINUTE] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    const received: KLineData[] = []
    feed.subscribe(SYMBOL, THREE_M, bar => received.push(bar))
    // Exactly one base subscription, for the base period, not the target.
    expect([...base.subs.keys()]).toEqual(['BTC|1m'])
    const t0 = Date.UTC(2023, 10, 14, 22, 0)
    const source = minuteBars(t0, 4)
    base.emit(MINUTE, source[0])
    base.emit(MINUTE, source[1])
    base.emit(MINUTE, source[2]) // completes the 22:00 bucket (emitted per merge)
    base.emit(MINUTE, source[3]) // rollover pushes only the fresh bucket
    // Same-bucket merges emit the bucket each time; rollover emits only the new bucket.
    expect(received.map(bar => bar.timestamp)).toEqual([t0, t0, t0, t0 + 180_000])
    expect(received[2].close).toBe(source[2].close)
    expect(received[2].volume).toBe(15)
    expect(received[3].open).toBe(source[3].open)
    feed.unsubscribe(SYMBOL, THREE_M)
    expect(base.subs.size).toBe(0)
  })

  it('merges same-bucket bars in place (replace semantics for the chart)', () => {
    const base = recordedFeed({ intervals: [MINUTE] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    const received: KLineData[] = []
    feed.subscribe(SYMBOL, THREE_M, bar => received.push(bar))
    const t0 = Date.UTC(2023, 10, 14, 22, 0)
    const source = minuteBars(t0, 2)
    base.emit(MINUTE, source[0])
    base.emit(MINUTE, source[1])
    // Same timestamp twice: the chart replaces by timestamp.
    expect(received).toHaveLength(2)
    expect(received[0].timestamp).toBe(received[1].timestamp)
    expect(received[1].close).toBe(source[1].close)
    expect(received[1].high).toBe(source[1].high)
  })

  it('seeds from history so the handoff has no gap', async () => {
    const t0 = Date.UTC(2023, 10, 14, 22, 0)
    const history = minuteBars(t0, 3) // completes the 22:00 3m bucket
    const base = recordedFeed({ intervals: [MINUTE], history })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    await feed.getHistoryKLineData(SYMBOL, THREE_M, t0, t0 + 600_000)
    const received: KLineData[] = []
    feed.subscribe(SYMBOL, THREE_M, bar => received.push(bar))
    const source = minuteBars(t0, 4)
    base.emit(MINUTE, source[3]) // first live bar opens the 22:03 bucket
    // The seeded tail (22:00, completed by history) is not re-emitted — the
    // chart already holds it; only the new bucket goes out.
    expect(received.map(bar => bar.timestamp)).toEqual([t0 + 180_000])
  })

  it('keeps the history bucket when the chart subscribes after loading it', async () => {
    const t0 = Date.UTC(2023, 10, 14, 22, 0)
    const source = minuteBars(t0, 2)
    const base = recordedFeed({ intervals: [MINUTE], history: source })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    await feed.getHistoryKLineData(SYMBOL, THREE_M, t0, t0 + 600_000)
    const received: KLineData[] = []
    feed.subscribe(SYMBOL, THREE_M, bar => received.push(bar))
    base.emit(MINUTE, minuteBars(t0 + 120_000, 1)[0])
    expect(received[0].open).toBe(source[0].open)
    expect(received[0].volume).toBe(15)
  })

  it('counts a forming base bar\'s cumulative volume once', async () => {
    const t0 = Date.UTC(2023, 10, 14, 22, 0)
    const forming = { ...minuteBars(t0, 1)[0], volume: 10 }
    const base = recordedFeed({ intervals: [MINUTE], history: [forming] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    await feed.getHistoryKLineData(SYMBOL, THREE_M, t0, t0 + 600_000)
    const received: KLineData[] = []
    feed.subscribe(SYMBOL, THREE_M, bar => received.push(bar))
    base.emit(MINUTE, { ...forming, volume: 12 })
    base.emit(MINUTE, { ...forming, volume: 15 })
    expect(received.map(bar => bar.volume)).toEqual([12, 15])
  })

  it('shares one base stream between a native chart and a built target', () => {
    const base = recordedFeed({ intervals: [MINUTE] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    const native: number[] = []
    const built: number[] = []
    feed.subscribe(SYMBOL, MINUTE, bar => native.push(bar.timestamp))
    feed.subscribe(SYMBOL, THREE_M, bar => built.push(bar.timestamp))
    const t0 = Date.UTC(2023, 10, 14, 22, 0)
    base.emit(MINUTE, minuteBars(t0, 1)[0])
    expect(native).toEqual([t0])
    expect(built).toEqual([t0])
    feed.unsubscribe(SYMBOL, MINUTE)
    expect(base.subs.size).toBe(1) // the built target still needs it
    feed.unsubscribe(SYMBOL, THREE_M)
    expect(base.subs.size).toBe(0)
  })

  it('releases a subscription forwarded because nothing could build it', async () => {
    const base = recordedFeed({ intervals: [THREE_M] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [MINUTE] })
    await feed.config()
    feed.subscribe(SYMBOL, MINUTE, () => {})
    expect([...base.subs.keys()]).toEqual(['BTC|1m'])
    feed.unsubscribe(SYMBOL, MINUTE)
    expect(base.subs.size).toBe(0)
  })

  it('detaches from the base it joined even after config changes the pick', async () => {
    const FIVE_M: Period = { multiplier: 5, timespan: 'minute', text: '5m' }
    const TEN_M: Period = { multiplier: 10, timespan: 'minute', text: '10m' }
    const base = recordedFeed({ intervals: [MINUTE, FIVE_M] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [TEN_M] })
    feed.subscribe(SYMBOL, TEN_M, () => {}) // config not loaded: falls back to 1m
    await feed.config()
    feed.unsubscribe(SYMBOL, TEN_M)
    expect(base.subs.size).toBe(0)
  })

  it('keeps a stale base bar from rolling the bucket backwards', () => {
    const base = recordedFeed({ intervals: [MINUTE] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    const received: KLineData[] = []
    feed.subscribe(SYMBOL, THREE_M, bar => received.push(bar))
    const t0 = Date.UTC(2023, 10, 14, 22, 3)
    base.emit(MINUTE, minuteBars(t0, 1)[0])
    const receivedAfterRollover = received.length
    base.emit(MINUTE, minuteBars(Date.UTC(2023, 10, 14, 22, 0), 1)[0]) // older bucket
    expect(received.length).toBe(receivedAfterRollover)
  })
})

describe('createAggregatingDatafeed — capabilities', () => {
  it('merges custom periods into config intervals', async () => {
    const base = recordedFeed({ intervals: [MINUTE] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    const config = await feed.config()
    expect(config.intervals?.map(period => period.text)).toEqual(['1m', '3m'])
    expect(config.exchanges).toHaveLength(1)
  })

  it('declareInterval makes a runtime period aggregatable and advertised', async () => {
    const base = recordedFeed({ intervals: [MINUTE] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    const twelveH: Period = { multiplier: 12, timespan: 'hour', text: '12h' }
    feed.declareInterval(twelveH)
    const config = await feed.config()
    expect(config.intervals?.map(period => period.text)).toEqual(['1m', '3m', '12h'])
    const received: KLineData[] = []
    feed.subscribe(SYMBOL, twelveH, bar => received.push(bar))
    expect([...base.subs.keys()]).toEqual(['BTC|1m'])
  })

  it('delegates search, resolve and unknown periods to the base feed', async () => {
    const base = recordedFeed({ intervals: [MINUTE] })
    const feed = createAggregatingDatafeed(base, { customPeriods: [THREE_M] })
    await expect(feed.searchSymbols!('ETH', undefined)).resolves.toEqual([{ ticker: 'ETH', exchange: 'HYPERLIQUID' }])
    await expect(feed.resolveSymbol!('BTC')).resolves.toMatchObject({ ticker: 'BTC' })
    // A period neither native nor declared forwards untouched (base fallback policy applies).
    const spy = vi.spyOn(base, 'subscribe')
    const weird: Period = { multiplier: 7, timespan: 'minute', text: '7m' }
    feed.subscribe(SYMBOL, weird, () => {})
    expect(spy).toHaveBeenCalledWith(SYMBOL, weird, expect.any(Function))
  })
})
