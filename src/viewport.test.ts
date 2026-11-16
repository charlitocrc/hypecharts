import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function harness () {
  let id = 0
  let queue: Array<{ id: number, callback: () => void }> = []
  const cancelled = new Set<number>()
  const window = {
    requestAnimationFrame: (callback: () => void) => { queue.push({ id: ++id, callback }); return id },
    cancelAnimationFrame: (value: number) => { cancelled.add(value) }
  }
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'klinecharts.js'), 'utf8')
  const body = source.slice(source.indexOf("'use strict';"), source.lastIndexOf('}));'))
  const classes = new Function('exports', 'window', `${body}\nreturn { TimeScaleStore, ChartImp, ChartEvent };`)({}, window)
  const data = Array.from({ length: 1000 }, (_, i) => ({ timestamp: i * 60000, open: 1, high: 2, low: 0, close: 1 }))
  const events: Array<{ type: string, bar: number, offset: number }> = []
  const chart = Object.create(classes.ChartImp.prototype)
  const store = {
    getDataList: () => data,
    getActionStore: () => ({ execute: (type: string) => { events.push({ type, bar: scale.getBarSpace().bar, offset: scale.getOffsetRightBarCount() }) } }),
    getCrosshairStore: () => ({ recalculate: () => {} }),
    adjustVisibleDataList: () => {},
    getChart: () => chart,
    getTimeScaleStore: () => scale
  }
  const scale = new classes.TimeScaleStore(store)
  const event = Object.create(classes.ChartEvent.prototype)
  Object.assign(event, { _chart: chart, _wheelZoomRemaining: 0, _wheelZoomCoordinate: null, _wheelZoomRequestId: null,
    _wheelYZoomRemaining: 0, _wheelYZoomTarget: null, _wheelYZoomRequestId: null,
    _pendingYExtremum: null, _pendingYExtremumAxis: null, _pendingYExtremumRequestId: null })
  Object.assign(chart, { _chartStore: store, _chartEvent: event, _zoomAnimationRequestId: null, _scrollAnimationRequestId: null,
    adjustPaneViewport: () => {} })
  scale.setTotalBarSpace(600)
  events.length = 0
  return { chart, scale, event, events,
    frame: () => { const callbacks = queue; queue = []; callbacks.forEach(item => { if (!cancelled.has(item.id)) item.callback() }) }
  }
}

describe('atomic viewport and reset against the vendored core', () => {
  it('keeps realtime padding unchanged while synchronizing historical scroll and zoom', () => {
    const { scale, events } = harness()
    scale.setViewport(2, -500)
    expect(scale.getOffsetRightDistance()).toBe(50)
    expect(events.filter(event => event.type === 'onVisibleRangeChange')).toEqual([
      { type: 'onVisibleRangeChange', bar: 2, offset: -500 }
    ])
  })

  it('returns to the latest candles after a historical sync, not to its historical baseline', () => {
    const { chart, scale } = harness()
    scale.setViewport(12, -900)
    chart.resetViewport()
    expect(scale.getBarSpace().bar).toBe(6)
    expect(scale.getOffsetRightBarCount()).toBeCloseTo(50 / 6)
    expect(scale.getVisibleRange().to).toBe(1000)
    expect(scale.getVisibleRange().from).toBeGreaterThan(800)
  })

  it('cancels queued scroll, zoom, wheel and price drag work so reset stays reset', () => {
    const { chart, scale, event, frame } = harness()
    let priceApplications = 0
    chart.zoomAtCoordinate(3, { x: 200 }, 180)
    chart.scrollByDistance(500, 100)
    event._queueWheelZoom(-1, { x: 200 })
    scale.zoom(1, { x: 200 })
    event._applyYExtremum({ setExtremum: () => { priceApplications++ } }, { min: 100, max: 200 })
    chart.resetViewport()
    for (let i = 0; i < 20; i++) frame()
    expect(scale.getBarSpace().bar).toBe(6)
    expect(scale.getOffsetRightBarCount()).toBeCloseTo(50 / 6)
    expect(priceApplications).toBe(0)
  })
})
