import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryPager } from './historyPaging'
import { ConnectionEvents, fetchRecovery, mergeRecovered } from './dataRecovery'
import { BinanceDatafeed } from './datafeeds/binance'
import { HyperliquidDatafeed } from './datafeeds/hyperliquid'
import { createCompositeDatafeed } from './datafeeds/composite'
import { createAggregatingDatafeed } from './datafeeds/aggregate'
const bar = (timestamp: number, close = 2) => ({ timestamp, open: 1, high: 10, low: 0, close, volume: 1 })
const period = { multiplier: 1, timespan: 'minute', text: '1m' }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('bounded recovery', () => {
  it('retries older pages with backoff, single-flight ownership and a finite limit', async () => {
    vi.useFakeTimers()
    const pager = new HistoryPager(), commit = vi.fn(() => true), error = vi.fn()
    const fetch = vi.fn().mockRejectedValueOnce(new Error('one')).mockRejectedValueOnce(new Error('two')).mockResolvedValue([bar(1)])
    const job = pager.request(fetch, commit, error, { attempts: 3, delayMs: 10 })
    expect(pager.request(fetch, commit, error)).toBe(job)
    await vi.runAllTimersAsync()
    expect(await job).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(error).not.toHaveBeenCalled()
    const fail = vi.fn(async () => { throw new Error('offline') })
    const failed = pager.request(fail, commit, error, { attempts: 3, delayMs: 10 })
    await vi.runAllTimersAsync()
    expect(await failed).toBe(false)
    expect(fail).toHaveBeenCalledTimes(3)
    expect(error).toHaveBeenCalledOnce()
  })
  it('cancels a backoff on dataset change without dispatching again', async () => {
    vi.useFakeTimers()
    const pager = new HistoryPager(), fetch = vi.fn(async () => { throw new Error('offline') }), commit = vi.fn(() => true), error = vi.fn()
    const job = pager.request(fetch, commit, error, { attempts: 3, delayMs: 1000 })
    await vi.advanceTimersByTimeAsync(0)
    pager.reset()
    expect(await job).toBe(false)
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled()
  })
  it('requests consecutive bounded windows and rejects oversized outages', async () => {
    const calls: number[][] = []
    const feed = { getHistoryKLineData: vi.fn(async (_s, _p, from: number, to: number) => { calls.push([from, to]); return [bar(from), bar(to)] }), subscribe () {}, unsubscribe () {} }
    const result = await fetchRecovery(feed, { ticker: 'BTC' }, period, 0, 1000 * 60000, () => true)
    expect(calls).toHaveLength(3)
    expect(calls[1][0]).toBe(calls[0][1] + 1)
    expect(result.at(-1)?.timestamp).toBe(1000 * 60000)
    await expect(fetchRecovery(feed, { ticker: 'BTC' }, period, 0, 21000 * 60000, () => true)).rejects.toThrow('20,000')
  })
  it('preserves live revisions while filling and correcting historical bars', () => {
    expect(mergeRecovered([bar(0), bar(2, 8)], [bar(0, 3), bar(1), bar(2, 4)], new Set([2])))
      .toEqual([bar(0, 3), bar(1), bar(2, 8)])
  })
  it('forwards reconnect events through dynamically added composite and aggregation routes', () => {
    const connections = new ConnectionEvents(), callback = vi.fn()
    const native = { subscribeConnection: connections.subscribe, getHistoryKLineData: async () => [], subscribe () {}, unsubscribe () {} }
    const composite = createCompositeDatafeed([])
    const stop = composite.subscribeConnection!(callback)
    composite.addRoute({ exchanges: ['TEST'], feed: createAggregatingDatafeed(native) })
    connections.emit({ status: 'reconnected' })
    expect(callback).toHaveBeenCalledOnce()
    stop(); connections.emit({ status: 'reconnected' });expect(callback).toHaveBeenCalledOnce()
  })
})
class Socket {
  static OPEN = 1
  static CONNECTING = 0
  static instances: Socket[] = []
  readyState = 0
  onopen?: () => void
  onclose?: (() => void) | null
  onmessage?: (message: { data: string }) => void
  constructor (_url: string) { Socket.instances.push(this) }
  send () {}
  close () { this.readyState = 3 }
  open () { this.readyState = 1; this.onopen?.() }
  drop () { this.readyState = 3; this.onclose?.() }
}
describe('venue connection lifecycle', () => {
  it.each(['binance', 'hyperliquid'])('%s emits reconnect once and unsubscribes cleanly', async venue => {
    vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket); Socket.instances = []
    const feed = venue === 'binance' ? new BinanceDatafeed() : new HyperliquidDatafeed()
    const callback = vi.fn(), events = vi.fn()
    const stop = feed.subscribeConnection(events)
    const symbol = { ticker: venue === 'binance' ? 'BTCUSDT' : 'BTC', exchange: venue === 'binance' ? 'BINANCE' : 'HYPERLIQUID' }
    feed.subscribe(symbol, period, callback)
    Socket.instances[0].open(); Socket.instances[0].drop()
    await vi.advanceTimersByTimeAsync(2000)
    Socket.instances[1].open()
    expect(events.mock.calls.map(([event]) => event.status)).toEqual(['connected', 'disconnected', 'reconnected'])
    stop();feed.unsubscribe(symbol, period, callback);feed.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })
})
