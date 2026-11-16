import { describe, expect, it, vi } from 'vitest'
import type { KLineData } from 'klinecharts'
import { HistoryPager, normalizeHistory } from './historyPaging'
const bar = (timestamp: number, close = 2): KLineData => ({ timestamp, open: 1, high: 3, low: 0, close, volume: 10 })
const deferred = () => {
  let resolve!: (bars: KLineData[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<KLineData[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('history page ownership', () => {
  it('shares an in-flight page and allows a synchronous next-page request during commit', async () => {
    const pager = new HistoryPager()
    const first = deferred()
    const fetch = vi.fn(() => first.promise)
    let next: Promise<boolean> | undefined
    const one = pager.request(fetch, () => {
      next = pager.request(async () => [bar(0)], () => true, () => {})
      return true
    }, () => {})
    expect(pager.request(fetch, () => false, () => {})).toBe(one)
    await Promise.resolve()
    first.resolve([bar(1)])
    expect(await one).toBe(true)
    expect(await next).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('drops stale success/error results and does not unlock a newer dataset request', async () => {
    for (const fail of [false, true]) {
      const pager = new HistoryPager()
      const old = deferred(), fresh = deferred()
      const commit = vi.fn(() => true), error = vi.fn()
      const previous = pager.request(() => old.promise, commit, error)
      await Promise.resolve()
      pager.reset()
      const next = pager.request(() => fresh.promise, commit, error)
      await Promise.resolve()
      if (fail) old.reject(new Error('old dataset'))
      else old.resolve([bar(0)])
      expect(await previous).toBe(false)
      expect(commit).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
      expect(pager.request(async () => [], commit, error)).toBe(next)
      fresh.resolve([bar(10)])
      expect(await next).toBe(true)
      expect(commit).toHaveBeenCalledTimes(1)
    }
  })
  it('invalidates queued work before it dispatches and handles synchronous feed errors', async () => {
    const pager = new HistoryPager(), fetch = vi.fn(async () => [bar(0)]), error = vi.fn()
    const job = pager.request(fetch, () => true, error)
    pager.reset()
    expect(await job).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(await pager.request(() => { throw new Error('offline') }, () => true, error)).toBe(false)
    expect(error).toHaveBeenCalledOnce()
  })
})

describe('history boundary normalization', () => {
  it('sorts, deduplicates, bounds and rejects malformed candles', () => {
    const result = normalizeHistory([bar(3), bar(1), bar(2), bar(2, 2.5), bar(0),
      { ...bar(1.5), close: NaN }, { ...bar(1.6), high: -1 }, { ...bar(1.7), volume: -1 }], 1, 2)
    expect(result).toEqual([bar(1), bar(2, 2.5)])
  })
})
