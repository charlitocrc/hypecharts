import { describe, expect, it } from 'vitest'

import { getPositionCoordinates, getPositionStats, longPosition } from './position'
import { measure } from './measure'
import { createLabel, formatDuration, formatPercent, formatSigned, barsBetween, arrowHead } from './label'
import { bubblePointer, getText, labelAlignOf, labelBaselineOf } from './annotation'
import segment from './segment'
import { applyBarOffsets, shouldSample } from './brush'

describe('position', () => {
  const entry = { x: 100, y: 300 }

  it('places long targets above and stops below at 2:1', () => {
    const [e, target, stop] = getPositionCoordinates('longPosition', entry, 600, 6)
    expect(e).toEqual(entry)
    expect(target).toEqual({ x: 280, y: 240 })
    expect(stop).toEqual({ x: 280, y: 330 })
  })

  it('mirrors for shorts and keeps a minimum width when zoomed out', () => {
    const [, target, stop] = getPositionCoordinates('shortPosition', entry, 600, 1)
    expect(target).toEqual({ x: 220, y: 360 })
    expect(stop).toEqual({ x: 220, y: 270 })
  })

  it('reports reward/risk and percentages from prices', () => {
    const stats = getPositionStats(100, 110, 95)
    expect(stats.ratio).toBe(2)
    expect(stats.targetPercent).toBeCloseTo(10)
    expect(stats.stopPercent).toBeCloseTo(5)
    expect(getPositionStats(100, 110, 100).ratio).toBe(0)
  })

  it('keeps target and stop on the same right edge when either is dragged', () => {
    const points = [
      { timestamp: 1, dataIndex: 1, value: 100 },
      { timestamp: 9, dataIndex: 9, value: 110 },
      { timestamp: 9, dataIndex: 9, value: 95 }
    ]
    const move = longPosition.performEventPressedMove!
    points[2] = { timestamp: 20, dataIndex: 20, value: 90 }
    move({ currentStep: -1, mode: 'normal' as any, points, performPointIndex: 2, performPoint: points[2] })
    expect(points[1]).toEqual({ timestamp: 20, dataIndex: 20, value: 110 })
    points[1] = { timestamp: 5, dataIndex: 5, value: 120 }
    move({ currentStep: -1, mode: 'normal' as any, points, performPointIndex: 1, performPoint: points[1] })
    expect(points[2]).toEqual({ timestamp: 5, dataIndex: 5, value: 90 })
  })
})

describe('measure', () => {
  it('reads price change, percent, bars and time', () => {
    const m = measure({ x: 0, y: 0 }, { x: 60, y: 0 }, 200, 210, 0, 36 * 3600_000, 6)
    expect(m).toEqual({ change: 10, percent: '+5.00%', bars: 10, duration: '1d 12h', up: true })
  })

  it('handles falls, leftward drags and missing timestamps', () => {
    const m = measure({ x: 60, y: 0 }, { x: 0, y: 0 }, 200, 190, undefined, 5, 6)
    expect(m).toMatchObject({ change: -10, percent: '-5.00%', bars: -10, duration: null, up: false })
  })

  it('formats helpers', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(90 * 60_000)).toBe('1h 30m')
    expect(formatDuration(2 * 86400_000)).toBe('2d')
    expect(formatSigned(-1.5, 2)).toBe('-1.50')
    expect(formatPercent(1, 0)).toBe('—')
    expect(barsBetween(0, 10, 0)).toBe(0)
  })

  it('points arrow heads at the tip', () => {
    const [a, tip, b] = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 })
    expect(tip).toEqual({ x: 10, y: 0 })
    expect(a.x).toBeLessThan(10)
    expect(a.y).toBeCloseTo(-b.y)
  })
})

describe('labels', () => {
  it('sizes the box to the longest line and anchors by align/baseline', () => {
    const { box, figures } = createLabel(['ab', 'abcd'], { x: 100, y: 50 }, 'center', 'bottom', { color: '#fff', background: '#000', size: 10, padding: 5 })
    expect(box.width).toBe(34)
    expect(box.height).toBe(2 * 14 + 10)
    expect(box.x).toBe(100 - 17)
    expect(box.y + box.height).toBe(50)
    expect(figures[0].ignoreEvent).toBe(true)
    expect((figures[1].attrs as any[]).map(a => a.text)).toEqual(['ab', 'abcd'])
  })
})

describe('annotation', () => {
  it('reads text only from string extendData', () => {
    expect(getText({ extendData: { text: 'hi' } })).toBe('hi')
    expect(getText({ extendData: null })).toBe('')
    expect(getText({ extendData: { text: 3 } })).toBe('')
  })

  it('builds a pointer whose base straddles the box centre', () => {
    const [a, tip, b] = bubblePointer({ x: 0, y: 0, width: 20, height: 20 }, { x: 10, y: 60 })
    expect(tip).toEqual({ x: 10, y: 60 })
    expect([a.x, b.x].sort((p, q) => p - q)).toEqual([4, 16])
    expect(a.y).toBeCloseTo(10)
  })
})

