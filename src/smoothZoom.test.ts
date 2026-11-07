import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

function makeHarness () {
  let nextId = 1
  let now = 0
  let queue: Array<{ id: number, cb: () => void }> = []
  const cancelled = new Set<number>()
  const win = {
    requestAnimationFrame (cb: () => void) { const id = nextId++; queue.push({ id, cb }); return id },
    cancelAnimationFrame (id: number) { cancelled.add(id) }
  }

  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'klinecharts.js')
  const source = readFileSync(path, 'utf-8')
  const body = source.slice(source.indexOf("'use strict';"), source.lastIndexOf('}));'))
  // eslint-disable-next-line no-new-func
  const classes = new Function('exports', 'window',
    `${body}\nreturn { ChartEvent: ChartEvent, ChartImp: ChartImp };`)({}, win) as any

  return {
    ...classes,
    now: () => now,
    hasFrames: () => queue.length > 0,
    frame () {
      now += 1000 / 60
      const callbacks = queue
      queue = []
      callbacks.forEach(({ id, cb }) => { if (!cancelled.has(id)) cb() })
    }
  }
}

const realDateNow = Date.now

afterEach(() => {
  Date.now = realDateNow
})

describe('smooth zoom', () => {
  it('eases one wheel notch across multiple small frames', () => {
    const h = makeHarness()
    const scales: number[] = []
    const store = { zoom: (scale: number) => { scales.push(scale) } }
    const event = Object.create(h.ChartEvent.prototype)
    Object.assign(event, {
      _chart: { getChartStore: () => ({ getTimeScaleStore: () => store }) },
      _wheelZoomRemaining: 0,
      _wheelZoomCoordinate: null,
      _wheelZoomRequestId: null
    })

    event._queueWheelZoom(1, { x: 300, y: 100 })
    for (let i = 0; i < 60 && h.hasFrames(); i++) h.frame()

    // Still eased across several frames (smooth), but snappier than the old
    // 0.26 decay: a notch lands within ~8 frames and applies the full 10%
    // bar-space step instead of the old 7.2%.
    expect(scales.length).toBeGreaterThan(4)
    expect(scales.length).toBeLessThan(20)
    expect(Math.max(...scales)).toBeLessThan(0.5)
    expect(scales.reduce((sum, scale) => sum + scale, 0)).toBeCloseTo(1, 3)
  })

  it('lands an animated zoom on its target without overshooting', () => {
    const h = makeHarness()
    Date.now = h.now
    let barSpace = 6
    const samples: number[] = []
    const store = {
      getBarSpace: () => ({ bar: barSpace }),
      zoom: (scale: number) => {
        barSpace *= 1 + scale / 10
        samples.push(barSpace)
      }
    }
    const chart = Object.create(h.ChartImp.prototype)
    Object.assign(chart, {
      _chartStore: { getTimeScaleStore: () => store },
      _zoomAnimationRequestId: null
    })

    chart.zoomAtCoordinate(1.12, { x: 300, y: 100 }, 180)
    for (let i = 0; i < 30 && h.hasFrames(); i++) h.frame()

    expect(samples.length).toBeGreaterThan(5)
    expect(Math.max(...samples)).toBeLessThanOrEqual(6 * 1.12 + 1e-10)
    expect(barSpace).toBeCloseTo(6 * 1.12, 5)
  })

  it('eases a price-axis wheel notch around the cursor and settles short of it', () => {
    const h = makeHarness()
    let extremum = { min: 0, max: 100, range: 100, realMin: 0, realMax: 100, realRange: 100 }
    const applied: Array<{ range: number }> = []
    const yAxis = {
      convertFromPixel: (y: number) => y,
      getExtremum: () => extremum,
      convertToRealValue: (v: number) => v,
      setExtremum: (next: { min: number, max: number, range: number, realMin: number, realMax: number, realRange: number }) => {
        extremum = next
        applied.push({ range: next.range })
      }
    }
    const pane = { getAxisComponent: () => yAxis, getYAxisWidget: () => ({ getBounding: () => ({ height: 300 }) }) }
    const event = Object.create(h.ChartEvent.prototype)
    Object.assign(event, {
      _chart: { adjustPaneViewport: () => {} },
      _wheelYZoomRemaining: 0,
      _wheelYZoomTarget: null,
      _wheelYZoomRequestId: null
    })

    // Wheel up zooms in: the range shrinks around the anchor (y=50, the
    // middle of the 0-100 range on a 300px axis).
    event._queueWheelYZoom(1, pane, 50)
    for (let i = 0; i < 60 && h.hasFrames(); i++) h.frame()

    expect(applied.length).toBeGreaterThan(4)
    // The anchor keeps its value: min/max converge on y=225 proportionally.
    const last = extremum
    expect(last.min).toBeGreaterThan(0)
    expect(last.max).toBeLessThan(100)
    expect(last.min).toBeCloseTo(50 * (1 - last.range / 100), 5)
    expect(last.max).toBeCloseTo(last.min + last.range, 5)
    // Eased steps compose multiplicatively, so the settled range lands just
    // above the exact 10% step.
    expect(last.range).toBeGreaterThan(89.9)
    expect(last.range).toBeLessThan(90.5)
  })

  it('coalesces burst drag-scaling into one extremum application per frame', () => {
    const h = makeHarness()
    const applied: number[] = []
    const yAxis = {
      convertToRealValue: (v: number) => v,
      setExtremum: (next: { min: number }) => { applied.push(next.min) }
    }
    const chart = { adjustPaneViewport: () => {} }
    const event = Object.create(h.ChartEvent.prototype)
    Object.assign(event, {
      _chart: chart,
      _pendingYExtremum: null,
      _pendingYExtremumAxis: null,
      _pendingYExtremumRequestId: null
    })

    event._applyYExtremum(yAxis, { min: 1 })
    event._applyYExtremum(yAxis, { min: 2 })
    event._applyYExtremum(yAxis, { min: 3 })
    expect(applied).toEqual([])
    h.frame()
    expect(applied).toEqual([3])
    h.frame()
    expect(applied).toEqual([3])
  })
})
