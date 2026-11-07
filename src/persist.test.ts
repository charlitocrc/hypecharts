import { describe, expect, it, vi } from 'vitest'

import {
  indicatorLayoutChanges, indicatorsKey, indicatorType, nextIndicatorId, readMigrated, symbolKey, toStoredDrawing, toStoredIndicatorLayout,
  readIndicatorFavorites, writeIndicatorFavorites, readIndicatorTemplates, writeIndicatorTemplates,
  readToolbarFavorites, writeToolbarFavorites, readDefaultDrawingPresets, writeDefaultDrawingPresets,
  readSymbolRecents, writeSymbolRecents, readSymbolPeriods, writeSymbolPeriod, toStoredIndicator
} from './persist'
import { matchPeriod, isPeriodPrefix } from './shortcuts'

import { Period } from './types'

const PERIODS: Period[] = [
  { multiplier: 1, timespan: 'minute', text: '1m' },
  { multiplier: 15, timespan: 'minute', text: '15m' },
  { multiplier: 30, timespan: 'minute', text: '30m' },
  { multiplier: 1, timespan: 'hour', text: '1h' },
  { multiplier: 4, timespan: 'hour', text: '4h' },
  { multiplier: 1, timespan: 'day', text: '1d' },
  { multiplier: 1, timespan: 'month', text: '1M' }
]

const GROUP = 'drawing_tools'

describe('matchPeriod', () => {
  it('resolves a complete period text', () => {
    expect(matchPeriod('15m', PERIODS)?.text).toBe('15m')
    expect(matchPeriod('4h', PERIODS)?.text).toBe('4h')
  })

  it('treats an incomplete buffer as no match but a valid prefix', () => {
    expect(matchPeriod('1', PERIODS)).toBeNull()
    expect(isPeriodPrefix('1', PERIODS)).toBe(true)
  })

  it('rejects junk', () => {
    expect(matchPeriod('99z', PERIODS)).toBeNull()
    expect(isPeriodPrefix('99z', PERIODS)).toBe(false)
    expect(matchPeriod('', PERIODS)).toBeNull()
  })

  it('prefers an exact case match so 1M and 1m stay distinct', () => {
    expect(matchPeriod('1M', PERIODS)?.timespan).toBe('month')
    expect(matchPeriod('1m', PERIODS)?.timespan).toBe('minute')
  })
})

describe('toStoredDrawing', () => {
  it('round-trips a drawing through JSON', () => {
    const overlay = {
      id: 'overlay_1',
      groupId: GROUP,
      name: 'straightLine',
      lock: false,
      mode: 'normal',
      styles: { line: { color: '#fff' } },
      points: [
        { timestamp: 1700000000000, dataIndex: 12, value: 42.5 },
        { timestamp: 1700003600000, dataIndex: 13, value: 43.5 }
      ]
    }
    const stored = toStoredDrawing(overlay, GROUP)
    expect(stored).not.toBeNull()
    expect(JSON.parse(JSON.stringify(stored))).toEqual({
      name: 'straightLine',
      lock: false,
      mode: 'normal',
      styles: { line: { color: '#fff' } },
      points: [
        { timestamp: 1700000000000, value: 42.5 },
        { timestamp: 1700003600000, value: 43.5 }
      ]
    })
  })

  it('keeps a value-only point, as used by price lines', () => {
    const stored = toStoredDrawing(
      { id: 'a', groupId: GROUP, name: 'priceLine', points: [{ value: 7 }] },
      GROUP
    )
    expect(stored?.points).toEqual([{ value: 7 }])
  })

  it('keeps extendData so text and brush offsets survive a reload', () => {
    const stored = toStoredDrawing(
      { id: 't', groupId: GROUP, name: 'text', points: [{ timestamp: 1, value: 2 }], extendData: { text: 'hi\nthere' } },
      GROUP
    )
    expect(JSON.parse(JSON.stringify(stored)).extendData).toEqual({ text: 'hi\nthere' })
    expect(toStoredDrawing({ id: 's', groupId: GROUP, name: 'segment', points: [{ value: 1 }] }, GROUP)?.extendData).toBeUndefined()
    expect(toStoredDrawing({ id: 'v', groupId: GROUP, name: 'anchoredVwap', points: [{ timestamp: 1 }], extendData: { series: [{ dataIndex: 0, value: 1 }] } }, GROUP)?.extendData).toBeUndefined()
  })

  it('never emits host-owned overlays', () => {
    const position = {
      id: 'p1',
      groupId: 'positions',
      name: 'positionLine',
      points: [{ value: 100 }]
    }
    const order = { ...position, id: 'o1', groupId: 'orders' }
    expect(toStoredDrawing(position, GROUP)).toBeNull()
    expect(toStoredDrawing(order, GROUP)).toBeNull()
    expect(toStoredDrawing({ ...position, groupId: undefined }, GROUP)).toBeNull()
  })

  it('keeps hidden state and anchors in future chart space', () => {
    expect(toStoredDrawing({ groupId: GROUP, name: 'segment', visible: false,
      points: [{ dataIndex: 501, value: 42 }] }, GROUP)).toMatchObject({
      visible: false, points: [{ dataIndex: 501, value: 42 }]
    })
  })

  it('drops overlays that cannot be restored', () => {
    expect(toStoredDrawing(null, GROUP)).toBeNull()
    expect(toStoredDrawing({ groupId: GROUP, name: 'segment', points: [] }, GROUP)).toBeNull()
    expect(toStoredDrawing({ groupId: GROUP, name: 'segment', points: [{}] }, GROUP)).toBeNull()
  })
})

