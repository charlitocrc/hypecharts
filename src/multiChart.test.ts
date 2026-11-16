import { describe, expect, it } from 'vitest'
import { ActionType, type KLineData } from 'klinecharts'
import type KLineChartPro from './KLineChartPro'
import type { ChartSelection, Period } from './types'
import { createChartSyncGroup } from './multiChart'
import { chartTimeAtIndex } from './multiChartTime'
const minute: Period = { multiplier: 1, timespan: 'minute', text: '1m' }
const five: Period = { multiplier: 5, timespan: 'minute', text: '5m' }
const bars = (from: number, count: number, step = 60000): KLineData[] => Array.from({ length: count }, (_, i) =>
  ({ timestamp: (from + i) * step, open: 1, high: 1, low: 1, close: 1 }))
function fixture (data: KLineData[], width = 300, period = minute, allowed = [minute, five]) {
  let bar = 10
  let offset = -10
  const realtimePadding = 50
  let disposed = false
  let selection: ChartSelection = { symbol: { ticker: 'BTC', exchange: 'TEST', market: 'perp' }, period, loading: false, dataReady: true, timeBased: true }
  let crosshair: { x?: number, paneId?: string } = {}
  const listeners = new Map<string, Set<(value: any) => void>>()
  const selections = new Set<(selection: ChartSelection) => void>()
  const disposers = new Set<() => void>()
  const counts = { symbol: 0, period: 0 }
  const emit = (type: string, value = {}) => listeners.get(type)?.forEach(listener => listener(value))
  const scale = {
    getBarSpace: () => ({ bar }), getOffsetRightBarCount: () => offset,
    coordinateToFloatIndex: (x: number) => data.length + offset - (width - x) / bar,
    dataIndexToCoordinate: (index: number) => width - (data.length + offset - index - 0.5) * bar,
    setBarSpace: (next: number) => { bar = next; emit(ActionType.OnVisibleRangeChange) },
    setViewport: (nextBar: number, nextOffset: number) => { bar = nextBar; offset = nextOffset; emit(ActionType.OnVisibleRangeChange) },
    getOffsetRightDistance: () => realtimePadding,
    setOffsetRightDistance: (next: number) => { offset = next / bar; emit(ActionType.OnVisibleRangeChange) }
  }
  const core = {
    getDataList: () => data, getSize: () => ({ width }),
    getChartStore: () => ({ getTimeScaleStore: () => scale, getCrosshairStore: () => ({
      set: (next: typeof crosshair) => { crosshair = next; emit(ActionType.OnCrosshairChange, next) }
    }) }),
    subscribeAction: (type: string, callback: (value: any) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(callback)
    },
    unsubscribeAction: (type: string, callback: (value: any) => void) => { listeners.get(type)?.delete(callback) }
  }
  const notify = () => selections.forEach(listener => listener(selection))
  const chart = {
    getChart: () => disposed ? null : core,
    getSelection: () => selection,
    subscribeSelectionChange: (listener: (value: ChartSelection) => void) => { selections.add(listener); return () => selections.delete(listener) },
    subscribeDispose: (listener: () => void) => { disposers.add(listener); return () => disposers.delete(listener) },
    setSymbol: (symbol: ChartSelection['symbol']) => { counts.symbol++; selection = { ...selection, symbol }; queueMicrotask(notify) },
    setPeriod: (period: Period) => {
      counts.period++
      selection = { ...selection, period: allowed.find(candidate => candidate.multiplier === period.multiplier && candidate.timespan === period.timespan) ?? allowed[0] }
      queueMicrotask(notify)
    }
  } as unknown as KLineChartPro
  return {
    chart, scale, counts, emit, notify,
    range: () => [chartTimeAtIndex(data, scale.coordinateToFloatIndex(0) - 0.5, selection.period),
      chartTimeAtIndex(data, data.length + offset - 0.5, selection.period)],
    crosshair: () => crosshair,
    widthWithoutEvent: (value: number) => { width = value },
    width: (value: number) => { width = value; emit(ActionType.OnVisibleRangeChange) },
    data: (value: KLineData[]) => { data = value; emit(ActionType.OnVisibleRangeChange) },
    select: (next: Partial<ChartSelection>) => { selection = { ...selection, ...next }; notify() },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) + selections.size + disposers.size,
    dispose: () => { disposers.forEach(listener => listener()); disposed = true }
  }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve() }

