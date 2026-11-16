import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { indicatorLayoutChanges, storedIndicatorPanes, toStoredIndicatorLayout } from './persist'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor/klinecharts.js'), 'utf8')
const body = source.slice(source.indexOf("'use strict';"), source.lastIndexOf('}));'))
const { ChartImp, ChartEvent, SeparatorWidget } = new Function('exports', `${body}\nreturn { ChartImp, ChartEvent, SeparatorWidget };`)({})

describe('persisted pane membership and order', () => {
  it('round-trips shared pane identity and groups by first visual occurrence', () => {
    const layout = toStoredIndicatorLayout({ main: [], sub: [
      { name: 'RSI', pane: 'pane_b', height: 150 },
      { name: 'VOL', pane: 'pane_a', height: 120 },
      { name: 'EMA', pane: 'pane_b', height: 999 }
    ] })!
    expect(toStoredIndicatorLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
    const panes = storedIndicatorPanes(layout.sub)
    expect(panes.map(pane => pane.id)).toEqual(['pane_b', 'pane_a'])
    expect(panes[0].indicators.map(item => item.name)).toEqual(['RSI', 'EMA'])
    expect(panes[0].height).toBe(150)
  })

  it('migrates each legacy study into its own pane without identity collisions', () => {
    const panes = storedIndicatorPanes([{ name: 'RSI' }, { name: 'EMA', pane: 'saved_pane_0' }, { name: 'VOL' }])
    expect(panes).toHaveLength(3)
    expect(new Set(panes.map(pane => pane.id)).size).toBe(3)
    expect(panes[1].id).toBe('saved_pane_0')
  })

  it('rejects reserved/malformed identities and duplicate instance placements', () => {
    expect(toStoredIndicatorLayout({ main: [{ name: 'EMA', pane: 'shared' }], sub: [
      { name: 'EMA', pane: 'shared' }, { name: 'RSI', pane: 'candle_pane' },
      { name: 'VOL', pane: 'xaxis_pane' }, { name: 'MACD', pane: '<script>' }
    ] })).toEqual({ main: [{ name: 'EMA' }], sub: [{ name: 'RSI' }, { name: 'VOL' }, { name: 'MACD' }] })
  })

  it('relocates only a changed member while retaining its shared-pane neighbor', () => {
    const current = { main: [], sub: [{ name: 'RSI', pane: 'shared' }, { name: 'EMA', pane: 'shared' }] }
    const next = { main: [], sub: [{ name: 'RSI', pane: 'shared' }, { name: 'EMA', pane: 'separate' }] }
    expect(indicatorLayoutChanges(current, next)).toEqual({
      remove: [{ main: false, item: current.sub[1] }], add: [{ main: false, item: next.sub[1] }], update: []
    })
  })

  it('reorders pane snapshots without removing or recalculating studies', () => {
    const a = { name: 'VOL', pane: 'a' }, b = { name: 'RSI', pane: 'b' }
    expect(indicatorLayoutChanges({ main: [], sub: [a, b] }, { main: [], sub: [b, a] })).toEqual({ remove: [], add: [], update: [] })
    expect(storedIndicatorPanes([b, a]).map(pane => pane.id)).toEqual(['b', 'a'])
  })
})

function coreHarness () {
  const children = ['candle_pane', 'sa', 'a', 'sb', 'b', 'sc', 'c', 'xAxis']
  const root = { insertBefore: (child: string, before: string) => {
    children.splice(children.indexOf(child), 1)
    children.splice(children.indexOf(before), 0, child)
  } }
  const makePane = (id: string): any => ({ id, top: null, bottom: null,
    getId: () => id, getContainer: () => id,
    getSeparatorWidget: () => ({ getContainer: () => `s${id}` }),
    setTopPane (pane: any) { this.top = pane }, setBottomPane (pane: any) { this.bottom = pane }
  })
  const panes = ['candle_pane', 'a', 'b', 'c'].map(makePane)
  const chart = Object.create(ChartImp.prototype)
  let adjustments = 0
  Object.assign(chart, { _panes: new Map(panes.map(pane => [pane.id, pane])), _chartContainer: root,
    _chartEvent: { cancelViewportAnimation: () => {} }, _xAxisPane: { getContainer: () => 'xAxis' },
    _chartStore: { getCrosshairStore: () => ({ set: () => {} }) }, adjustPaneViewport: () => { adjustments++ } })
  return { chart, panes, children, adjustments: () => adjustments }
}

describe('core pane ordering', () => {
  it('keeps objects, DOM and separator neighbor links in the same order', () => {
    const { chart, panes, children, adjustments } = coreHarness()
    expect(chart.setPaneOrder(['c', 'a', 'b'])).toBe(true)
    expect(chart.getPaneOrder()).toEqual(['c', 'a', 'b'])
    expect(children).toEqual(['candle_pane', 'sc', 'c', 'sa', 'a', 'sb', 'b', 'xAxis'])
    expect(panes[0].top).toBeNull()
    expect(panes[0].bottom).toBe(panes[3])
    expect(panes[3].top).toBe(panes[0])
    expect(panes[3].bottom).toBe(panes[1])
    expect(panes[2].bottom).toBeNull()
    expect(adjustments()).toBe(1)
  })

  it('rejects incomplete, duplicate, unknown and price-pane orders atomically', () => {
    const { chart, adjustments } = coreHarness()
    for (const order of [['a'], ['a', 'a', 'b'], ['a', 'b', 'missing'], ['a', 'b', 'candle_pane'], ['a', 'b', 'c']]) expect(chart.setPaneOrder(order)).toBe(false)
    expect(chart.getPaneOrder()).toEqual(['a', 'b', 'c'])
    expect(adjustments()).toBe(0)
  })
})


describe('pane separator gestures', () => {
  it('prioritizes the whole separator hit area over either adjacent plot', () => {
    const separator = { getBounding: () => ({ left: 0, top: 97, width: 500 }) }
    const a = { getSeparatorWidget: () => null, getBounding: () => ({ left: 0, top: 0, width: 500, height: 100 }) }
    const b = { getSeparatorWidget: () => separator, getBounding: () => ({ left: 0, top: 100, width: 500, height: 100 }) }
    const event = Object.create(ChartEvent.prototype)
    event._chart = { getAllPanes: () => new Map<string, typeof a | typeof b>([['a', a], ['b', b]]) }
    for (const y of [97, 99, 100, 101, 104]) {
      expect(event._findWidgetByEvent({ x: 250, y })).toEqual({ pane: b, widget: separator })
    }
  })

  it('resizes current neighbors and reports the pane ID as a string', () => {
    const events: any[] = []
    const previous = { height: 100, getOptions: () => ({ minHeight: 30 }), setBounding ({ height }: any) { this.height = height } }
    const pane = { height: 100, getId: () => 'shared', getTopPane: () => previous, getOptions: () => ({ dragEnabled: true, minHeight: 30 }),
      setBounding ({ height }: any) { this.height = height },
      getChart: () => ({ adjustPaneViewport: () => {}, getChartStore: () => ({ getActionStore: () => ({ execute: (type: string, data: any) => events.push({ type, data }) }) }) })
    }
    const separator = Object.create(SeparatorWidget.prototype)
    Object.assign(separator, { _dragStartY: 0, _topPaneHeight: 100, _currentPaneHeight: 100, getPane: () => pane })
    separator._pressedTouchMouseMoveEvent({ pageY: 15 })
    expect(previous.height).toBe(115)
    expect(pane.height).toBe(85)
    expect(events).toEqual([{ type: 'onPaneDrag', data: { paneId: 'shared' } }])
  })
})