describe('indicator persistence', () => {
  it('uses a separate storage key for every symbol', () => {
    expect(indicatorsKey('BTC')).toBe('indicators:BTC')
    expect(indicatorsKey('ETH')).toBe('indicators:ETH')
  })

  it('keeps placement, parameters, and visibility', () => {
    expect(toStoredIndicatorLayout({
      main: [{ name: 'EMA', calcParams: [8, 21], visible: false }],
      sub: [{ name: 'RSI', calcParams: [14] }]
    })).toEqual({
      main: [{ name: 'EMA', calcParams: [8, 21], visible: false }],
      sub: [{ name: 'RSI', calcParams: [14] }]
    })
  })

  it('accepts legacy name arrays and sanitizes malformed entries', () => {
    expect(toStoredIndicatorLayout({
      main: ['MA', 'MA', null, { name: '' }],
      sub: [{ name: 'MACD', calcParams: [12, 26, 9] }, { name: 'RSI', calcParams: [NaN] }]
    })).toEqual({
      main: [{ name: 'MA' }],
      sub: [{ name: 'MACD', calcParams: [12, 26, 9] }, { name: 'RSI' }]
    })
    expect(toStoredIndicatorLayout({ main: [] })).toBeNull()
    expect(toStoredIndicatorLayout({ main: [], sub: [] })).toEqual({ main: [], sub: [] })
  })

  it('assigns stable instance IDs that keep the study type', () => {
    expect(nextIndicatorId('EMA', [])).toBe('EMA')
    expect(nextIndicatorId('EMA', ['EMA', 'MA'])).toBe('EMA~2')
    expect(nextIndicatorId('EMA', ['EMA', 'EMA~2', 'EMA~4'])).toBe('EMA~3')
    expect(nextIndicatorId('EMA', ['EMA~2'])).toBe('EMA')
    expect(indicatorType('EMA~3')).toBe('EMA')
    expect(indicatorType('RSI')).toBe('RSI')
  })

  it('keeps valid per-plot styles and drops malformed ones', () => {
    expect(toStoredIndicatorLayout({
      main: [{ name: 'EMA', plots: { ema1: { color: '#00ff00', size: 2, style: 'dashed', visible: false }, ema2: { color: 'red', size: 99, style: 'dotted' }, ema3: null } }],
      sub: [{ name: 'RSI', plots: {} }]
    })).toEqual({
      main: [{ name: 'EMA', plots: { ema1: { color: '#00ff00', size: 2, style: 'dashed', visible: false } } }],
      sub: [{ name: 'RSI' }]
    })
  })

  it('keys storage by exchange, market and ticker and migrates ticker-only data once', () => {
    expect(symbolKey({ ticker: 'BTC' })).toBe('BTC')
    expect(symbolKey({ ticker: 'HYPE/USDC', exchange: 'Hyperliquid', market: 'spot' })).toBe('Hyperliquid:spot:HYPE/USDC')
    expect(symbolKey({ ticker: 'xyz:TSLA', exchange: 'Hyperliquid', market: 'perpetual' })).toBe('Hyperliquid:perpetual:xyz:TSLA')

    const store = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) }
    }
    vi.stubGlobal('window', { localStorage })
    store.set('klinecharts-pro:indicators:BTC', JSON.stringify({ main: ['EMA'], sub: [] }))
    const key = indicatorsKey(symbolKey({ ticker: 'BTC', exchange: 'Hyperliquid', market: 'perpetual' }))
    expect(readMigrated(key, indicatorsKey('BTC'))).toEqual({ main: ['EMA'], sub: [] })
    expect(store.has('klinecharts-pro:indicators:BTC')).toBe(false)
    expect(readMigrated(indicatorsKey(symbolKey({ ticker: 'BTC', exchange: 'Other', market: 'perpetual' })), indicatorsKey('BTC'))).toBeNull()
    expect(readMigrated(key, indicatorsKey('BTC'))).toEqual({ main: ['EMA'], sub: [] })
    vi.unstubAllGlobals()
  })

  it('keeps sub-pane heights within sane bounds', () => {
    expect(toStoredIndicatorLayout({ main: [], sub: [{ name: 'RSI', height: 140.6 }, { name: 'MACD', height: 5 }] }))
      .toEqual({ main: [], sub: [{ name: 'RSI', height: 141 }, { name: 'MACD' }] })
  })

  it('diffs layouts into removals, additions and in-place updates', () => {
    const current = {
      main: [{ name: 'EMA', calcParams: [9], visible: true }, { name: 'EMA~2', calcParams: [21], visible: true }],
      sub: [{ name: 'RSI', calcParams: [14], visible: true }]
    }
    const next = {
      main: [{ name: 'EMA', calcParams: [9], visible: false }],
      sub: [{ name: 'RSI', calcParams: [14], visible: true }, { name: 'MACD', calcParams: [12, 26, 9], visible: true }]
    }
    expect(indicatorLayoutChanges(current, next)).toEqual({
      remove: [{ main: true, item: current.main[1] }],
      add: [{ main: false, item: next.sub[1] }],
      update: [{ main: true, item: next.main[0] }]
    })
    expect(indicatorLayoutChanges(next, next)).toEqual({ remove: [], add: [], update: [] })
  })

  it('keeps several instances of one study', () => {
    expect(toStoredIndicatorLayout({
      main: [{ name: 'EMA', calcParams: [9] }, { name: 'EMA~2', calcParams: [21] }],
      sub: [{ name: 'RSI' }, { name: 'RSI~2', calcParams: [7] }]
    })).toEqual({
      main: [{ name: 'EMA', calcParams: [9] }, { name: 'EMA~2', calcParams: [21] }],
      sub: [{ name: 'RSI' }, { name: 'RSI~2', calcParams: [7] }]
    })
  })
})


