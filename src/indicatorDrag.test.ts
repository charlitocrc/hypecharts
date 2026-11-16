import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canDragIndicatorToMain } from './indicatorDrag'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor/klinecharts.js'), 'utf8')
const body = source.slice(source.indexOf("'use strict';"), source.lastIndexOf('}));'))
const core = new Function('exports', `${body}\nreturn { IndicatorTooltipView, ChartImp };`)({})

describe('indicator title dragging', () => {
  it('admits supported on-chart studies including repeated instances', () => {
    for (const name of ['VOL', 'VOL~2', 'EMA', 'MA~3', 'BOLL', 'COMPARE']) expect(canDragIndicatorToMain(name)).toBe(true)
    for (const name of ['RSI', 'RSI~2', 'MACD', 'unknown', '']) expect(canDragIndicatorToMain(name)).toBe(false)
  })

  it('reports actual title text bounds after wrapping without including value labels', () => {
    const view = Object.create(core.IndicatorTooltipView.prototype)
    view.createFigure = () => ({ draw: () => {} })
    const ctx = { measureText: (text: string) => ({ width: text.length * 5 }) }
    const rects: any[] = []
    const result = view.drawStandardTooltipLabels(ctx, { width: 100 }, [{ title: { text: '' }, value: { text: 'VOL(5,10,20)' } }], 85, 0, 18,
      { marginLeft: 4, marginTop: 3, marginRight: 4, marginBottom: 3, size: 12, family: 'sans-serif', weight: 'normal' }, (rect: any) => rects.push(rect))
    expect(rects).toEqual([{ x: 4, y: 21, width: 60, height: 12 }])
    expect(result[0]).toBe(68)
  })

  it('returns copied bounds only for a current pane', () => {
    const bounds = [{ indicatorName: 'VOL', x: 4, y: 3, width: 60, height: 12 }]
    const chart = Object.create(core.ChartImp.prototype)
    chart.getPaneById = (id: string) => id === 'current' ? { _indicatorTitleBounds: bounds } : null
    expect(chart.getIndicatorTitleBounds('removed')).toEqual([])
    const read = chart.getIndicatorTitleBounds('current')
    read[0].x = 100
    expect(bounds[0].x).toBe(4)
  })
})
