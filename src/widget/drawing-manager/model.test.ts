import { describe, expect, it } from 'vitest'
import {
  drawingStyleSections, fromUserStyles, parsePoints, pointDrafts, toUserStyles, withLevelAwareStyles, withUserStyles
} from './model'
import {
  FIB_LEVEL_DEFAULTS, bandPairs, defaultLevelColor, fibLevels, isLevelVisible, levelColor, levelStylesOf, parseFibLevels, sanitizeLevelStyles, showLevelLabels, withAlpha
} from '../../extension/fibLevels'
import { positionSize } from '../../extension/position'

describe('drawing editor', () => {
  it('round trips UTC coordinates independently of local timezone and retains future-space anchors', () => {
    const points = [{ timestamp: 1700000000000, value: 42.25 }, { dataIndex: 600, value: -1 }, { value: 0 }]
    expect(parsePoints(pointDrafts(points))).toEqual(points)
    expect(parsePoints([{ time: '2023-11-14T22:13:20', value: '42.25' }])).toEqual([points[0]])
  })

  it('rejects blank, infinite and invalid coordinates', () => {
    for (const value of ['', ' ', 'Infinity', 'NaN', 'one']) expect(parsePoints([{ value }])).toBeNull()
    expect(parsePoints([{ time: '' }])).toBeNull()
    expect(parsePoints([{ time: 'invalid' }])).toBeNull()
  })

  it('maps editor fields onto every figure type and back', () => {
    const draft = { lineColor: '#ff0000', lineWidth: 3, lineStyle: 'dotted' as const, fillColor: '#00ff00', fillOpacity: 35, textColor: '#0000ff', textSize: 16 }
    const user = toUserStyles(draft)!
    expect(user.line).toEqual({ color: '#ff0000', size: 3, style: 'dashed', dashedValue: [1, 3] })
    expect(user.arc).toEqual(user.line)
    expect(user.rect).toEqual({ borderColor: '#ff0000', borderSize: 3, borderStyle: 'dashed', borderDashedValue: [1, 3], color: 'rgba(0, 255, 0, 0.35)' })
    expect(user.polygon).toEqual(user.rect)
    expect(user.text).toEqual({ color: '#0000ff', size: 16 })
    expect(fromUserStyles(user)).toEqual(draft)
    expect(toUserStyles({})).toBeUndefined()
  })

  it('stores only touched fields and keeps unrelated styles', () => {
    const user = toUserStyles({ lineColor: '#ff0000' })!
    expect(user).toEqual({ line: { color: '#ff0000' }, arc: { color: '#ff0000' }, polygon: { borderColor: '#ff0000' }, rect: { borderColor: '#ff0000' }, circle: { borderColor: '#ff0000' } })
    expect(withUserStyles({ text: { size: 14 }, user: { line: { color: '#000000' } } }, {})).toEqual({ text: { size: 14 } })
    expect(withUserStyles(undefined, {})).toBeNull()
  })

  it('offers sections that match each tool', () => {
    expect(drawingStyleSections('segment')).toEqual({ line: true, fill: false, text: false, levels: false, bands: false })
    expect(drawingStyleSections('rect')).toMatchObject({ line: true, fill: true })
    expect(drawingStyleSections('text')).toMatchObject({ line: false, text: true })
    // level tools style each level individually; the flat pickers would fight them
    expect(drawingStyleSections('fibonacciLine')).toEqual({ line: false, fill: false, text: false, levels: true, bands: true })
    expect(drawingStyleSections('fibonacciSegment')).toMatchObject({ levels: true, bands: true })
    expect(drawingStyleSections('fibonacciChannel')).toMatchObject({ fill: true, levels: true, bands: false })
    expect(drawingStyleSections('longPosition')).toEqual({ line: false, fill: false, text: false, levels: false, bands: false })
  })

  it('applies line opacity as rgba and keeps full opacity untouched', () => {
    const user = toUserStyles({ lineColor: '#ff0000', lineOpacity: 40 })!
    expect(user.line.color).toBe('rgba(255, 0, 0, 0.4)')
    expect(fromUserStyles(user)).toMatchObject({ lineColor: '#ff0000', lineOpacity: 40 })
    expect(toUserStyles({ lineColor: '#ff0000', lineOpacity: 100 })!.line.color).toBe('#ff0000')
    expect(toUserStyles({ lineColor: '#ff0000' })!.line.color).toBe('#ff0000')
  })

  it('marks text bold via the style weight', () => {
    const user = toUserStyles({ textColor: '#ffffff', textBold: true })!
    expect(user.text).toEqual({ color: '#ffffff', weight: 'bold' })
    expect(fromUserStyles(user)).toMatchObject({ textColor: '#ffffff', textBold: true })
  })

  it('carries the label box background via the user rect layer', () => {
    const user = toUserStyles({ textColor: '#ffffff', textBackground: '#2962ff' })!
    expect(user.rect).toEqual({ color: '#2962ff' })
    expect(fromUserStyles(user)).toMatchObject({ textColor: '#ffffff', textBackground: '#2962ff' })
    // unset background writes no rect layer
    expect(toUserStyles({ textColor: '#ffffff' })!.rect).toBeUndefined()
  })

  it('drops flat line and text fields for level tools so per-level colors survive', () => {
    // a level tool edited before the per-level feature carries a stale flat draft
    const staleDraft = { lineColor: '#000000', textColor: '#000000', fillColor: '#00ff00', fillOpacity: 30 }
    const next = withLevelAwareStyles(undefined, staleDraft, true)!
    expect(next.user.line).toBeUndefined()
    expect(next.user.text).toBeUndefined()
    // the fill is still an editable section and survives
    expect(next.user.polygon.color).toBe('rgba(0, 255, 0, 0.3)')
    // non-level tools keep the flat fields
    expect(withLevelAwareStyles(undefined, { lineColor: '#ff0000' }, false)!.user.line).toEqual({ color: '#ff0000' })
  })
})

