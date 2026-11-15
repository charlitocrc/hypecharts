import { describe, expect, it, vi } from 'vitest'
import type { KLineData } from 'klinecharts'
import type { Datafeed, Period } from './types'
import { ProfileHistory, profileDetailPeriod, profileSource } from './profileData'

const minute: Period = { multiplier: 1, timespan: 'minute', text: '1m' }
const five: Period = { multiplier: 5, timespan: 'minute', text: '5m' }
const parent: KLineData = { timestamp: 0, open: 1, high: 2, low: 1, close: 2, volume: 50 }
const detail = Array.from({ length: 5 }, (_, i) => ({ ...parent, timestamp: i * 60000, volume: 10 }))
const makeFeed = (getHistoryKLineData: Datafeed['getHistoryKLineData']): Datafeed =>
  ({ getHistoryKLineData, subscribe: () => {}, unsubscribe: () => {} })

describe('profile detail selection and fallback', () => {
  it('chooses only advertised finer candles within the prefetch budget, excluding seconds', () => {
    const second: Period = { multiplier: 1, timespan: 'second', text: '1s' }
    expect(profileDetailPeriod(five, [second, five, minute], 0, 300000)).toEqual(minute)
    expect(profileDetailPeriod(five, [minute], 0, 5001 * 60000)).toBeUndefined()
    expect(profileDetailPeriod(minute, [second, minute], 0, 60000)).toBeUndefined()
  })

  it('replaces a complete closed parent exactly once', () => {
    const result = profileSource([parent], five, detail, minute, 300000)
    expect(result.bars).toEqual(detail)
    expect(result.detailedParents).toBe(1)
    expect(result.fallbackParents).toBe(0)
    expect(result.bars.reduce((sum, b) => sum + b.volume!, 0)).toBe(50)
  })

  it('retains the whole parent for missing, invalid, inconsistent or developing detail', () => {
    for (const bars of [detail.slice(1), detail.map((b, i) => i === 2 ? { ...b, volume: NaN } : b),
      detail.map(b => ({ ...b, volume: 9 })), detail.map(b => ({ ...b, high: 3 }))]) {
      expect(profileSource([parent], five, bars, minute, 300000).bars).toEqual([parent])
    }
    expect(profileSource([parent], five, detail, minute, 299999).bars).toEqual([parent])
  })

  it('keeps covered and uncovered parents without mixing their volumes', () => {
    const next = { ...parent, timestamp: 300000 }
    const result = profileSource([parent, next], five, detail, minute, 600000)
    expect(result.bars).toEqual([...detail, next])
    expect([result.detailedParents, result.fallbackParents]).toEqual([1, 1])
  })
})

describe('bounded profile history lifecycle', () => {
  it('pages before venue caps, deduplicates requests and rejects oversized windows', async () => {
    const fetch = vi.fn(async (_symbol, _period, from: number, to: number) => [
      { ...parent, timestamp: from }, { ...parent, timestamp: to + 1 }])
    const loader = new ProfileHistory()
    const feed = makeFeed(fetch)
    const first = loader.load(feed, { ticker: 'BTC' }, minute, 0, 1200 * 60000)
    expect(loader.load(feed, { ticker: 'BTC' }, minute, 0, 1200 * 60000)).toBe(first)
    const bars = await first
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.map(call => call.slice(2))).toEqual([[0, 29999999], [30000000, 59999999], [60000000, 71999999]])
    expect(bars.map(bar => bar.timestamp)).toEqual([0, 30000000, 60000000])
    await loader.load(feed, { ticker: 'BTC' }, minute, 0, 5001 * 60000)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('isolates markets and discards pending pages after a dataset reset', async () => {
    let resolve!: (bars: KLineData[]) => void
    const fetch = vi.fn(() => new Promise<KLineData[]>(done => { resolve = done }))
    const loader = new ProfileHistory()
    const pending = loader.load(makeFeed(fetch), { ticker: 'BTC', exchange: 'TEST', market: 'spot' }, minute, 0, 1000 * 60000)
    loader.reset()
    resolve(detail)
    expect(await pending).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
    const other = loader.load(makeFeed(async () => detail), { ticker: 'BTC', exchange: 'TEST', market: 'perp' }, minute, 0, 300000)
    expect(await other).toEqual(detail)
  })

  it('cancels obsolete range pages while retaining settled cache entries', async () => {
    const loader = new ProfileHistory()
    const feed = makeFeed(async () => detail)
    const cached = loader.load(feed, { ticker: 'BTC' }, minute, 0, 300000)
    await cached
    let resolve!: (bars: KLineData[]) => void
    const fetch = vi.fn(() => new Promise<KLineData[]>(done => { resolve = done }))
    const old = loader.load(makeFeed(fetch), { ticker: 'BTC' }, minute, 0, 1000 * 60000)
    loader.cancelPending()
    resolve(detail)
    expect(await old).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(loader.load(feed, { ticker: 'BTC' }, minute, 0, 300000)).toBe(cached)
  })

  it('settles failed requests to chart fallback without repeat fetch loops', async () => {
    const fetch = vi.fn(async () => { throw new Error('offline') })
    const loader = new ProfileHistory()
    const feed = makeFeed(fetch)
    expect(await loader.load(feed, { ticker: 'BTC' }, minute, 0, 300000)).toEqual([])
    expect(await loader.load(feed, { ticker: 'BTC' }, minute, 0, 300000)).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
