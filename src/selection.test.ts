import { describe, expect, it, vi } from 'vitest'
import { ChartSelectionError, SelectionRequests, isSelectionRequest } from './selection'
import type { ChartSelection } from './types'

const ready = (ticker = 'BTC', dataReady = true): ChartSelection => ({
  symbol: { ticker }, period: { multiplier: 1, timespan: 'minute', text: '1m' }, loading: false, dataReady, timeBased: true
})

describe('awaitable selection ownership', () => {
  it('ignores old data while resolving and binds completion to the latest exact request', async () => {
    const resolving = vi.fn()
    const requests = new SelectionRequests(resolving)
    const operation = requests.begin()
    const settled = vi.fn()
    void operation.promise.then(settled)
    requests.complete(1, ready())
    requests.activate(operation)
    requests.bind(2)
    requests.bind(3) // An automatic interval snap starts a replacement dataset.
    requests.complete(2, ready())
    requests.complete(3, { ...ready(), loading: true })
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    requests.complete(3, ready('ETH'))
    await expect(operation.promise).resolves.toEqual(ready('ETH'))
    expect(requests.current(operation)).toBe(false)
    expect(resolving.mock.calls.map(([value]) => value)).toEqual([true, false, false])
  })

  it('resolves empty history instead of waiting forever for a live candle', async () => {
    const requests = new SelectionRequests(() => {})
    const operation = requests.begin()
    requests.activate(operation)
    requests.bind(1)
    requests.complete(1, ready('EMPTY', false))
    await expect(operation.promise).resolves.toMatchObject({ loading: false, dataReady: false })
  })

  it('rejects superseded work and never lets stale completions or failures settle its replacement', async () => {
    const requests = new SelectionRequests(() => {})
    const first = requests.begin()
    requests.activate(first)
    requests.bind(1)
    const next = requests.begin()
    await expect(first.promise).rejects.toMatchObject({ code: 'superseded' })
    requests.activate(first)
    requests.fail(first, new ChartSelectionError('resolve_failed'))
    requests.activate(next)
    requests.bind(2)
    requests.complete(1, ready(), new ChartSelectionError('load_failed'))
    expect(requests.current(next)).toBe(true)
    requests.complete(2, ready('ETH'))
    await expect(next.promise).resolves.toEqual(ready('ETH'))
  })

  it('does not supersede existing work for an already aborted caller', async () => {
    const requests = new SelectionRequests(() => {})
    const first = requests.begin()
    const controller = new AbortController()
    controller.abort('already cancelled')
    const aborted = requests.begin(controller.signal)
    await expect(aborted.promise).rejects.toMatchObject({ code: 'aborted', cause: 'already cancelled' })
    expect(requests.current(first)).toBe(true)
    requests.cancel('disposed')
    await expect(first.promise).rejects.toMatchObject({ code: 'disposed' })
  })

  it('cleans abort listeners on every terminal path and preserves the original error or abort reason', async () => {
    for (const outcome of ['success', 'failure', 'abort', 'superseded', 'disposed'] as const) {
      const requests = new SelectionRequests(() => {})
      const controller = new AbortController()
      const remove = vi.spyOn(controller.signal, 'removeEventListener')
      const operation = requests.begin(controller.signal)
      const result = operation.promise.catch(error => error)
      const cause = new Error(outcome)
      requests.activate(operation)
      requests.bind(1)
      if (outcome === 'success') requests.complete(1, ready())
      else if (outcome === 'failure') requests.complete(1, ready(), new ChartSelectionError('load_failed', cause))
      else if (outcome === 'abort') controller.abort(cause)
      else requests.cancel(outcome)
      const value = await result
      if (outcome === 'success') expect(value).toEqual(ready())
      else {
        expect(value).toBeInstanceOf(ChartSelectionError)
        expect(value.code).toBe(outcome === 'failure' ? 'load_failed' : outcome === 'abort' ? 'aborted' : outcome)
        if (outcome === 'failure' || outcome === 'abort') expect(value.cause).toBe(cause)
      }
      expect(remove).toHaveBeenCalledOnce()
      expect(requests.current(operation)).toBe(false)
      controller.abort()
    }
  })

  it('cancels unresolved symbols and ignores their late resolver failures', async () => {
    const requests = new SelectionRequests(() => {})
    const operation = requests.begin()
    requests.cancel('superseded')
    requests.fail(operation, new ChartSelectionError('resolve_failed', new Error('late')))
    await expect(operation.promise).rejects.toMatchObject({ code: 'superseded' })
  })
})

describe('selection request validation', () => {
  it('requires at least one valid field without restricting optional metadata', () => {
    expect(isSelectionRequest({ symbol: 'TEST:BTC' })).toBe(true)
    expect(isSelectionRequest({ period: ready().period })).toBe(true)
    expect(isSelectionRequest({ symbol: { ticker: 'BTC', description: 'Bitcoin' }, period: ready().period })).toBe(true)
    for (const value of [null, undefined, {}, { symbol: '' }, { symbol: {} }, { symbol: null },
      { period: { ...ready().period, multiplier: 0 } }, { period: { ...ready().period, multiplier: 1.5 } },
      { period: { ...ready().period, timespan: 'tick' } }, { period: { ...ready().period, text: '' } }]) {
      expect(isSelectionRequest(value)).toBe(false)
    }
  })
})