describe('fibonacci level styles', () => {
  it('sanitizes per-level styles from editor and persisted values', () => {
    const raw = { 0.618: { color: '#089981', visible: false }, 1: { color: 'nope', visible: 'yes' }, junk: null }
    const clean = sanitizeLevelStyles(raw)!
    expect(clean).toEqual({ '0.618': { color: '#089981', visible: false } })
    expect(sanitizeLevelStyles({ 1: { color: 'nope' } })).toBeUndefined()
    expect(sanitizeLevelStyles(undefined)).toBeUndefined()
  })

  it('reads level styles, visibility and label toggle from extendData', () => {
    const overlay: any = { extendData: { levelStyles: { 0.5: { color: '#ff9800', visible: false } }, showLabels: false } }
    const styles = levelStylesOf(overlay)
    expect(levelStylesOf({ extendData: { levelStyles: 'junk' } } as any)).toEqual({})
    expect(styles['0.5'].color).toBe('#ff9800')
    expect(isLevelVisible(styles, 0.5)).toBe(false)
    expect(isLevelVisible(styles, 0.618)).toBe(true)
    expect(showLevelLabels(overlay)).toBe(false)
    expect(showLevelLabels({ extendData: {} } as any)).toBe(true)
  })

  it('falls back to the default level sequence when no override exists', () => {
    expect(defaultLevelColor(0.236)).toBe('#F23645')
    expect(defaultLevelColor(0.618)).toBe('#3F8D82')
    expect(defaultLevelColor(1.618)).toBe('#4891E7')
    expect(defaultLevelColor(2.5)).toBe('#787B86')
    expect(levelColor({}, 0)).toBe('#787B86')
    expect(levelColor({ 0: { color: '#123456' } }, 0)).toBe('#123456')
  })

  it('pairs adjacent levels by descending value for bands', () => {
    expect(bandPairs([0, 0.5, 1])).toEqual([[1, 0.5], [0.5, 0]])
    expect(bandPairs([0.618])).toEqual([])
  })

  it('applies alpha to palette hex colors', () => {
    expect(withAlpha('#F23645', 0.1)).toBe('rgba(242, 54, 69, 0.1)')
  })
})

describe('position tool risk settings', () => {
  it('computes position size from account risk and stop distance', () => {
    expect(positionSize(10_000, 1, 500)).toBe(0.2)
    expect(positionSize(0, 1, 500)).toBe(0)
    expect(positionSize(10_000, 0, 500)).toBe(0)
    expect(positionSize(10_000, 1, 0)).toBe(0)
  })
})

describe('fibonacci levels', () => {
  it('parses, dedupes and bounds user levels', () => {
    expect(parseFibLevels('0, 0.5 1;1.618 0.5')).toEqual([0, 0.5, 1, 1.618])
    expect(parseFibLevels('')).toBeNull()
    expect(parseFibLevels('0, abc')).toBeNull()
    expect(parseFibLevels('11')).toBeNull()
    expect(fibLevels({ name: 'fibonacciLine', extendData: { levels: [0, 1] } } as any, 'fibonacciLine')).toEqual([0, 1])
    expect(fibLevels({ name: 'fibonacciLine', extendData: { levels: [NaN] } } as any, 'fibonacciLine')).toEqual(FIB_LEVEL_DEFAULTS.fibonacciLine)
  })
})