describe('timestamp chart synchronization', () => {
  it('aligns both endpoints with unequal histories and drawable widths', async () => {
    const a = fixture(bars(0, 100))
    const b = fixture(bars(20, 70), 150)
    const group = createChartSyncGroup()
    group.add(a.chart); group.add(b.chart)
    expect(b.range()[0]).toBeCloseTo(a.range()[0]!, 5)
    expect(b.range()[1]).toBeCloseTo(a.range()[1]!, 5)
    expect(b.scale.getBarSpace().bar).toBe(5)
    b.scale.setOffsetRightDistance(-30)
    await settle()
    expect(a.range()[0]).toBeCloseTo(b.range()[0]!, 5)
    expect(a.range()[1]).toBeCloseTo(b.range()[1]!, 5)
    group.destroy()
  })
  it('maps different intervals, preserves the range on resize and restores after follower history changes', async () => {
    const a = fixture(bars(0, 200), 300)
    const b = fixture(bars(0, 40, 300000), 300, five)
    const group = createChartSyncGroup()
    group.add(a.chart); group.add(b.chart)
    expect(b.range()[0]).toBeCloseTo(a.range()[0]!, 5)
    const before = [...a.range()]
    b.width(150)
    await settle()
    expect(b.range()[0]).toBeCloseTo(before[0]!, 5)
    expect(b.range()[1]).toBeCloseTo(before[1]!, 5)
    b.data(bars(-20, 60, 300000))
    await settle()
    expect(b.range()[0]).toBeCloseTo(before[0]!, 5)
    expect(b.range()[1]).toBeCloseTo(before[1]!, 5)
    group.destroy()
  })
  it('reads committed axis widths after range events without swallowing a user zoom', async () => {
    const a = fixture(bars(0, 200)), b = fixture(bars(0, 200), 150)
    const group = createChartSyncGroup()
    group.add(a.chart); group.add(b.chart)
    a.scale.setBarSpace(4)
    a.widthWithoutEvent(290) // vendor commits pane bounds after emitting its range event
    await settle()
    expect(a.scale.getBarSpace().bar).toBe(4)
    expect(b.range()[0]).toBeCloseTo(a.range()[0]!, 5)
    expect(b.range()[1]).toBeCloseTo(a.range()[1]!, 5)
    group.destroy()
  })

  it('maps crosshair time into the target candle, clears gaps, and uses its candle pane', () => {
    const a = fixture(bars(0, 100))
    const b = fixture(bars(0, 20, 300000), 300, five)
    const group = createChartSyncGroup({ range: false })
    group.add(a.chart); group.add(b.chart)
    a.emit(ActionType.OnCrosshairChange, { realDataIndex: 12, dataIndex: 12, x: 10, paneId: 'source-rsi' })
    expect(b.crosshair()).toEqual({ x: b.scale.dataIndexToCoordinate(2), paneId: 'candle_pane' })
    b.data(bars(0, 20, 300000).filter((_, i) => i !== 2))
    a.emit(ActionType.OnCrosshairChange, { realDataIndex: 12, dataIndex: 12, x: 10 })
    expect(b.crosshair()).toEqual({})
    a.emit(ActionType.OnCrosshairChange, {})
    expect(b.crosshair()).toEqual({})
    group.destroy()
  })
  it('aligns a late-loading follower and ignores synthetic charts', () => {
    const a = fixture(bars(0, 100))
    const b = fixture([])
    b.select({ loading: true, dataReady: false })
    const group = createChartSyncGroup()
    group.add(a.chart); group.add(b.chart)
    b.data(bars(20, 80))
    b.select({ loading: false, dataReady: true })
    expect(b.range()[0]).toBeCloseTo(a.range()[0]!, 5)
    b.select({ timeBased: false })
    const before = b.scale.getOffsetRightBarCount()
    a.scale.setOffsetRightDistance(-40)
    expect(b.scale.getOffsetRightBarCount()).toBe(before)
    group.destroy()
  })
})

describe('selection links and cleanup', () => {
  it('keeps symbol/period independent by default and links actual later selections on opt-in', async () => {
    const a = fixture(bars(0, 100)), b = fixture(bars(0, 100))
    const group = createChartSyncGroup({ range: false })
    group.add(a.chart); group.add(b.chart)
    a.select({ symbol: { ticker: 'ETH', exchange: 'TEST', market: 'spot' }, period: five })
    expect(b.counts).toEqual({ symbol: 0, period: 0 })
    group.setOptions({ symbol: true, period: true })
    await settle()
    expect(b.chart.getSelection()!.symbol.ticker).toBe('ETH')
    expect(b.chart.getSelection()!.period).toEqual(five)
    expect(a.counts).toEqual({ symbol: 0, period: 0 })
    group.destroy()
  })
  it('does not echo a follower interval snap back to the leader', async () => {
    const a = fixture(bars(0, 100)), b = fixture(bars(0, 100), 300, minute, [minute])
    const group = createChartSyncGroup({ range: false, period: true })
    group.add(a.chart); group.add(b.chart)
    a.select({ period: five })
    await settle()
    expect(a.chart.getSelection()!.period).toEqual(five)
    expect(b.chart.getSelection()!.period).toEqual(minute)
    expect(a.counts.period).toBe(0)
    group.destroy()
  })
  it('allows a follower user to take over while its linked history is still loading', async () => {
    const a = fixture(bars(0, 100)), b = fixture(bars(0, 100))
    b.select({ loading: true, dataReady: false })
    const group = createChartSyncGroup({ range: false, period: true })
    group.add(a.chart); group.add(b.chart)
    a.select({ period: five })
    await settle()
    b.select({ period: minute })
    await settle()
    expect(a.chart.getSelection()!.period).toEqual(minute)
    expect(b.chart.getSelection()!.loading).toBe(true)
    group.destroy()
  })

  it('unsubscribes on remove/re-add, automatic disposal and destroy', () => {
    const a = fixture(bars(0, 100)), b = fixture(bars(0, 100))
    const group = createChartSyncGroup()
    group.add(a.chart); group.add(b.chart)
    expect(b.listenerCount()).toBe(6)
    group.remove(b.chart)
    expect(b.listenerCount()).toBe(0)
    group.add(b.chart)
    expect(b.listenerCount()).toBe(6)
    b.dispose()
    expect(b.listenerCount()).toBe(0)
    group.destroy()
    expect(a.listenerCount()).toBe(0)
    group.add(a.chart)
    expect(a.listenerCount()).toBe(0)
  })
})
