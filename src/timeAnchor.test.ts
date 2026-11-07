import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The core lib ships as a vendored UMD bundle that exports no internals, so
// strip the wrapper and hand back the one class under test.
function loadTimeScaleStore (): any {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'klinecharts.js')
  const source = readFileSync(path, 'utf-8')
  const start = source.indexOf("'use strict';")
  const end = source.lastIndexOf('}));')
  // eslint-disable-next-line no-new-func
  return new Function('exports', `${source.slice(start, end)}\nreturn TimeScaleStore;`)({})
}

const TimeScaleStore = loadTimeScaleStore()
const INTERVAL = 60_000
const ORIGIN = 1_700_000_000_000
const BAR_SPACE = 6

function bars (count: number, from = ORIGIN): Array<{ timestamp: number }> {
  return Array.from({ length: count }, (_, i) => ({ timestamp: from + i * INTERVAL }))
}

function makeStore (list: Array<{ timestamp: number }>) {
  const feed = { list }
  // Set the viewport fields directly: the setters walk back into stores this
  // stand-in does not have, and dataIndexToCoordinate only reads these three.
  const store: any = new TimeScaleStore({ getDataList: () => feed.list })
  store._totalBarSpace = 900
  store._barSpace = BAR_SPACE
  store._offsetRightBarCount = 8
  const xOf = (timestamp: number): number => store.dataIndexToCoordinate(store.timestampToDataIndex(timestamp))
  return { store, feed, xOf }
}

describe('overlay time anchoring', () => {
  it('holds a point drawn past the last bar when history is prepended', () => {
    const { store, feed, xOf } = makeStore(bars(500))

    // Five bars into the empty area to the right of the newest candle.
    const timestamp = store.dataIndexToTimestamp(504)
    expect(timestamp).toBe(ORIGIN + 504 * INTERVAL)
    expect(store.timestampToDataIndex(timestamp)).toBe(504)
    const x = xOf(timestamp)

    feed.list = bars(500, ORIGIN - 500 * INTERVAL).concat(feed.list)
    expect(store.timestampToDataIndex(timestamp)).toBe(1004)
    expect(xOf(timestamp)).toBe(x)
  })

  it('holds a point drawn before the first loaded bar', () => {
    const { store, feed, xOf } = makeStore(bars(500))

    const timestamp = ORIGIN - 10 * INTERVAL
    expect(store.timestampToDataIndex(timestamp)).toBe(-10)
    const x = xOf(timestamp)

    feed.list = bars(500, ORIGIN - 500 * INTERVAL).concat(feed.list)
    expect(store.timestampToDataIndex(timestamp)).toBe(490)
    expect(xOf(timestamp)).toBe(x)
  })

  it('holds an on-chart point across a prepend, and slides it on a new bar', () => {
    const { store, feed, xOf } = makeStore(bars(500))

    const timestamp = ORIGIN + 300 * INTERVAL
    expect(store.timestampToDataIndex(timestamp)).toBe(300)
    const x = xOf(timestamp)

    feed.list = bars(500, ORIGIN - 500 * INTERVAL).concat(feed.list)
    expect(store.timestampToDataIndex(timestamp)).toBe(800)
    expect(xOf(timestamp)).toBe(x)

    // A new bar slides the whole chart one bar left; the anchor slides with it.
    feed.list = feed.list.concat(bars(1, ORIGIN + 500 * INTERVAL))
    expect(xOf(timestamp)).toBe(x - BAR_SPACE)
  })

  it('estimates the bar interval from the smallest recent gap', () => {
    const list = bars(500)
    list[499] = { timestamp: list[498].timestamp + INTERVAL * 4 }
    const { store } = makeStore(list)
    expect(store.dataIndexToTimestamp(500)).toBe(list[499].timestamp + INTERVAL)
  })

  it('returns no timestamp outside the range with nothing to extrapolate from', () => {
    expect(makeStore([]).store.dataIndexToTimestamp(3)).toBeNull()
    expect(makeStore(bars(1)).store.dataIndexToTimestamp(3)).toBeNull()
  })
})
