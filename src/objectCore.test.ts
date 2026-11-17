import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor/klinecharts.js'), 'utf8')
const body = source.slice(source.indexOf("'use strict';"), source.lastIndexOf('}));'))
const { ChartImp, SyntheticEvent } = new Function('exports', `${body}\nreturn { ChartImp, SyntheticEvent };`)({})
describe('core object management boundaries', () => {
  it('reorders owned layers while retaining host objects and slots', () => {
    const a = { id: 'a', groupId: 'drawing_tools' }, host = { id: 'order', groupId: 'orders' }, b = { id: 'b', groupId: 'drawing_tools' }
    const items = [a, host, b], chart = Object.create(ChartImp.prototype)
    chart._chartStore = { getOverlayStore: () => ({ getInstances: () => items }) };chart.updatePane = () => {}
    expect(chart.setOverlayOrder('candle_pane', 'drawing_tools', ['b', 'a'])).toBe(true)
    expect(items).toEqual([b, host, a]);expect(items[1]).toBe(host)
    expect(chart.setOverlayOrder('candle_pane', 'drawing_tools', ['order', 'a'])).toBe(false)
    expect(chart.setOverlayOrder('candle_pane', 'drawing_tools', ['b', 'b'])).toBe(false)
    expect(items).toEqual([b, host, a])
  })
  it('preserves modifier keys on canvas selection events', () => {
    const synthetic = Object.create(SyntheticEvent.prototype)
    synthetic._getBoundingRect = () => ({ left: 10, top: 20 })
    const event = synthetic._makeCompatEvent({ type: 'click', clientX: 30, clientY: 40, ctrlKey: true, shiftKey: true, metaKey: false })
    expect(event).toMatchObject({ x: 20, y: 20, ctrlKey: true, shiftKey: true, metaKey: false })
  })
})

describe('rapid canvas clicks', () => {
  it.each([{ distance: 100, ctrlKey: false, doubles: 0 }, { distance: 0, ctrlKey: true, doubles: 0 }, { distance: 0, ctrlKey: false, doubles: 1 }])('delivers the second click with $distance pixel separation and ctrl=$ctrlKey', ({ distance, ctrlKey, doubles }) => {
    const clicks: string[] = []
    const synthetic = Object.create(SyntheticEvent.prototype)
    Object.assign(synthetic, { _clickCount: 1, _clickTimeoutId: 1, _cancelClick: false, _unsubscribeRootMouseEvents: null,
      _makeCompatEvent: (event: any) => event, _firesTouchEvents: () => false,
      _handler: { mouseUpEvent: 'up', mouseClickEvent: 'click', mouseDoubleClickEvent: 'double' },
      _processEvent: (_event: any, handler: string) => clicks.push(handler), _getCoordinate: () => ({}),
      _mouseTouchMoveWithDownInfo: () => ({ manhattanDistance: distance }), _resetClickTimeout: () => {} })
    synthetic._mouseUpHandler({ button: 0, ctrlKey })
    expect(clicks.filter(type => type === 'click')).toHaveLength(1)
    expect(clicks.filter(type => type === 'double')).toHaveLength(doubles)
  })
})
