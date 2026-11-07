import { describe, expect, it } from 'vitest'

import { effectivePeriods, parseSymbolName, periodDurationMs, qualifiedSymbolName, snapPeriod } from './symbolSelect'
import type { Period } from './types'

const P = (multiplier: number, timespan: string, text: string): Period => ({ multiplier, timespan, text })

const PERIODS: Period[] = [
  P(1, 'minute', '1m'), P(5, 'minute', '5m'), P(15, 'minute', '15m'),
  P(1, 'hour', '1h'), P(4, 'hour', '4h'),
  P(1, 'day', '1d'), P(1, 'week', '1w'), P(1, 'month', '1M')
]

describe('parseSymbolName', () => {
  it('splits exchange-qualified names', () => {
    expect(parseSymbolName('BINANCE:BTCUSDT')).toEqual({ exchange: 'BINANCE', ticker: 'BTCUSDT' })
    expect(parseSymbolName('hyperliquid:btc')).toEqual({ exchange: 'HYPERLIQUID', ticker: 'btc' })
  })

  it('passes bare tickers through', () => {
    expect(parseSymbolName('BTCUSDT')).toEqual({ ticker: 'BTCUSDT' })
    expect(parseSymbolName('  BTC ')).toEqual({ ticker: 'BTC' })
  })

  it('tolerates malformed qualifiers', () => {
    expect(parseSymbolName(':BTC')).toEqual({ ticker: ':BTC' })
    expect(parseSymbolName('BINANCE:')).toEqual({ ticker: 'BINANCE:' })
  })
})

describe('qualifiedSymbolName', () => {
  it('qualifies by exchange when present', () => {
    expect(qualifiedSymbolName({ ticker: 'BTC', exchange: 'HYPERLIQUID' })).toBe('HYPERLIQUID:BTC')
    expect(qualifiedSymbolName({ ticker: 'BTC' })).toBe('BTC')
  })
})

describe('snapPeriod', () => {
  it('returns the period untouched when supported', () => {
    expect(snapPeriod(PERIODS[2], PERIODS)).toBe(PERIODS[2])
  })

  it('prefers the same timespan', () => {
    // 3m is unsupported: nearest minute multiple is 1m, not 1h.
    expect(snapPeriod(P(3, 'minute', '3m'), PERIODS)?.text).toBe('5m')
    expect(snapPeriod(P(2, 'hour', '2h'), PERIODS)?.text).toBe('1h')
  })

  it('falls back to the nearest duration', () => {
    expect(snapPeriod(P(1, 'year', 'Y'), PERIODS)?.text).toBe('1M')
    expect(snapPeriod(P(10, 'second', '10s'), PERIODS)?.text).toBe('1m')
  })

  it('handles empty candidate lists', () => {
    expect(snapPeriod(P(1, 'day', '1d'), [])).toBeNull()
  })
})

describe('effectivePeriods', () => {
  it('intersects host periods with each constraint', () => {
    const symbolIntervals = [P(1, 'minute', '1m'), P(1, 'hour', '1h'), P(1, 'week', '1w')]
    const configIntervals = [P(1, 'minute', '1m'), P(4, 'hour', '4h'), P(1, 'week', '1w')]
    expect(effectivePeriods(PERIODS, [symbolIntervals, configIntervals]).map(p => p.text))
      .toEqual(['1m', '1w'])
  })

  it('ignores empty constraints', () => {
    expect(effectivePeriods(PERIODS, [undefined, []])).toEqual(PERIODS)
  })

  it('falls back to the host list when the intersection is empty', () => {
    expect(effectivePeriods(PERIODS, [[P(2, 'minute', '2m')]])).toEqual(PERIODS)
  })
})

describe('periodDurationMs', () => {
  it('multiplies the timespan unit', () => {
    expect(periodDurationMs(P(15, 'minute', '15m'))).toBe(15 * 60 * 1000)
    expect(periodDurationMs(P(1, 'week', '1w'))).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