describe('toolbar favorites and default drawing presets', () => {
  it('sanitizes toolbar favorites like indicator favorites', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) }
    } })
    try {
      store.set('klinecharts-pro:toolbar-favorites', JSON.stringify(['fibonacciLine', 'fibonacciLine', 7, '']))
      expect(readToolbarFavorites()).toEqual(['fibonacciLine'])
      writeToolbarFavorites(['segment', 'rect'])
      expect(readToolbarFavorites()).toEqual(['segment', 'rect'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stores per-tool default drawing presets', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) }
    } })
    try {
      expect(readDefaultDrawingPresets()).toEqual({})
      writeDefaultDrawingPresets({ fibonacciLine: 'TV look', text: '' })
      expect(readDefaultDrawingPresets()).toEqual({ fibonacciLine: 'TV look' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('symbol recents (search dialog)', () => {
  it('stores, dedupes and caps recents at 10, most recent first', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) }
    }})
    for (let i = 0; i < 12; i++) {
      writeSymbolRecents([{ exchange: 'BINANCE', ticker: `COIN${i}` }, ...readSymbolRecents()])
    }
    const recents = readSymbolRecents()
    expect(recents).toHaveLength(10)
    expect(recents[0]).toEqual({ exchange: 'BINANCE', ticker: 'COIN11' })
    // re-selecting an existing symbol moves it to the head without duplication
    writeSymbolRecents([{ exchange: 'BINANCE', ticker: 'COIN5' } as any, ...readSymbolRecents()])
    const moved = readSymbolRecents()
    expect(moved[0].ticker).toBe('COIN5')
    expect(moved.filter(item => item.ticker === 'COIN5')).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('drops malformed recents and truncates text fields', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify([
      { exchange: 'BINANCE', ticker: 'BTCUSDT', description: 'x'.repeat(200), market: 'spot' },
      { ticker: 'NOEXCHANGE' },
      { exchange: '', ticker: 'EMPTY' },
      { exchange: 42, ticker: 'BAD' },
      null
    ]), setItem: () => {}, removeItem: () => {} }})
    const recents = readSymbolRecents()
    expect(recents).toHaveLength(1)
    expect(recents[0].description).toHaveLength(60)
    expect(recents[0].ticker).toBe('BTCUSDT')
    vi.unstubAllGlobals()
  })
})

