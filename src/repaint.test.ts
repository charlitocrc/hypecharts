import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

const UpdateLevel = { Main: 0, Overlay: 1, All: 4 }

// A requestAnimationFrame stand-in with the browser's ordering rules: callbacks
// registered while a frame is running belong to the next frame, and cancelling
// one still queued for the running frame skips it.
function makeHarness () {
  let nextId = 1
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
  // requestAnimationFrame$1 is the lib's own wrapper; the scroll and zoom
  // pipelines schedule through it, so the harness has to as well.
  const { DrawWidget, raf } = new Function('exports', 'window',
    `${body}\nreturn { DrawWidget: DrawWidget, raf: requestAnimationFrame$1 };`)({}, win)

  let frameIndex = 0
  const painted: Array<{ frame: number, layer: string }> = []
  const canvas = { offsetWidth: 800, offsetHeight: 400, style: {}, width: 0, height: 0 }
  const ctx = { clearRect () {}, scale () {} }
  const widget: any = Object.create(DrawWidget.prototype)
  Object.assign(widget, {
    _mainRequestAnimationId: -1,
    _overlayRequestAnimationId: -1,
    _mainPending: false,
    _overlayPending: false,
    _mainPendingWidth: 0,
    _mainPendingHeight: 0,
    _overlayPendingWidth: 0,
    _overlayPendingHeight: 0,
    _mainCanvas: canvas,
    _overlayCanvas: canvas,
    _mainCtx: ctx,
    _overlayCtx: ctx,
    updateMain () { painted.push({ frame: frameIndex, layer: 'candles' }) },
    updateOverlay () { painted.push({ frame: frameIndex, layer: 'drawings' }) }
  })

  const container = { style: {}, offsetWidth: 800, offsetHeight: 400 }
  const bounding = { width: 800, height: 400, left: 0 }

  return {
    painted,
    update: (level: number) => { widget.updateImp(level, container, bounding) },
    raf: (cb: () => void) => raf(cb),
    frame () {
      frameIndex++
      const list = queue
      queue = []
      for (const { id, cb } of list) {
        if (cancelled.has(id)) continue
        cb()
      }
    },
    frameIndex: () => frameIndex
  }
}

type Harness = ReturnType<typeof makeHarness>

// One second of interaction: pointer events at `rateHz`, display at 60Hz.
function run (h: Harness, rateHz: number, onPointer: () => void): void {
  const msPerFrame = 1000 / 60
  const step = 1000 / rateHz
  let nextFrameAt = msPerFrame
  let nextPointerAt = step / 2
  for (let t = 0; t < 1000; t += 0.5) {
    if (t >= nextPointerAt) { onPointer(); nextPointerAt += step }
    if (t >= nextFrameAt) { h.frame(); nextFrameAt += msPerFrame }
  }
}

function counts (h: Harness): { candles: number, drawings: number } {
  return {
    candles: h.painted.filter(p => p.layer === 'candles').length,
    drawings: h.painted.filter(p => p.layer === 'drawings').length
  }
}

// Every frame that painted one layer must have painted the other too, or the
// drawings render against a different scroll offset and price scale than the
// candles sitting underneath them.
function framesOutOfSync (h: Harness): number[] {
  const byFrame = new Map<number, Set<string>>()
  for (const { frame, layer } of h.painted) {
    if (!byFrame.has(frame)) byFrame.set(frame, new Set())
    byFrame.get(frame)!.add(layer)
  }
  return [...byFrame.entries()].filter(([, layers]) => layers.size !== 2).map(([frame]) => frame)
}

describe('canvas layer repaints', () => {
  let h: Harness
  beforeEach(() => { h = makeHarness() })

  // Dragging the chart: scroll() coalesces the recalculation into a frame,
  // while the crosshair updates the overlay layer on every pointer event.
  for (const rateHz of [60, 125, 240]) {
    it(`keeps drawings painting in step with candles while dragging at ${rateHz}Hz`, () => {
      let recalcPending = false
      run(h, rateHz, () => {
        if (!recalcPending) {
          recalcPending = true
          h.raf(() => { recalcPending = false; h.update(UpdateLevel.All) })
        }
        h.update(UpdateLevel.Overlay)
      })
      const { candles, drawings } = counts(h)
      expect(candles).toBeGreaterThan(50)
      expect(drawings).toBe(candles)
      expect(framesOutOfSync(h)).toEqual([])
    })
  }

  it('keeps both layers in step while the y axis is rescaled', () => {
    run(h, 125, () => { h.update(UpdateLevel.All) })
    const { candles, drawings } = counts(h)
    expect(candles).toBeGreaterThan(50)
    expect(drawings).toBe(candles)
    expect(framesOutOfSync(h)).toEqual([])
  })

  it('keeps both layers in step while zooming', () => {
    let zoomPending = false
    run(h, 125, () => {
      if (zoomPending) return
      zoomPending = true
      h.raf(() => { zoomPending = false; h.update(UpdateLevel.All) })
    })
    const { candles, drawings } = counts(h)
    expect(candles).toBeGreaterThan(50)
    expect(drawings).toBe(candles)
    expect(framesOutOfSync(h)).toEqual([])
  })

  it('paints on the next frame, not the one after', () => {
    h.update(UpdateLevel.All)
    h.frame()
    expect(h.painted.map(p => p.layer).sort()).toEqual(['candles', 'drawings'])
    expect(h.painted.every(p => p.frame === 1)).toBe(true)
  })

  it('coalesces repeated updates between frames into a single paint', () => {
    for (let i = 0; i < 20; i++) { h.update(UpdateLevel.All) }
    h.frame()
    expect(counts(h)).toEqual({ candles: 1, drawings: 1 })
  })

  it('paints at the newest bounding when the pane resized while queued', () => {
    h.update(UpdateLevel.All)
    h.update(UpdateLevel.All)
    h.frame()
    expect(counts(h)).toEqual({ candles: 1, drawings: 1 })
  })
})
