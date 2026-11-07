import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// Live-scale easing (follow-up to the violent-rescale report): data-driven
// rescales must chase the target extremum over WALL-CLOCK time (buildTicks
// runs several times per frame, so a per-call factor converges before the
// first paint), while a moved viewport adopts the new scale immediately.
const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'klinecharts.js')
const source = readFileSync(path, 'utf-8')
const body = source.slice(source.indexOf("'use strict';"), source.lastIndexOf('}));'))
const { YAxisImp } = new Function('exports', `${body}\nreturn { YAxisImp: YAxisImp };`)({})

const EXTREMUM = (min: number, max: number) => ({ min, max, range: Math.abs(max - min), realMin: min, realMax: max, realRange: Math.abs(max - min) })

interface Rig {
  axis: any
  setViewport (from: number, to: number, bar: number): void
  readExtremum (): { min: number, max: number }
}

let fakeNow = 1_000_000
// The vendor calls Date.now dynamically at call time, so a global stub works.
// It stays installed for the whole file (workers are per-file); tests reset
// fakeNow through afterEach below.
Date.now = () => fakeNow
afterEach(() => { fakeNow = 1_000_000 })

function makeRig (calcResult: () => { min: number, max: number, range: number, realMin: number, realMax: number, realRange: number }): Rig {
  const axis = Object.create(YAxisImp.prototype)
  axis._extremum = { min: 0, max: 0, range: 0, realMin: 0, realMax: 0, realRange: 0 }
  axis._prevExtremum = axis._extremum
  axis._ticks = []
  axis._autoCalcTickFlag = true
  axis._displayExtremum = null
  axis.calcExtremum = calcResult
  const viewport = { from: 0, to: 100, bar: 8 }
  axis.getParent = () => ({
    getChart: () => ({
      getChartStore: () => ({
        getTimeScaleStore: () => ({
          getVisibleRange: () => ({ from: viewport.from, to: viewport.to }),
          getBarSpace: () => ({ bar: viewport.bar })
        })
      })
    })
  })
  axis.optimalTicks = (ticks: unknown) => ticks
  return {
    axis,
    setViewport (from, to, bar) { viewport.from = from; viewport.to = to; viewport.bar = bar },
    readExtremum () { return { min: axis._extremum.min, max: axis._extremum.max } }
  }
}

describe('y-axis live-scale easing', () => {
  it('eases over wall-clock time: same-instant repaints do not advance it', () => {
    let target = EXTREMUM(100, 110)
    const rig = makeRig(() => target)
    rig.axis.buildTicks(false)
    expect(rig.readExtremum()).toEqual({ min: 100, max: 110 })

    // One big trade grows the range; same-instant buildTicks calls (the
    // several-per-frame pipelines) must not advance the ease further — only
    // elapsed time does.
    target = EXTREMUM(100, 130)
    rig.axis.buildTicks(false)
    const afterFirstFrame = rig.readExtremum().max
    for (let i = 0; i < 10; i++) rig.axis.buildTicks(false)
    expect(rig.readExtremum().max).toBe(afterFirstFrame)

    // Frames carry the ease forward (~16ms cadence, half-life ≈ 5 frames).
    for (let i = 0; i < 2; i++) { fakeNow += 16; rig.axis.buildTicks(false) }
    const progressed = rig.readExtremum()
    expect(progressed.max).toBeGreaterThan(afterFirstFrame)
    expect(progressed.max).toBeLessThan(120)

    // After ~400ms more it is fully settled.
    for (let i = 0; i < 80; i++) { fakeNow += 16; rig.axis.buildTicks(false) }
    expect(rig.readExtremum().max).toBe(130)
    expect(rig.readExtremum().min).toBe(100)
  })

  it('converges smoothly across paint times', () => {
    let target = EXTREMUM(100, 110)
    const rig = makeRig(() => target)
    rig.axis.buildTicks(false)
    target = EXTREMUM(100, 130)
    const ys: number[] = []
    for (const stepMs of [16, 16, 16, 32, 64, 128]) {
      fakeNow += stepMs
      rig.axis.buildTicks(false)
      ys.push(rig.readExtremum().max)
    }
    // strictly increasing, monotone toward the target
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1])
    // and settles exactly after enough time
    for (let i = 0; i < 80; i++) { fakeNow += 16; rig.axis.buildTicks(false) }
    expect(rig.readExtremum().max).toBe(130)
  })

  it('snaps immediately when the viewport moves (zoom, pan)', () => {
    let target = EXTREMUM(100, 110)
    const rig = makeRig(() => target)
    rig.axis.buildTicks(false)

    // Zoom: the bar space changed — adopt the new scale at once.
    target = EXTREMUM(80, 120)
    rig.setViewport(0, 100, 6)
    rig.axis.buildTicks(false)
    expect(rig.readExtremum()).toEqual({ min: 80, max: 120 })

    // Pan: the visible range shifted — same immediate adoption.
    target = EXTREMUM(60, 90)
    rig.setViewport(5, 105, 6)
    rig.axis.buildTicks(false)
    expect(rig.readExtremum()).toEqual({ min: 60, max: 90 })
  })

  it('snaps on forced rebuilds and manual scale handoff', () => {
    let target = EXTREMUM(100, 110)
    const rig = makeRig(() => target)
    rig.axis.buildTicks(false)

    // force === true (resize / forced y-axis rebuild) bypasses the ease.
    target = EXTREMUM(0, 200)
    rig.axis.buildTicks(true)
    expect(rig.readExtremum()).toEqual({ min: 0, max: 200 })

    // Manual scale (setExtremum) invalidates the eased display; while manual
    // mode holds, buildTicks keeps the set scale. Re-enabling auto mode snaps
    // to the then-current target instead of lerping from the manual scale.
    rig.axis.setExtremum(EXTREMUM(500, 600))
    expect(rig.readExtremum()).toEqual({ min: 500, max: 600 })
    rig.axis.buildTicks(false)
    expect(rig.readExtremum()).toEqual({ min: 500, max: 600 })
    target = EXTREMUM(10, 20)
    rig.setViewport(1, 101, 8)
    rig.axis.setAutoCalcTickFlag(true)
    rig.axis.buildTicks(false)
    expect(rig.readExtremum()).toEqual({ min: 10, max: 20 })
  })

  it('stays snapped when nothing changes', () => {
    const target = EXTREMUM(100, 110)
    const rig = makeRig(() => target)
    rig.axis.buildTicks(false)
    fakeNow += 500
    for (let i = 0; i < 5; i++) rig.axis.buildTicks(false)
    expect(rig.readExtremum()).toEqual({ min: 100, max: 110 })
  })
})