describe('per-symbol periods (SQ-4)', () => {
  it('remembers one period text per symbol key and bounds the map', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) }
    }})
    writeSymbolPeriod('BINANCE:spot:BTCUSDT', '4h')
    writeSymbolPeriod('HYPERLIQUID:perp:BTC', '1h')
    expect(readSymbolPeriods()).toEqual({ 'BINANCE:spot:BTCUSDT': '4h', 'HYPERLIQUID:perp:BTC': '1h' })
    for (let i = 0; i < 70; i++) {
      writeSymbolPeriod(`VENUE:perp:COIN${i}`, '1d')
    }
    const periods = readSymbolPeriods()
    expect(Object.keys(periods)).toHaveLength(60)
    expect(periods['VENUE:perp:COIN69']).toBe('1d')
    expect(periods['BINANCE:spot:BTCUSDT']).toBeUndefined()
    // junk writes are ignored
    writeSymbolPeriod('', '4h')
    writeSymbolPeriod('VENUE:X', '')
    expect(Object.keys(readSymbolPeriods())).toHaveLength(60)
    vi.unstubAllGlobals()
  })
})

describe('drawing timeframes reservation (DRAW-007)', () => {
  it('round-trips a sanitized timeframes list and omits it when absent', () => {
    const stored = toStoredDrawing({
      id: 'tf1', groupId: GROUP, name: 'straightLine',
      points: [{ timestamp: 1, value: 2 }],
      timeframes: ['15m', '1h', '', 42, 'x'.repeat(40), '4h']
    }, GROUP)
    // junk and over-long entries are dropped, not truncated
    expect(stored?.timeframes).toEqual(['15m', '1h', '4h'])
    // the editor's "all timeframes" clear path stores absent, not an empty list
    expect(toStoredDrawing({ id: 'tf3', groupId: GROUP, name: 'segment', points: [{ value: 1 }], timeframes: [] }, GROUP)?.timeframes)
      .toBeUndefined()
    expect(toStoredDrawing({ id: 'tf2', groupId: GROUP, name: 'segment', points: [{ value: 1 }] }, GROUP)?.timeframes)
      .toBeUndefined()
  })
})

describe('indicator calculation inputs (IND-002)', () => {
  it('round-trips source, offset and timeframe, dropping defaults and junk', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
    const stored = toStoredIndicator({
      name: 'EMA',
      calcParams: [21],
      source: 'hlc3',
      offset: -3,
      timeframe: '4h'
    })
    expect(stored).toEqual({ name: 'EMA', calcParams: [21], source: 'hlc3', offset: -3, timeframe: '4h' })
    // defaults are omitted
    expect(toStoredIndicator({ name: 'MA', source: 'close', offset: 0, timeframe: '' })).toEqual({ name: 'MA' })
    // junk is rejected
    expect(toStoredIndicator({ name: 'MA', source: 'median', offset: 9999, timeframe: 'x'.repeat(12) }))
      .toEqual({ name: 'MA' })
    expect(toStoredIndicator({ name: 'MA', offset: 2.7 })).toEqual({ name: 'MA', offset: 3 })
    vi.unstubAllGlobals()
  })
})

describe('compare target persistence (M5 WORK-001)', () => {
  it('round-trips a compare target and rejects malformed ones', () => {
    const stored = toStoredIndicator({
      name: 'COMPARE',
      compare: { exchange: 'BINANCE', market: 'spot', ticker: 'ETHUSDT', shortName: 'ETH', name: 'Ethereum' }
    })
    expect(stored?.compare).toEqual({
      exchange: 'BINANCE', market: 'spot', ticker: 'ETHUSDT', shortName: 'ETH', name: 'Ethereum'
    })
    expect(toStoredIndicator({ name: 'COMPARE', compare: { ticker: '' } })?.compare).toBeUndefined()
    expect(toStoredIndicator({ name: 'COMPARE', compare: 'ETHUSDT' })?.compare).toBeUndefined()
    expect(toStoredIndicator({ name: 'COMPARE', compare: { ticker: 'X'.repeat(100) } })?.compare).toBeUndefined()
  })
})
