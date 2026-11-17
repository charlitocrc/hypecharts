import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticReporter, validDatafeedConfiguration } from './diagnostics'
import type { ChartDiagnostic } from './types'

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
afterEach(() => { vi.restoreAllMocks() })

describe('chart diagnostic delivery', () => {
  it('delivers after state-notification microtasks with original causes and detached context', async () => {
    let stateSettled = false
    const observedState: boolean[] = []
    const listener = vi.fn((_diagnostic: ChartDiagnostic) => { observedState.push(stateSettled) })
    const reporter = new DiagnosticReporter(listener)
    const cause = new Error('offline')
    const period = { multiplier: 1, timespan: 'minute', text: '1m' }
    const symbol = { ticker: 'BTC', intervals: [period] }
    reporter.report({ code: 'history_failed', cause, symbol, period, scope: 'paging' })
    symbol.ticker = 'ETH'; period.text = '5m'
    queueMicrotask(() => { stateSettled = true })
    expect(listener).not.toHaveBeenCalled()
    await flush()
    expect(observedState).toEqual([true])
    const diagnostic = listener.mock.calls[0][0]
    expect(diagnostic).toMatchObject({ code: 'history_failed', severity: 'error', operation: 'getHistoryKLineData', retryable: true, scope: 'paging', symbol: { ticker: 'BTC' }, period: { text: '1m' } })
    expect(diagnostic.symbol!.intervals![0].text).toBe('1m')
    expect(diagnostic.cause).toBe(cause)
  })

  it('drops stale and disposed work both before scheduling and before delivery', async () => {
    const listener = vi.fn(), reporter = new DiagnosticReporter(listener)
    reporter.report({ code: 'history_failed' }, () => false)
    let current = true
    reporter.report({ code: 'history_failed' }, () => current)
    current = false
    await flush()
    expect(listener).not.toHaveBeenCalled()
    reporter.report({ code: 'stylesheet_missing' })
    reporter.stop()
    await flush()
    reporter.report({ code: 'container_zero_height' })
    await flush()
    expect(listener).not.toHaveBeenCalled()
  })

  it('isolates callback failures and lets a callback stop later queued delivery', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const listener = vi.fn(() => { throw new Error('consumer failed') })
    new DiagnosticReporter(listener).report({ code: 'configuration_failed' })
    await flush()
    expect(listener).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledOnce()
    let reporter: DiagnosticReporter
    const stop = vi.fn((): void => reporter.stop())
    reporter = new DiagnosticReporter(stop)
    reporter.report({ code: 'configuration_failed' })
    reporter.report({ code: 'history_failed' })
    await flush()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('uses structured console fallback unless a callback replaces it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new DiagnosticReporter()
    reporter.report({ code: 'stylesheet_missing' })
    reporter.report({ code: 'subscription_failed', operation: 'unsubscribe', retryable: false })
    await flush()
    expect(warn.mock.calls[0][0]).toContain('hypecharts/styles.css')
    expect(error.mock.calls[0][1]).toMatchObject({ code: 'subscription_failed', operation: 'unsubscribe', retryable: false })
    new DiagnosticReporter(() => {}).report({ code: 'stylesheet_missing' })
    await flush()
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('feed configuration boundary', () => {
  it('accepts capability fallbacks and rejects shapes that break discovery or interval selection', () => {
    expect(validDatafeedConfiguration({ exchanges: [] })).toBe(true)
    expect(validDatafeedConfiguration({ exchanges: [{ key: 'TEST', name: 'Fixture' }], intervals: [{ multiplier: 1, timespan: 'minute', text: '1m' }], searchDelayMs: 0 })).toBe(true)
    for (const config of [null, {}, { exchanges: null }, { exchanges: [{}] },
      { exchanges: [], intervals: [{}] }, { exchanges: [], symbolTypes: [null] },
      { exchanges: [], supportsSearch: 'yes' }, { exchanges: [], searchDelayMs: NaN }]) {
      expect(validDatafeedConfiguration(config)).toBe(false)
    }
  })
})