describe('freehand', () => {
  it('shifts points by their sub-bar offset', () => {
    const coords = [{ x: 10, y: 1 }, { x: 20, y: 2 }]
    expect(applyBarOffsets(coords, [0.25, -0.5], 8)).toEqual([{ x: 12, y: 1 }, { x: 16, y: 2 }])
    expect(applyBarOffsets(coords, [0.25], 8)).toBe(coords)
    expect(applyBarOffsets(coords, undefined, 8)).toBe(coords)
  })

  it('samples only after the pointer travels a few pixels', () => {
    expect(shouldSample(null, { x: 0, y: 0 })).toBe(true)
    expect(shouldSample({ x: 0, y: 0 }, { x: 1, y: 2 })).toBe(false)
    expect(shouldSample({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true)
  })
})

describe('segment extend left/right (DRAW-003)', () => {
  const bounding = { width: 600, height: 300, left: 0, top: 0, right: 600, bottom: 300 } as any
  const call = (extendData: unknown): any => segment.createPointFigures!({
    overlay: { extendData } as any,
    coordinates: [{ x: 100, y: 200 }, { x: 300, y: 100 }],
    bounding,
    barSpace: { bar: 8, halfBar: 4 } as any,
    precision: { price: 2, volume: 2 },
    dateTimeFormat: undefined as any,
    defaultStyles: {} as any,
    xAxis: undefined as any,
    yAxis: undefined as any
  }) as any

  const figures = (extendData: unknown): any[] => [].concat(call(extendData))

  it('stays a plain segment without extend flags', () => {
    const [figure] = figures(undefined) as any[]
    expect(figure.attrs.coordinates).toEqual([{ x: 100, y: 200 }, { x: 300, y: 100 }])
    expect(figures({ extendLeft: false, extendRight: false })[0].attrs.coordinates)
      .toEqual([{ x: 100, y: 200 }, { x: 300, y: 100 }])
  })

  it('projects to the pane edges along the drawn slope', () => {
    const [left] = figures({ extendLeft: true }) as any[]
    expect(left.attrs.coordinates[0]).toEqual({ x: 0, y: 250 })
    expect(left.attrs.coordinates[1]).toEqual({ x: 300, y: 100 })
    const [right] = figures({ extendRight: true }) as any[]
    expect(right.attrs.coordinates[0]).toEqual({ x: 100, y: 200 })
    expect(right.attrs.coordinates[1]).toEqual({ x: 600, y: -50 })
    const [both] = figures({ extendLeft: true, extendRight: true }) as any[]
    expect(both.attrs.coordinates).toEqual([{ x: 0, y: 250 }, { x: 600, y: -50 }])
  })

  it('extends a vertical trend line across the pane', () => {
    const figuresV = segment.createPointFigures!({
      overlay: { extendData: { extendRight: true } } as any,
      coordinates: [{ x: 200, y: 250 }, { x: 200, y: 100 }],
      bounding,
      barSpace: { bar: 8, halfBar: 4 } as any,
      precision: { price: 2, volume: 2 },
      dateTimeFormat: undefined as any,
      defaultStyles: {} as any,
      xAxis: undefined as any,
      yAxis: undefined as any
    }) as any
    expect((figuresV as any[])[0].attrs.coordinates).toEqual([{ x: 200, y: 0 }, { x: 200, y: 300 }])
  })
})

describe('text label anchor and background (DRAW-003)', () => {
  it('defaults the anchor to top-left and honours extendData', () => {
    expect(labelAlignOf({ extendData: undefined } as any)).toBe('left')
    expect(labelBaselineOf({ extendData: undefined } as any)).toBe('top')
    expect(labelAlignOf({ extendData: { align: 'right' } } as any)).toBe('right')
    expect(labelBaselineOf({ extendData: { baseline: 'bottom' } } as any)).toBe('bottom')
    // junk falls back to defaults
    expect(labelAlignOf({ extendData: { align: 'up' } } as any)).toBe('left')
    expect(labelBaselineOf({ extendData: { baseline: 3 } } as any)).toBe('top')
  })

  it('anchors the label box at the chosen position', () => {
    const anchor = { x: 100, y: 100 }
    const style = { color: '#fff', background: 'rgba(0,0,0,0)', size: 14, family: 'Helvetica Neue', padding: 2 }
    const top = createLabel(['x'], anchor, 'left', 'top', style)
    expect(top.box.x).toBe(anchor.x)
    expect(top.box.y).toBe(anchor.y)
    const bottomRight = createLabel(['x'], anchor, 'right', 'bottom', style)
    expect(bottomRight.box.x).toBeLessThan(anchor.x)
    expect(bottomRight.box.y).toBeLessThan(anchor.y)
    const centered = createLabel(['x'], anchor, 'center', 'middle', style)
    expect(centered.box.x + centered.box.width / 2).toBe(anchor.x)
    expect(centered.box.y + centered.box.height / 2).toBe(anchor.y)
  })
})
